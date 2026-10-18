---
name: release
description: Release this VS Code extension — run the checks, bump the version, commit and tag, push to origin/master, and publish to both the Visual Studio Marketplace and Open VSX. Use when the user asks to release, ship, publish, or cut a version.
---

# Release

Takes the extension from a clean working tree to a published version on
**both** the Visual Studio Marketplace and Open VSX (VSCodium, Gitpod, Eclipse
Theia and other non-Microsoft IDEs read from Open VSX, not the Marketplace —
skipping it silently leaves those users on the old version). Three
irreversible steps sit at the end; each has its own confirmation and none of
them happens without the user saying yes.

**Never skip a gate to save time. Never publish without explicit approval.**

## Before anything

Check with `git status --porcelain`, `git branch --show-current`, and
`git fetch && git status -sb`:

- On `master` (this project develops and releases on master — not `main`).
- Working tree **clean**. Uncommitted work must be committed or stashed first;
  do not sweep it into the release commit.
- In sync with `origin/master`. If behind, pull first. If ahead, that is fine —
  those commits go out with this release.

Ask the user for the new version number if they have not given one. Show the
current version from `package.json`, the Marketplace-published version, and the
Open VSX-published version (`npx ovsx show t-shoot.markdown-live-preview-editor`)
— all three can differ — so the choice is informed.

## Step 1 — Quality

```bash
npm run compile   # esbuild + tsc --noEmit
npm run test:all  # unit (with coverage) -> integration -> e2e
```

`test:all` is the release gate: the unit suite alone cannot see CSS, layout,
click behaviour, or anything that only exists once VS Code has loaded the
extension, and real bugs have shipped through exactly those gaps. It downloads
a VS Code build on first run, so allow it several minutes. The `test` skill
documents what each suite covers.

Everything must pass. A failure stops the release — report it and stop; do not
"fix it quickly" as part of a release unless the user asks.

## Step 2 — Licensing

Run the `license-check` skill's scripts:

```bash
node .agents/skills/license-check/scripts/audit-deps.mjs
```

Any `x` (incompatible) or `?` (undetermined) is **blocking**. `!` items need a
line in `THIRD-PARTY-NOTICES.md`; if one is already covered there, say so and
move on.

The package audit needs a built VSIX, so it runs in step 4.

## Step 3 — Carried-over findings

Read `.claude/RELEASE-MEMO.md`. Two things to do with it:

1. **Open questions** — each one already has a decided course of action; what
   is open is the underlying legal question. So do **not** re-litigate them or
   present them as choices to make again. State the standing decision in one
   line, then say whether anything in that question's "what would change the
   answer" has actually happened. If nothing has, that is a one-line "unchanged"
   and the release continues.
2. **Before next release** — work through the checklist. Items that are done
   move to the decision log; items that are not get carried forward.

Never quietly drop an open question because a release is in progress.

## Step 4 — Version, changelog, package

1. Set the new version in `package.json`.
2. Add a CHANGELOG section for it, dated today, in the existing style — the
   file is bilingual, so both the English and 日本語 sections need the entry.
   Write what changed for users, not a commit list.
3. Build the package:

```bash
npx vsce package
```

4. Audit what was actually built:

```bash
node .agents/skills/license-check/scripts/audit-package.mjs
```

`BLOCK` findings stop the release. `REVIEW` needs a judgement call — put it to
the user rather than deciding alone. `INFO` is informational.

5. Sanity-check the contents with `npx vsce ls` — `LICENSE`,
   `THIRD-PARTY-NOTICES.md` and `LICENSE-SHAPES` must all be in the package.

## Step 5 — Gate 1: confirm before git

Present a single summary and **stop for approval**:

- Version: old → new
- Tests: pass/fail counts
- Licence audits: findings at each level
- Open questions carried (one line each)
- What the git step will do: commit, tag `vX.Y.Z`, push to `origin/master`
- That the publish steps to follow will target **both** the Marketplace and
  Open VSX

Wait for the user. Do not continue on silence or on an ambiguous reply.

## Step 6 — Git

```bash
git add -A
git commit -m "Release X.Y.Z"
git tag -a vX.Y.Z -m "Release X.Y.Z"
git push origin master --follow-tags
```

Tag format is `vX.Y.Z`, matching the existing `v0.0.11`.

**The `-a` is not optional.** `--follow-tags` pushes annotated tags only. A bare
`git tag vX.Y.Z` makes a lightweight one, which the push skips **without saying
so** — the commits land, the tag silently does not, and the release looks like
it worked. Every existing release tag is annotated; keep it that way.

Confirm the tag actually arrived before moving on:

```bash
git ls-remote --tags origin | grep vX.Y.Z
```

Nothing back means the tag is still local. Recover with
`git tag -d vX.Y.Z && git tag -a vX.Y.Z -m "Release X.Y.Z" && git push origin vX.Y.Z`.

## Step 7 — Gate 2: confirm before publishing

**This gate is separate from gate 1 and cannot be merged into it.** A push can
be corrected with another commit. Publishing cannot: on either registry the
version number is consumed forever and the build reaches every existing
installation, and `vsce unpublish` / `ovsx unpublish` remove the whole
extension (or, for `ovsx`, whichever versions are named) rather than fixing one.

State plainly that this is irreversible, name the extension and version, and
say both registries will be published to. Ask for explicit approval once —
Step 8 and Step 9 both proceed on it; no second confirmation between them.

## Step 8 — Publish to the Marketplace

```bash
npx vsce publish
```

**Credentials.** `vsce` needs a Personal Access Token.

- If `VSCE_PAT` is set in the environment, `vsce` uses it.
- Otherwise check for a stored login first (attempt the publish; `vsce` uses
  whatever it finds). If there is none, ask the user to run
  `npx vsce login t-shoot` in their own terminal, then continue.

**Never ask the user to paste a PAT into the conversation, never read one from a
file, and never write one anywhere.** A PAT lets anyone publish under this
publisher name. If a command would put a token in a shell argument or a log,
use the login flow instead.

## Step 9 — Publish to Open VSX

Publish the **same** `.vsix` built in step 4 — do not let `ovsx` repackage from
source, which risks the two registries silently shipping different bytes:

```bash
npx ovsx publish markdown-live-preview-editor-X.Y.Z.vsix --no-dependencies
```

`--no-dependencies` is required for this extension: it is esbuild-bundled (the
`.vsix` already contains everything needed at runtime), and `ovsx`'s default
dependency walk only understands npm/yarn-installed `node_modules`, which is
not what a bundle's `dist/` is.

**Credentials.** Same shape as `vsce`, but a separate token — an Open VSX
personal access token from <https://open-vsx.org/user-settings/tokens>, not the
Marketplace PAT.

- If `OVSX_PAT` is set in the environment, `ovsx` uses it.
- Otherwise check for a stored login first (attempt the publish; `ovsx` reads
  its own credential store, separate from `vsce`'s). If there is none, ask the
  user to run `npx ovsx login t-shoot` in their own terminal, then continue.

The same rule as step 8 applies: never ask for the PAT in-conversation, never
read or write one to a file yourself.

If the namespace (`t-shoot`) does not exist yet on Open VSX, `publish` fails
saying so; `npx ovsx create-namespace t-shoot` (same credentials) creates it —
this is one-time setup, already done for this project, but the failure mode is
worth recognizing if it ever reappears (e.g. a namespace rename).

`--skip-duplicate` (fails silently instead of erroring if the version already
exists) is useful when *resuming* a release where step 9 alone needs re-running
— do not add it to a first attempt, since a silent no-op there would look
identical to a real publish.

## Step 10 — Afterwards

Confirm both versions are actually live:

```bash
npx vsce show t-shoot.markdown-live-preview-editor
npx ovsx show t-shoot.markdown-live-preview-editor
```

Each tool printing success (`DONE Published` for `vsce`; `ovsx` exits zero with
no error) means the upload was accepted, **not** that the version is available.
Both registries validate the package first (the Marketplace runs a virus scan
and checks; Open VSX reviews too), which takes minutes — longer for a larger
VSIX. Until that finishes, the version does not appear in `show` at all.

So a `show` that still lists the previous version right after publishing is
normal on either registry, and is **not** yet confirmation of anything. Don't
poll either for long: say plainly that both uploads succeeded and the listings
have not caught up, and point the user at whichever hub is relevant:

- Marketplace: <https://marketplace.visualstudio.com/manage/publishers/t-shoot>
- Open VSX: <https://open-vsx.org/user-settings/namespaces> (extension pages
  live at `https://open-vsx.org/extension/t-shoot/markdown-live-preview-editor`)

If validation fails on either, that registry's version number is not consumed
— fix the problem and re-run that registry's publish command alone at the same
version; the other registry is unaffected and does not need repeating.

Then update `.claude/RELEASE-MEMO.md`: move completed checklist items into the
decision log with today's date, and update each open question's "last reviewed"
date.

## If something stops mid-way

Say exactly where it stopped and what state things are in:

- **Before step 6** — nothing has left the machine. Reverting is just undoing
  the version bump and changelog edit.
- **After step 6, before step 8** — the commit and tag are pushed but nothing is
  published anywhere. Resuming means running step 8 then step 9; do not re-run
  the earlier steps or bump the version again.
- **After step 8, before step 9** — the Marketplace has the release, Open VSX
  does not yet. Resuming means running step 9 alone (its own gate-7 approval
  still covers this — do not ask again, but do say plainly that the Marketplace
  half is already out and only Open VSX remains).
- **After step 9** — the release is out on both. A mistake is fixed by
  releasing a new patch version on whichever registry needs it, never by
  unpublishing.
