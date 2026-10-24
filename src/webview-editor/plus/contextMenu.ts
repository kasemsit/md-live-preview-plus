import { type EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import type { EditorState } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import type { SyntaxNode } from '@lezer/common';
import type { PlusCommand, PlusEditorToHostMessage } from '../../shared/messages';
import { readTableModel, caretPastTable, cellInlineHooks } from '../livePreviewPlugin';
import { insertRow, insertColumn, deleteRow, deleteColumn, renderTableMarkdown, type TableEditModel } from '../tableEdit';
import { renderInlineInto } from '../tableCellInline';
import { scanFootnotes } from './footnotes';
import { inSourceContext } from './wikilinks';
import { markdownToHtml, htmlToText } from './richText';

/**
 * The editor side of the right-click menu (the menu itself is VS Code's, see
 * `webview/context` in package.json and src/editor/plus/contextMenu.ts).
 *
 * VS Code decides which items to show from `data-vscode-context` on the
 * clicked element and its ancestors: the editor root says whether there is a
 * selection or footnotes, a link, a table or a formula says what it is. When an
 * item is chosen the host sends `plusRun`, and the command acts on the spot that
 * was right-clicked — remembered here — or on the caret when it came from the
 * command palette.
 */

let post: (message: PlusEditorToHostMessage) => void = () => undefined;
let last: { target: HTMLElement | null; pos: number; at: number } | null = null;
const FRESH_MS = 20_000;

const notify = (message: string, error = false) => post({ type: 'plusDo', action: 'notify', message, error });

function contextPos(view: EditorView): number {
	return last && Date.now() - last.at < FRESH_MS ? last.pos : view.state.selection.main.head;
}

function contextTarget(): HTMLElement | null {
	return last && Date.now() - last.at < FRESH_MS ? last.target : null;
}

// ── Where a block starts and ends, for block links and review comments ──

const BLOCK_ID = /\s\^([A-Za-z0-9][A-Za-z0-9-]*)\s*$/;
const BLOCK_ID_ONLY = /^\s*\^([A-Za-z0-9][A-Za-z0-9-]*)\s*$/;
const WHOLE_BLOCKS = /^(Blockquote|Table|FencedCode|CodeBlock|BlockMath|HTMLBlock|CommentBlock|BulletList|OrderedList)$/;

type Block =
	| { kind: 'heading'; node: SyntaxNode; text: string }
	| { kind: 'paragraph'; node: SyntaxNode }
	| { kind: 'block'; node: SyntaxNode };

/**
 * The block at `pos`. A paragraph (including one in a list item) can carry a
 * block id on its last line; a quote/callout, table, code or math block takes
 * it on its own line after the block, as Obsidian does.
 */
function blockAt(state: EditorState, pos: number): Block | null {
	let paragraph: SyntaxNode | null = null;
	let whole: SyntaxNode | null = null;
	for (let n: SyntaxNode | null = syntaxTree(state).resolveInner(pos, 1); n; n = n.parent) {
		if (/^(ATXHeading\d|SetextHeading\d)$/.test(n.name)) {
			const line = state.doc.lineAt(n.from).text;
			return { kind: 'heading', node: n, text: line.replace(/^#{1,6}\s+/, '').replace(/\s*#*\s*$/, '') };
		}
		if (n.name === 'Paragraph' && !paragraph) paragraph = n;
		// The outermost quote wins (a callout is one block); lists only when no paragraph was hit.
		if (n.name === 'Blockquote' || (WHOLE_BLOCKS.test(n.name) && n.name !== 'BulletList' && n.name !== 'OrderedList')) whole = n;
	}
	if (whole) return { kind: 'block', node: whole };
	if (paragraph) return { kind: 'paragraph', node: paragraph };
	return null;
}

/** A short random block id not yet used in the document, like Obsidian's. */
function newBlockId(state: EditorState): string {
	const text = state.doc.toString();
	for (;;) {
		const id = Math.random().toString(36).slice(2, 8);
		if (id.length === 6 && !text.includes(`^${id}`)) return id;
	}
}

/** The block's anchor (`^id` or heading text), adding a block id to the document when it has none. */
function ensureAnchor(view: EditorView, block: Block): string {
	const { state } = view;
	const { doc } = state;
	if (block.kind === 'heading') {
		const id = BLOCK_ID.exec(doc.lineAt(block.node.from).text);
		return id ? `^${id[1]}` : block.text.replace(BLOCK_ID, '').trim();
	}
	if (block.kind === 'paragraph') {
		const lastLine = doc.lineAt(block.node.to);
		const id = BLOCK_ID.exec(lastLine.text);
		if (id) return `^${id[1]}`;
		const fresh = newBlockId(state);
		view.dispatch({ changes: { from: lastLine.to, insert: `${/\s$/.test(lastLine.text) ? '' : ' '}^${fresh}` } });
		return `^${fresh}`;
	}
	const lastLine = doc.lineAt(block.node.to);
	for (let n = lastLine.number + 1; n <= Math.min(doc.lines, lastLine.number + 2); n++) {
		const id = BLOCK_ID_ONLY.exec(doc.line(n).text);
		if (id) return `^${id[1]}`;
		if (doc.line(n).text.trim()) break;
	}
	const fresh = newBlockId(state);
	const next = lastLine.number < doc.lines ? doc.line(lastLine.number + 1).text : '';
	view.dispatch({ changes: { from: lastLine.to, insert: `\n\n^${fresh}${next.trim() ? '\n' : ''}` } });
	return `^${fresh}`;
}

function copyBlockLink(view: EditorView): void {
	const block = blockAt(view.state, contextPos(view));
	if (!block) return notify('There is no block here to link to.', true);
	post({ type: 'plusDo', action: 'copyBlockLink', anchor: ensureAnchor(view, block) });
}

function addReviewComment(view: EditorView): void {
	const { state } = view;
	const pos = contextPos(view);
	const block = blockAt(state, pos);
	const end = block ? state.doc.lineAt(block.node.to) : state.doc.lineAt(pos);
	const sel = state.selection.main;
	const quoted = sel.empty ? '' : ` "${state.sliceDoc(sel.from, sel.to).replace(/\s+/g, ' ').trim().slice(0, 80)}"`;
	const head = `\n\n<!-- REVIEW${quoted}: `;
	const next = end.number < state.doc.lines ? state.doc.line(end.number + 1).text : '';
	view.dispatch({
		changes: { from: end.to, insert: `${head} -->${next.trim() ? '\n' : ''}` },
		selection: { anchor: end.to + head.length },
		scrollIntoView: true,
	});
	view.focus();
}

// ── Clipboard ──

async function writeRichClipboard(html: string, text: string): Promise<boolean> {
	try {
		await navigator.clipboard.write([
			new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([text], { type: 'text/plain' }) }),
		]);
		return true;
	} catch {
		// Fall back to a copy event, which can carry HTML too.
	}
	let done = false;
	const onCopy = (event: ClipboardEvent) => {
		event.clipboardData?.setData('text/html', html);
		event.clipboardData?.setData('text/plain', text);
		event.preventDefault();
		// CodeMirror's own copy handler would clear the data again.
		event.stopImmediatePropagation();
		done = true;
	};
	document.addEventListener('copy', onCopy, true);
	try {
		document.execCommand('copy');
	} finally {
		document.removeEventListener('copy', onCopy, true);
	}
	return done;
}

async function copyRichText(view: EditorView, range?: { from: number; to: number }): Promise<void> {
	const { state } = view;
	let from = range?.from ?? state.selection.main.from;
	let to = range?.to ?? state.selection.main.to;
	if (from === to) {
		const block = blockAt(state, contextPos(view));
		if (!block) return notify('Select some text to copy.', true);
		from = state.doc.lineAt(block.node.from).from;
		to = block.node.to;
	}
	const html = markdownToHtml(state.sliceDoc(from, to));
	const text = htmlToText(html);
	if (await writeRichClipboard(html, text)) notify('Copied as rich text.');
	else post({ type: 'plusDo', action: 'copy', text, notice: 'Copied as plain text (this window cannot write rich text).' });
}

// ── Footnotes ──

/**
 * Relabels every footnote with the number it is shown as (order of first
 * citation), so `[^7]` cited first becomes `[^1]`. Definitions keep their
 * place; Pandoc and Obsidian number by citation order anyway, and this makes
 * the source agree with what is displayed.
 */
function renumberFootnotes(view: EditorView): void {
	const { state } = view;
	const scan = scanFootnotes(state.doc);
	if (!scan.defs.size) return notify('This document has no footnotes.', true);
	const rename = new Map([...scan.order.entries()].map(([label, n]) => [label, String(n)]));
	if ([...rename].every(([a, b]) => a === b)) return notify('Footnotes are already numbered in order.');
	const changes: { from: number; to: number; insert: string }[] = [];
	for (let n = 1; n <= state.doc.lines; n++) {
		const line = state.doc.line(n);
		if (!line.text.includes('[^')) continue;
		for (const m of line.text.matchAll(/\[\^([^\]\s]+)\]/g)) {
			const to = rename.get(m[1]);
			const from = line.from + m.index! + 2;
			if (!to || to === m[1] || inSourceContext(state, from)) continue;
			changes.push({ from, to: from + m[1].length, insert: to });
		}
	}
	view.dispatch({ changes });
	notify(`Renumbered ${rename.size} footnotes in citation order.`);
}

// ── Tables ──

function tableAtTarget(view: EditorView): { model: TableEditModel; from: number; to: number; row: number; col: number } | null {
	const cell = contextTarget()?.closest('[data-mlp-row]') as HTMLElement | null;
	const wrap = cell?.closest('.mlp-table-wrap') as HTMLElement | null;
	if (!cell || !wrap) return null;
	const tableFrom = Number(wrap.dataset.mlpTableFrom);
	let found: SyntaxNode | null = null;
	syntaxTree(view.state).iterate({
		from: tableFrom,
		to: Math.min(view.state.doc.lineAt(tableFrom).to, view.state.doc.length),
		enter: (n) => {
			if (n.name === 'Table' && view.state.doc.lineAt(n.from).from === tableFrom) {
				found = n.node;
				return false;
			}
		},
	});
	if (!found) return null;
	const m = readTableModel(view.state, found);
	return {
		model: { rows: m.rows, headerRowCount: m.headerRowCount, align: m.align, indent: m.indent },
		from: m.tableFrom,
		to: m.tableTo,
		row: Number(cell.dataset.mlpRow),
		col: Number(cell.dataset.mlpCol),
	};
}

function cellText(markdown: string): string {
	const span = document.createElement('span');
	renderInlineInto(span, markdown, cellInlineHooks);
	for (const pop of Array.from(span.querySelectorAll('.mlp-fn-pop'))) pop.remove();
	for (const m of Array.from(span.querySelectorAll<HTMLElement>('[data-mlp-tex]'))) m.replaceWith(`$${m.dataset.mlpTex}$`);
	return (span.textContent ?? '').replace(/[\t\n]+/g, ' ').trim();
}

const collator = new Intl.Collator(['th', 'en'], { numeric: true, sensitivity: 'base' });

function tableCommand(view: EditorView, command: PlusCommand): void {
	const t = tableAtTarget(view);
	if (!t) return notify('Right-click a table cell first.', true);
	const { model, row, col } = t;
	if (command === 'table.copyTsv') {
		const text = model.rows.map((cells) => cells.map(cellText).join('\t')).join('\n');
		return post({ type: 'plusDo', action: 'copy', text, notice: `Copied the table (${model.rows.length} rows) as tab-separated text.` });
	}
	let next: TableEditModel = model;
	const header = Math.max(1, model.headerRowCount);
	switch (command) {
		case 'table.insertRowAbove':
			next = insertRow(model, Math.max(row, header));
			break;
		case 'table.insertRowBelow':
			next = insertRow(model, row + 1);
			break;
		case 'table.insertColumnLeft':
			next = insertColumn(model, col);
			break;
		case 'table.insertColumnRight':
			next = insertColumn(model, col + 1);
			break;
		case 'table.deleteRow':
			if (row < header) return notify('The header row cannot be deleted.', true);
			next = deleteRow(model, row);
			break;
		case 'table.deleteColumn':
			next = deleteColumn(model, col);
			break;
		case 'table.sortAscending':
		case 'table.sortDescending': {
			const sign = command === 'table.sortAscending' ? 1 : -1;
			const body = model.rows.slice(header).sort((a, b) => sign * collator.compare(cellText(a[col] ?? ''), cellText(b[col] ?? '')));
			next = { ...model, rows: [...model.rows.slice(0, header), ...body] };
			break;
		}
	}
	const insert = renderTableMarkdown(next);
	if (view.state.sliceDoc(t.from, t.to) === insert) return;
	// Keep the caret off the table, or it would show as source (see TableWidget).
	const delta = insert.length - (t.to - t.from);
	const after = caretPastTable(view.state, t.from, delta);
	view.dispatch({ changes: { from: t.from, to: t.to, insert }, ...(after !== null ? { selection: { anchor: after } } : {}) });
}

// ── Dispatch ──

export function runPlusCommand(view: EditorView, command: PlusCommand, range?: { from: number; to: number }): void {
	switch (command) {
		case 'copyBlockLink':
			return copyBlockLink(view);
		case 'addReviewComment':
			return addReviewComment(view);
		case 'copyRichText':
			return void copyRichText(view, range);
		case 'openAsTextHere':
			return post({ type: 'plusDo', action: 'openAsText', line: view.state.doc.lineAt(contextPos(view)).number });
		case 'openLinkBeside': {
			const href = (contextTarget()?.closest('[data-href]') as HTMLElement | null)?.dataset.href;
			if (!href) return notify('Right-click a link first.', true);
			return post({ type: 'plusDo', action: 'openBeside', href });
		}
		case 'copyTex': {
			const math = contextTarget()?.closest('[data-mlp-tex]') as HTMLElement | null;
			if (!math) return notify('Right-click a formula first.', true);
			return post({ type: 'plusDo', action: 'copy', text: math.dataset.mlpTex ?? '', notice: 'Copied the TeX.' });
		}
		case 'renumberFootnotes':
			return renumberFootnotes(view);
		default:
			return tableCommand(view, command);
	}
}

/** Keeps the editor root's menu context current and remembers where the menu was opened. */
export function contextMenuExtension(poster: (message: PlusEditorToHostMessage) => void) {
	post = poster;
	return ViewPlugin.fromClass(
		class {
			private key = '';
			private readonly onContextMenu = (event: MouseEvent) => {
				const target = event.target as HTMLElement | null;
				// A rendered table is one widget: coordinates inside it map to its
				// edge, which may be outside the table. Its own start is exact.
				const table = target?.closest?.('.mlp-table-wrap') as HTMLElement | null;
				const pos = table?.dataset.mlpTableFrom
					? Number(table.dataset.mlpTableFrom)
					: (this.view.posAtCoords({ x: event.clientX, y: event.clientY }) ?? this.view.state.selection.main.head);
				last = { target, pos, at: Date.now() };
				this.sync();
			};
			constructor(private readonly view: EditorView) {
				view.dom.addEventListener('contextmenu', this.onContextMenu, true);
				this.sync();
			}
			update(update: ViewUpdate) {
				if (update.selectionSet || update.docChanged) this.sync();
			}
			private sync() {
				const { state } = this.view;
				const context = JSON.stringify({
					mlpEditor: true,
					mlpHasSelection: !state.selection.main.empty,
					mlpHasFootnotes: scanFootnotes(state.doc).defs.size > 0,
				});
				if (context !== this.key) {
					this.key = context;
					this.view.dom.dataset.vscodeContext = context;
				}
			}
			destroy() {
				this.view.dom.removeEventListener('contextmenu', this.onContextMenu, true);
			}
		},
	);
}
