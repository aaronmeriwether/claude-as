# claude-as

Per-project credential profiles for [Claude Code](https://docs.anthropic.com/en/docs/claude-code)
that **keep one shared chat history**. Pin a directory to a profile once; every
`claude` launched anywhere under it uses those credentials, while transcripts,
settings, plugins and hooks stay common to all of them.

Useful when you have more than one Claude Code identity — a personal Max
subscription, a work Enterprise account, a Bedrock role — and don't want each one
to come with its own island of history and settings.

## Install

Requires the [Bun](https://bun.sh) runtime.

```bash
bun install -g claude-as
claude-as install       # adds a claude()/claude-as() block to ~/.zshrc
exec zsh
```

`claude-as install --shell bash` writes to `~/.bash_profile` (or `~/.bashrc`);
`uninstall` removes the block. Re-running `install` replaces it in place.

## Usage

```bash
cd ~/some-repo
claude-as personal      # this repo (and everything under it) -> "personal"
claude                  # first launch prompts /login for that profile
claude-as               # show the profile in effect here
claude-as ls            # every pinned project
claude-as default       # unpin; back to the plain ~/.claude account
```

Run `claude-as help` for the full flag list.

## How it works

A profile is nothing but a `CLAUDE_CONFIG_DIR` (`~/.claude-profiles/<name>`).
Claude Code keys its OS-keystore credential entry off that path, so profiles
cannot see each other's auth. The profile dir is then populated by one rule:

> **directories are symlinked back into `~/.claude`; regular files are not.**

So `projects/` (transcripts), `plugins/`, `hooks/`, `tasks/`, `file-history/` and
the rest are genuinely one shared store, while `settings.json`, `CLAUDE.md`,
`.claude.json` and the server-pushed policy files stay per-profile. The rule
works because directory contents are keyed by session id, pid or content hash, so
they merge without collisions — and because a file written via
write-tmp-then-rename would replace its own symlink with a real file and silently
un-share itself. `history.jsonl` is the one shared file: append-only, so it is
safe, and shared shell history is worth having.

`daemon/` and `backups/` are the two directories held back — the first is
per-config-dir IPC state, the second backs up the private `.claude.json`.
`settings.json` and `CLAUDE.md` are copied from `~/.claude` the first time a
profile is created, so a new profile starts from your usual setup and then
diverges. The `default` profile is plain `~/.claude` with no `CLAUDE_CONFIG_DIR`
at all.

The installed `claude()` shell function asks the CLI for the environment of the
current directory and `exec`s the real binary in a subshell, so nothing leaks into
the interactive shell and Claude Code still owns the tty:

```sh
claude() { local __cs; __cs="$(command claude-as --exec-env)" || return $?
           ( eval "$__cs"; exec "$CLAUDE_AS_REAL" "$@" ) }
```

## Config

There are two pieces, and claude-as only owns the first.

**Which project uses which profile** — `~/.claude-profiles/config.yaml`, rewritten
by `claude-as <profile>` and safe to hand-edit:

```yaml
projects:
  /home/me/src/side-project: personal
  /home/me/src/day-job: work
```

Keys are matched by **longest path prefix**, so a subdirectory can override its
parent. They come from `git rev-parse --show-toplevel` (falling back to `$PWD`) at
the time you run `claude-as`.

**What a profile does** — its own `~/.claude-profiles/<name>/settings.json`, which
is ordinary Claude Code settings. claude-as adds no configuration layer of its
own; a non-OAuth profile such as Bedrock is just a profile whose `settings.json`
says so:

```json
{
  "env": {
    "CLAUDE_CODE_USE_BEDROCK": "1",
    "AWS_PROFILE": "my-bedrock-profile",
    "AWS_REGION": "us-west-2"
  }
}
```

### Sharing `CLAUDE.md` anyway

`CLAUDE.md` is per-profile by default, since a work profile and a personal one
usually want different standing instructions. If you would rather have one set of
instructions everywhere, replace the seeded copy with a symlink by hand — claude-as
leaves an existing symlink on a seeded file alone, so this survives every sync:

```bash
ln -sfn ~/.claude/CLAUDE.md ~/.claude-profiles/work/CLAUDE.md
```

The caveat is the reason it isn't the default: an editor that saves by writing a
temp file and renaming it over the target will replace the symlink with a real
file, quietly ending the sharing. Check with `ls -l` and re-run the same command to
restore it. Editing through `/memory` in Claude Code, or with an editor that writes
in place, is unaffected. The same trick works for `settings.json`, with the same
caveat and rather more to lose.

### Setting up other `CLAUDE_CONFIG_DIR`-aware tools

`CLAUDE_CONFIG_DIR` is exported only inside the subshell that launches `claude`,
so Claude Code and everything it spawns see the right profile, but a setup
command you run by hand does not — it would configure the default profile no
matter which directory you are in. Borrow the profile's environment for one
command:

```bash
(eval "$(claude-as --exec-env)"; some-tool --setup)
```

## Notes

- Links are re-synced on every launch, so directories Claude Code creates in
  `~/.claude` later get shared without a re-install. A directory that an older
  version had shared but the current rules hold back is unlinked on the next sync.
- Each profile keeps its own `.claude.json`, so onboarding and folder-trust
  prompts appear once per profile, and MCP servers added via `claude mcp add` are
  per-profile.
- All profiles write transcripts into the same shared `projects/` store. That is
  the point of the tool, but it is worth knowing before pointing a work account at
  it.
- `--exec-env` is a no-op when `CLAUDE_CONFIG_DIR` is already set, so a `claude`
  spawned from inside a session stays on its parent's profile.
- Prior art, both of which isolate history rather than share it:
  [claude-code-profiles](https://github.com/quinnjr/claude-code-profiles) (the
  per-directory pin) and
  [claude-account-switcher](https://github.com/ukogan/claude-account-switcher)
  (the symlinked shared config).

## License

MIT
