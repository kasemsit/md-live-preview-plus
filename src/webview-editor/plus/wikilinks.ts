import { Decoration, type DecorationSet, type EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import { StateEffect, type EditorState, type Extension, type Range } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import type { SyntaxNode } from '@lezer/common';
import { cursorTouchesRange, isBlockRevealed, blockRevealChanged } from '../cmUtils';
import { findWikilinks } from '../../shared/plusWikilinks';
import { registerInlinePass } from './inlineExtras';
import { isUnresolved, onNoteIndexChange, refreshNoteIndex } from './noteIndex';

/**
 * Wikilinks in the document body: `[[target#anchor|label]]` shows only `label`
 * as a link (`data-href="wiki:target#anchor"`) until the caret is on its line,
 * as ordinary Markdown links do. The host resolves `wiki:` by file name across
 * the workspace (Obsidian semantics) — see src/editor/plus/wikiOpen.ts.
 */

const SOURCE_NODES = /^(FencedCode|CodeBlock|InlineCode|HTMLBlock|CommentBlock)$/;

/**
 * True where Markdown is shown as source rather than rendered: code, raw HTML,
 * and a table switched to code mode. A rendered table is not source — its
 * widget renders cell links itself through `renderInlineInto`.
 */
export function inSourceContext(state: EditorState, pos: number): boolean {
	for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, 1); node; node = node.parent) {
		if (SOURCE_NODES.test(node.name)) return true;
		if (node.name === 'Table') return isBlockRevealed(state.doc.lineAt(node.from).from);
	}
	return false;
}

const hidden = Decoration.replace({});

/** The note list arrived or changed: unresolved-link styling has to be recomputed. */
export const noteIndexChanged = StateEffect.define<null>();

export function linkClass(target: string): string {
	return isUnresolved(target) ? 'mlp-link mlp-wikilink mlp-wikilink-unresolved' : 'mlp-link mlp-wikilink';
}

function linkMark(target: string): Decoration {
	return Decoration.mark({
		tagName: 'a',
		class: linkClass(target),
		attributes: { 'data-href': `wiki:${target}`, title: target },
	});
}

function build(view: EditorView): DecorationSet {
	const { state } = view;
	const out: Range<Decoration>[] = [];
	for (const { from, to } of view.visibleRanges) {
		for (const link of findWikilinks(state.sliceDoc(from, to))) {
			const s = from + link.from;
			const e = from + link.to;
			const labelFrom = from + link.labelFrom;
			const labelTo = from + link.labelTo;
			if (labelTo <= labelFrom) continue;
			if (cursorTouchesRange(state, s, e) || inSourceContext(state, s)) continue;
			out.push(hidden.range(s, labelFrom), linkMark(link.target).range(labelFrom, labelTo), hidden.range(labelTo, e));
		}
	}
	return Decoration.set(out, true);
}

const wikilinkDecorations = ViewPlugin.fromClass(
	class {
		decorations: DecorationSet;
		private readonly unsubscribe: () => void;
		private readonly onFocus = () => void refreshNoteIndex();
		constructor(private readonly view: EditorView) {
			this.decorations = build(view);
			this.unsubscribe = onNoteIndexChange(() => {
				view.dispatch({ effects: noteIndexChanged.of(null) });
				// Links that widgets rendered (table cells, footnote cards) are not
				// decorations, so they are updated in place.
				for (const a of Array.from(view.dom.querySelectorAll<HTMLElement>('.mlp-table-wrap .mlp-wikilink, .mlp-fn-pop .mlp-wikilink'))) {
					a.classList.toggle('mlp-wikilink-unresolved', isUnresolved((a.dataset.href ?? '').replace(/^wiki:/, '')));
				}
			});
			void refreshNoteIndex();
			// A note created or renamed elsewhere shows up the next time the editor is used.
			view.dom.addEventListener('focusin', this.onFocus);
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
		destroy() {
			this.unsubscribe();
			this.view.dom.removeEventListener('focusin', this.onFocus);
		}
	},
	{ decorations: (v) => v.decorations },
);

/**
 * Opens a wikilink on a plain press, wherever it is rendered — including
 * inside a table, whose widget takes every press for cell editing before
 * CodeMirror's handlers would see it. Listening in the capture phase on the
 * editor root runs first.
 */
function clickToOpen(onOpen: (href: string) => void): Extension {
	return ViewPlugin.fromClass(
		class {
			private readonly handler = (event: MouseEvent) => {
				if (event.button !== 0) return;
				const link = (event.target as HTMLElement | null)?.closest?.('.mlp-wikilink');
				const href = link?.getAttribute('data-href');
				if (!href) return;
				event.preventDefault();
				event.stopPropagation();
				onOpen(href);
			};
			constructor(private readonly view: EditorView) {
				view.dom.addEventListener('mousedown', this.handler, true);
			}
			destroy() {
				this.view.dom.removeEventListener('mousedown', this.handler, true);
			}
		},
	);
}

export function wikilinkExtension(onOpen: (href: string) => void): Extension {
	return [wikilinkDecorations, clickToOpen(onOpen)];
}

// Table cells and footnote cards: the inline Markdown parser would read
// `[[a|b]]` as bracket text and split nothing useful out of it, so links are
// swapped for private-use placeholders before parsing and rebuilt afterwards.
const PLACEHOLDER = /\uE000(\d+)\uE001/;
const PLACEHOLDER_SPLIT = /(\uE000\d+\uE001)/;

export function wikilinkElement(target: string, label: string): HTMLAnchorElement {
	const a = document.createElement('a');
	a.className = linkClass(target);
	a.setAttribute('data-href', `wiki:${target}`);
	a.title = target;
	a.textContent = label;
	return a;
}

registerInlinePass((text) => {
	if (!text.includes('[[')) return { text };
	const links = findWikilinks(text);
	if (!links.length) return { text };
	let out = '';
	let last = 0;
	links.forEach((link, i) => {
		out += `${text.slice(last, link.from)}\uE000${i}\uE001`;
		last = link.to;
	});
	out += text.slice(last);
	return {
		text: out,
		finish(root) {
			const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
			const nodes: Text[] = [];
			for (let n = walker.nextNode(); n; n = walker.nextNode()) {
				if (PLACEHOLDER.test(n.nodeValue ?? '')) nodes.push(n as Text);
			}
			for (const node of nodes) {
				const frag = document.createDocumentFragment();
				for (const part of (node.nodeValue ?? '').split(PLACEHOLDER_SPLIT)) {
					const m = /^\uE000(\d+)\uE001$/.exec(part);
					if (m) frag.append(wikilinkElement(links[+m[1]].target, links[+m[1]].label));
					else if (part) frag.append(part);
				}
				node.replaceWith(frag);
			}
		},
	};
});
