import { expect, test } from 'bun:test';
import { lstatSync, mkdtempSync, mkdirSync, readFileSync, readlinkSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Config, renderBlock, resolveProfile, spliceBlock, syncLinks } from './cli.ts';

const cfg: Config = { projects: { '/w/a': 'personal', '/w/a/b': 'work' } };

test('longest matching prefix wins, on path boundaries', () => {
  expect(resolveProfile(cfg, '/w/a')).toBe('personal');
  expect(resolveProfile(cfg, '/w/a/x')).toBe('personal');
  expect(resolveProfile(cfg, '/w/a/b')).toBe('work');
  expect(resolveProfile(cfg, '/w/a/b/deep')).toBe('work');
  expect(resolveProfile(cfg, '/w/abc')).toBe('default');
  expect(resolveProfile(cfg, '/w')).toBe('default');
});

test('syncLinks shares dirs, keeps files private, seeds settings', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'claude-as-'));
  const claudeDir = join(tmp, '.claude');
  mkdirSync(join(claudeDir, 'projects'), { recursive: true });
  mkdirSync(join(claudeDir, 'daemon'), { recursive: true });
  writeFileSync(join(claudeDir, 'history.jsonl'), 'h');
  writeFileSync(join(claudeDir, 'settings.json'), '{"model":"opus"}');
  writeFileSync(join(claudeDir, 'policy-limits.json'), '{}');
  const profileDir = join(tmp, 'personal');

  syncLinks(claudeDir, profileDir);
  syncLinks(claudeDir, profileDir); // idempotent

  expect(readlinkSync(join(profileDir, 'projects'))).toBe(join(claudeDir, 'projects'));
  expect(readlinkSync(join(profileDir, 'history.jsonl'))).toBe(join(claudeDir, 'history.jsonl'));
  // private dir and private file are simply absent — Claude Code makes its own inside the profile
  expect(() => lstatSync(join(profileDir, 'daemon'))).toThrow();
  expect(() => lstatSync(join(profileDir, 'policy-limits.json'))).toThrow();

  // settings.json is seeded as a real copy, and edits to it stay in the profile
  expect(lstatSync(join(profileDir, 'settings.json')).isSymbolicLink()).toBe(false);
  writeFileSync(join(profileDir, 'settings.json'), '{"model":"haiku"}');
  syncLinks(claudeDir, profileDir);
  expect(readFileSync(join(profileDir, 'settings.json'), 'utf8')).toBe('{"model":"haiku"}');
  expect(readFileSync(join(claudeDir, 'settings.json'), 'utf8')).toBe('{"model":"opus"}');
});

test('syncLinks demotes a stale share-link left by an older ruleset', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'claude-as-'));
  const claudeDir = join(tmp, '.claude');
  mkdirSync(join(claudeDir, 'daemon'), { recursive: true });
  writeFileSync(join(claudeDir, 'settings.json'), '{"model":"opus"}');
  const profileDir = join(tmp, 'personal');
  mkdirSync(profileDir, { recursive: true });
  symlinkSync(join(claudeDir, 'settings.json'), join(profileDir, 'settings.json'));
  symlinkSync(join(claudeDir, 'daemon'), join(profileDir, 'daemon'));

  syncLinks(claudeDir, profileDir);

  expect(lstatSync(join(profileDir, 'settings.json')).isSymbolicLink()).toBe(false);
  expect(readFileSync(join(profileDir, 'settings.json'), 'utf8')).toBe('{"model":"opus"}'); // content preserved
  expect(() => lstatSync(join(profileDir, 'daemon'))).toThrow();
});

test('spliceBlock installs, replaces, and removes without eating the rc file', () => {
  const rc = 'export FOO=1\n';
  const installed = spliceBlock(rc, renderBlock('claude-as'));
  expect(installed.startsWith(rc)).toBe(true);
  expect(installed).toContain('command claude-as --exec-env');

  const replaced = spliceBlock(installed, renderBlock("bun '/y/cli.ts'"));
  expect(replaced).toContain("bun '/y/cli.ts'");
  expect(replaced).not.toContain('command claude-as --exec-env');

  expect(spliceBlock(replaced, null)).toBe(rc);
});

test('--exec-env emits the profile config dir', async () => {
  // realpath: process.cwd() reports /private/var on macOS, so map keys must match
  const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'claude-as-')));
  const root = join(tmp, 'profiles');
  const claudeDir = join(tmp, '.claude');
  mkdirSync(claudeDir, { recursive: true });
  const proj = join(tmp, 'proj', 'sub');
  mkdirSync(proj, { recursive: true });
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'config.yaml'), Bun.YAML.stringify({ projects: { [join(tmp, 'proj')]: 'work' } }));

  const env: Record<string, string | undefined> = { ...process.env, CLAUDE_AS_ROOT: root, CLAUDE_AS_CLAUDE_DIR: claudeDir };
  delete env.CLAUDE_CONFIG_DIR; // the test runner may itself be under a profile
  const run = (cwd: string, extra: Record<string, string> = {}) =>
    new Response(
      Bun.spawn(['bun', join(import.meta.dir, 'cli.ts'), '--exec-env'], { cwd, env: { ...env, ...extra } }).stdout,
    ).text();

  const out = await run(proj);
  expect(out).toContain(`export CLAUDE_CONFIG_DIR='${join(root, 'work')}'`);
  expect(out).toContain('CLAUDE_AS_REAL=');

  // unmapped dir, and an already-profiled session, both stay on the default config
  expect(await run(tmp)).not.toContain('CLAUDE_CONFIG_DIR');
  expect(await run(proj, { CLAUDE_CONFIG_DIR: '/already/set' })).not.toContain('export CLAUDE_CONFIG_DIR');
});
