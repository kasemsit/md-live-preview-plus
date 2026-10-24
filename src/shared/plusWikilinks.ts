/**
 * Obsidian-style wikilinks: `[[target]]`, `[[target|label]]`, `[[target#Heading]]`,
 * `[[target#^block-id|label]]`.
 *
 * Kept free of DOM and CodeMirror imports so the table parser (which runs inside
 * the Markdown parser) and the unit tests can use it.
 *
 * Inside a table cell Obsidian accepts the label separator both escaped
 * (`[[a\|b]]`, the GFM-safe form) and bare (`[[a|b]]`), so both are matched.
 */
export const WIKILINK_SOURCE = String.raw`\[\[([^\[\]|\n\\]+?)(?:\\?\|([^\[\]\n]+?))?\]\]`;

/** A fresh global regex — `g` regexes carry `lastIndex`, so never share one. */
export function wikilinkRegex(): RegExp {
	return new RegExp(WIKILINK_SOURCE, 'g');
}

export interface WikilinkMatch {
	/** Offset of `[[` in the scanned text. */
	from: number;
	/** Offset just past `]]`. */
	to: number;
	/** `target#anchor`, trimmed. */
	target: string;
	/** What is displayed: the alias when given, else the target. */
	label: string;
	/** Offsets of the displayed text inside the source (alias, or the target itself). */
	labelFrom: number;
	labelTo: number;
}

export function findWikilinks(text: string): WikilinkMatch[] {
	const out: WikilinkMatch[] = [];
	const re = wikilinkRegex();
	let m: RegExpExecArray | null;
	while ((m = re.exec(text))) {
		const from = m.index;
		const to = from + m[0].length;
		const target = m[1].trim();
		let labelFrom: number;
		if (m[2] !== undefined) {
			labelFrom = from + m[0].indexOf('|', m[1].length + 2) + 1;
		} else {
			labelFrom = from + 2;
		}
		out.push({ from, to, target, label: (m[2] ?? m[1]).trim(), labelFrom, labelTo: to - 2 });
	}
	return out;
}

/**
 * A predicate saying whether offset `i` of `text` lies inside a wikilink.
 *
 * Table splitters call this for every `|` they meet: a pipe inside `[[...]]`
 * belongs to the link, not to the row. Matching whole links (rather than
 * toggling on `[[` / `]]`) means an unclosed `[[` cannot swallow the rest of
 * the row.
 */
export function insideWikilink(text: string): (i: number) => boolean {
	if (!text.includes('[[')) return () => false;
	const spans = findWikilinks(text);
	if (!spans.length) return () => false;
	return (i) => spans.some((s) => i > s.from && i < s.to - 1);
}

/** Splits `target#anchor` into the note name and the last anchor segment. */
export function splitTarget(target: string): { name: string; anchor: string } {
	const parts = target.split('#');
	return { name: parts[0].trim(), anchor: parts.length > 1 ? parts[parts.length - 1].trim() : '' };
}

/**
 * A Pandoc citation key inside a bracketed group — `[@key]`, `[@a; @b]`,
 * `[see @key, p. 33]`, `[-@key]`. Only bracketed citations are matched: a bare
 * `@word` in prose is far more often an e-mail address or a handle.
 */
export interface CitationMatch {
	/** Offset of `@`. */
	from: number;
	/** Offset just past the key. */
	to: number;
	key: string;
	/** The enclosing `[...]`. */
	groupFrom: number;
	groupTo: number;
}

// Not the inside of `[[...]]`, and not a `[text](url)` or `[text][ref]` link.
const CITE_GROUP = /(?<!\[)\[([^[\]\n]*@[^[\]\n]*)\](?![\](])/g;
const CITE_KEY = /(^|[\s;])(-?)@([A-Za-z0-9_](?:[\w:.#$%&+?<>~/-]*[A-Za-z0-9_])?)/g;

export function findCitations(text: string): CitationMatch[] {
	if (!text.includes('@')) return [];
	const out: CitationMatch[] = [];
	for (const group of text.matchAll(CITE_GROUP)) {
		const groupFrom = group.index!;
		const groupTo = groupFrom + group[0].length;
		for (const k of group[1].matchAll(CITE_KEY)) {
			const at = groupFrom + 1 + k.index! + k[1].length + k[2].length;
			out.push({ from: at, to: at + 1 + k[3].length, key: k[3], groupFrom, groupTo });
		}
	}
	return out;
}

/** True when a citation group starts at `offset` of `text` (the `[` of `[@key]`). */
export function isCitationAt(text: string, offset: number): boolean {
	return findCitations(text).some((c) => c.groupFrom === offset);
}

/**
 * `[from, to]` (the two `$`) of each inline formula in `text`, by the same
 * Pandoc rules the parser uses (webview-editor/plus/mathSyntax.ts): the
 * opening `$` not followed by a space, the closing one not preceded by a space
 * nor followed by a digit, and never `$$`.
 */
export function findInlineMath(text: string): [number, number][] {
	const out: [number, number][] = [];
	for (let i = 0; i < text.length; i++) {
		const ch = text[i];
		if (ch === '\\') {
			i++;
			continue;
		}
		if (ch !== '$') continue;
		if (text[i + 1] === '$') {
			i++;
			continue;
		}
		if (i + 1 >= text.length || /\s/.test(text[i + 1])) continue;
		for (let j = i + 1; j < text.length; j++) {
			const c = text[j];
			if (c === '\\') {
				j++;
				continue;
			}
			if (c === '\n' || (c === '$' && text[j + 1] === '$')) break;
			if (c !== '$' || /\s/.test(text[j - 1]) || /\d/.test(text[j + 1] ?? '')) continue;
			out.push([i, j]);
			i = j;
			break;
		}
	}
	return out;
}

/**
 * A predicate saying whether a `|` at offset `i` is part of a wikilink or a
 * formula rather than a table-cell boundary — `[[note|label]]` and `$|x|$`
 * read as one cell each, as Obsidian shows them.
 */
export function insideTableAtom(text: string): (i: number) => boolean {
	const inLink = insideWikilink(text);
	const math = text.includes('$') ? findInlineMath(text) : [];
	if (!math.length) return inLink;
	return (i) => inLink(i) || math.some(([a, b]) => i > a && i < b);
}
