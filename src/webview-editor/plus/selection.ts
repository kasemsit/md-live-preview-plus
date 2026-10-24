import { EditorView, ViewPlugin } from '@codemirror/view';
import type { EditorState, Extension } from '@codemirror/state';
import type { PlusEditorToHostMessage } from '../../shared/messages';

/**
 * Reports the selection to the host, which writes it where a Claude Code hook
 * picks it up. A webview's selection is invisible to VS Code, so without this
 * Claude cannot see what is selected in the preview.
 *
 * The text is the Markdown source of the selection (not the rendered text),
 * with 1-based line numbers, so an edit can be made at exactly that place.
 * Debounced: a drag fires a selection change per pixel.
 *
 * A rendered table is a widget: text selected in it is a browser selection that
 * CodeMirror never sees. It is mapped back to the source through the offsets
 * each cell carries (`data-mlp-from` / `data-mlp-to`, see renderTableElement).
 */

type Selection = Extract<PlusEditorToHostMessage, { type: 'plusSelection' }>;

function message(state: EditorState, from: number, to: number): Selection {
	if (from >= to) return { type: 'plusSelection', text: '' };
	return {
		type: 'plusSelection',
		text: state.sliceDoc(from, to),
		from,
		to,
		startLine: state.doc.lineAt(from).number,
		endLine: state.doc.lineAt(to).number,
	};
}

function cellOf(node: Node | null): HTMLElement | null {
	const el = node instanceof HTMLElement ? node : node?.parentElement ?? null;
	return (el?.closest('[data-mlp-from]') as HTMLElement | null) ?? null;
}

/**
 * The source range of a browser selection that touches a rendered table, or
 * null when it does not. Within one cell, the selected text is located in the
 * cell's own source when it occurs there exactly once; otherwise whole cells.
 */
export function tableSelectionRange(view: EditorView, sel: globalThis.Selection | null): [number, number] | null {
	if (!sel || sel.isCollapsed || !sel.anchorNode || !sel.focusNode) return null;
	if (!view.dom.contains(sel.anchorNode) || !view.dom.contains(sel.focusNode)) return null;
	const a = cellOf(sel.anchorNode);
	const f = cellOf(sel.focusNode);
	if (!a && !f) {
		const inTable = (n: Node) => !!(n instanceof HTMLElement ? n : n.parentElement)?.closest('.mlp-table-wrap');
		if (!inTable(sel.anchorNode) && !inTable(sel.focusNode)) return null;
	}
	const range = (cell: HTMLElement): [number, number] => [Number(cell.dataset.mlpFrom), Number(cell.dataset.mlpTo)];
	if (a && a === f) {
		const [from, to] = range(a);
		const text = String(sel).trim();
		const src = a.dataset.mlpSrc ?? view.state.sliceDoc(from, to);
		const at = text ? src.indexOf(text) : -1;
		if (at >= 0 && src.indexOf(text, at + 1) < 0) return [from + at, from + at + text.length];
		return [from, to];
	}
	// Either end outside a cell (in the text around the table, or on a table's
	// border) resolves through CodeMirror's own DOM mapping.
	const pos = (cell: HTMLElement | null, node: Node, offset: number, end: 'start' | 'end'): number => {
		if (cell) return range(cell)[end === 'start' ? 0 : 1];
		try {
			return view.posAtDOM(node, offset);
		} catch {
			return -1;
		}
	};
	const p1 = pos(a, sel.anchorNode, sel.anchorOffset, 'start');
	const p2 = pos(f, sel.focusNode, sel.focusOffset, 'start');
	if (p1 < 0 || p2 < 0) return null;
	const from = Math.min(p1, p2);
	// Extend to the end of whichever cell the later end sits in.
	const lateCell = p1 >= p2 ? a : f;
	const to = Math.max(p1, p2, lateCell ? range(lateCell)[1] : 0);
	return [from, to];
}

export function selectionReporter(post: (message: PlusEditorToHostMessage) => void): Extension {
	let timer: ReturnType<typeof setTimeout> | undefined;
	let last = '';
	const report = (view: EditorView) => {
		clearTimeout(timer);
		timer = setTimeout(() => {
			const { state } = view;
			const table = tableSelectionRange(view, document.getSelection());
			const r = state.selection.main;
			const msg = table ? message(state, table[0], table[1]) : message(state, r.from, r.to);
			const key = JSON.stringify(msg);
			if (key === last) return;
			last = key;
			post(msg);
		}, 300);
	};
	return [
		EditorView.updateListener.of((update) => {
			if (update.selectionSet || update.docChanged) report(update.view);
		}),
		// A selection inside a widget changes only the browser's selection.
		ViewPlugin.fromClass(
			class {
				private readonly onChange = () => {
					const sel = document.getSelection();
					if (sel?.anchorNode && this.view.dom.contains(sel.anchorNode)) report(this.view);
				};
				constructor(private readonly view: EditorView) {
					document.addEventListener('selectionchange', this.onChange);
				}
				destroy() {
					document.removeEventListener('selectionchange', this.onChange);
				}
			},
		),
	];
}
