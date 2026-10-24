import { Decoration, type DecorationSet, type EditorView, ViewPlugin, type ViewUpdate, keymap, type Command } from '@codemirror/view';
import { Prec, type EditorState, type Extension, type Range } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import type { SyntaxNode } from '@lezer/common';
import { blockRevealChanged } from '../cmUtils';

/**
 * Blank lines next to a table, a display formula or a code block collapse in
 * the preview. Those blocks carry their own spacing, so the blank line Markdown
 * needs around them only added a second gap. A blank line between paragraphs
 * is kept: it is the paragraph spacing. The caret's own line always shows at
 * full height, so a collapsed line can still be typed on — and ArrowUp/Down
 * stop on it, since CodeMirror moves by a line's height and would step over a
 * line this short.
 */

const SPACED_BLOCKS = /^(Table|BlockMath|FencedCode|CodeBlock)$/;
const collapse = Decoration.line({ class: 'mlp-blank-collapse' });

function lineIsSpacedBlock(state: EditorState, lineNumber: number): boolean {
	if (lineNumber < 1 || lineNumber > state.doc.lines) return false;
	const line = state.doc.line(lineNumber);
	if (!line.text.trim()) return false;
	const pos = line.from + (line.text.length - line.text.trimStart().length);
	for (let n: SyntaxNode | null = syntaxTree(state).resolveInner(pos, 1); n; n = n.parent) {
		if (SPACED_BLOCKS.test(n.name)) return true;
	}
	return false;
}

function collapses(state: EditorState, lineNumber: number): boolean {
	if (lineNumber < 1 || lineNumber > state.doc.lines || state.doc.line(lineNumber).text.trim()) return false;
	return lineIsSpacedBlock(state, lineNumber - 1) || lineIsSpacedBlock(state, lineNumber + 1);
}

function stepOnto(dir: 1 | -1): Command {
	return (view) => {
		const { state } = view;
		const sel = state.selection.main;
		if (!sel.empty || state.selection.ranges.length > 1) return false;
		const target = state.doc.lineAt(sel.head).number + dir;
		if (!collapses(state, target)) return false;
		view.dispatch({ selection: { anchor: state.doc.line(target).from }, scrollIntoView: true });
		return true;
	};
}

function build(view: EditorView): DecorationSet {
	const { state } = view;
	const caretLine = state.doc.lineAt(state.selection.main.head).number;
	const out: Range<Decoration>[] = [];
	for (const { from, to } of view.visibleRanges) {
		for (let pos = from; pos <= to; ) {
			const line = state.doc.lineAt(pos);
			pos = line.to + 1;
			if (line.number !== caretLine && collapses(state, line.number)) out.push(collapse.range(line.from));
		}
	}
	return Decoration.set(out, true);
}

const spacingDecorations = ViewPlugin.fromClass(
	class {
		decorations: DecorationSet;
		constructor(view: EditorView) {
			this.decorations = build(view);
		}
		update(update: ViewUpdate) {
			if (
				update.docChanged ||
				update.viewportChanged ||
				update.selectionSet ||
				syntaxTree(update.startState) !== syntaxTree(update.state) ||
				update.transactions.some((tr) => tr.effects.some((e) => e.is(blockRevealChanged)))
			) {
				this.decorations = build(update.view);
			}
		}
	},
	{ decorations: (v) => v.decorations },
);

export const spacingPlugin: Extension = [
	spacingDecorations,
	Prec.high(keymap.of([{ key: 'ArrowDown', run: stepOnto(1) }, { key: 'ArrowUp', run: stepOnto(-1) }])),
];
