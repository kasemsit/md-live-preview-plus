import { Decoration, type DecorationSet, type EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import type { Range } from '@codemirror/state';
import { cursorTouchesRange, blockRevealChanged } from '../cmUtils';
import { findCitations } from '../../shared/plusWikilinks';
import { inSourceContext, linkClass, LINK_CONTEXT, noteIndexChanged } from './wikilinks';
import { registerInlinePass } from './inlineExtras';

/**
 * Pandoc citations — `[@key]`, `[@a; @b, p. 3]` — as written in paper drafts.
 * Each key behaves like a wikilink to `@key.md`, the vault's reference note: a
 * hover shows it, a click opens it, and a key with no note is drawn faint, so a
 * mistyped key shows up before the document is built. The source text stays as
 * written; the group gets a faint chip.
 */

const groupDeco = Decoration.mark({ class: 'mlp-cite-group' });

function keyDeco(key: string): Decoration {
	return Decoration.mark({
		tagName: 'a',
		class: `${linkClass(`@${key}`)} mlp-cite`,
		attributes: { 'data-href': `wiki:@${key}`, title: `@${key}`, 'data-vscode-context': LINK_CONTEXT },
	});
}

function build(view: EditorView): DecorationSet {
	const { state } = view;
	const out: Range<Decoration>[] = [];
	for (const { from, to } of view.visibleRanges) {
		for (let pos = from; pos <= to; ) {
			const line = state.doc.lineAt(pos);
			pos = line.to + 1;
			if (!line.text.includes('@') || cursorTouchesRange(state, line.from, line.to)) continue;
			const groups = new Set<number>();
			for (const c of findCitations(line.text)) {
				if (inSourceContext(state, line.from + c.from)) continue;
				if (!groups.has(c.groupFrom)) {
					groups.add(c.groupFrom);
					out.push(groupDeco.range(line.from + c.groupFrom, line.from + c.groupTo));
				}
				out.push(keyDeco(c.key).range(line.from + c.from, line.from + c.to));
			}
		}
	}
	return Decoration.set(out, true);
}

export const citationPlugin = ViewPlugin.fromClass(
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
				update.transactions.some((tr) => tr.effects.some((e) => e.is(blockRevealChanged) || e.is(noteIndexChanged)))
			) {
				this.decorations = build(update.view);
			}
		}
	},
	{ decorations: (v) => v.decorations },
);

// Table cells and cards: the inline renderer leaves "[@key]" as text (see the
// Link case in tableCellInline.ts); wrap its keys here.
registerInlinePass((text) => {
	if (!text.includes('@')) return { text };
	return {
		text,
		finish(root) {
			const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
			const nodes: Text[] = [];
			for (let n = walker.nextNode(); n; n = walker.nextNode()) {
				if (n.nodeValue?.includes('@') && !n.parentElement?.closest('code,a')) nodes.push(n as Text);
			}
			for (const node of nodes) {
				const value = node.nodeValue ?? '';
				const cites = findCitations(value);
				if (!cites.length) continue;
				const frag = document.createDocumentFragment();
				let last = 0;
				let group: HTMLElement | null = null;
				let groupEnd = -1;
				const append = (piece: Node | string) => (group ?? frag).append(piece);
				for (const c of cites) {
					if (c.groupFrom >= groupEnd) {
						if (group) {
							group.append(value.slice(last, groupEnd));
							last = groupEnd;
							group = null;
						}
						frag.append(value.slice(last, c.groupFrom));
						group = document.createElement('span');
						group.className = 'mlp-cite-group';
						frag.append(group);
						last = c.groupFrom;
						groupEnd = c.groupTo;
					}
					append(value.slice(last, c.from));
					const a = document.createElement('a');
					a.className = `${linkClass(`@${c.key}`)} mlp-cite`;
					a.setAttribute('data-href', `wiki:@${c.key}`);
					a.title = `@${c.key}`;
					a.dataset.vscodeContext = LINK_CONTEXT;
					a.textContent = value.slice(c.from, c.to);
					append(a);
					last = c.to;
				}
				if (group) {
					group.append(value.slice(last, groupEnd));
					last = groupEnd;
				}
				frag.append(value.slice(last));
				node.replaceWith(frag);
			}
		},
	};
});
