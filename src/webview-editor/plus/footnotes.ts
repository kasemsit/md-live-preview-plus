import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from '@codemirror/view';
import type { EditorState, Range, Text as Doc } from '@codemirror/state';
import { cursorTouchesRange } from '../cmUtils';
import { renderInlineInto } from '../tableCellInline';
import { cellInlineHooks } from '../livePreviewPlugin';
import { inSourceContext } from './wikilinks';
import { registerInlinePass } from './inlineExtras';

/**
 * Footnotes, Pandoc/GFM/Obsidian style: `[^label]` in the text and
 * `[^label]: text` (continued by indented lines) anywhere in the document.
 *
 * - A reference becomes a superscript number, numbered by first citation, with
 *   a hover card showing the footnote; a click scrolls to the definition and
 *   flashes it.
 * - A definition shows `n.` and a `↩` back-link to its first citation.
 * - Raw source shows while the caret is on the line; a reference with no
 *   definition stays as typed, so a typo is visible.
 */

export interface FootnoteDef {
	from: number;
	line: number;
	text: string;
}
export interface FootnoteScan {
	defs: Map<string, FootnoteDef>;
	/** label → display number */
	order: Map<string, number>;
	/** label → offset of its first citation */
	first: Map<string, number>;
	firstDefLine: number;
}

const DEF_LINE = /^\[\^([^\]\s]+)\]:[ \t]?(.*)$/;
const REF = /\[\^([^\]\s]+)\]/g;

const scans = new WeakMap<Doc, FootnoteScan>();
/** The scan of the document most recently rendered — read by table-cell rendering, which only sees text. */
let current: FootnoteScan = { defs: new Map(), order: new Map(), first: new Map(), firstDefLine: 0 };

export function scanFootnotes(doc: Doc): FootnoteScan {
	const cached = scans.get(doc);
	if (cached) return (current = cached);
	const defs = new Map<string, FootnoteDef>();
	const order = new Map<string, number>();
	const first = new Map<string, number>();
	let firstDefLine = 0;
	for (let k = 1; k <= doc.lines; k++) {
		const line = doc.line(k);
		const m = DEF_LINE.exec(line.text);
		if (!m) continue;
		let text = m[2];
		for (let j = k + 1; j <= doc.lines && /^( {2,}|\t)\S/.test(doc.line(j).text); j++) {
			text += ` ${doc.line(j).text.trim()}`;
		}
		if (!defs.has(m[1])) defs.set(m[1], { from: line.from, line: k, text });
		firstDefLine ||= k;
	}
	if (defs.size) {
		for (let k = 1; k <= doc.lines; k++) {
			const line = doc.line(k);
			if (DEF_LINE.test(line.text)) continue;
			for (const r of line.text.matchAll(REF)) {
				if (!defs.has(r[1])) continue;
				if (!order.has(r[1])) order.set(r[1], order.size + 1);
				if (!first.has(r[1])) first.set(r[1], line.from + r.index!);
			}
		}
		for (const label of defs.keys()) if (!order.has(label)) order.set(label, order.size + 1);
	}
	const scan = { defs, order, first, firstDefLine };
	scans.set(doc, scan);
	return (current = scan);
}

/** Scrolls `pos` to the middle of the editor and briefly highlights its line. */
export function jumpTo(view: EditorView, pos: number): void {
	view.dispatch({ effects: EditorView.scrollIntoView(pos, { y: 'center' }) });
	let tries = 0;
	const flash = () => {
		try {
			const scroller = view.scrollDOM;
			const block = view.lineBlockAt(pos);
			const box = scroller.getBoundingClientRect();
			const top = block.top + view.documentTop - box.top + scroller.scrollTop;
			const offset = top - scroller.scrollTop;
			if (offset < -5 || offset > scroller.clientHeight) {
				if (++tries < 12) setTimeout(flash, 90);
				return;
			}
			if (getComputedStyle(scroller).position === 'static') scroller.style.position = 'relative';
			const mark = document.createElement('div');
			mark.className = 'mlp-fn-flashbox';
			mark.style.top = `${top}px`;
			mark.style.height = `${block.height}px`;
			scroller.appendChild(mark);
			setTimeout(() => mark.remove(), 1500);
		} catch {
			if (++tries < 12) setTimeout(flash, 90);
		}
	};
	setTimeout(flash, 60);
}

function viewOf(el: HTMLElement): EditorView | null {
	const root = el.closest('.cm-editor');
	return root ? EditorView.findFromDOM(root as HTMLElement) : null;
}

function onPress(el: HTMLElement, pos: number): void {
	el.addEventListener('mousedown', (event) => {
		if (event.button !== 0) return;
		event.preventDefault();
		event.stopPropagation();
		const view = viewOf(el);
		if (view) jumpTo(view, pos);
	});
}

/** A reference: superscript number plus its hover card. */
export function footnoteRefElement(label: string, scan: FootnoteScan = current): HTMLElement {
	const def = scan.defs.get(label);
	const wrap = document.createElement('span');
	wrap.className = 'mlp-fn';
	const sup = document.createElement('sup');
	sup.className = 'mlp-fn-ref';
	sup.textContent = String(scan.order.get(label) ?? '?');
	wrap.appendChild(sup);
	if (!def) return wrap;
	const card = document.createElement('span');
	card.className = 'mlp-fn-pop';
	try {
		renderInlineInto(card, def.text, cellInlineHooks);
	} catch {
		card.textContent = def.text;
	}
	wrap.appendChild(card);
	// Positioned on screen rather than relative to the line: a card near the
	// right edge or the top of the panel would otherwise be cut off.
	wrap.addEventListener('mouseenter', () => {
		wrap.classList.add('mlp-fn-open');
		const r = sup.getBoundingClientRect();
		const vw = document.documentElement.clientWidth;
		card.style.left = `${Math.max(8, Math.min(r.left - 16, vw - card.offsetWidth - 8))}px`;
		const above = r.top - card.offsetHeight - 6;
		card.style.top = `${above >= 8 ? above : r.bottom + 6}px`;
	});
	wrap.addEventListener('mouseleave', () => wrap.classList.remove('mlp-fn-open'));
	onPress(sup, def.from);
	return wrap;
}

class RefWidget extends WidgetType {
	constructor(
		private readonly label: string,
		private readonly n: number,
		private readonly text: string,
		private readonly target: number,
	) {
		super();
	}
	eq(o: RefWidget): boolean {
		return o.label === this.label && o.n === this.n && o.text === this.text && o.target === this.target;
	}
	toDOM(): HTMLElement {
		return footnoteRefElement(this.label);
	}
	ignoreEvent(): boolean {
		return true;
	}
}

class DefWidget extends WidgetType {
	constructor(
		private readonly n: number,
		private readonly back: number,
	) {
		super();
	}
	eq(o: DefWidget): boolean {
		return o.n === this.n && o.back === this.back;
	}
	toDOM(): HTMLElement {
		const num = document.createElement('span');
		num.className = 'mlp-fn-def-num';
		num.textContent = `${this.n}.`;
		if (this.back >= 0) {
			const back = document.createElement('span');
			back.className = 'mlp-fn-back';
			back.textContent = '↩';
			back.title = 'back to text';
			onPress(back, this.back);
			num.appendChild(back);
		}
		return num;
	}
	ignoreEvent(): boolean {
		return true;
	}
}

function build(view: EditorView): DecorationSet {
	const state: EditorState = view.state;
	const scan = scanFootnotes(state.doc);
	if (!scan.defs.size) return Decoration.none;
	const out: Range<Decoration>[] = [];
	for (const { from, to } of view.visibleRanges) {
		for (let pos = from; pos <= to; ) {
			const line = state.doc.lineAt(pos);
			pos = line.to + 1;
			const touched = cursorTouchesRange(state, line.from, line.to);
			const dm = /^\[\^([^\]\s]+)\]:[ \t]?/.exec(line.text);
			if (dm && scan.defs.get(dm[1])?.line === line.number) {
				const cls = line.number === scan.firstDefLine ? 'mlp-fn-def mlp-fn-def-first' : 'mlp-fn-def';
				out.push(Decoration.line({ class: cls }).range(line.from));
				if (!touched) {
					const widget = new DefWidget(scan.order.get(dm[1]) ?? 0, scan.first.get(dm[1]) ?? -1);
					out.push(Decoration.replace({ widget }).range(line.from, line.from + dm[0].length));
				}
				continue;
			}
			if (touched) continue;
			for (const m of line.text.matchAll(REF)) {
				const def = scan.defs.get(m[1]);
				const s = line.from + m.index!;
				if (!def || inSourceContext(state, s)) continue;
				const widget = new RefWidget(m[1], scan.order.get(m[1]) ?? 0, def.text, def.from);
				out.push(Decoration.replace({ widget }).range(s, s + m[0].length));
			}
		}
	}
	return Decoration.set(out, true);
}

export const footnotePlugin = ViewPlugin.fromClass(
	class {
		decorations: DecorationSet;
		constructor(view: EditorView) {
			this.decorations = build(view);
		}
		update(update: ViewUpdate) {
			if (update.docChanged || update.viewportChanged || update.selectionSet) this.decorations = build(update.view);
		}
	},
	{ decorations: (v) => v.decorations },
);

/**
 * The label for a new footnote: one past the highest numeric label in use, so
 * `[^1]`…`[^7]` gives `8` even when some are cited out of order.
 */
export function nextFootnoteLabel(doc: string): string {
	let max = 0;
	for (const m of doc.matchAll(/\[\^(\d+)\]/g)) max = Math.max(max, Number(m[1]));
	return String(max + 1);
}

/** True when line `n` is a footnote definition or one of its indented continuation lines. */
function isInDefinition(doc: Doc, n: number): boolean {
	for (let k = n; k >= 1; k--) {
		const text = doc.line(k).text;
		if (DEF_LINE.test(text)) return true;
		if (!/^( {2,}|\t)\S/.test(text)) return false;
	}
	return false;
}

/**
 * Inserts `[^n]` at the caret and `[^n]: ` on a new line at the end of the
 * document, then puts the caret there so the note can be typed straight away.
 */
export function insertFootnote(view: EditorView): boolean {
	const { state } = view;
	const label = nextFootnoteLabel(state.doc.toString());
	const at = state.selection.main.head;
	const ref = `[^${label}]`;
	const tail = state.sliceDoc(Math.max(0, state.doc.length - 2));
	// One blank line before the first definition, none between definitions.
	let lastText = state.doc.lines;
	while (lastText > 1 && !state.doc.line(lastText).text.trim()) lastText--;
	const afterDefs = scanFootnotes(state.doc).defs.size > 0 && isInDefinition(state.doc, lastText);
	let sep = '';
	if (state.doc.length) {
		if (afterDefs) sep = tail.endsWith('\n') ? '' : '\n';
		else sep = tail.endsWith('\n\n') ? '' : tail.endsWith('\n') ? '\n' : '\n\n';
	}
	const def = `${sep}[^${label}]: `;
	view.dispatch({
		changes: [
			{ from: at, insert: ref },
			{ from: state.doc.length, insert: def },
		],
		selection: { anchor: state.doc.length + ref.length + def.length },
		scrollIntoView: true,
	});
	view.focus();
	return true;
}

// Footnote references inside table cells and footnote cards.
registerInlinePass((text) => {
	if (!text.includes('[^')) return { text };
	return {
		text,
		finish(root) {
			if (!current.defs.size) return;
			const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
			const nodes: Text[] = [];
			for (let n = walker.nextNode(); n; n = walker.nextNode()) {
				if (/\[\^[^\]\s]+\]/.test(n.nodeValue ?? '') && !n.parentElement?.closest('code,.mlp-fn')) nodes.push(n as Text);
			}
			for (const node of nodes) {
				const frag = document.createDocumentFragment();
				for (const part of (node.nodeValue ?? '').split(/(\[\^[^\]\s]+\])/)) {
					const m = /^\[\^([^\]\s]+)\]$/.exec(part);
					if (m && current.defs.has(m[1])) frag.append(footnoteRefElement(m[1]));
					else if (part) frag.append(part);
				}
				node.replaceWith(frag);
			}
		},
	};
});
