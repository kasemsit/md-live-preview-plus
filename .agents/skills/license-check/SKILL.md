---
name: license-check
description: Check this VS Code extension for licensing, copyright, and trademark problems before publishing — bundled dependency licenses, attribution for vendored and generated assets (Shiki grammars, AWS shapes, ported CSS), third-party marks in naming and branding, and Marketplace/Open VSX requirements. Use when adding a dependency, vendoring or generating an asset, adding a syntax-highlight language, copying code or CSS from elsewhere, writing README/marketplace copy, or preparing a release.
---

# Licensing and copyright check

Goal: never ship someone else's work without the permission and attribution it
requires — and never claim rights this project does not hold.

**Not legal advice.** This finds and fixes the routine, well-understood problems.
Where something is genuinely unsettled, say so and leave it for a lawyer rather
than resolving it in the project's favour.

## Which check to run

Match the work in front of you. Do not run all four for a one-line change.

| Situation | Do this |
| --- | --- |
| Added/updated an npm dependency | Step 1 |
| Vendored a file, or a build script writes into `dist/` | Step 2 |
| Added a language to `CURATED_LANGS` | Step 2, **grammar section — this is the live hazard** |
| Copied code, CSS, or an icon from anywhere | Step 3 |
| Wrote README / marketplace / naming copy | Step 4 |
| Preparing a release | All four, in order |

## Step 1 — Bundled dependencies

```bash
node .agents/skills/license-check/scripts/audit-deps.mjs
```

Walks the **production** tree only (devDependencies never ship, so they carry no
distribution obligation) and flags four states: `x` incompatible, `?`
undetermined, `!` extra obligation, blank fine.

Why this matters at all: `.vscodeignore` excludes `node_modules/`, so the
`LICENSE` files that satisfied MIT on disk are **not in the VSIX**. Once
`dist/extension.js` contains that code, MIT's "include the above copyright
notice in all copies" is live and unsatisfied by default.

Handling the flags:

- **`x` (GPL/AGPL/SSPL/BUSL)** — stop. Copyleft reaches the whole bundle, which
  is incompatible with shipping under MIT. Find another package.
- **`?`** — go read the package's `LICENSE` file and its README. The script
  already falls back to reading the license text when `package.json` omits the
  field, so a remaining `?` means nobody stated anything. Never assume MIT.
- **`!` Apache-2.0** — check for a `NOTICE` file in the package; §4(d) requires
  reproducing its text. **No license scanner does this**, so the script checks it
  and prints the paths. This is the most commonly missed obligation.
- **`!` MPL-2.0** — per-file copyleft. Your own files stay MIT; you owe a source
  location for the MPL files. `dompurify` is `MPL-2.0 OR Apache-2.0` — elect
  Apache-2.0 and it becomes a NOTICE check instead.
- **`!` LGPL** — bundling destroys the relink ability LGPL is conditioned on.
  Either mark the package `external` in `esbuild.js` and ship it unbundled, or
  don't use it.

Then make sure every shipped package is named in `THIRD-PARTY-NOTICES.md`.
Background and the full obligation table: `references/licenses.md`.

## Step 2 — Vendored and generated assets

```bash
node .agents/skills/license-check/scripts/audit-package.mjs   # audits the newest .vsix
```

**This is the step that catches what tooling cannot see.** Files a build script
writes into `dist/` never pass through npm, so they have no `license` field and
are invisible to every dependency scanner — including step 1.

Three live cases in this repo, detailed in `references/bundled-assets.md`:

- **`dist/langs/*.json`** — 23 TextMate grammars copied out of `@shikijs/langs`.
  Shiki is MIT but does not author them; each keeps its upstream license.
- **`dist/aws4-shapes.json`** — draw.io stencil geometry. Already attributed
  well; keep the conversion mechanical, because that is what the notices claim.
- **`media/sample-styles/*.css`** — ports of github-markdown-css and VS Code's
  own markdown.css. Both record provenance in a source comment that never
  reaches the shipped notices file.

**Before adding a language to `CURATED_LANGS`**, check Shiki's grammar
[NOTICE](https://github.com/shikijs/textmate-grammars-themes/blob/main/packages/tm-grammars/NOTICE).
The full set is **not** uniformly permissive — it contains GPL-3.0 (`ada`),
MPL-2.0 (`bird2`), NOASSERTION (`apache`), and a GPL-3.0 theme (`aurora-x`).
One line in that array can pull GPL code into the VSIX. This is the single most
likely way this project acquires a real defect.

The recurring lesson: the provenance is usually already known and written in a
code comment — the gap is that **the comment stays in `src/` while the
obligation travels with `dist/`**. Ask not "did I note where this came from" but
"does the note ship with it."

## Step 3 — Copied code, CSS, and assets

Before pasting anything from outside this repo:

- **A GitHub repo with no LICENSE file grants nothing.** GitHub's ToS permits
  viewing and forking *on GitHub*, not shipping the code. Counter-intuitively
  this is stricter than GPL.
- **Stack Overflow is CC BY-SA** (2.5/3.0/4.0 by post date). ShareAlike
  conflicts with redistributing that file under MIT. Understand the snippet and
  rewrite it in this codebase's idiom — that settles the question and reads
  better anyway.
- **Blog posts** default to all rights reserved; a footer CC license is often
  **CC BY-NC**, unusable here.
- **A port of someone's CSS or a conversion of their data is a derivative
  work.** Format conversion does not launder provenance.

When you do bring something in, record it in `THIRD-PARTY-NOTICES.md` in the
same change — not later.

## Step 4 — Naming, branding, marketplace

The whole of branding compliance in one line: **plain text, never logos, and
never lead with someone else's mark.**

- Both AWS (§7) and Microsoft mandate `[Your Brand] for [Their Mark]`.
  `MyTool for AWS` ✅ — `AWS MyTool` ❌.
- **Never** use the VS Code fish icon in an extension icon, README, or banner —
  Microsoft prohibits this explicitly for extensions. Likewise the AWS smile and
  the Obsidian gem.
- Write "Visual Studio Code" on first mention, not "VSCode".
- Keep the "not affiliated with…" disclaimer visible in the README and
  marketplace description. It is factor-3 evidence, **not** a safe harbour — it
  cannot cure logo use or a bad name.
- Keep `"license"` in `package.json`. Open VSX rejects a license-less extension
  outright, and **fails silently with no prompt under CI**.

`references/trademarks.md` has the nominative-fair-use factors, the verified
vendor rules, and what the Marketplace policies do and do not actually say.

## Reporting findings

Separate what you verified from what you could not:

1. **Blocking** — incompatible license, missing attribution for shipped code, a
   mark in the leading position. Fix before release.
2. **Should fix** — an obligation met in spirit but not in the shipped artifact.
   Most findings here land in this bucket.
3. **Open questions** — flag, don't resolve. One standing: **whether
   redistributing AWS shape geometry inside the extension package is covered by
   AWS's "create architecture diagrams" grant** (there is no AWS icon license
   document at all — see `references/trademarks.md`). Standing questions live in
   `.claude/RELEASE-MEMO.md`; add new ones there rather than here.

   But flagging is not the same as giving up. Before recording something as
   unresolved, exhaust the cheap leads — a package's generated metadata often
   names the upstream source, and an upstream README may carry per-file license
   exceptions. That is how the `yaml` grammar was settled after first looking
   unknowable (`references/bundled-assets.md`).

Never resolve an open question in the project's favour to close a checklist. A
vendored file's license cannot convey rights its own author never held — the
reason the AWS question stays open even though draw.io ships under Apache-2.0.
