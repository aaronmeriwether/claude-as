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
cannot see each other's auth — but *everything else* in the profile dir is a
symlink back into the real `~/.claude`, so `projects/` (transcripts),
`history.jsonl`, `settings.json`, `plugins/`, `hooks/` and the rest are genuinely
one shared store. The `default` profile is plain `~/.claude` with no
`CLAUDE_CONFIG_DIR` at all.

The installed `claude()` shell function asks the CLI for the environment of the
current directory and `exec`s the real binary in a subshell, so nothing leaks into
the interactive shell and Claude Code still owns the tty:

```sh
claude() { local __cs; __cs="$(command claude-as --exec-env)" || return $?
           ( eval "$__cs"; exec "$CLAUDE_AS_REAL" "$@" ) }
```

## Config

`~/.claude-profiles/config.yaml`, rewritten by `claude-as <profile>` and safe to
hand-edit. A profile's `env` is exported before launch — that is how a non-OAuth
profile such as Bedrock is expressed:

```yaml
profiles:
  personal: {}
  work:
    env:
      CLAUDE_CODE_USE_BEDROCK: "1"
      AWS_PROFILE: my-bedrock-profile
      AWS_REGION: us-west-2
projects:
  /home/me/src/side-project: personal
  /home/me/src/day-job: work
```

`projects` keys are matched by **longest path prefix**, so a subdirectory can
override its parent. Keys come from `git rev-parse --show-toplevel` (falling back
to `$PWD`) at the time you run `claude-as`.

## Notes

- Only `.claude.json` and `.credentials.json` are withheld from the symlink sync —
  they carry account identity. Everything else is shared, including runtime dirs
  (`daemon/`, `ide/`), which is no worse than two concurrent sessions on one
  account.
- Links are re-synced on every launch, so entries Claude Code creates in
  `~/.claude` later get shared without a re-install.
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
