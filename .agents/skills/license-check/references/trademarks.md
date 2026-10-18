# Trademarks, branding, and marketplace rules

Not legal advice. Verified against primary sources; gaps are marked as gaps.

## The one rule that unifies everything

**Plain text, never logos, and never lead with someone else's mark.**

That single sentence satisfies the Ninth Circuit's nominative-use factor 2, AWS
Trademark Guidelines §13, and Microsoft's VS Code icon prohibition
simultaneously. Almost every branding mistake is a violation of one half of it.

## Nominative fair use

*New Kids on the Block v. News America Publishing*, 971 F.2d 302 (9th Cir. 1992).
**All three** factors must hold:

1. The product cannot be readily identified without using the mark;
2. Only as much of the mark as is reasonably necessary is used;
3. Nothing suggests sponsorship or endorsement by the mark holder.

Factor 2 is what separates a word from a logo: it permits "the words but not the
font or symbol." Using the *name* in plain text is generally defensible;
reproducing the *logo, custom typeface, or trade dress* usually is not.

What flips nominative into infringing: using the logo instead of the word;
putting the mark in the **leading position** of your product name; mimicking
trade dress; anything implying official status.

**A disclaimer is a convention, not a safe harbour.** "Not affiliated with X" is
evidence bearing on factor 3 — it does not rescue a use that fails factor 1 or 2.
It will not cure logo use or a name that leads with someone else's mark. Put it
where the claim is made (README top, Marketplace description), not buried.

*Scope caveat:* New Kids is Ninth Circuit law. Other circuits differ — the Third
has its own variant, some fold it into ordinary confusion analysis.

## Naming: the mandated shape

Both AWS and Microsoft independently require the same pattern:

> `[Your Brand] [relational phrase] [Their Mark]`

- ✅ `MyDiagrams for AWS` · `My Extension for Visual Studio Code`
- ❌ `AWS Diagrams` · `Visual Studio Code My Extension`

AWS §7 is categorical: *"You will not incorporate AWS Marks into the names of
your organization, products, or services."* §13 permits fair use *"in plain text
only (no logos) and used to make true factual statements"* with relational
phrases — for, with, compatible with, works with, built on — *"so long as the
term is accurate."*

## Icons and logos — hard prohibitions

**VS Code icon is flatly banned for extensions.** From
[code.visualstudio.com/brand](https://code.visualstudio.com/brand), explicitly
Not OK: *"Using the icon to identify or promote your own product, service,
application, **VS Code extension**, blog, podcast…"* Also banned: integrating it
into your logo, modifying or re-drawing it, adding text or a background.

Do not put the VS Code fish, the AWS smile, or the Obsidian gem in your extension
icon, README, or Marketplace banner.

**Spelling:** use "Visual Studio Code" on first mention; Microsoft asks you not
to write "vscode", "VSCode", "VSC", or "Code".

**AWS trade dress (§10):** don't imitate the look and feel of AWS properties,
*"including … fonts, graphic designs, **product icons**"*.

## AWS Architecture Icons — the sharpest open risk

There is **no AWS Architecture Icons license or terms-of-use document.** Verified
three ways: the live page, the downloaded icon ZIP (8,426 entries — no LICENSE,
TERMS, or README of any kind), and all 156 slides of the official PowerPoint
toolkit (design guidance only, no legal terms). Archived snapshots from 2019,
2020 and 2022 show materially unchanged wording.

The entire grant is one sentence:

> "We allow customers and partners to use these toolkits and assets to create
> architecture diagrams… incorporate them directly into your whitepapers,
> presentations, datasheets, posters, or any technical material."

Two limits matter: **who** ("customers and partners", not the public) and **what
purpose** ("to create architecture diagrams"). And §15 says AWS *"does not
provide licenses or other authorization for use of AWS content in third party
publications, including screenshots, diagrams, code…"* outside limited
educational/non-profit fair use.

**The distinction that matters for this repo:**

- **Within the grant** — a *user* of the extension authors a diagram containing
  AWS shapes. That is the sanctioned use case, and draw.io's own stencil
  restriction expressly does not reach *"end-user diagram output."*
- **Not clearly within the grant** — **redistributing the shape geometry inside
  the extension package** to everyone who installs it. The grant permits *using*
  the icons to *make diagrams*; it does not on its face grant redistribution in a
  shipped software product.

### How does draw.io itself do it?

Worth understanding, because the instinct is "draw.io ships these, so it must be
fine" — and the answer is more limited than that.

- **They do not rely on Apache-2.0 for the icons.** The drawio LICENSE is
  standard Apache boilerplate with no icon clause, and Apache-2.0 §6 expressly
  *"does not grant permission to use the trade names, trademarks, service marks,
  or product names of the Licensor."*
- **They state their permission in a scoped way.** From the drawio README:
  *"Some icons are originally defined by third-party copyright holders; we have
  verified that all original licenses permit use **in this project**."* That
  sentence clears draw.io. It says nothing about anyone else redistributing the
  shapes in their own software.
- **They negotiated directly with vendors.** In
  [discussion #5327](https://github.com/jgraph/drawio/discussions/5327) the
  maintainer describes telling Microsoft the Azure icons would not be included
  *"until they deleted most of the original license text"*, and questions the
  clarity of AWS's own terms. Asked to place shapes in the public domain or
  clarify commercial reuse, the answer was *"Commercially, we can't do that."*
- **The stencils carry no notice of their own.** `vendor/aws4.xml` has no
  copyright or license header anywhere in its 6.5MB — only shape geometry and
  AWS service names.
- **The geometry is traced, not redrawn.** 1,037 shapes across 683 distinct
  canvas sizes with fractional coordinates (`43.945x43.945`, `377.953x377.953`)
  — the signature of vector tracing from source artwork, not original drawing on
  a clean grid. And draw.io's own stencil restriction explicitly reaches
  *"conversions to other formats, traced reproductions, substantially similar
  visual representations."* By their own definition these are derivatives of the
  vendor icons, not independent works.

So draw.io's position rests on a project-specific permission plus direct vendor
relationships — **neither of which transfers to a downstream redistributor.**

Their stencil LICENSE does add a restriction aimed at **Atlassian** products,
which a VS Code extension sits outside. But that clause narrows rights; it does
not grant any. Neither it nor Apache-2.0 can convey more rights in the AWS icons
than AWS granted, because JGraph does not own them.

**A vendored file's license cannot convey rights its author never held.** That
is the general lesson worth carrying to any vendored asset — and the specific
reason this question stays open even though draw.io ships under Apache-2.0.

This is the one item genuinely worth a lawyer's read, or an email to
`trademarks@amazon.com` (§16), before a wider release. Do not let the skill
manufacture a permissive reading of it.

Design constraints from the AWS deck, if the shapes are rendered: don't crop,
flip, rotate, recolor, or reshape service icons. This repo's build script and
notices already commit to exactly that (geometry copied verbatim, color taken
from the user's own file) — keep it true.

## Obsidian — low risk

"Obsidian-style" in the README is comfortably defensible: descriptive, plain
text, no logo, not leading the product name. Obsidian's developer policy asks
only that you not *"use the 'Obsidian' trademark in a way that could confuse
users into thinking your plugin or theme is a first-party creation"* — and
"-style" affirmatively negates that. That policy also governs only Obsidian's own
plugin directory, so it binds a VS Code extension as good practice, not terms.

Keep it in the description rather than `displayName`; never use the logo or app
icon. (Their commercial-use contact requirement applies to *assets*, not
descriptive word use.)

## Marketplace rules — thinner than assumed

**There is no "VS Marketplace Extension Guidelines" page and no acceptable-use
policy.** The Participation Policies (June 2021) contain **zero** rules on
naming, trademarks, icons, impersonation, or telemetry. Don't cite them for
naming rules. The rules that exist:

- **Publisher Agreement §3(b)** (Jan 2019) — you warrant your listing *"does not
  violate third parties' intellectual property rights, including third-party
  trademarks or icons."* Microsoft pushes the whole trademark question onto you.
- **§13 indemnity** — you indemnify Microsoft against infringement claims. If AWS
  or Obsidian complains, you carry the cost.
- **Participation Policies §5(a)** — Microsoft may remove an offering *"for any
  reason."*
- **§3(b)** — don't promote builds for *competing editors* in your listing or
  in-product. Dual-publishing to Open VSX is fine; advertising it there is not.

Don't confuse this with the **Microsoft Publisher Agreement 8.0**, which governs
the Azure/commercial marketplace — a different agreement that dominates search
results.

**Gap, stated as a gap:** no published Microsoft clause on impersonation or
typosquatting was found. Verified-publisher enforcement is platform practice, not
published policy.

## The `license` field

- **VS Marketplace:** effectively optional. `vsce` warns and shows an
  interactive `[y/N]` prompt defaulting to No; answer `y` or pass
  `--skip-license` and it publishes. Without one the listing reads "Unlicensed."
- **Open VSX:** a **hard failure**. `ovsx` throws *"This extension cannot be
  accepted because it has no license."* The interactive rescue is skipped under
  CI (`!isCI`), so a license-less release pipeline **fails with no prompt** — a
  common release-automation break.

Open VSX requires *a* license expression but does **not** require it to be
OSI-approved, and it may differ from your source repo's license.

## Telemetry

Publisher Agreement §5(b) requires a privacy statement describing what customer
data is collected, how it is used, and what controls users have. These clauses
are written around hosted/Azure offerings and apply awkwardly to a local
extension. There is no VS Marketplace rule mandating a telemetry opt-out.

This extension collects nothing, which is the simplest possible position — keep
it that way, and if that ever changes, the privacy statement comes first.

## Sources

[VS Code brand](https://code.visualstudio.com/brand) ·
[AWS Trademark Guidelines](https://aws.amazon.com/trademark-guidelines/) ·
[AWS Architecture Icons](https://aws.amazon.com/architecture/icons/) ·
[Marketplace Publisher Agreement](https://cdn.vsassets.io/v/M146_20190123.39/_content/Visual-Studio-Marketplace-Publisher-Agreement.pdf) ·
[Participation Policies](https://cdn.vsassets.io/v/M187_20210610.3/_content/Visual-Studio-Marketplace-Participation-Policies.pdf) ·
[Open VSX FAQ](https://www.eclipse.org/legal/open-vsx-registry-faq/) ·
[Obsidian developer policies](https://docs.obsidian.md/Developer+policies) ·
[drawio stencils LICENSE](https://github.com/jgraph/drawio/blob/dev/src/main/webapp/stencils/LICENSE)
