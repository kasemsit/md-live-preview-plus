# License obligations for a bundled VS Code extension

Not legal advice. This is a working reference for spotting problems early;
anything marked **unsettled** needs a lawyer, not a confident answer.

## Why bundling is the thing that matters

`npm install` distributes nothing, so almost no obligation is triggered. The
`.vsix` is the distribution unit, and `.vscodeignore` keeps `node_modules/` out
of it — so the `LICENSE` files that satisfied MIT on disk are simply not there
any more. Once `dist/extension.js` contains CodeMirror, Mermaid and Shiki code,
MIT's "include the above copyright notice … in all copies or substantial
portions" is live and unsatisfied by default.

esbuild does help, but far less than it appears. `legalComments` defaults to
`eof` when bundling, and **minify does not strip legal comments** — but only
packages that put a `/*!` or `@license` banner in their *published* code have
anything to preserve. In this repo that is dompurify, js-yaml and lodash-es;
the other ~165 production packages ship a separate `LICENSE` file no bundler
ever reads. A surviving banner block is evidence of a few well-behaved
packages, not of compliance.

**So the notices file is the mechanism that actually does the work.** It is what
Microsoft itself ships (`ThirdPartyNotices.txt` in VS Code), and it satisfies
BSD's "other materials provided with the distribution" directly.

## Obligation table

Assume: bundled into `dist/*.js`, shipped in a `.vsix`, project is MIT.

| License | What you owe | OK to bundle? |
| --- | --- | --- |
| MIT, ISC | Reproduce copyright + permission notice | Yes |
| BSD-2-Clause | Copyright, conditions, disclaimer | Yes |
| BSD-3-Clause | Same + don't use author's name to promote | Yes |
| Apache-2.0 | §4(a)-(d); see NOTICE trap below | Yes |
| MPL-2.0 | Per-file copyleft; publish source location | Yes, with a source link |
| LGPL-2.1/3 | Relink ability — destroyed by bundling | **Only if externalized** |
| GPL-2.0/3.0 | Copyleft over the whole combined work | **No** |
| AGPL-3.0 | GPL + network clause | **No** |
| CC-BY | Title, author, source, license, changes | Assets only |
| CC-BY-SA | Attribution + ShareAlike | **Risky — see below** |
| SIL OFL 1.1 | Ship OFL text; Reserved Font Name on modify | Fonts only |
| Unlicense, CC0, 0BSD, WTFPL | Nothing practical | Yes |

### The Apache-2.0 NOTICE trap

§4(d): if the upstream package ships a `NOTICE` file, its attribution text must
be reproduced in your distribution. **No license scanner does this** — they read
the SPDX id and stop. `audit-deps.mjs` checks for it explicitly. It is the most
commonly missed obligation in this whole list.

### MPL-2.0 in a bundle

Copyleft attaches per *file*, not per program, so your own MIT files are
unaffected. What you owe is §3.2: make the MPL files' source available and say
where. A URL to the upstream repo at the exact version, in the notices file, is
standard practice. (dompurify is `MPL-2.0 OR Apache-2.0` — you elect one; taking
Apache-2.0 avoids the source-availability line and swaps in the NOTICE check.)

### Why LGPL breaks specifically here

LGPL permits linking to proprietary code *provided the user can swap in a
modified library*. Tree-shaking and minification fuse the library into your
code, so there is no boundary left to swap — the license isn't incompatible,
your build makes compliance impossible. Marking the package `external` in
esbuild and shipping it unbundled restores the relink path.

### Why GPL is disqualifying even though this project is MIT

MIT is GPL-compatible in one direction only. MIT code can be absorbed *into* a
GPL project; GPL code cannot flow into a work you distribute under MIT, because
you cannot grant recipients MIT terms over code you only hold under GPL. The
Marketplace listing would say MIT while the real obligations were GPL — a
license misstatement, not a technicality.

## Genuinely unsettled

State these as open questions; don't resolve them in either direction.

- Whether bundling unmodified **CC-BY-SA** assets creates an "adaptation"
  (ShareAlike propagates) or a mere "collection" (it doesn't). Fact-dependent,
  no controlling authority.
- Whether **JS bundling** is static or dynamic linking for LGPL. The FSF has
  never addressed JS bundlers. The conservative reading above is conservative
  *because* this is open.
- Whether **linking creates a derivative work** at all. FSF says yes;
  substantial scholarship disputes it; US courts have not squarely decided.
- **How short a snippet is too short to be copyrightable.** Trivial fragments
  likely fall below the originality threshold and *Google v. Oracle* (2021)
  supports fair use for small functional excerpts — but there is no line-count
  rule, and anyone who gives you one is guessing.

## Copied code

- **Stack Overflow** is CC BY-SA (2.5 / 3.0 / 4.0 by post date). ShareAlike
  conflicts with redistributing that file under MIT, and the required
  attribution is heavier than a comment — link the question, name every
  contributor, link each profile. Rewriting the logic in your own idiom avoids
  the question entirely and usually reads better.
- **Blog posts**: no license stated means all rights reserved. A site-wide
  footer CC license is often **CC BY-NC**, which is unusable in a Marketplace
  extension.
- **A GitHub repo with no LICENSE file grants nothing.** GitHub's ToS §D.5
  permits viewing and forking *on GitHub*, not shipping the code in your
  product. Counter-intuitively this is stricter than GPL, which at least grants
  rights with conditions.
- A README that says "MIT" with no LICENSE file is ambiguous — ask the author to
  add the file rather than assuming.

## Dev vs prod

devDependencies create no distribution obligations, because obligations attach
to distribution and they are never distributed. This holds even for GPL build
tools (Make is GPL; software built with it is not). Hence `--production` /
`--omit dev` on every command, and why `audit-deps.mjs` walks only the prod tree.

Four edge cases where that reasoning breaks:

1. **Build-time codegen that copies licensed material into output.** This repo
   has two: `dist/langs/*.json` (Shiki grammars) and `dist/aws4-shapes.json`
   (draw.io stencils). Neither is a dependency, so no scanner will ever see
   them. This is what `audit-package.mjs` is for.
2. **Injected helpers** (`tslib`, Babel/esbuild shims) land in output.
3. **A devDependency that shipped code imports anyway** — the `package.json`
   section is a convention; the bundle is the ground truth.
4. **Type-only packages** (`@types/*`) are erased at compile time. No obligation.

## Tooling

Verified as of this writing:

- **`license-checker` is abandoned** (last publish 2019) despite being the most
  recommended tool online. So are `npm-license-crawler`,
  `oss-attribution-generator`, and `license-compatibility-checker`.
- Maintained: **`license-checker-rseidelsohn`** (drop-in replacement),
  `licensee` (good CI gate, rules in package.json),
  `@cyclonedx/cyclonedx-npm` and Syft for SBOMs.
- Grype consumes Syft output for *vulnerabilities*, not licenses — not a
  compliance tool.

```bash
# license texts, not just SPDX ids — this is what a notices file needs
npx license-checker-rseidelsohn --production --customPath customFormat.json
# customFormat.json: {"name":"","version":"","licenses":"","repository":"","licenseText":""}

# CI gate
npx license-checker-rseidelsohn --production \
  --onlyAllow "MIT;ISC;BSD-2-Clause;BSD-3-Clause;Apache-2.0;0BSD;CC0-1.0;Unlicense;MPL-2.0"
```

Every one of these reads `package.json`'s `license` field, so none detect Apache
NOTICE files, vendored code, or a declared license contradicting the file
headers. Tooling gets ~85%; the rest is reading.

## Sources

[esbuild legal comments](https://esbuild.github.io/api/#legal-comments) ·
[Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0) ·
[ASF GPL compatibility](https://www.apache.org/licenses/GPL-compatibility.html) ·
[MPL-2.0 FAQ](https://www.mozilla.org/en-US/MPL/2.0/FAQ/) ·
[GNU GPL FAQ](https://www.gnu.org/licenses/gpl-faq.html) ·
[SIL OFL 1.1](https://openfontlicense.org/documents/OFL.txt) ·
[CC FAQ](https://creativecommons.org/faq/) ·
[SO attribution](https://stackoverflow.blog/2009/06/25/attribution-required/) ·
[choosealicense: no permission](https://choosealicense.com/no-permission/) ·
[GitHub ToS](https://docs.github.com/en/site-policy/github-terms/github-terms-of-service)
