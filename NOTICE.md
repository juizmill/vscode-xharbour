# Notice

This project ("vscode xHarbour") is a fork of
[harbourCodeExtension](https://github.com/APerricone/harbourCodeExtension)
by **Antonino Perricone**.

- Original `client/` package: MIT License (see `LICENSE-MIT-client-original.txt`, kept unmodified).
- Original `server/` package: licensed `"GPL"` (no version specified, no
  `LICENSE`/`COPYING` file in the upstream repository at the time of forking).

Because this fork combines and modifies the GPL-licensed `server/` code, the
combined work is distributed under the **GNU General Public License v3.0 or
later** (see `LICENSE` in this directory). If you need a different GPL
version guarantee, contact the upstream author to confirm the exact version
they intended.

Thanks to Antonino Perricone and contributors (including
[Edgard Lorraine Messias](https://github.com/edgardmessias) for the syntax
highlighting work) for the original implementation this fork builds on.

## RTL function documentation (`hbdocs.json`)

The parameter/return documentation shown for standard RTL functions (hover,
signature help, completion) is extracted from the `$DOC$`-tagged comment
blocks in the [xHarbour project](https://github.com/xHarbour-org/xharbour)'s
own `doc/` source files, via `src/server/parseHBDoc.js`. Those doc files are
themselves credited to their individual Harbour/xHarbour project authors
(see e.g. `doc/en/array.txt` in that repository).
