#!/usr/bin/env bun
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';

export type Config = { projects: Record<string, string> };

export const DEFAULT_PROFILE = 'default';

/**
 * What a profile shares with ~/.claude. The rule is "directories share, regular
 * files don't", which lands right almost everywhere: dir contents are keyed by
 * session id / pid / hash so they merge cleanly, while the top-level files are
 * account identity, server-pushed policy, or per-config-dir scratch state.
 *
 * DETAIL: it also sidesteps a failure mode — a shared *file* is a symlink, and
 * anything written via write-tmp-then-rename replaces that symlink with a real
 * file, silently un-sharing it. Only append-only files are safe to share.
 */
const PRIVATE_DIRS = new Set(['daemon', 'backups']); // per-config-dir IPC state; backups of the private .claude.json
const SHARED_FILES = new Set(['history.jsonl']); // append-only, carries no identity
const SEED_FILES = new Set(['settings.json', 'CLAUDE.md']); // private, but copied once so a new profile isn't bare

const BEGIN = '# >>> claude-as >>> (managed by `claude-as install`; do not edit)';
const END = '# <<< claude-as <<<';

const RESERVED = new Set(['install', 'uninstall', 'ls', 'help', '--help', '-h', '--exec-env']);

export function resolveProfile(cfg: Config, dir: string): string {
  let best = '';
  for (const path of Object.keys(cfg.projects)) {
    if (dir !== path && !dir.startsWith(path.endsWith('/') ? path : path + '/')) continue;
    if (path.length > best.length) best = path;
  }
  return best ? (cfg.projects[best] ?? DEFAULT_PROFILE) : DEFAULT_PROFILE;
}

/** Link the shareable entries of `claudeDir` into `profileDir` and seed the private ones. Idempotent; re-run each launch so newly created entries get picked up. */
export function syncLinks(claudeDir: string, profileDir: string): void {
  mkdirSync(profileDir, { recursive: true });
  for (const e of readdirSync(claudeDir, { withFileTypes: true })) {
    const src = join(claudeDir, e.name);
    const dest = join(profileDir, e.name);
    const share = e.isDirectory() ? !PRIVATE_DIRS.has(e.name) : SHARED_FILES.has(e.name);
    let cur = null;
    try {
      cur = lstatSync(dest);
    } catch {
      /* absent */
    }
    // Demote a link an older ruleset made shareable; only ever our own link back to src.
    if (cur?.isSymbolicLink() && !share && readlinkSync(dest) === src) {
      unlinkSync(dest);
      cur = null;
    }
    if (cur) continue;
    if (share) symlinkSync(src, dest);
    else if (SEED_FILES.has(e.name)) copyFileSync(src, dest);
  }
}

export function renderBlock(cmd: string): string {
  return [
    BEGIN,
    `claude-as() { command ${cmd} "$@"; }`,
    'claude() {',
    '  local __cs',
    `  __cs="$(command ${cmd} --exec-env)" || return $?`,
    '  ( eval "$__cs"; exec "$CLAUDE_AS_REAL" "$@" )',
    '}',
    END,
  ].join('\n');
}

/** Replace the managed block in `rc` with `block`, or drop it when `block` is null. */
export function spliceBlock(rc: string, block: string | null): string {
  const lines = rc.split('\n');
  const from = lines.indexOf(BEGIN);
  const to = lines.indexOf(END);
  if (from !== -1 && to > from) lines.splice(from, to - from + 1);
  let out = lines.join('\n').replace(/\n{3,}$/, '\n\n');
  if (block) out = (out.endsWith('\n') || out === '' ? out : out + '\n') + block + '\n';
  return out;
}

export function shq(s: string): string {
  return `'${s.replaceAll("'", `'\\''`)}'`;
}

function loadConfig(file: string): Config {
  const cfg = existsSync(file) ? (Bun.YAML.parse(readFileSync(file, 'utf8')) as Partial<Config>) : {};
  return { projects: cfg?.projects ?? {} };
}

function saveConfig(file: string, cfg: Config): void {
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, Bun.YAML.stringify(cfg), { mode: 0o600 });
}

/** First `name` on PATH. Shell functions aren't on PATH, so this never finds our own wrappers. */
function onPath(name: string): string | null {
  for (const dir of (process.env.PATH ?? '').split(':')) {
    try {
      const p = join(dir, name);
      lstatSync(p);
      return p;
    } catch {
      /* next */
    }
  }
  return null;
}

function projectRoot(): string {
  const git = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' });
  return git.status === 0 ? git.stdout.trim() : process.cwd();
}

function main(argv: string[]): number {
  const home = homedir();
  const claudeDir = process.env.CLAUDE_AS_CLAUDE_DIR ?? join(home, '.claude');
  const root = process.env.CLAUDE_AS_ROOT ?? join(home, '.claude-profiles');
  const configFile = join(root, 'config.yaml');
  const cfg = loadConfig(configFile);
  const cmd = argv[0];

  if (cmd === '--exec-env') {
    // Hot path: runs on every `claude` launch.
    const out = [`CLAUDE_AS_REAL=${shq(onPath('claude') ?? 'claude')}`];
    const name = process.env.CLAUDE_CONFIG_DIR ? DEFAULT_PROFILE : resolveProfile(cfg, process.cwd());
    if (name !== DEFAULT_PROFILE) {
      const dir = join(root, name);
      syncLinks(claudeDir, dir);
      out.push(`export CLAUDE_CONFIG_DIR=${shq(dir)}`);
    }
    console.log(out.join('\n'));
    return 0;
  }

  if (cmd === 'install' || cmd === 'uninstall') {
    const flag = argv.indexOf('--shell');
    const shell = flag !== -1 ? argv[flag + 1] : basename(process.env.SHELL ?? 'zsh');
    if (shell !== 'zsh' && shell !== 'bash') {
      console.error(`unsupported shell: ${shell} (use --shell zsh|bash)`);
      return 2;
    }
    // macOS bash logins read ~/.bash_profile, not ~/.bashrc.
    const rcFile =
      shell === 'zsh'
        ? join(home, '.zshrc')
        : existsSync(join(home, '.bash_profile'))
          ? join(home, '.bash_profile')
          : join(home, '.bashrc');
    // Prefer the installed bin so the block survives reinstalls; fall back to this source file.
    const self = onPath('claude-as') ? 'claude-as' : `bun ${shq(import.meta.path)}`;
    const before = existsSync(rcFile) ? readFileSync(rcFile, 'utf8') : '';
    writeFileSync(rcFile, spliceBlock(before, cmd === 'install' ? renderBlock(self) : null));
    console.log(`${cmd === 'install' ? 'installed into' : 'removed from'} ${rcFile} — open a new shell (or \`source ${rcFile}\`)`);
    return 0;
  }

  if (cmd === 'help' || cmd === '--help' || cmd === '-h') {
    console.log(
      [
        'claude-as                    show the profile in effect for this project',
        'claude-as <profile>          use <profile> here (creates it; `default` unpins)',
        'claude-as ls                 list every pinned project',
        'claude-as install|uninstall [--shell zsh|bash]',
        '',
        `pins:   ${configFile}`,
        `config: ${join(root, '<profile>', 'settings.json')}   (per-profile; seeded from ~/.claude, then yours)`,
      ].join('\n'),
    );
    return 0;
  }

  if (cmd === 'ls') {
    console.log(
      Object.entries(cfg.projects)
        .sort()
        .map(([p, n]) => `${n}\t${p}`)
        .join('\n'),
    );
    return 0;
  }

  const here = projectRoot();
  if (cmd && !RESERVED.has(cmd)) {
    if (cmd === DEFAULT_PROFILE) delete cfg.projects[here];
    else cfg.projects[here] = cmd;
    saveConfig(configFile, cfg);
  }

  const name = resolveProfile(cfg, here);
  console.log(`${here}\n  profile ${name}\n  config  ${name === DEFAULT_PROFILE ? claudeDir : join(root, name)}`);
  return 0;
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
