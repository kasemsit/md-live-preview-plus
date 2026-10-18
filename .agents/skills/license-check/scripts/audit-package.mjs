/**
 * Checks the shipped artifact, not the source tree.
 *
 * The dependency audit answers "what did we depend on"; this answers "what did
 * a user actually receive, and did the notices travel with it". They diverge in
 * ways that matter: build scripts copy third-party data into dist/ without
 * passing through npm at all (dist/langs/*.json, dist/aws4-shapes.json), CSS in
 * media/ can be a port of someone else's stylesheet, and .vscodeignore decides
 * whether the LICENSE files are even present in the shipped package.
 *
 * Usage:  node .agents/skills/license-check/scripts/audit-package.mjs [file.vsix]
 *         With no argument, audits the newest *.vsix in the repo root.
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname, basename, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

/**
 * Newest VSIX belonging to *this* extension. Matching on the package name
 * matters: a stray .vsix downloaded into the repo root for comparison would
 * otherwise be picked up and audited as if it were ours.
 */
function newestVsix() {
	const { name } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
	const v = readdirSync(root).filter((f) => f.endsWith('.vsix') && f.startsWith(`${name}-`));
	if (!v.length) return null;
	return v.map((f) => ({ f, t: statSync(join(root, f)).mtimeMs })).sort((a, b) => b.t - a.t)[0].f;
}

const target = process.argv[2] ?? newestVsix();
const findings = [];
const note = (level, msg) => findings.push({ level, msg });

if (!target) {
	console.log('No .vsix found. Run `npx vsce package` first, then re-run.');
	process.exit(0);
}

const targetPath = isAbsolute(target) ? target : join(root, target);
if (!existsSync(targetPath)) {
	console.log(`No such file: ${targetPath}`);
	process.exit(1);
}

/** `unzip -Z1` lists entries without extracting. */
let entries;
try {
	entries = execFileSync('unzip', ['-Z1', targetPath], { encoding: 'utf8' })
		.split('\n').map((s) => s.trim()).filter(Boolean);
} catch {
	console.log(`Could not read ${basename(targetPath)} (needs \`unzip\` on PATH). Skipping package audit.`);
	process.exit(0);
}

const inPkg = (re) => entries.filter((e) => re.test(e));

// 1. The license text itself must ship. Marketplace shows it on the listing page.
if (!inPkg(/^extension\/LICENSE(\.txt|\.md)?$/i).length) {
	note('BLOCK', 'No LICENSE file in the package. Add it, and keep it out of .vscodeignore.');
}

// 2. If a notices file exists in the repo, it has to be inside the package too —
//    a notices file that stays home satisfies nothing.
for (const f of ['THIRD-PARTY-NOTICES.md', 'LICENSE-SHAPES']) {
	if (existsSync(join(root, f)) && !inPkg(new RegExp(`^extension/${f}$`, 'i')).length) {
		note('BLOCK', `${f} exists in the repo but is not in the package — .vscodeignore is excluding it.`);
	}
}

// 3. Data files copied into dist/ by a build script never carry an npm license
//    field, so they are invisible to the dependency audit. Each needs a line in
//    the notices file naming its upstream and license.
const notices = existsSync(join(root, 'THIRD-PARTY-NOTICES.md'))
	? readFileSync(join(root, 'THIRD-PARTY-NOTICES.md'), 'utf8')
	: '';

const dataFiles = inPkg(/^extension\/dist\/.*\.json$/);
if (dataFiles.length) {
	const langs = dataFiles.filter((e) => /\/dist\/langs\//.test(e));
	if (langs.length && !/grammar|textmate|tm-grammars/i.test(notices)) {
		note('BLOCK', `${langs.length} syntax grammar file(s) ship in dist/langs/ but no grammar attribution appears in THIRD-PARTY-NOTICES.md. These are third-party TextMate grammars copied verbatim by a build script; most are MIT (c) Microsoft, from the vscode repo.`);
	}
	for (const f of dataFiles.filter((e) => !/\/dist\/langs\//.test(e))) {
		const stem = basename(f, '.json');
		if (!notices.includes(stem)) {
			note('REVIEW', `dist/${basename(f)} ships but is not named in THIRD-PARTY-NOTICES.md. If a build script generated it from vendored third-party data, attribute it there.`);
		}
	}
}

// 4. Bundles: esbuild's `legalComments` defaults to 'eof' when bundling, and
//    minify does NOT strip them — so banners do survive. The catch is that only
//    packages which put a /*! or @license banner in their *published* code have
//    anything to preserve; the great majority ship a separate LICENSE file that
//    no bundler ever reads. So a surviving banner block is not evidence of
//    compliance, it is evidence of a handful of well-behaved packages.
const esb = existsSync(join(root, 'esbuild.js')) ? readFileSync(join(root, 'esbuild.js'), 'utf8') : '';
if (!/legalComments/.test(esb) && esb) {
	note('INFO', "esbuild.js does not set `legalComments`. The default when bundling is 'eof', which preserves banners — so this is currently safe, but it is implicit. Setting legalComments:'eof' explicitly stops a future refactor from silently regressing it.");
}
for (const b of inPkg(/^extension\/dist\/[^/]+\.js$/)) {
	const local = join(root, b.replace(/^extension\//, ''));
	if (!existsSync(local)) continue;
	const src = readFileSync(local, 'utf8');
	const banners = (src.match(/@license|\/\*!/g) ?? []).length;
	if (banners === 0 && statSync(local).size > 50_000) {
		note('INFO', `dist/${basename(b)} carries no license banner. Expected — most packages ship no banner to preserve — but it means THIRD-PARTY-NOTICES.md is the only thing attributing what is inside this bundle.`);
	}
}

// 5. Themes shipped as source (CSS) that were ported from someone else's work.
for (const css of inPkg(/^extension\/media\/.*\.css$/)) {
	const local = join(root, css.replace(/^extension\//, ''));
	if (!existsSync(local)) continue;
	const head = readFileSync(local, 'utf8').slice(0, 800);
	const m = head.match(/github-markdown-css|markdown-language-features|Microsoft Corporation|derived from|移植|変換した|を元に/i);
	if (m && !notices.includes(basename(css))) {
		note('REVIEW', `media/${basename(css)} says in its own header that it is derived from third-party CSS ("${m[0]}"), but ${basename(css)} is not named in THIRD-PARTY-NOTICES.md. A port of someone else's stylesheet is a derivative work and needs their copyright line.`);
	}
}

// 6. Branding. Both AWS and Microsoft require [Your Brand] [phrase] [Their Mark];
//    a third-party mark in the leading position reads as a first-party product.
const pkgJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const MARKS = [
	['AWS', /\bAWS\b/], ['Amazon', /\bAmazon\b/],
	['Visual Studio Code', /Visual Studio Code|\bVS ?Code\b/i],
	['Obsidian', /\bObsidian\b/], ['GitHub', /\bGitHub\b/],
	['draw.io', /\bdraw\.io\b|\bdrawio\b/i], ['Markdown', /^Markdown\b/],
];
for (const [mark, re] of MARKS) {
	if (mark === 'Markdown') continue; // generic format name, not a mark
	for (const field of ['displayName', 'name']) {
		const v = pkgJson[field] ?? '';
		if (re.test(v) && re.test(v.split(/\s+/).slice(0, 1).join(' '))) {
			note('BLOCK', `package.json "${field}" leads with the third-party mark "${mark}": ${JSON.stringify(v)}. Both AWS (§7) and Microsoft require the form [Your Brand] for [Their Mark].`);
		}
	}
}
if (!pkgJson.license) {
	note('BLOCK', 'package.json has no "license" field. Open VSX rejects this outright, and under CI it fails with no prompt.');
}

// 7. The disclaimer. Not a safe harbour, but it is factor-3 evidence and costs
//    nothing. Only worth asking for once a mark is actually being used.
const readme = existsSync(join(root, 'README.md')) ? readFileSync(join(root, 'README.md'), 'utf8') : '';
const usesMarks = MARKS.filter(([m, re]) => m !== 'Markdown' && re.test(readme)).map(([m]) => m);
if (usesMarks.length && !/not affiliated|independent project|関連会社|独立したプロジェクト/i.test(readme)) {
	note('REVIEW', `README references third-party marks (${usesMarks.join(', ')}) but carries no "not affiliated with" disclaimer.`);
}

console.log(`Package audit: ${target}  (${entries.length} entries)\n`);
if (!findings.length) {
	console.log('  No findings.');
} else {
	for (const f of findings) console.log(`  [${f.level}] ${f.msg}\n`);
}
process.exit(findings.some((f) => f.level === 'BLOCK') ? 1 : 0);
