import type { BlockContext, Line, MarkdownConfig } from '@lezer/markdown';
import type { EditorState } from '@codemirror/state';
import type { SyntaxNode } from '@lezer/common';

/**
 * TeX math in the Markdown parser itself, as Obsidian and Pandoc write it:
 * `$…$` inline, and `$$…$$` as a block (one line, or `$$` lines around it).
 *
 * Making math a syntax node rather than matching it at render time is what
 * keeps the rest of the parser out of it: `$a_i$ and $b_j$` would otherwise
 * read as emphasis from the first `_` to the second, and a `*` or `[` inside a
 * formula would start markup.
 *
 * Inline rules follow Pandoc, which is what keeps money from turning into
 * math: the opening `$` is not followed by a space, the closing one is not
 * preceded by a space and not followed by a digit (`$5 and $10` stays text).
 */

const DOLLAR = 36;
const BACKSLASH = 92;
const isSpace = (ch: number) => ch === 32 || ch === 9 || ch === 10 || ch === 13;
const isDigit = (ch: number) => ch >= 48 && ch <= 57;

/** Does a line's text from `pos` open a `$$` block (and not just hold `$$x$$ text`)? */
function opensBlock(text: string, pos: number): boolean {
	if (text.charCodeAt(pos) !== DOLLAR || text.charCodeAt(pos + 1) !== DOLLAR) return false;
	const rest = text.slice(pos + 2);
	const close = rest.indexOf('$$');
	return close < 0 || !rest.slice(close + 2).trim();
}

const closesBlock = (text: string) => /\$\$\s*$/.test(text);

export const PlusMath: MarkdownConfig = {
	defineNodes: ['InlineMath', 'InlineMathMark', { name: 'BlockMath', block: true }],
	parseInline: [
		{
			name: 'InlineMath',
			parse(cx, next, pos) {
				if (next !== DOLLAR) return -1;
				const first = cx.char(pos + 1);
				if (first === DOLLAR || first < 0 || isSpace(first)) return -1;
				for (let i = pos + 1; i < cx.end; i++) {
					const ch = cx.char(i);
					if (ch === BACKSLASH) {
						i++;
						continue;
					}
					if (ch === 10) return -1; // inline math stays on one line
					if (ch !== DOLLAR) continue;
					if (cx.char(i + 1) === DOLLAR) return -1;
					if (isSpace(cx.char(i - 1)) || isDigit(cx.char(i + 1))) continue;
					return cx.addElement(
						cx.elt('InlineMath', pos, i + 1, [cx.elt('InlineMathMark', pos, pos + 1), cx.elt('InlineMathMark', i, i + 1)]),
					);
				}
				return -1;
			},
		},
	],
	parseBlock: [
		{
			name: 'BlockMath',
			parse(cx: BlockContext, line: Line) {
				if (!opensBlock(line.text, line.pos)) return false;
				const from = cx.lineStart + line.pos;
				const oneLine = line.text.slice(line.pos + 2);
				if (oneLine.includes('$$')) {
					cx.nextLine();
				} else {
					// Same container test @lezer/markdown's FencedCode uses: stop when
					// the line no longer belongs to the enclosing list item or quote.
					// (`Line.depth` is public at runtime but missing from the typings.)
					while (cx.nextLine() && (line as unknown as { depth: number }).depth >= cx.depth) {
						if (closesBlock(line.text.slice(line.pos))) {
							cx.nextLine();
							break;
						}
					}
				}
				cx.addElement(cx.elt('BlockMath', from, cx.prevLineEnd()));
				return true;
			},
			// "where\n$$\n…" — display math may follow a line of text directly.
			endLeaf: (_cx, line) => opensBlock(line.text, line.pos),
			before: 'FencedCode',
		},
	],
};

/** The TeX inside a math node, without its `$` / `$$` delimiters or (for quoted blocks) the `>` markers. */
export function mathTex(state: EditorState, node: SyntaxNode): string {
	const text = state.sliceDoc(node.from, node.to);
	if (node.name === 'InlineMath') return text.slice(1, -1);
	const body = text.replace(/^\$\$/, '').replace(/\$\$\s*$/, '');
	const prefix = state.sliceDoc(state.doc.lineAt(node.from).from, node.from);
	if (!prefix.includes('>')) return body.trim();
	return body
		.split('\n')
		.map((l, i) => (i === 0 ? l : l.replace(/^(?:[ \t]*>[ \t]?)*/, '')))
		.join('\n')
		.trim();
}

/** Whether a math node spans more than one line (and so needs a block widget). */
export function isMultilineMath(state: EditorState, node: { from: number; to: number }): boolean {
	return state.doc.lineAt(node.from).number !== state.doc.lineAt(node.to).number;
}

/**
 * The line-aligned range a multi-line `$$` block is replaced over, or null when
 * the block shares its first line with other content (e.g. `- $$`), in which
 * case it is left as source. Widened over indentation and quote markers, as
 * tables are (see `alignedBlockRange`).
 */
export function mathBlockRange(state: EditorState, node: { from: number; to: number }): { from: number; to: number } | null {
	const first = state.doc.lineAt(node.from);
	if (node.to !== state.doc.lineAt(node.to).to) return null;
	return /^[ \t]*(?:>[ \t]*)*$/.test(state.sliceDoc(first.from, node.from)) ? { from: first.from, to: node.to } : null;
}

/** True while the selection is inside (or touching) the block, which then shows its source. */
export function mathBlockRevealed(state: EditorState, range: { from: number; to: number }): boolean {
	return state.selection.ranges.some((r) => r.from <= range.to && r.to >= range.from);
}

/** The range a multi-line math block widget replaces in this state, or null when it shows as source. */
export function mathBlockReplaced(state: EditorState, node: { from: number; to: number }): { from: number; to: number } | null {
	if (!isMultilineMath(state, node)) return null;
	const range = mathBlockRange(state, node);
	return range && !mathBlockRevealed(state, range) ? range : null;
}
