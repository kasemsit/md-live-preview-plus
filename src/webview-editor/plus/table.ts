import { tags } from '@lezer/highlight';
import type { BlockContext, Element, LeafBlock, Line, MarkdownConfig } from '@lezer/markdown';
import { insideTableAtom } from '../../shared/plusWikilinks';

/*
 * GFM tables — a copy of @lezer/markdown's `Table` extension (MIT, Marijn
 * Haverbeke and others; 1.6.4), changed in two places:
 *
 * 1. A `|` inside `[[...]]` or inside inline math `$...$` is not a cell
 *    boundary. Obsidian reads `| [[note|label]] |` and `| $|x|$ |` as one cell
 *    each; stock GFM reads several, so a header row holding either no longer
 *    matched its delimiter row and the whole table stayed plain text.
 * 2. A table may interrupt a paragraph inside a blockquote. The stock hook
 *    tests the *next* line against the delimiter regex as raw text, `>` markers
 *    included, so `> text\n> | a |\n> |---|` never became a table.
 *
 * `parseRow` is not exported by the library, which is why the extension is
 * copied rather than wrapped. Node names are unchanged, so everything that
 * reads the tree is unaffected.
 */

function parseRow(cx: BlockContext, line: string, startI = 0, elts?: Element[], offset = 0): number {
	let count = 0;
	let first = true;
	let cellStart = -1;
	let cellEnd = -1;
	let esc = false;
	const inLink = insideTableAtom(line);
	const parseCell = () => {
		elts!.push(
			cx.elt(
				'TableCell',
				offset + cellStart,
				offset + cellEnd,
				cx.parser.parseInline(line.slice(cellStart, cellEnd), offset + cellStart),
			),
		);
	};
	for (let i = startI; i < line.length; i++) {
		const next = line.charCodeAt(i);
		if (next === 124 /* '|' */ && !esc && !inLink(i)) {
			if (!first || cellStart > -1) count++;
			first = false;
			if (elts) {
				if (cellStart > -1) parseCell();
				elts.push(cx.elt('TableDelimiter', i + offset, i + offset + 1));
			}
			cellStart = cellEnd = -1;
		} else if (esc || (next !== 32 && next !== 9)) {
			if (cellStart < 0) cellStart = i;
			cellEnd = i + 1;
		}
		esc = !esc && next === 92;
	}
	if (cellStart > -1) {
		count++;
		if (elts) parseCell();
	}
	return count;
}

function hasPipe(str: string, start: number): boolean {
	for (let i = start; i < str.length; i++) {
		const next = str.charCodeAt(i);
		if (next === 124 /* '|' */) return true;
		if (next === 92 /* '\' */) i++;
	}
	return false;
}

const delimiterLine = /^\|?(\s*:?-+:?\s*\|)+(\s*:?-+:?\s*)?$/;

/** Length of a line's leading blockquote markers (`> `, `>> `, ` > > `). */
export function quotePrefixLength(text: string): number {
	return /^(?:[ \t]*>[ \t]?)*/.exec(text)![0].length;
}

class PlusTableParser {
	// null: second line not seen yet; false: not a table; array: the rows so far.
	rows: Element[] | null | false = null;

	nextLine(cx: BlockContext, line: Line, leaf: LeafBlock): boolean {
		if (this.rows == null) {
			this.rows = false;
			let lineText: string;
			if (
				(line.next === 45 || line.next === 58 || line.next === 124) /* '-:|' */ &&
				delimiterLine.test((lineText = line.text.slice(line.pos)))
			) {
				const firstRow: Element[] = [];
				const firstCount = parseRow(cx, leaf.content, 0, firstRow, leaf.start);
				if (firstCount === parseRow(cx, lineText, 0)) {
					this.rows = [
						cx.elt('TableHeader', leaf.start, leaf.start + leaf.content.length, firstRow),
						cx.elt('TableDelimiter', cx.lineStart + line.pos, cx.lineStart + line.text.length),
					];
				}
			}
		} else if (this.rows) {
			const content: Element[] = [];
			parseRow(cx, line.text, line.pos, content, cx.lineStart);
			this.rows.push(cx.elt('TableRow', cx.lineStart + line.pos, cx.lineStart + line.text.length, content));
		}
		return false;
	}

	finish(cx: BlockContext, leaf: LeafBlock): boolean {
		if (!this.rows) return false;
		cx.addLeafElement(leaf, cx.elt('Table', leaf.start, leaf.start + leaf.content.length, this.rows));
		return true;
	}
}

export const PlusTable: MarkdownConfig = {
	defineNodes: [
		{ name: 'Table', block: true },
		{ name: 'TableHeader', style: { 'TableHeader/...': tags.heading } },
		'TableRow',
		{ name: 'TableCell', style: tags.content },
		{ name: 'TableDelimiter', style: tags.processingInstruction },
	],
	parseBlock: [
		{
			name: 'Table',
			leaf(_cx, leaf) {
				return hasPipe(leaf.content, 0) ? new PlusTableParser() : null;
			},
			endLeaf(cx, line, leaf) {
				if (leaf.parsers.some((p) => p instanceof PlusTableParser) || !hasPipe(line.text, line.basePos)) return false;
				const next = cx.peekLine();
				// Inside a blockquote the peeked line still carries its markers.
				if (line.basePos > 0 && /^[ \t]*>/.test(line.text)) {
					const body = next.slice(quotePrefixLength(next));
					return delimiterLine.test(body) && parseRow(cx, line.text, line.basePos) === parseRow(cx, body, 0);
				}
				return delimiterLine.test(next) && parseRow(cx, line.text, line.basePos) === parseRow(cx, next, line.basePos);
			},
			before: 'SetextHeading',
		},
	],
};
