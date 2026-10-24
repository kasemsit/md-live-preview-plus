import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from '@codemirror/view';
import { StateField, type EditorState, type Extension, type Range } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import type { SyntaxNode } from '@lezer/common';
import { cursorTouchesRange, inlineCursorTouchesRange, isBlockRevealed, blockRevealChanged } from '../cmUtils';
import { isMultilineMath, mathBlockReplaced, mathTex } from './mathSyntax';

/**
 * Renders the math nodes plus/mathSyntax.ts adds to the tree, with KaTeX.
 *
 * - Inline `$…$` becomes rendered math until the caret is inside it.
 * - A one-line `$$…$$` renders as display math until the caret is on its line.
 * - A multi-line `$$` block becomes a block widget until the selection enters
 *   it; clicking the formula puts the caret there, showing the source.
 *
 * KaTeX (~270 KB, plus fonts) is loaded only when a document has math, as a
 * separate nonce'd script the same way the Mermaid chunk is (see
 * mermaidLoader.ts); until it arrives a formula shows as its source.
 */

interface KatexApi {
	renderToString(tex: string, options: Record<string, unknown>): string;
}

declare global {
	interface Window {
		mlpKatex?: KatexApi;
		mlpKatexChunkUri?: string;
		mlpKatexBase?: string;
	}
}

let loading: Promise<KatexApi> | null = null;

export function loadKatex(): Promise<KatexApi> {
	if (window.mlpKatex) return Promise.resolve(window.mlpKatex);
	if (loading) return loading;
	loading = new Promise<KatexApi>((resolve, reject) => {
		const src = window.mlpKatexChunkUri;
		if (!src) {
			reject(new Error('KaTeX chunk URI was not provided by the host'));
			return;
		}
		if (window.mlpKatexBase) {
			const css = document.createElement('link');
			css.rel = 'stylesheet';
			css.href = `${window.mlpKatexBase}katex.min.css`;
			document.head.appendChild(css);
		}
		const script = document.createElement('script');
		script.src = src;
		// The webview's CSP admits only scripts carrying the page's nonce.
		if (window.mlpNonce) script.nonce = window.mlpNonce;
		script.addEventListener('load', () => (window.mlpKatex ? resolve(window.mlpKatex) : reject(new Error('KaTeX chunk did not register'))));
		script.addEventListener('error', () => reject(new Error('Failed to load KaTeX')));
		document.head.appendChild(script);
	});
	loading.catch(() => {
		loading = null;
	});
	return loading;
}

const cache = new Map<string, string>();
const MATH_CONTEXT = JSON.stringify({ mlpMath: true });

function toHtml(katex: KatexApi, tex: string, display: boolean): string {
	const key = `${display ? 'D' : 'I'}${tex}`;
	let html = cache.get(key);
	if (html === undefined) {
		try {
			html = katex.renderToString(tex, { displayMode: display, throwOnError: false, strict: 'ignore', trust: false, output: 'htmlAndMathml' });
		} catch {
			html = '';
		}
		if (cache.size > 2000) cache.clear();
		cache.set(key, html);
	}
	return html;
}

/**
 * Renders `tex` into `el`. When KaTeX is not loaded yet the source is shown
 * and replaced once it is; `onLate` runs then (the widget's height changed).
 */
export function renderMathInto(el: HTMLElement, tex: string, display: boolean, onLate?: () => void): void {
	// The TeX, for "Copy TeX" and rich-text copy; `mlpMath` shows the math items of the right-click menu.
	el.dataset.mlpTex = tex;
	el.dataset.vscodeContext = MATH_CONTEXT;
	const draw = (katex: KatexApi) => {
		const html = toHtml(katex, tex, display);
		if (html) el.innerHTML = html;
		else el.textContent = tex;
	};
	if (window.mlpKatex) {
		draw(window.mlpKatex);
		return;
	}
	el.classList.add('mlp-math-pending');
	el.textContent = display ? `$$${tex}$$` : `$${tex}$`;
	loadKatex().then(
		(katex) => {
			el.classList.remove('mlp-math-pending');
			draw(katex);
			onLate?.();
		},
		() => el.classList.add('mlp-math-failed'),
	);
}

class MathWidget extends WidgetType {
	constructor(
		private readonly tex: string,
		private readonly display: boolean,
		private readonly block: boolean,
		private readonly from: number,
	) {
		super();
	}
	eq(other: MathWidget): boolean {
		return other.tex === this.tex && other.display === this.display && other.block === this.block && other.from === this.from;
	}
	toDOM(view: EditorView): HTMLElement {
		const el: HTMLElement = document.createElement(this.display ? 'div' : 'span');
		el.className = this.display ? (this.block ? 'mlp-math mlp-math-display mlp-math-block' : 'mlp-math mlp-math-display') : 'mlp-math';
		renderMathInto(el, this.tex, this.display, () => view.requestMeasure());
		// A click opens the source. The caret is placed here rather than by
		// CodeMirror: KaTeX's absolutely positioned layout makes the clicked
		// coordinates map to the wrong place in the line.
		el.addEventListener('mousedown', (event) => {
			if (event.button !== 0) return;
			event.preventDefault();
			const anchor = this.block ? this.from : this.from + (this.display ? 2 : 1);
			view.dispatch({ selection: { anchor }, scrollIntoView: false });
			view.focus();
		});
		return el;
	}
	ignoreEvent(): boolean {
		return true;
	}
}

function inRevealedTable(state: EditorState, pos: number): boolean {
	for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, 1); node; node = node.parent) {
		if (node.name === 'Table') return isBlockRevealed(state.doc.lineAt(node.from).from);
	}
	return false;
}

function buildInline(view: EditorView): DecorationSet {
	const { state } = view;
	const out: Range<Decoration>[] = [];
	for (const { from, to } of view.visibleRanges) {
		syntaxTree(state).iterate({
			from,
			to,
			enter: (node) => {
				if (node.name === 'InlineMath') {
					if (inlineCursorTouchesRange(state, node.from, node.to) || inRevealedTable(state, node.from)) return false;
					const widget = new MathWidget(mathTex(state, node.node), false, false, node.from);
					out.push(Decoration.replace({ widget }).range(node.from, node.to));
					return false;
				}
				if (node.name === 'BlockMath') {
					if (isMultilineMath(state, node)) return false; // the state field's job
					const line = state.doc.lineAt(node.from);
					if (cursorTouchesRange(state, line.from, line.to)) return false;
					const widget = new MathWidget(mathTex(state, node.node), true, false, node.from);
					out.push(Decoration.replace({ widget }).range(node.from, node.to));
					return false;
				}
			},
		});
	}
	return Decoration.set(out, true);
}

const inlineMath = ViewPlugin.fromClass(
	class {
		decorations: DecorationSet;
		constructor(view: EditorView) {
			this.decorations = buildInline(view);
		}
		update(update: ViewUpdate) {
			if (
				update.docChanged ||
				update.viewportChanged ||
				update.selectionSet ||
				syntaxTree(update.startState) !== syntaxTree(update.state) ||
				update.transactions.some((tr) => tr.effects.some((e) => e.is(blockRevealChanged)))
			) {
				this.decorations = buildInline(update.view);
			}
		}
	},
	{ decorations: (v) => v.decorations },
);

function buildBlocks(state: EditorState): DecorationSet {
	const out: Range<Decoration>[] = [];
	syntaxTree(state).iterate({
		enter: (node) => {
			// Math blocks sit at block level; nothing inline can hold one.
			if (/^(Paragraph|ATXHeading\d|SetextHeading\d|FencedCode|CodeBlock|HTMLBlock|Table)$/.test(node.name)) return false;
			if (node.name !== 'BlockMath') return;
			const range = mathBlockReplaced(state, node);
			if (range) {
				const widget = new MathWidget(mathTex(state, node.node), true, true, range.from);
				out.push(Decoration.replace({ widget, block: true }).range(range.from, range.to));
			}
			return false;
		},
	});
	return Decoration.set(out, true);
}

// Block widgets may only come from state, not from a view plugin.
const blockMath = StateField.define<DecorationSet>({
	create: buildBlocks,
	update(value, tr) {
		if (tr.docChanged || tr.selection || syntaxTree(tr.startState) !== syntaxTree(tr.state)) return buildBlocks(tr.state);
		return value;
	},
	provide: (field) => EditorView.decorations.from(field),
});

export const mathExtension: Extension = [inlineMath, blockMath];
