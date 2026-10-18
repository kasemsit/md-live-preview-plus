# The assets this repo ships that no dependency scanner can see

Three things reach users without passing through npm's `license` field. Each was
put in `dist/` by a build script, so `audit-deps.mjs` is blind to all of them and
`audit-package.mjs` exists to cover them.

## 1. Syntax grammars — `dist/langs/*.json` (23 files, ~5.7MB)

`scripts/build-shiki-langs.mjs` copies grammars out of `@shikijs/langs` into
`dist/langs/`. The npm package is MIT (© Pine Wu, © Anthony Fu), **but Shiki does
not author these grammars** — it normalises and redistributes them from their
original upstream repos, each keeping its own license. Shiki records them in a
per-file NOTICE:

<https://github.com/shikijs/textmate-grammars-themes/blob/main/packages/tm-grammars/NOTICE>

Verified for the 23 grammars in `CURATED_LANGS` as of Shiki 1.29.2:

| Grammars | License | Upstream |
| --- | --- | --- |
| c, cpp, csharp, css, go, html, java, javascript, json, jsx, markdown, php, python, ruby, rust, shellscript, sql, tsx, typescript | MIT | microsoft/vscode |
| bash | MIT | byte-identical to `shellscript.json` — same grammar, aliased |
| kotlin | MIT | fwcd/vscode-kotlin |
| swift | MIT | jtbandes/swift-tmlanguage |
| yaml | MIT | textmate/yaml.tmbundle — © 2015 FichteFoll (see below) |

Themes are the same story (`@shikijs/themes`, its own
[NOTICE](https://github.com/shikijs/textmate-grammars-themes/blob/main/packages/tm-themes/NOTICE)):
`dark-plus` / `light-plus` are MIT © Microsoft, `github-dark` / `github-light`
are MIT from primer/github-vscode-theme.

So everything currently shipped is MIT — **but the copyright lines are not
reproduced anywhere in the VSIX**, and MIT requires that. Fixing it is one
section in `THIRD-PARTY-NOTICES.md` naming vscode/fwcd/jtbandes/primer.

### The live hazard: adding a language

`CURATED_LANGS` in `scripts/build-shiki-langs.mjs` (kept in sync with
`src/editor/shikiHost.ts`) is an allowlist. Shiki's full grammar set is **not**
uniformly permissive — it contains at least:

- **GPL-3.0** — e.g. `ada.json` (AdaCore/ada_language_server)
- **MPL-2.0** — e.g. `bird2.json`
- **NOASSERTION** (no license determined) — e.g. `apache.json`
- and a GPL-3.0 *theme*, `aurora-x.json`

Adding one line to `CURATED_LANGS` can therefore copy GPL-3.0 code into the
VSIX, which is incompatible with shipping under MIT. **Check the NOTICE before
adding any language or theme.** This is the single most likely way this repo
acquires a real licensing defect.

### When a grammar is missing from the NOTICE — the `yaml` case

`yaml.json` does not appear in the grammar NOTICE at all. That is not evidence
of a missing license; it means the NOTICE is not the only place to look.

`tm-grammars`' generated `index.js` carries a `source` field per grammar, pinned
to an upstream commit:

```
source: 'https://github.com/textmate/yaml.tmbundle/blob/e54ceae3.../Syntaxes/YAML.tmLanguage'
```

Following it settled the question. `textmate/yaml.tmbundle` has no top-level
LICENSE, and its README grants a permissive repo-wide license **with an
exception**: a file accompanied by one named with a `-license` suffix takes that
license instead. `Syntaxes/YAML-license.txt` exists and is the MIT License,
© 2015 FichteFoll.

The method generalises: check the package's own generated metadata for a
`source` pointer, follow it, and read the upstream README for per-file
exceptions before concluding a license is unknown.

## 2. AWS shapes — `dist/aws4-shapes.json` (~2.3MB)

`scripts/build-aws-shapes.mjs` converts `vendor/aws4.xml` (draw.io's stencil
library) into SVG paths. **This one is already handled well** — `LICENSE-SHAPES`
reproduces draw.io's stencil restriction verbatim, `THIRD-PARTY-NOTICES.md`
names the source and records that only a format conversion was performed, and
both files ship inside the VSIX.

Two things to keep true, because they are what the notices *claim*:

- **The conversion must stay mechanical.** The stencil terms cover derivatives
  including "conversions to other formats". The build script's contract —
  nothing rounded, re-scaled, simplified, minified or recoloured — is a
  licensing commitment, not a style preference. Changing it turns a format
  conversion into a redraw.
- **draw.io is Apache-2.0**, so check upstream for a `NOTICE` file whose text
  §4(d) would require reproducing.

Note the restriction's actual shape: it forbids use in **Atlassian** products and
ecosystems. A VS Code extension is outside it. The clause also expressly does not
reach end-user diagram output.

## 3. Ported CSS — `media/sample-styles/*.css`, `media/webview-editor-theme.css`

Both sample styles are ports of someone else's stylesheet, and each says so in
its own header comment:

- `github-like.css` — converted from **github-markdown-css**'s `dark_colorblind`
  palette (MIT, © Sindre Sorhus)
- `vscode.css` — ported from VS Code's own
  `markdown-language-features/media/markdown.css` (MIT, © Microsoft Corporation)

A port of a stylesheet is a derivative work; MIT wants the copyright line to
travel with it. The provenance is honestly recorded in the source comments, but
those comments do not reach `THIRD-PARTY-NOTICES.md`, which is the file that
actually ships. Add both.

## The pattern

In every one of these cases the developer *knew* the provenance and wrote it
down in a code comment — the gap is only that the comment stays in `src/` while
the obligation travels with `dist/`. When adding any new generated or vendored
asset, the question to ask is not "did I note where this came from" but **"does
the note ship with it."**
