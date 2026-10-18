/**
 * Walks the *production* dependency tree and reports every license that ships.
 *
 * Why not `license-checker`: that tool reports everything in node_modules,
 * devDependencies included, which for this repo is ~600 packages of noise
 * around the ~12 that actually reach a user. What matters legally is only what
 * lands inside the VSIX, so this resolves the prod tree transitively from
 * package.json and stops there.
 *
 * Usage:  node .agents/skills/license-check/scripts/audit-deps.mjs [--json]
 * Exit:   1 if anything is DENY or UNKNOWN, else 0.
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const asJson = process.argv.includes('--json');

/**
 * Copyleft licenses whose reach extends over a combined work. Bundling one of
 * these into dist/*.js would place the whole bundle under its terms, which is
 * incompatible with shipping this extension under MIT.
 */
const DENY = [
	/^AGPL/i, /^GPL-/i, /^GPL$/i, /GNU General Public/i,
	/^SSPL/i, /^BUSL/i, /^Commons Clause/i, /^Elastic-2/i,
];

/**
 * Not fatal, but each carries an obligation beyond "keep the copyright line":
 * a NOTICE file to reproduce, per-file source disclosure, share-alike terms,
 * or a reserved font name. Flagged so a human decides.
 */
const REVIEW = [
	/^Apache-2/i,     // NOTICE file must be reproduced if upstream ships one
	/^MPL-/i,         // file-level copyleft: modified files stay MPL
	/^LGPL/i,         // dynamic-linking relief is meaningless in a bundle
	/^EPL-/i, /^CDDL/i, /^CPL-/i,
	/^CC-BY-SA/i,     // share-alike; a real problem inside an MIT product
	/^CC-BY(?!-SA)/i, // attribution required in the shipped artifact
	/^OFL/i, /Open Font/i, // reserved font name
	/^Artistic/i, /^Zlib/i, /^BSD-4/i, // BSD-4 has the advertising clause
	/NOASSERTION/i, /^SEE LICEN[SC]E/i, /^UNLICENSED$/i,
];

/** Permissive and satisfied by reproducing the notice. */
const ALLOW = [/^MIT/i, /^ISC/i, /^BSD-2/i, /^BSD-3/i, /^0BSD/i, /^CC0/i, /^Unlicense/i, /^Python-2/i, /^BlueOak/i];

function classify(id) {
	if (!id) return 'UNKNOWN';
	// An SPDX expression is only as safe as its riskiest branch.
	const parts = String(id).split(/\s+(?:OR|AND)\s+|[()]/).map((s) => s.trim()).filter(Boolean);
	const hit = (list) => parts.some((p) => list.some((re) => re.test(p)));
	if (hit(DENY)) return 'DENY';
	if (hit(REVIEW)) return 'REVIEW';
	if (parts.every((p) => ALLOW.some((re) => re.test(p)))) return 'ALLOW';
	return 'UNKNOWN';
}

/** package.json's `license` field, or the older `licenses` array. */
function licenseOf(pkg) {
	if (typeof pkg.license === 'string') return pkg.license;
	if (pkg.license?.type) return pkg.license.type;
	if (Array.isArray(pkg.licenses)) return pkg.licenses.map((l) => l.type || l).join(' OR ');
	return null;
}

/**
 * Some packages ship a LICENSE file but forget the package.json field (khroma
 * is one). Reading the file's first lines recovers the id rather than reporting
 * a false unknown — but the result is marked `fromFile` so it is still shown as
 * something a human confirmed rather than something the manifest declared.
 */
function licenseFromFile(dir) {
	let names;
	try { names = readdirSync(dir); } catch { return null; }
	const f = names.find((n) => /^(LICEN[SC]E|COPYING)/i.test(n));
	if (!f) return null;
	let head;
	try { head = readFileSync(join(dir, f), 'utf8').slice(0, 400); } catch { return null; }
	for (const [re, id] of [
		[/\bMIT License\b|\bThe MIT License\b/i, 'MIT'],
		[/\bISC License\b/i, 'ISC'],
		[/\bApache License\b/i, 'Apache-2.0'],
		[/\bMozilla Public License\b/i, 'MPL-2.0'],
		[/\bGNU AFFERO\b/i, 'AGPL-3.0'],
		[/\bGNU LESSER\b/i, 'LGPL'],
		[/\bGNU GENERAL PUBLIC\b/i, 'GPL'],
		[/Permission is hereby granted, free of charge/i, 'MIT'],
		[/Permission to use, copy, modify, and(?:\/or)? distribute/i, 'ISC'],
	]) if (re.test(head)) return id;
	return null;
}

/** node_modules resolution: walk up from `from` looking for the package. */
function resolvePkg(name, from) {
	let dir = from;
	for (;;) {
		const p = join(dir, 'node_modules', name, 'package.json');
		if (existsSync(p)) return { dir: join(dir, 'node_modules', name), json: JSON.parse(readFileSync(p, 'utf8')) };
		const up = dirname(dir);
		if (up === dir) return null;
		dir = up;
	}
}

/** True if the package ships its own license text, not just an SPDX id. */
function hasLicenseFile(dir) {
	try {
		return readdirSync(dir).some((f) => /^(LICEN[SC]E|COPYING|NOTICE)/i.test(f));
	} catch {
		return false;
	}
}

const rootPkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const found = new Map();
const missing = new Set();

/** Transitive walk over dependencies only — devDependencies never ship. */
function walk(names, from) {
	for (const name of names) {
		if (found.has(name)) continue;
		const r = resolvePkg(name, from);
		if (!r) { missing.add(name); continue; }
		const declared = licenseOf(r.json);
		const fromFile = declared ? null : licenseFromFile(r.dir);
		const id = declared ?? fromFile;
		found.set(name, {
			name,
			version: r.json.version,
			license: id ?? '(none declared)',
			status: classify(id),
			fromFile: Boolean(fromFile),
			licenseFile: hasLicenseFile(r.dir),
		});
		walk(Object.keys(r.json.dependencies ?? {}), r.dir);
	}
}

walk(Object.keys(rootPkg.dependencies ?? {}), root);

/**
 * Apache-2.0 §4(d): if the upstream package ships a NOTICE file, its attribution
 * text must be reproduced in anything derived from it. No license scanner does
 * this — they read the SPDX id and stop — so it is checked here explicitly.
 */
const apacheNotices = [];
for (const r of found.values()) {
	if (!/Apache-2/i.test(r.license)) continue;
	const p = resolvePkg(r.name, root);
	if (!p) continue;
	const f = (() => { try { return readdirSync(p.dir).find((n) => /^NOTICE/i.test(n)); } catch { return null; } })();
	if (f) apacheNotices.push({ name: r.name, file: join(p.dir, f) });
}

const rows = [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
const bad = rows.filter((r) => r.status === 'DENY' || r.status === 'UNKNOWN');
const review = rows.filter((r) => r.status === 'REVIEW');

if (asJson) {
	console.log(JSON.stringify({ rows, missing: [...missing] }, null, 2));
} else {
	const w = Math.max(...rows.map((r) => r.name.length), 4);
	console.log(`Production dependency licenses (${rows.length} packages, transitive)\n`);
	for (const r of rows) {
		const mark = { DENY: 'x', UNKNOWN: '?', REVIEW: '!', ALLOW: ' ' }[r.status];
		const note = r.fromFile
			? '   (read from LICENSE file; package.json declares none)'
			: r.licenseFile ? '' : '   (no license file in package)';
		console.log(`  ${mark} ${r.name.padEnd(w)}  ${r.version.padEnd(10)}  ${r.license}${note}`);
	}
	console.log('\n  x = incompatible   ? = undetermined   ! = extra obligation\n');
	if (missing.size) console.log(`Not installed, so not checked: ${[...missing].join(', ')}\nRun npm install and re-run.\n`);
	if (apacheNotices.length) {
		console.log('Apache-2.0 packages shipping a NOTICE file — §4(d) requires reproducing its text:');
		for (const a of apacheNotices) console.log(`    ${a.name}  ->  ${a.file}`);
		console.log('');
	}
	if (review.length) console.log(`${review.length} package(s) carry an obligation beyond keeping the notice — see SKILL.md step 2.`);
	if (bad.length) console.log(`BLOCKING: ${bad.map((r) => `${r.name} (${r.license})`).join(', ')}`);
	else if (!review.length) console.log('No blocking findings.');
}

process.exit(bad.length ? 1 : 0);
