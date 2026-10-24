# md-live-preview-plus — changes

Each `## <version>` section is used as the GitHub release notes by `plus/release.sh`.

## 0.4.3

Rebuilt as a fork of the upstream source (0.4.0) instead of a patch applied to the
published bundle. Everything from 0.4.0-plus.2 is kept, and:

- **Wikilink completion**:
  - `[[` offers the notes in the workspace. A bare name is used where it is unique, a path otherwise.
  - `[[note#` offers that note's headings, and `[[note#^` its block ids.
- **Footnotes**:
  - `[^` offers the existing footnotes, plus *new footnote*.
  - **Insert Footnote** (`Ctrl+Alt+6`, or `Cmd+Alt+6` on macOS) adds the next number at the cursor and its definition at the end of the file.
- **Block ids** (`^ma-32`) are dimmed.
- **In table code mode** a wikilink shows its full `[[…]]` source.
- **A callout continues around a table** without a gap. A table in a plain quote takes the quote's colours.
- **Update notice**: once a day the extension checks GitHub Releases and offers the newer version. Turn it off with `mdLivePreview.plus.checkForUpdates`.
- **New setting** `mdLivePreview.plus.shareSelectionWithClaude`. The selection file is written only if `~/.claude` exists.
- **Versions now increase with every release**, so VS Code installs a new one over the old without `--force`.
