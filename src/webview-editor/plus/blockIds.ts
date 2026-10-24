import { Decoration, type DecorationSet, type EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import type { Range } from '@codemirror/state';
import { inSourceContext } from './wikilinks';

/**
 * Dims a trailing Obsidian block id (`... text ^ma-32`): it is a link target,
 * not prose, and at full strength it reads as part of the sentence. Kept
 * visible rather than hidden so it can still be seen, copied and edited.
 */
const BLOCK_ID = /(?:^|\s)(\^[A-Za-z0-9][A-Za-z0-9-]*)\s*$/;
const dim = Decoration.mark({ class: 'mlp-block-id' });

function build(view: EditorView): DecorationSet {
	const { state } = view;
	const out: Range<Decoration>[] = [];
	for (const { from, to } of view.visibleRanges) {
		for (let pos = from; pos <= to; ) {
			const line = state.doc.lineAt(pos);
			pos = line.to + 1;
			const m = BLOCK_ID.exec(line.text);
			if (!m) continue;
			const s = line.from + m.index + m[0].indexOf('^');
			if (inSourceContext(state, s)) continue;
			out.push(dim.range(s, s + m[1].length));
		}
	}
	return Decoration.set(out, true);
}

export const blockIdPlugin = ViewPlugin.fromClass(
	class {
		decorations: DecorationSet;
		constructor(view: EditorView) {
			this.decorations = build(view);
		}
		update(update: ViewUpdate) {
			if (update.docChanged || update.viewportChanged) this.decorations = build(update.view);
		}
	},
	{ decorations: (v) => v.decorations },
);
