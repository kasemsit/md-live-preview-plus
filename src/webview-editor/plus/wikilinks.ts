import { Decoration, type DecorationSet, type EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import type { EditorState, Extension, Range } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import type { SyntaxNode } from '@lezer/common';
import { cursorTouchesRange, isBlockRevealed, blockRevealChanged } from '../cmUtils';
import { findWikilinks } from './wikilinkSyntax';
import { registerInlinePass } from './inlineExtras';

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

function linkMark(target: string): Decoration {
	return Decoration.mark({
		tagName: 'a',
		class: 'mlp-link mlp-wikilink',
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
const PLACEHOLDER = /(\d+)/;
const PLACEHOLDER_SPLIT = /(\d+)/;

export function wikilinkElement(target: string, label: string): HTMLAnchorElement {
	const a = document.createElement('a');
	a.className = 'mlp-link mlp-wikilink';
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
		out += `${text.slice(last, link.from)}${i}`;
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
					const m = /^(\d+)$/.exec(part);
					if (m) frag.append(wikilinkElement(links[+m[1]].target, links[+m[1]].label));
					else if (part) frag.append(part);
				}
				node.replaceWith(frag);
			}
		},
	};
});
