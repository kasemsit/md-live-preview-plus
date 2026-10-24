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

const BLOCK_ID_ONLY = /^\s*\^[A-Za-z0-9][A-Za-z0-9-]*\s*$/;
const LIST_ITEM = /^\s*([-*+]|\d+[.)])\s/;
const MAX_PREVIEW_LINES = 40;
const MAX_PREVIEW_CHARS = 4000;

/** 0-based [from, to) of the lines a link to `line` (0-based) previews. */
function blockAround(lines: string[], line: number): [number, number] {
	const text = lines[line];
	const h = HEADING.exec(text);
	if (h) {
		// A heading (or a block id on one, as in Laws/): its whole section.
		const level = h[1].length;
		let end = line + 1;
		let inFence = false;
		for (; end < lines.length; end++) {
			if (FENCE.test(lines[end])) inFence = !inFence;
			const next = !inFence && HEADING.exec(lines[end]);
			if (next && next[1].length <= level) break;
		}
		return [line, end];
	}
	if (BLOCK_ID_ONLY.test(text)) {
		// An id on its own line names the block just above it.
		let from = line;
		while (from > 0 && lines[from - 1].trim()) from--;
		return [from, line];
	}
	if (LIST_ITEM.test(text)) return [line, line + 1];
	// A paragraph: the id sits on its last line.
	let from = line;
	while (from > 0 && lines[from - 1].trim() && !HEADING.test(lines[from - 1]) && !LIST_ITEM.test(lines[from - 1])) from--;
	return [from, line + 1];
}

/**
 * The Markdown a hover preview of `[[note#anchor]]` shows, cut from the note's
 * lines: a heading's section, a block id's block, or the note's opening when
 * there is no anchor (or it is not found). Block ids are dropped from the text,
 * and long sections are cut at a line limit.
 */
export function extractPreview(lines: string[], anchor: string): { text: string; anchorFound: boolean; truncated: boolean } {
	let range: [number, number] | null = null;
	const found = findAnchorLine(lines, anchor);
	if (found) range = blockAround(lines, found - 1);
	if (!range) {
		let from = 0;
		if (lines[0]?.trim() === '---') {
			const close = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
			if (close > 0) from = close + 1;
		}
		while (from < lines.length && !lines[from].trim()) from++;
		range = [from, lines.length];
	}
	let out = lines.slice(range[0], range[1]).map((l) => l.replace(/\s+\^[A-Za-z0-9][A-Za-z0-9-]*\s*$/, ''));
	while (out.length && !out[out.length - 1].trim()) out.pop();
	let truncated = false;
	if (out.length > MAX_PREVIEW_LINES) {
		out = out.slice(0, MAX_PREVIEW_LINES);
		truncated = true;
	}
	let text = out.join('\n');
	if (text.length > MAX_PREVIEW_CHARS) {
		text = text.slice(0, text.lastIndexOf('\n', MAX_PREVIEW_CHARS) > 0 ? text.lastIndexOf('\n', MAX_PREVIEW_CHARS) : MAX_PREVIEW_CHARS);
		truncated = true;
	}
	return { text, anchorFound: !anchor || found > 0, truncated };
}
