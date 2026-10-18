---
name: test
description: Run this extension's tests — the unit suite for everyday work, and the full unit + integration + e2e run before a release. Use when asked to run tests, check that a change is safe, or verify the build before shipping.
---

# Test

Run commands from the repository root. On Windows PowerShell, use `npm.cmd` and `npx.cmd` when execution policy blocks `.ps1` wrappers. Compile before integration or E2E checks so they load the current bundle.

For real VS Code UI checks with computer-use, read [extension-ui-test](../extension-ui-test/SKILL.md). Keep browser E2E results separate from desktop UI verification.

Three suites, each covering what the others cannot reach. Which ones to run
depends on why you are running them.

| Suite | Command | Runs in | Covers |
| --- | --- | --- | --- |
| Unit | `npm test` | Node | Pure logic: parsing, geometry, table models, message routing |
| Integration | `npm run test:integration` | Real VS Code | Activation, commands, settings, views, undo/redo, edits reaching disk, external changes |
| E2E | `npm run test:e2e` | Chromium | The shipped webview bundle + stylesheet: rendering, diagrams, computed colors, layout geometry, what a click does |

The suites are independent; a failure in one says nothing about the others.

## Everyday work — run only what the change touches

**Default to this.** The full run takes minutes and needs a VS Code download;
most edits do not warrant it.

```
npm run test:related -- <changed files>
```

`vitest related` maps each file to the tests that import it, directly or
transitively, so this stays correct as tests are added and removed — it reads
the current import graph rather than any list written down here.

Then judge what else the change reaches:

- **Touched `media/webview-editor-theme.css` or any `*Widget.ts` / DOM code?**
  Run `npm run test:e2e`. Unit tests cannot see CSS or layout at all.
- **Touched `documentSync.ts` or anything about edits, undo, or external
  changes?** Run `npm run test:integration`. That path is a promise chain in
  the host, and getting its order wrong desyncs the file from the view.
- **Touched `package.json` contributions, `package.nls*.json`, `l10n/`, or
  activation?** Run `npm run test:integration`.
- **Touched only `src/shared/` or another pure module?** `test:related` is
  enough.

If you cannot tell what a change reaches, run the full suite rather than
guessing.

## Before a release — run everything

```
npm run test:all
```

Unit (with coverage) → integration → e2e, in that order, stopping at the first
failure. The `release` skill runs this as a gate; do not skip it, and do not
publish over a failure.

## Coverage

```
npm run test:coverage
```

Prints a summary and writes `coverage/` (HTML, git-ignored). The number is a
tool for finding untested logic, **not a target to hit** — do not add tests
whose only purpose is to raise it.

`vitest.config.ts` excludes files that are nothing but wiring to a browser or
to the VS Code host, since the unit suite runs in Node and can never reach
them; the integration and e2e suites cover those instead. Anything with logic
of its own stays counted, tested or not.

## Adding tests

Put a test where the thing it tests can actually be observed:

- **Logic** → `src/**/*.test.ts`, beside the file. Plain Node, no DOM.
- **VS Code behaviour** → `test/integration/*.test.ts`. Mocha TDD (`suite` /
  `test`), real `vscode` API available.
- **Anything visual or interactive** → `test/e2e/*.spec.ts`. `mountEditor` from
  `./harness` mounts the real bundle and stylesheet in a page.

The DOM stub in `src/webview-editor/testDom.ts` is deliberately minimal — it has
no `classList`, `childNodes`, or `insertBefore`. When a unit test would need
those, either extract the decision into a pure function and test that (see
`searchRowFor`), or write the test as e2e instead. Do not grow the stub into a
second DOM implementation.

The README's "Manual verification steps" is the list these suites are working
through. Thirteen of its sixteen steps are automated; when you automate another,
say so there rather than leaving the list claiming work nobody does any more.
What is deliberately left manual: the editor-title toggle icon appearing, and
state persisting across a VS Code restart.

`src/webview-editor/editorWiring.test.ts` guards against features that are
written but never switched on, by asserting on the text of `main.ts` and the
theme. It exists because that failure mode is silent — the code compiles, ships,
and never runs. Add to it when wiring a capability that would fail the same way.

## When a test fails

Read the failure before changing anything. A test that encodes the old
behaviour is a decision to revisit, not an obstacle: if the new behaviour is
right, update the test **and say so** — never delete a test to make a run
green, and never weaken an assertion without explaining why in the diff.

Both `test:integration` and `test:e2e` have caught real bugs in shipped code.
Treat their failures as findings, not as flakiness.

## Troubleshooting

- **`Cannot find dependency '@vitest/coverage-v8'`** — install it pinned to the
  vitest version (`npm i -D @vitest/coverage-v8@<vitest version>`); an
  unpinned install resolves a mismatched major and fails.
- **E2E fails to mount** — `npm run compile` first. The harness loads
  `dist/webview-editor.js`, so it tests whatever was built last, not the source.
- **Integration cannot find a workspace** — it opens `test/fixtures`; that
  folder must exist and stay in git.
- **Playwright browser missing** — `npx playwright install chromium`.
