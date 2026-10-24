import type { PlusAnchor } from './messages';

/**
 * Wikilink anchors in Markdown text — `#Heading` and `#^block-id` targets —
 * shared by completion (webview) and link opening (host).
 */

const FENCE = /^\s*(```|~~~)/;
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const BLOCK_ID = /(?:^|\s)\^([A-Za-z0-9][A-Za-z0-9-]*)\s*$/;

export function anchorsInText(text: string): PlusAnchor[] {
	const out: PlusAnchor[] = [];
	let inFence = false;
	for (const line of text.split(/\r?\n/)) {
		if (FENCE.test(line)) {
			inFence = !inFence;
			continue;
		}
		if (inFence) continue;
		const h = HEADING.exec(line);
		if (h) out.push({ kind: 'heading', text: h[2], level: h[1].length });
		const b = BLOCK_ID.exec(line);
		if (b) out.push({ kind: 'block', text: b[1] });
	}
	return out;
}

const normalize = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * 1-based line of `anchor` in `lines`, or 0 when absent. `^id` matches a block
 * id at a line's end; anything else matches a heading's text, ignoring case and
 * runs of whitespace, as Obsidian does.
 */
export function findAnchorLine(lines: string[], anchor: string): number {
	if (!anchor) return 0;
	if (anchor.startsWith('^')) {
		const id = anchor.slice(1);
		return lines.findIndex((l) => BLOCK_ID.exec(l)?.[1] === id) + 1;
	}
	const want = normalize(anchor);
	let inFence = false;
	for (let i = 0; i < lines.length; i++) {
		if (FENCE.test(lines[i])) inFence = !inFence;
		if (inFence) continue;
		const h = HEADING.exec(lines[i]);
		if (h && normalize(h[2]) === want) return i + 1;
	}
	return 0;
}
