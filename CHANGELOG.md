# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

### Releasing

Releases are automated via CI. To create a new release:

1. Add a new entry at the top of this file with heading `## [vX.Y.Z]` (without a
   date). This is a draft — it can be merged to `main` without triggering a
   release.
2. When ready to publish, update the heading to `## [vX.Y.Z] - YYYY-MM-DD` and
   merge to `main`. The date signals "ready to release".
3. The workflow will run tests, create a Git tag, GitHub Release, and npm publish.
4. If the tag already exists, the workflow skips (safe to re-merge).
5. If tests fail, no tag/release is created. The release will be re-attempted on
   each subsequent push to `main`, or can be manually retried from the Actions UI.

Stable versions (e.g. `v1.2.0`) publish to npm `@latest`. Pre-release versions
(e.g. `v1.2.0-rc.1`) publish to npm `@next` and create a GitHub pre-release.

## [v1.0.0]

### Added
- Initial release: per-project credential profiles for Claude Code that share one
  chat history. `claude-as <profile>` pins a directory tree to a profile and
  `claude-as install` adds the `claude()` shell wrapper. Directories under
  `~/.claude` are shared between profiles, regular files are per-profile, and a
  new profile's `settings.json`/`CLAUDE.md` are seeded from your default config.
