# xHarbour Tools

Language support for **Harbour** and **xHarbour** (`.prg`, `.ch`, `.hbx`, `.hb`)
in Visual Studio Code: syntax highlighting, diagnostics, hover, go to
definition, completion, a debugger, build tasks, and a set of
project-specific aliasing features (below) that let you teach the editor —
and, where it matters, the compiler — about your own macro conventions.

> This is a fork of [harbourCodeExtension](https://github.com/APerricone/harbourCodeExtension)
> by **Antonino Perricone**, combined with **Edgard Lorraine Messias**'s
> syntax highlighting work. See [NOTICE.md](NOTICE.md) for full attribution
> and [License](#license) below — the short version is that this project is
> GPL-3.0-or-later, same as the original `server` package it's built on, and
> that stays true no matter how much the fork evolves on top of it.

## Contents

- [Requirements](#requirements)
- [Language features](#language-features)
- [Diagnostics / validation](#diagnostics--validation)
- [Aliasing features](#aliasing-features-fork-specific)
  - [`harbour.aliases.customKeywords`](#harbouraliasescustomkeywords)
  - [`harbour.aliases.callSuffixes` and `callSuffixMode`](#harbouraliasescallsuffixes-and-callsuffixmode)
  - [`harbour.aliases.commandRules`](#harbouraliasescommandrules)
- [Commands](#commands)
- [Settings reference](#settings-reference)
- [Code formatting](#code-formatting)
- [Debugging](#debugging)
- [Build tasks](#build-tasks)
- [Snippets](#snippets)
- [Building the extension from source](#building-the-extension-from-source)
- [License](#license)

## Requirements

You need a working `harbour`/`xhbmk`/`hbmk2` toolchain reachable from the
setting `harbour.compilerExecutable` (default: `harbour`, resolved via
`PATH`). It can be a native install, or a wrapper script — e.g. one that
runs the compiler inside a Docker container:

```jsonc
// .vscode/settings.json
{
  "harbour.compilerExecutable": "/path/to/harbour-docker.sh"
}
```

A wrapper only needs to compile whatever file it's given, in that file's own
directory — several features below (validation, `commandRules`) write small
helper files next to the source file being compiled specifically so
container-based wrappers that only mount that directory still see them.

## Language features

- **Syntax highlighting** for `.prg`, `.ch`, `.hbx`, `.hb` (language id
  `harbour`, aliases `Harbour`/`xHarbour`/`FlagShip`/`Clipper`/`xBase`).
- **Hover**: shows the doc-comment block immediately above a
  function/procedure/method definition, and the expansion of `#define`
  constants. This works across the whole indexed workspace, not just the
  file you're editing — hovering a call to a function defined in another
  `.prg` still shows its comment (as long as `harbour.workspaceDepth > 0`,
  see [below](#settings-reference)).
- **Go to definition** / **Find all references**, also workspace-wide.
- **Document symbols** (`Ctrl+Shift+O` / `Cmd+Shift+O`) and **workspace
  symbols** (`Ctrl+T` / `Cmd+T`).
- **Completion** and **signature help**, including for `harbour.aliases.callSuffixes`
  call styles (see below).
- **Semantic tokens**, **folding ranges**, and bracket/`IF`-`ENDIF`/`FOR`-`NEXT`-style
  decoration of matching pairs (`harbour.decorator`).
- **Document formatting**, configured through a dedicated settings editor
  (see [Code formatting](#code-formatting)).

## Diagnostics / validation

Two independent mechanisms feed the Problems panel:

1. **Compiler-backed validation** (`harbour.validating`, on by default): on
   every open/save, the file is run through
   `harbour.compilerExecutable -s -w<harbour.warningLevel> ...` (syntax
   check only) and the compiler's own warnings/errors are shown inline.
   This catches real syntax errors and things like undeclared-variable
   ambiguity — but it can never tell you a *called function* doesn't exist,
   because in the Clipper/xHarbour model function calls are resolved at
   **link** time, across the whole program, not per file.
2. **Workspace-aware "possibly undefined function" hints**
   (`harbour.checkUndefinedFunctions`, off by default): the language server
   already indexes every `.prg`/`.ch` file it can find (up to
   `harbour.workspaceDepth` subfolders) for hover/completion/go-to-definition,
   so it can cross-check every bare `Foo(...)` call against that index plus
   the standard xHarbour/Harbour RTL docs. It's opt-in and reported as
   `Information`, not `Warning`/`Error`, because it's inherently best-effort:
   a function defined in a library that isn't part of the open workspace
   will always look "undefined" to it. It only runs at all when
   `harbour.workspaceDepth > 0` — with no cross-file index, every external
   call would be a false positive.

## Aliasing features (fork-specific)

These settings exist for codebases that lean on preprocessor macros
(`#command`/`#xcommand`/`#translate`) or object-style call conventions the
compiler doesn't know about by name — so the editor can be taught the
convention once, instead of every file needing local hints.

### `harbour.aliases.customKeywords`

Colors specific words as keywords when they start a statement — useful for
your own `#command` macros:

```jsonc
"harbour.aliases.customKeywords": [
  { "word": "Default", "scope": "keyword" }
]
```

### `harbour.aliases.callSuffixes` and `callSuffixMode`

Some codebases call a function two ways: `Foo(x)` or, via a suffix
convention, `Foo:Exec(x)`. `callSuffixes` tells signature help/completion
that both forms mean "call `Foo`":

```jsonc
"harbour.aliases.callSuffixes": ["Exec"]
```

`callSuffixMode` optionally *enforces* one of the two styles for functions
defined in your workspace, reporting the other one as an **Error**:

```jsonc
"harbour.aliases.callSuffixMode": "suffixOnly" // or "bareOnly", default "either"
```

| Mode | `Foo(x)` | `Foo:Exec(x)` |
|---|---|---|
| `either` (default) | allowed | allowed |
| `suffixOnly` | flagged as Error | allowed |
| `bareOnly` | allowed | flagged as Error |

This never applies to standard RTL functions (`Len:Exec()` wouldn't make
sense to require) — only to functions your workspace actually defines.

Because `Foo:Exec(...)` isn't real xHarbour syntax for calling a plain
function — the compiler sees a bare identifier before `:` and, unable to
tell whether it's `Foo` the function or an undeclared memvar, emits
`Warning W0001 Ambiguous reference` — the [compiler-backed validator](#diagnostics--validation)
specifically suppresses that one warning for identifiers immediately
followed by `:<a configured suffix>(`, while leaving every other ambiguous
reference on the same or other lines untouched.

### `harbour.aliases.commandRules`

Declares `#command`/`#xcommand`-style macro rules once, in settings, instead
of pasting a `#command` line at the top of every `.prg`:

```jsonc
"harbour.aliases.commandRules": [
  { "match": "DEFAULT <v> := <x>", "replace": "Default( <v>, <x> )" }
]
```

is equivalent to having this at the top of every file compiled in that
workspace:

```harbour
#command DEFAULT <v> := <x> => Default( <v>, <x> )
```

Each rule is written to a generated `.ch` file next to the source file being
compiled and passed to the compiler with `-u+<file>` on every
validate/build — so it works even if `harbour.compilerExecutable` is a
container wrapper that only mounts that one directory. The first word of
`match` (`DEFAULT` above) is also registered automatically as a
`customKeyword`, so you don't need a separate entry for it.

## Commands

| Command | Title | What it does |
|---|---|---|
| `harbour.getDbgCode` | **Harbour: Get debugger code** | Opens the source of the in-process debugger library (`dbg_lib.prg`) as a new untitled document — save it into your project (or, better, compile it into a library you link against) to enable [debugging](#debugging). |
| `harbour.setupCodeFormat` | **Harbour: setup code style** | Opens a webview to configure the [document formatter](#code-formatting) settings interactively, with a live preview. |

## Settings reference

**Compiler / validation**

| Setting | Default | Description |
|---|---|---|
| `harbour.compilerExecutable` | `"harbour"` | Path (or wrapper script) used for validation and build tasks. |
| `harbour.validating` | `true` | Run the compiler-backed validator on open/save. |
| `harbour.warningLevel` | `1` (0–3) | Compiler `-w` level used for validation. |
| `harbour.extraIncludePaths` | `[]` | Extra `-I` paths; supports `${workspaceFolder}`. |
| `harbour.extraOptions` | `""` | Free-form extra compiler flags. |
| `harbour.workspaceDepth` | `2` | Subfolder depth the language server scans for `.prg`/`.ch`/`.c`/`.h` files to index for cross-file features (hover, go to definition, `checkUndefinedFunctions`). `0` = only files you have open. |
| `harbour.checkUndefinedFunctions` | `false` | See [Diagnostics](#diagnostics--validation). |
| `harbour.decorator` | `true` | Decorate matching `if/endif`, `for/next`, `while/endwhile`, etc. |

**Aliases** — see [above](#aliasing-features-fork-specific).

| Setting | Default |
|---|---|
| `harbour.aliases.customKeywords` | `[]` |
| `harbour.aliases.callSuffixes` | `[]` |
| `harbour.aliases.callSuffixMode` | `"either"` |
| `harbour.aliases.commandRules` | `[]` |

**Formatter** — set via `harbour.setupCodeFormat`, or directly:

| Setting | Default |
|---|---|
| `harbour.formatter.indent.funcBody` | `true` |
| `harbour.formatter.indent.variables` | `true` |
| `harbour.formatter.indent.logical` | `true` |
| `harbour.formatter.indent.cycle` | `true` |
| `harbour.formatter.indent.switch` | `true` |
| `harbour.formatter.indent.case` | `true` |
| `harbour.formatter.replace.not` | `"use !"` (`"ignore"` / `"use .not."` / `"use !"`) |
| `harbour.formatter.replace.asterisk` | `"use //"` (`"ignore"` / `"use //"` / `"use *"` / `"use &&"`) |
| `harbour.formatter.replace.amp` | `"use //"` (`"ignore"` / `"use //"` / `"use &&"`) |

## Code formatting

Run **Harbour: setup code style** to open a live-preview editor for the
`harbour.formatter.*` settings above — check the boxes/pick the options you
want and the sample on the right updates immediately; changes are written
straight to your settings.

## Debugging

The extension ships a `harbour-dbg` debug adapter that talks to a small
in-process debugger library over a socket (default port `6110`).

1. Run **Harbour: Get debugger code**, save the file into your project (or
   compile it into a library and link it in), and compile your program
   **with debug info** (`-b`).
2. Add a launch configuration — the command palette's "Add configuration"
   offers ready-made snippets for launch, attach-by-path, and
   attach-by-picking-a-running-process. Example `launch.json`:

```jsonc
{
  "type": "harbour-dbg",
  "request": "launch",
  "name": "Launch current program",
  "program": "${workspaceFolder}/myapp",
  "workingDir": "${workspaceFolder}/",
  "sourcePaths": ["${workspaceFolder}"],
  "stopOnEntry": true
}
```

`request` can be `"launch"` or `"attach"` (by `program` path or by
`process` id — `"${command:pickProcess}"` opens a picker of running
matching processes). See the protocol the debugger and the extension speak
to each other in [`debugger.md`](debugger.md) if you need to build a
compatible client.

## Build tasks

Two task types are contributed:

- **`Harbour`** — runs `harbour.compilerExecutable` directly on one file.
  `output`: `"portable"` (`.hrb`) or `"C code"` (`c-type`: `compact` /
  `normal` / `verbose` / `real C Code`).
- **`HBMK2`** — runs `hbmk2` (found next to `harbour.compilerExecutable`)
  with `platform`/`compiler`/`extraArgs`/`debugSymbols`, and an optional
  `setupBatch` (or per-OS `windows`/`linux`/`osx` overrides) to source
  environment variables before building — handy for MSVC's `vcvars*.bat`
  or similar toolchain setup scripts.

Example `tasks.json` entry:

```jsonc
{
  "label": "build",
  "type": "HBMK2",
  "input": "${file}",
  "extraArgs": ["-gtcgi", "-w3"],
  "group": { "kind": "build", "isDefault": true }
}
```

## Snippets

A small set of statement snippets (`for`, `for each`, `do while`, etc.) is
contributed for the `harbour` language — see
[`harbour.code-snippets`](harbour.code-snippets).

## Building the extension from source

```sh
npm install                            # single node_modules for both the
                                        # extension host and the language
                                        # server (src/client, src/server)
npx webpack --mode production          # builds dist/extension.js,
                                        # dist/debugger.js, dist/hb_server.js
npx vsce package --no-dependencies \
  --allow-missing-repository \
  --baseContentUrl "<url>" --baseImagesUrl "<url>"   # -> vscode-xharbour.vsix
code --install-extension vscode-xharbour.vsix
```

`npm run prelanch` (`webpack --mode development`) is the pre-launch task
for `F5` (Run Extension) in this repo's own `.vscode/launch.json`.

## License

This project is **GPL-3.0-or-later** (see [`LICENSE`](LICENSE)) — the
original `server` package it's built on was GPL-licensed, and a combined
work built on GPL code stays GPL regardless of how much is added or
rewritten on top of it. The original `client` package was MIT-licensed;
that text is preserved unmodified in
[`LICENSE-MIT-client-original.txt`](LICENSE-MIT-client-original.txt) for
attribution. Full details in [`NOTICE.md`](NOTICE.md).
