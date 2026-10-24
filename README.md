# md-live-preview-plus

A patched build of [Markdown Live Preview Editor](https://github.com/t-shoot/md-live-preview-editor)
(t-shoot) for notes written the Obsidian way, plus a bridge to Claude Code. It is an
independent patch: it is affiliated with neither t-shoot nor Obsidian. This package adds:

- **The selection, passed to Claude**: the exact markdown source, line numbers and file path.
- **Auto-save on select**: the file is saved when you select, so line numbers match the file on disk.
- **Wikilinks**: `[[note]]`, `[[note#Heading]]`, `[[note#^block|label]]` render as links and open the note in Live Preview at the anchor. Notes are found by name anywhere in the workspace, as in Obsidian.
- **Callouts**: `> [!note]`, `> [!danger] Title` and the other Obsidian types render as coloured cards with an icon.
- **Tables inside quotes and callouts** render as tables, including a table directly under a line of text, and a `|` inside `[[...]]` no longer splits a table cell.
- **Footnotes**: `[^1]` renders as a superscript number with a hover card. Clicking it jumps to the definition, and `↩` jumps back. `[^1]: …` definitions render as a numbered list.
- **A readable highlight**: the selection band becomes translucent instead of hiding the text.

It is a patched copy of version 0.4.0 (MIT licence, notice kept). The patched copy
has its own id, `local.markdown-live-preview-editor-claude`, so a marketplace update
can never overwrite it.

![Sample note rendered with the Thai/English theme](styles/preview/sample.png)

**Get it from [Releases](../../releases)**, not from the VS Code Marketplace. This patched copy is
not published there, on purpose: the Marketplace extension is t-shoot's own.

## Install (Windows, macOS, Linux)

Download `md-live-preview-plus.zip` from [Releases](../../releases), unzip it, then run the
installer from that folder:

- **Windows:** `powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1`
- **macOS / Linux:** `./install.sh` (needs `python3`)

The installer does three things:
1. It removes t-shoot's original extension if present, because both register the same editor. Then it installs the `.vsix`.
2. It copies the Claude Code hook to `~/.claude/hooks/`, or `%USERPROFILE%\.claude\hooks\` on Windows.
3. It registers the hook in Claude Code's `settings.json`, keeping your other settings. Running it twice is harmless.

Then reload VS Code (*Developer: Reload Window*) and start a new Claude Code session. Open a
`.md` file with *Open With → Markdown Live Preview*. To check that the bridge works:
1. Select some text.
2. Check that `~/.claude/live-preview-selection.json` updates.
3. Ask Claude what you selected.

**The look comes with the extension.** Callout colours, footnotes and tables in quotes are
styled by the extension itself, whichever CSS theme you use. The Thai/English reading theme
`thai-readable.css` ships inside the `.vsix`. On first run it is copied to the **CSS
Themes** view and switched on, unless you have already chosen another theme. Later releases
update it.

Only want the extension, without the Claude bridge? Install the `.vsix` alone:
`code --install-extension markdown-live-preview-editor-claude-0.4.0.vsix`.

## Theme and font

`thai-readable.css` sets the body text in Sarabun at 16.5px with 1.8 line spacing, which
leaves room for Thai tone and vowel marks. It also styles headings, quotes, tables and
code, and shortens blank lines. Sarabun is embedded in the CSS, so nothing needs to be
installed:
- Sarabun is © 2018 The Sarabun Project Authors, under the SIL Open Font License 1.1 (`fonts/OFL.txt`).
- The `.ttf` files in `fonts/` are there if you also want the font system-wide.

To change the theme, edit `styles/src/thai-readable.theme.css` and rebuild. If you don't
want your edits overwritten by updates, save them as a CSS theme of your own in the sidebar.
The preview image is rendered from `test/sample.md`.

## How it works

- The webview reads the CodeMirror selection and posts it to the extension host.
- The extension host saves the file if it is dirty, then writes
  `~/.claude/live-preview-selection.json`.
- On every prompt, the hook prints that file as context. It only does so when the
  selection is non-empty and less than 30 minutes old.

The selection is saved only on your own machine, and Claude receives it only when you send a prompt.

## When upstream releases a new version

You don't have to follow upstream: version 0.4.0 keeps working. To move to a newer
release:
```
node patch.js <unpacked-new-extension-dir> --rename
cd <that dir> && npx @vscode/vsce package --no-dependencies --allow-missing-repository
```
`patch.js` anchors each edit on a string that must occur exactly once. If upstream
renamed something, the script stops with an error instead of producing a broken
build. In that case the anchors in `patch.js` must be updated.

## Notes

- Selecting text saves the file.
- The Windows installer and hook have not been tested on Windows yet. Please open an issue if one fails.

## Building it yourself

```
curl -L -o upstream/t-shoot.markdown-live-preview-editor-0.4.0.vsix \
  https://marketplace.visualstudio.com/_apis/public/gallery/publishers/t-shoot/vsextensions/markdown-live-preview-editor/0.4.0/vspackage
./build.sh          # builds the theme, applies patch.js, packages the .vsix
```

## Licence

- **This repository's own code:** MIT, see `LICENSE`.
- **Markdown Live Preview Editor (t-shoot):** MIT, see `LICENSE-upstream.txt`. The built `.vsix` carries the upstream notices.
- **Sarabun:** SIL Open Font License 1.1, see `fonts/OFL.txt`.

This is an independent patch, affiliated with neither t-shoot nor Obsidian.

