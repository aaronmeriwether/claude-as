import { expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, readlinkSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Config, renderBlock, resolveProfile, spliceBlock, syncLinks } from './cli.ts';

const cfg: Config = {
  profiles: { personal: {}, work: {} },
  projects: { '/w/a': 'personal', '/w/a/b': 'work' },
};

test('longest matching prefix wins, on path boundaries', () => {
  expect(resolveProfile(cfg, '/w/a')).toBe('personal');
  expect(resolveProfile(cfg, '/w/a/x')).toBe('personal');
  expect(resolveProfile(cfg, '/w/a/b')).toBe('work');
  expect(resolveProfile(cfg, '/w/a/b/deep')).toBe('work');
  expect(resolveProfile(cfg, '/w/abc')).toBe('default');
  expect(resolveProfile(cfg, '/w')).toBe('default');
});

test('syncLinks shares everything but the identity files', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'claude-as-'));
  const claudeDir = join(tmp, '.claude');
  mkdirSync(join(claudeDir, 'projects'), { recursive: true });
  writeFileSync(join(claudeDir, 'history.jsonl'), '');
  writeFileSync(join(claudeDir, '.claude.json'), '{}');
  const profileDir = join(tmp, 'personal');

  syncLinks(claudeDir, profileDir);
  syncLinks(claudeDir, profileDir); // idempotent

  expect(readlinkSync(join(profileDir, 'projects'))).toBe(join(claudeDir, 'projects'));
  expect(readlinkSync(join(profileDir, 'history.jsonl'))).toBe(join(claudeDir, 'history.jsonl'));
  expect(() => readlinkSync(join(profileDir, '.claude.json'))).toThrow();
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

test('--exec-env emits the profile config dir and its env', async () => {
  // realpath: process.cwd() reports /private/var on macOS, so map keys must match
  const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'claude-as-')));
  const root = join(tmp, 'profiles');
  const claudeDir = join(tmp, '.claude');
  mkdirSync(claudeDir, { recursive: true });
  const proj = join(tmp, 'proj', 'sub');
  mkdirSync(proj, { recursive: true });
  mkdirSync(root, { recursive: true });
  writeFileSync(
    join(root, 'config.yaml'),
    Bun.YAML.stringify({
      profiles: { work: { env: { CLAUDE_CODE_USE_BEDROCK: '1', AWS_PROFILE: 'my-profile' } } },
      projects: { [join(tmp, 'proj')]: 'work' },
    }),
  );

  const env = { ...process.env, CLAUDE_AS_ROOT: root, CLAUDE_AS_CLAUDE_DIR: claudeDir };
  delete env.CLAUDE_CONFIG_DIR; // the test runner may itself be under a profile
  const run = (cwd: string, extra: Record<string, string> = {}) =>
    new Response(
      Bun.spawn(['bun', join(import.meta.dir, 'cli.ts'), '--exec-env'], { cwd, env: { ...env, ...extra } }).stdout,
    ).text();

  const out = await run(proj);
  expect(out).toContain(`export CLAUDE_CONFIG_DIR='${join(root, 'work')}'`);
  expect(out).toContain("export CLAUDE_CODE_USE_BEDROCK='1'");
  expect(out).toContain('CLAUDE_AS_REAL=');

  // unmapped dir, and an already-profiled session, both stay on the default config
  expect(await run(tmp)).not.toContain('CLAUDE_CONFIG_DIR');
  expect(await run(proj, { CLAUDE_CONFIG_DIR: '/already/set' })).not.toContain('export CLAUDE_CONFIG_DIR');
});
