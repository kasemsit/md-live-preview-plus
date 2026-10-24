import { findCitations, findWikilinks, splitTarget } from './plusWikilinks';

/**
 * The text side of the Backlinks view: which notes a file links to, and how a
 * link's target matches a note. Kept free of VS Code so it can be unit-tested;
 * src/editor/plus/backlinks.ts does the file reading and the tree.
 */

export interface OutgoingLink {
	/** Normalised target: lower case, `/` separators, no `.md`. `@key` for a citation. */
	key: string;
	/** 1-based line of the link. */
	line: number;
	/** The line, cleaned for display (see `cleanLine`). */
	text: string;
	/** What the link shows: the wikilink's label, or `@key`. */
	label: string;
}

export function linkKey(name: string): string {
	return name
		.trim()
		.replace(/\\/g, '/')
		.replace(/\.(md|markdown)$/i, '')
		.toLowerCase();
}

/** A source line as a reader would see it: links by their labels, block markers and ids dropped. */
export function cleanLine(line: string): string {
	let text = line;
	for (const link of findWikilinks(text).reverse()) text = text.slice(0, link.from) + link.label + text.slice(link.to);
	return text
		.replace(/^\s*(?:>\s?)+/, '')
		.replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, '')
		.replace(/^#{1,6}\s+/, '')
		.replace(/\s+\^[A-Za-z0-9][A-Za-z0-9-]*\s*$/, '')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, 240);
}

const FENCE = /^\s*(```|~~~)/;

/** Every wikilink and citation in a note, outside code fences and frontmatter. */
export function extractLinks(text: string): OutgoingLink[] {
	const out: OutgoingLink[] = [];
	const lines = text.split(/\r?\n/);
	let inFence = false;
	let start = 0;
	if (lines[0]?.trim() === '---') {
		const close = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
		if (close > 0) start = close + 1;
	}
	for (let i = start; i < lines.length; i++) {
		const line = lines[i];
		if (FENCE.test(line)) {
			inFence = !inFence;
			continue;
		}
		if (inFence || (!line.includes('[[') && !line.includes('@'))) continue;
		let cleaned: string | null = null;
		const clean = () => (cleaned ??= cleanLine(line));
		for (const link of findWikilinks(line)) {
			const { name } = splitTarget(link.target);
			if (!name) continue; // [[#heading]] points into the same note
			out.push({ key: linkKey(name), line: i + 1, text: clean(), label: link.label });
		}
		for (const cite of findCitations(line)) {
			out.push({ key: `@${cite.key.toLowerCase()}`, line: i + 1, text: clean(), label: `@${cite.key}` });
		}
	}
	return out;
}

/**
 * The keys under which links to a note are indexed: its name, and each
 * trailing part of its workspace path — `[[Note]]`, `[[Folder/Note]]` and
 * `[[Vault/Folder/Note]]` all reach `Vault/Folder/Note.md`.
 */
export function keysForNote(relativePath: string): string[] {
	const parts = linkKey(relativePath).split('/');
	return parts.map((_, i) => parts.slice(i).join('/'));
}
