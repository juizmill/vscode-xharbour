# Changelog

All notable changes to **vscode xHarbour** (this fork) are documented here.
Format loosely follows [Keep a Changelog](https://keepachangelog.com/).

For the pre-fork history of the base extension (`harbourCodeExtension`),
see [its own changelog and wiki](https://github.com/APerricone/harbourCodeExtension/wiki) —
it isn't reproduced here since none of it is specific to this fork.

## Unreleased

## 0.0.3 - 2026-08-17

### Added
- `harbour.aliases.customKeywords` — color custom words as keywords.
- `harbour.aliases.callSuffixes` — treat `identifier:Suffix(...)` as a call
  to `identifier` for signature help/completion.
- `harbour.aliases.callSuffixMode` — optionally enforce (as an Error) the
  bare or `:Suffix()` call style for workspace-defined functions.
- `harbour.aliases.commandRules` — declare `#command`-style macro rules in
  settings instead of pasting a `#command` line into every file; applied to
  the compiler via a generated `.ch` and `-u+`.
- `harbour.aliases.commandRulesUseFileDir` — write that generated `.ch` next
  to the file being compiled instead of the OS temp dir; only needed when
  `harbour.compilerExecutable` is a containerized wrapper (e.g. Docker) that
  can't see the OS temp dir. Off by default.
- `harbour.checkUndefinedFunctions` — opt-in, workspace-aware "possibly
  undefined function" hints from the language server, independent of the
  compiler-backed validator.
- Hover now also shows the doc-comment of functions defined in another
  file, not just the one being edited (same workspace index Go to
  Definition already used).

### Changed
- `client/` and `server/` merged into a single package (one `package.json`,
  one `webpack.config.js` building both bundles into the same `dist/`, one
  `node_modules`) — no more copying a built copy of the server into
  `client/server` at package time.
- `harbour.workspaceDepth` default raised from `0` to `2`, so cross-file
  features work out of the box.
- Replaced jQuery in the code-style formatter webview with plain DOM APIs.
- Converted `var` to `let`/`const` throughout the extension and language
  server source.

### Fixed
- `harbour.aliases.commandRules` wrote its generated `.ch` file to the OS
  temp directory, which a containerized `harbour.compilerExecutable` (e.g.
  a Docker wrapper that only mounts the compiled file's own directory)
  can't see — validation/build failed with `Can't open standard rule file`.
  It's written next to the file being compiled when
  `harbour.aliases.commandRulesUseFileDir` is enabled (see Added); off by
  default it goes back to the OS temp dir, so most projects don't get this
  file cluttering their working directory.
- The compiler-backed validator silently dropped any compiler message that
  didn't have a `file(line)` prefix (such as the error above) into a
  diagnostics bucket for an empty filename, so it never reached the
  Problems panel. Those messages now attach to the file being validated.
- The validator no longer reports `Warning W0001 Ambiguous reference` for
  an identifier immediately followed by a configured
  `harbour.aliases.callSuffixes` suffix (e.g. `Foo:Exec(...)`) — that
  ambiguity is an expected side effect of the alias convention itself, not
  a real problem, and every other ambiguous reference is still reported
  normally.
- Removed an unused `npm-check-updates` dependency found while merging the
  server's `package.json` into the root one.

## Fork start

Forked from [harbourCodeExtension](https://github.com/APerricone/harbourCodeExtension)
by Antonino Perricone, combined with Edgard Lorraine Messias's syntax
highlighting work. See [`NOTICE.md`](NOTICE.md) for attribution and
licensing.
