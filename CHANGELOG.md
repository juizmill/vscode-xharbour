# Changelog

All notable changes to **vscode xHarbour** (this fork) are documented here.
Format loosely follows [Keep a Changelog](https://keepachangelog.com/).

For the pre-fork history of the base extension (`harbourCodeExtension`),
see [its own changelog and wiki](https://github.com/APerricone/harbourCodeExtension/wiki) —
it isn't reproduced here since none of it is specific to this fork.

## Unreleased

## 0.0.8 - 2026-08-17

### Added
- New extension/Marketplace icon (`harbourIcon.png`), rasterized from
  `harbour.svg`.
- File Icon Theme ("xHarbour Icons", `Ctrl+K Ctrl+T` to select it): shows
  the `harbour.svg` icon for `.prg`/`.ch`/`.hbx`/`.hb` files in the
  Explorer. Not selected automatically -- picking a file icon theme is a
  user/global VS Code setting (`workbench.iconTheme`), so activating this
  one replaces whatever icon theme is currently active for *all* files, not
  just xHarbour ones; other file types fall back to a plain generic
  file/folder icon since this theme doesn't attempt to also cover every
  other language.

### Fixed
- `.vscodeignore`'s blanket `*.svg` rule was stripping every SVG (including
  the ones the new icon theme needs) out of the packaged `.vsix`; added
  explicit `!harbour.svg`/`!fileicons/**` exceptions.

## 0.0.7 - 2026-08-17

### Added
- `hbdocs.json` grew from 833 to 1025 documented RTL functions (192 net
  new), re-extracted from the actual xHarbour project's own `doc/` source
  (the same repo `Dockerfile` builds `harbour.compilerExecutable`'s Docker
  image from) via a fixed `src/server/parseHBDoc.js` -- it previously
  produced zero output against this source because these doc files use a
  `*`-prefixed comment-continuation style the parser didn't strip, and
  rejected any function whose syntax had a space before `(` (e.g.
  `ADDASCII (...)`) as if it were a multi-word command. `hbdocs.missing`
  shrank by the same 192 entries (existing entries were left untouched, not
  regenerated from scratch, so nothing that already had docs was touched).
- Custom/forked compilers' own native functions -- not visible to the
  workspace `.prg`/`.ch` scan since they're baked into the compiler binary
  -- are now recognized for completion, hover and the undefined-function
  check if a `.hbx` export file declaring them (`DYNAMIC <name>` lines) is
  found under `harbour.extraIncludePaths`. No parameter docs are available
  from a `.hbx` (just names), so hover shows a minimal placeholder, like it
  already does for undocumented standard RTL functions.

## 0.0.6 - 2026-08-17

### Added
- Hover now shows parameters, description and return value for standard
  xHarbour/Harbour RTL functions (e.g. `Len()`), reusing the same
  `hbdocs.json` data already powering signature help and completion --
  previously hover only worked for functions defined in the workspace.
  RTL functions known to exist but without parsed documentation
  (`hbdocs.missing`) get a minimal "no documentation available" hover
  instead of nothing.

## 0.0.5 - 2026-08-17

### Fixed
- The compiler-backed validator could report a compiler warning (e.g.
  `Ambiguous reference`) on the wrong line -- one that only *mentions* the
  identifier inside a string literal (e.g. `Local a := "Mensagem do Erro()
  ..."`) -- and misidentify that occurrence as the real one. Two bugs
  combined to cause this: the identifier-column search matched raw line text
  without excluding string literals/comments, and the "line continuation"
  check used to walk backward from the reported line to find the real
  reference matched a `;` anywhere in a line instead of only a trailing one,
  so it could wander into unrelated lines. Both are fixed.

## 0.0.4 - 2026-08-17

### Fixed
- `harbour.checkUndefinedFunctions` reported a false "not found" hint for
  functions defined only in an `#include`d `.ch` file: the hover doc-comment
  lookup already walked a document's `#include` chain, but the
  undefined-function check (and `harbour.aliases.callSuffixMode` checks) only
  consulted the directory-scanned `harbour.workspaceDepth` index, never the
  `#include` chain. Both now check the same resolved include chain hover
  uses.

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
