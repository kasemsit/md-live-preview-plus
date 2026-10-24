import { Decoration, type DecorationSet, type EditorView, ViewPlugin, type ViewUpdate, keymap, type Command } from '@codemirror/view';
import { EditorSelection, Prec, type Extension, type Range } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import { inlineCursorTouchesRange, blockRevealChanged } from '../cmUtils';
import { inSourceContext } from './wikilinks';
import { registerInlinePass } from './inlineExtras';

/**
 * Underline. Markdown has no syntax for it, so — as in Obsidian — it is the
 * HTML tag pair `<u>…</u>`, which Pandoc and Word exports keep.
 *
 * - Ctrl/Cmd+U wraps the selection in `<u>…</u>`, or unwraps it, the way
 *   Ctrl+B does `**` (see emphasisShortcuts.ts).
 * - In the preview the tags are hidden and the text underlined, until the
 *   caret is inside; in table cells and cards the text is underlined.
 */

const OPEN = '<u>';
const CLOSE = '</u>';

export interface WrapEdit {
	from: number;
	to: number;
	insert: string;
	selFrom: number;
	selTo: number;
}

/** Wrap or unwrap `selected` in `open`/`close`, from the text just around it. Pure, for testing. */
export function computeWrapToggle(selected: string, before: string, after: string, from: number, to: number, open: string, close: string): WrapEdit {
	if (selected.length >= open.length + close.length && selected.toLowerCase().startsWith(open) && selected.toLowerCase().endsWith(close)) {
		const inner = selected.slice(open.length, selected.length - close.length);
		return { from, to, insert: inner, selFrom: from, selTo: from + inner.length };
	}
	if (before.toLowerCase() === open && after.toLowerCase() === close) {
		const start = from - open.length;
		return { from: start, to: to + close.length, insert: selected, selFrom: start, selTo: start + selected.length };
	}
	return { from, to, insert: `${open}${selected}${close}`, selFrom: from + open.length, selTo: from + open.length + selected.length };
}

export const toggleUnderline: Command = (view) => {
	const { state } = view;
	const changes = state.changeByRange((range) => {
		const selected = state.sliceDoc(range.from, range.to);
		const before = state.sliceDoc(Math.max(0, range.from - OPEN.length), range.from);
		const after = state.sliceDoc(range.to, Math.min(state.doc.length, range.to + CLOSE.length));
		const edit = computeWrapToggle(selected, before, after, range.from, range.to, OPEN, CLOSE);
		return {
			changes: { from: edit.from, to: edit.to, insert: edit.insert },
			range: EditorSelection.range(edit.selFrom, edit.selTo),
		};
	});
	view.dispatch(state.update(changes, { scrollIntoView: true, userEvent: 'input' }));
	return true;
};

const hidden = Decoration.replace({});
const underlined = Decoration.mark({ class: 'mlp-underline' });

function build(view: EditorView): DecorationSet {
	const { state } = view;
	const out: Range<Decoration>[] = [];
	for (const { from, to } of view.visibleRanges) {
		// Tags are paired in order within the same block, as a browser would.
		const open: { from: number; to: number; parent: number }[] = [];
		syntaxTree(state).iterate({
			from,
			to,
			enter: (node) => {
				if (node.name !== 'HTMLTag') return;
				const tag = state.sliceDoc(node.from, node.to).toLowerCase();
				const parent = node.node.parent?.from ?? -1;
				if (tag === OPEN) open.push({ from: node.from, to: node.to, parent });
				else if (tag === CLOSE) {
					const start = open.pop();
					if (!start || start.parent !== parent || inSourceContext(state, start.from)) return;
					if (node.from > start.to) out.push(underlined.range(start.to, node.from));
					if (!inlineCursorTouchesRange(state, start.from, node.to)) {
						out.push(hidden.range(start.from, start.to), hidden.range(node.from, node.to));
					}
				}
			},
		});
	}
	return Decoration.set(out, true);
}

const underlinePlugin = ViewPlugin.fromClass(
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
				update.transactions.some((tr) => tr.effects.some((e) => e.is(blockRevealChanged)))
			) {
				this.decorations = build(update.view);
			}
		}
	},
	{ decorations: (v) => v.decorations },
);

export const underlineExtension: Extension = [underlinePlugin, Prec.high(keymap.of([{ key: 'Mod-u', run: toggleUnderline }]))];

// Table cells and cards: the inline renderer shows HTML tags as text, so the
// pair is swapped for private-use markers before parsing and the text between
// them wrapped in <u> afterwards (across bold, links, … if it spans them).
const MARK_OPEN = '';
const MARK_CLOSE = '';

registerInlinePass((text) => {
	if (!/<u>/i.test(text) || !/<\/u>/i.test(text)) return { text };
	return {
		text: text.replace(/<u>/gi, MARK_OPEN).replace(/<\/u>/gi, MARK_CLOSE),
		finish(root) {
			const marks: { node: Text; offset: number; open: boolean }[] = [];
			const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
			for (let n = walker.nextNode(); n; n = walker.nextNode()) {
				const value = n.nodeValue ?? '';
				for (let i = 0; i < value.length; i++) {
					if (value[i] === MARK_OPEN || value[i] === MARK_CLOSE) marks.push({ node: n as Text, offset: i, open: value[i] === MARK_OPEN });
				}
			}
			// Innermost pairs first, so earlier wraps do not move later markers.
			const pairs: [(typeof marks)[number], (typeof marks)[number]][] = [];
			const stack: (typeof marks)[number][] = [];
			for (const m of marks) {
				if (m.open) stack.push(m);
				else if (stack.length) pairs.push([stack.pop()!, m]);
			}
			for (const [a, b] of pairs.reverse()) {
				const range = document.createRange();
				range.setStart(a.node, a.offset + 1);
				range.setEnd(b.node, b.offset);
				const u = document.createElement('u');
				u.appendChild(range.extractContents());
				range.insertNode(u);
			}
			// Drop the markers, and any left unpaired.
			const clean = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
			for (let n = clean.nextNode(); n; n = clean.nextNode()) {
				if (n.nodeValue && /[]/.test(n.nodeValue)) n.nodeValue = n.nodeValue.replace(/[]/g, '');
			}
		},
	};
});
