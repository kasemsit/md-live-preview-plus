# md-live-preview-plus — changes

Each `## <version>` section is used as the GitHub release notes by `plus/release.sh`.

## Unreleased

- **Text size**: Larger Text, Smaller Text and Reset Text Size in the right-click menu.
  - The size is the setting `mdLivePreview.plus.textScale`, so it is remembered next time and applies to every open preview.
  - It scales the preview's base size, which is your VS Code editor font size and at least 15px; headings, tables and formulas follow.
- **Less empty space**:
  - A blank line next to a table, a display formula or a code block collapses, since those blocks have their own spacing.
  - A blank line between paragraphs stays: it is the paragraph spacing.
  - The caret's line opens to full height, and the arrow keys stop on it.
- **A one-line `$$…$$` formula** no longer takes three lines' height. It went from 84 px to about 35.
- **Tables**: a `|` inside `$…$` no longer splits a cell, so `| $|B_m|/n$ |` keeps its table.
- **`[text]`** is a link only when the document defines `[text]: url`, as in CommonMark and Obsidian. Before, `[0.8, 1.0]` or `[ฎีกา 1689/2518]` showed as an empty link with its brackets hidden.

## 0.4.8

- **Image embeds** `![[name.png]]` render as images, as in Obsidian:
  - the file is found by name anywhere in the workspace, so attachments kept in their own folder load;
  - `![[name.png|300]]` sets the width, `![[name.png|300x200]]` width and height;
  - with duplicate names, the file at the written path wins, then one in the note's own folder, then the shortest path. Write part of the path to choose, e.g. `![[Folder/name.png]]`;
  - a missing file says so; the caret on the line shows the source.
- **Underline**: Ctrl/Cmd+U wraps the selection in `<u>…</u>`, or unwraps it. Markdown has no underline; Obsidian, Pandoc and Word exports use the tag. The preview hides the tags and underlines the text, in tables too.
- **Search Google** and **Search Google Scholar** in the right-click menu, for the selected text.

## 0.4.7

**A right-click menu** in the Live Preview. It is VS Code's own menu, and it shows only the items that fit what was clicked:

- **Anywhere**:
  - **Copy Link to This Block**: copies `[[Note#^id]]`. A paragraph or list item without a block id gets one; a quote, callout, table or code block gets its id on its own line after the block, as Obsidian does. A heading copies `[[Note#Heading]]`, or its block id if it has one.
  - **Copy as Rich Text**: the selection, or the clicked block, as HTML for Word, Google Docs or e-mail. Headings, lists, tables, bold and links survive. Wikilinks become their labels, and `<!-- … -->` notes and block ids are left out.
  - **Add REVIEW Comment**: inserts `<!-- REVIEW "selected text": … -->` after the block and puts the caret in it.
  - **Open as Text at This Line**, **Open in Obsidian**.
- **With a selection**: **Ask Claude About the Selection** focuses Claude Code's prompt box; the selection is already attached.
- **On a link or citation**: **Open Link to the Side**.
- **On a formula**: **Copy TeX**.
- **On a table cell**: **Insert Row Above/Below**, **Insert Column Left/Right**, **Delete Row**, **Delete Column**, **Sort Table by This Column**, **Copy Table as Tab-Separated Text** (pastes into Excel or Sheets as cells).
- **In a document with footnotes**: **Renumber Footnotes in Order** relabels every footnote with the number it is shown as.

Every item is also a command, so it can have a keyboard shortcut. From the command palette it acts on the caret.

## 0.4.6

- **Math**, rendered with KaTeX, as Obsidian and Pandoc write it:
  - `$…$` inline;
  - `$$…$$` on one line;
  - `$$` blocks over several lines, which may follow a line of text directly.
- **Editing math**: click a formula, or move the caret into it, to edit its TeX.
- **Math is part of the parser**, so `$a_i$ and $b_j$` no longer turns into italics between the two formulas.
  - Pandoc's rules keep money as text: `$5 and $10` is not math.
- **Math renders in table cells, footnote cards and link previews too.**
- **KaTeX loads only when a document has math.** It ships in the extension; nothing is fetched from the internet.

## 0.4.5

- **Backlinks view** in the Markdown Live Preview sidebar: the notes that link to the one you are reading, each with the line that does it. Click a line to open that note there.
  - Pandoc citations count: a draft citing `[@key]` is listed under the reference note `@key.md`.
  - Works for the active Live Preview or an ordinary Markdown editor, and follows saved changes on disk.
- **Pandoc citations** (`[@key]`, `[@a; @b, p. 3]`) in drafts:
  - each key links to its `@key` reference note: hover to read it, click to open it;
  - a key with no note is drawn faint, so a typo shows before the document is built.
- **Selections inside rendered tables now reach Claude**, as the cells' Markdown source with line numbers. Before, Claude received nothing for them.

## 0.4.4

- **Hover preview of wikilinks**: rest the pointer on `[[note#^ma-32]]` to read that block in a card without leaving the note.
  - For a heading, or a block id on a heading as in `Laws/`, the card shows the whole section.
  - The card stays open while the pointer is on it, so a long section can be scrolled. Its title opens the note.
- **Links to missing notes** are shown faint with a dashed underline, as in Obsidian.
- **Foldable callouts**: `> [!type]-` starts folded and `> [!type]+` starts open. The chevron after the title folds or opens either.
- **HTML comments** (`<!-- … -->`) are tinted as notes to the writer, on their own lines or inside a paragraph.
- **Headings** in the Thai theme share one colour at every level, darker at the top. Before, only level 3 was coloured.
- **The Claude bridge**:
  - A notice in Claude Code says what was sent with each prompt.
  - A status bar item shows what Claude will get next. Click it to stop sending.
  - A selection is sent in full once per session. While it stays the same, later prompts carry a one-line reminder instead, so the conversation no longer grows with every prompt.
  - A selection over 4,000 characters is sent as its head and tail plus its line range.
  - Selecting text in an ordinary editor, or closing the preview, stops sending the old selection.
  - **Run the installer again** to get the new hook.

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
