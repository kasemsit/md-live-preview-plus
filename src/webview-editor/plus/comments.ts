import { Decoration, type DecorationSet, type EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import type { Range } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';

/**
 * HTML comments (`<!-- … -->`) stay as source — they are notes to the writer,
 * not content, and an exported document drops them — but they get a tint of
 * their own so they read as annotations rather than as body text. A comment on
 * its own lines becomes a sticky-note band; one inside a paragraph is tinted in
 * place. The `<!--` / `-->` markers are dimmed.
 */

const OPEN = '<!--';
const CLOSE = '-->';
const markerDeco = Decoration.mark({ class: 'mlp-comment-marker' });
const inlineDeco = Decoration.mark({ class: 'mlp-comment' });

function build(view: EditorView): DecorationSet {
	const { state } = view;
	const { doc } = state;
	const out: Range<Decoration>[] = [];
	const seen = new Set<number>();
	const markers = (from: number, to: number) => {
		if (state.sliceDoc(from, from + OPEN.length) === OPEN) out.push(markerDeco.range(from, from + OPEN.length));
		if (to - from > OPEN.length + CLOSE.length - 1 && state.sliceDoc(to - CLOSE.length, to) === CLOSE) {
			out.push(markerDeco.range(to - CLOSE.length, to));
		}
	};
	for (const { from, to } of view.visibleRanges) {
		syntaxTree(state).iterate({
			from,
			to,
			enter: (node) => {
				if (node.name === 'CommentBlock') {
					if (seen.has(node.from)) return false;
					seen.add(node.from);
					const first = doc.lineAt(node.from).number;
					const last = doc.lineAt(node.to).number;
					for (let n = first; n <= last; n++) {
						let cls = 'mlp-comment-line';
						if (n === first) cls += ' mlp-comment-line-first';
						if (n === last) cls += ' mlp-comment-line-last';
						out.push(Decoration.line({ class: cls }).range(doc.line(n).from));
					}
					markers(node.from, node.to);
					return false;
				}
				if (node.name === 'Comment') {
					out.push(inlineDeco.range(node.from, node.to));
					markers(node.from, node.to);
					return false;
				}
			},
		});
	}
	return Decoration.set(out, true);
}

export const commentPlugin = ViewPlugin.fromClass(
	class {
		decorations: DecorationSet;
		constructor(view: EditorView) {
			this.decorations = build(view);
		}
		update(update: ViewUpdate) {
			if (update.docChanged || update.viewportChanged || syntaxTree(update.startState) !== syntaxTree(update.state)) {
				this.decorations = build(update.view);
			}
		}
	},
	{ decorations: (v) => v.decorations },
);
