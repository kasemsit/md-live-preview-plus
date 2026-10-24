import { type EditorView, ViewPlugin } from '@codemirror/view';
import type { Extension } from '@codemirror/state';
import type { PlusPreview } from '../../shared/messages';
import { renderInlineInto } from '../tableCellInline';
import { cellInlineHooks } from '../livePreviewPlugin';
import { previewLink } from './hostRequests';
import { insideWikilink } from '../../shared/plusWikilinks';
import { calloutStyle } from './callouts';

/**
 * Hover preview for wikilinks, like Obsidian's page preview: resting the
 * pointer on `[[note#^ma-32]]` shows that block — for a heading, its whole
 * section — in a card, without leaving the note. The card stays open while the
 * pointer is on it, so a long section can be scrolled; its title opens the note.
 */

const SHOW_DELAY_MS = 350;
const HIDE_DELAY_MS = 250;
const CACHE_MS = 15_000;

const inline = (el: HTMLElement, text: string) => renderInlineInto(el, text, cellInlineHooks);

function splitRow(row: string): string[] {
	const inLink = insideWikilink(row);
	const cells: string[] = [];
	let cell = '';
	let escaped = false;
	for (let i = 0; i < row.length; i++) {
		const ch = row[i];
		if (ch === '|' && !escaped && !inLink(i)) {
			cells.push(cell);
			cell = '';
		} else cell += ch;
		escaped = !escaped && ch === '\\';
	}
	cells.push(cell);
	if (cells.length > 1 && !cells[0].trim()) cells.shift();
	if (cells.length > 1 && !cells[cells.length - 1].trim()) cells.pop();
	return cells.map((c) => c.trim());
}

/**
 * A small block renderer for the card: headings, paragraphs (line breaks kept,
 * as Obsidian shows them), lists, quotes and callouts, tables and code. Inline
 * Markdown goes through the same renderer table cells use.
 */
export function renderMarkdownBlocks(parent: HTMLElement, text: string): void {
	const lines = text.split('\n');
	let para: HTMLElement | null = null;
	const add = (tag: string, cls: string) => {
		const el = document.createElement(tag);
		el.className = cls;
		parent.appendChild(el);
		para = null;
		return el;
	};
	for (let i = 0; i < lines.length; ) {
		const line = lines[i];
		if (/^\s*(```|~~~)/.test(line)) {
			const fence = line.trim().slice(0, 3);
			let end = i + 1;
			while (end < lines.length && !lines[end].trim().startsWith(fence)) end++;
			add('pre', 'mlp-lp-code').textContent = lines.slice(i + 1, end).join('\n');
			i = end + 1;
			continue;
		}
		if (!line.trim()) {
			para = null;
			i++;
			continue;
		}
		const h = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
		if (h) {
			inline(add('div', `mlp-lp-h mlp-lp-h${h[1].length}`), h[2]);
			i++;
			continue;
		}
		if (/^\s*>/.test(line)) {
			const body: string[] = [];
			while (i < lines.length && /^\s*>/.test(lines[i])) body.push(lines[i++].replace(/^\s*>[ \t]?/, ''));
			const box = add('div', 'mlp-lp-quote');
			const head = /^\[!([A-Za-z][\w-]*)\][+-]?\s*(.*)$/.exec(body[0] ?? '');
			if (head) {
				box.classList.add('mlp-lp-callout', `mlp-co-${calloutStyle(head[1]).colour}`);
				const title = document.createElement('div');
				title.className = 'mlp-lp-callout-title';
				inline(title, head[2] || head[1].charAt(0).toUpperCase() + head[1].slice(1));
				box.appendChild(title);
				body.shift();
			}
			renderMarkdownBlocks(box, body.join('\n'));
			continue;
		}
		if (/^\s*\|/.test(line)) {
			const table = add('table', 'mlp-lp-table') as HTMLTableElement;
			let first = true;
			while (i < lines.length && /^\s*\|/.test(lines[i])) {
				const row = lines[i++];
				if (/^\s*\|?(\s*:?-+:?\s*\|)+(\s*:?-+:?\s*)?\s*$/.test(row)) continue;
				const tr = table.insertRow();
				for (const cell of splitRow(row.trim())) {
					const td = document.createElement(first ? 'th' : 'td');
					inline(td, cell);
					tr.appendChild(td);
				}
				first = false;
			}
			continue;
		}
		const li = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line);
		if (li) {
			const item = add('div', 'mlp-lp-li');
			item.style.paddingLeft = `${1.1 + li[1].length * 0.5}em`;
			const mark = document.createElement('span');
			mark.className = 'mlp-lp-li-mark';
			mark.textContent = /\d/.test(li[2]) ? li[2] : '•';
			item.appendChild(mark);
			const content = document.createElement('span');
			inline(content, li[3]);
			item.appendChild(content);
			i++;
			continue;
		}
		if (!para) para = add('p', 'mlp-lp-p');
		else para.appendChild(document.createElement('br'));
		const span = document.createElement('span');
		inline(span, line.trim());
		(para as HTMLElement).appendChild(span);
		i++;
	}
}

const STATUS_NOTE: Record<PlusPreview['status'], string> = {
	ok: '',
	missing: 'No note by this name in the workspace.',
	'anchor-missing': 'Heading or block not found; showing the start of the note.',
	'not-markdown': '',
};

export function linkPreviewExtension(onOpen: (href: string) => void): Extension {
	return ViewPlugin.fromClass(
		class {
			private card: HTMLElement | null = null;
			private shownHref = '';
			private hovered: HTMLElement | null = null;
			private showTimer: ReturnType<typeof setTimeout> | undefined;
			private hideTimer: ReturnType<typeof setTimeout> | undefined;
			private readonly cache = new Map<string, { at: number; preview: PlusPreview }>();

			private readonly onOver = (event: MouseEvent) => {
				const link = (event.target as HTMLElement | null)?.closest?.('.mlp-wikilink') as HTMLElement | null;
				if (!link || link.closest('.mlp-fn-pop')) return;
				clearTimeout(this.hideTimer);
				this.hovered = link;
				if (this.card && link.dataset.href === this.shownHref) return;
				clearTimeout(this.showTimer);
				this.showTimer = setTimeout(() => void this.open(link), SHOW_DELAY_MS);
			};
			private readonly onOut = (event: MouseEvent) => {
				const link = (event.target as HTMLElement | null)?.closest?.('.mlp-wikilink');
				if (!link || link.contains(event.relatedTarget as Node | null)) return;
				this.hovered = null;
				clearTimeout(this.showTimer);
				this.scheduleHide();
			};
			private readonly onPress = (event: MouseEvent) => {
				if (this.card && !this.card.contains(event.target as Node)) this.hide();
			};
			private readonly onScroll = () => this.hide();

			constructor(private readonly view: EditorView) {
				view.dom.addEventListener('mouseover', this.onOver);
				view.dom.addEventListener('mouseout', this.onOut);
				view.scrollDOM.addEventListener('scroll', this.onScroll, { passive: true });
				document.addEventListener('mousedown', this.onPress, true);
			}

			private scheduleHide() {
				clearTimeout(this.hideTimer);
				this.hideTimer = setTimeout(() => this.hide(), HIDE_DELAY_MS);
			}

			private hide() {
				clearTimeout(this.showTimer);
				clearTimeout(this.hideTimer);
				this.card?.remove();
				this.card = null;
				this.shownHref = '';
			}

			private async fetch(target: string): Promise<PlusPreview | null> {
				const hit = this.cache.get(target);
				if (hit && Date.now() - hit.at < CACHE_MS) return hit.preview;
				const preview = await previewLink(target);
				if (preview) this.cache.set(target, { at: Date.now(), preview });
				return preview;
			}

			private async open(link: HTMLElement) {
				const href = link.dataset.href ?? '';
				if (!href.startsWith('wiki:')) return;
				const preview = await this.fetch(href.slice('wiki:'.length));
				// The pointer moved on while the host was reading the file.
				if (!preview || this.hovered !== link || !link.isConnected) return;
				this.hide();
				const card = this.render(href, preview);
				document.body.appendChild(card);
				this.card = card;
				this.shownHref = href;
				this.place(card, link);
			}

			private render(href: string, preview: PlusPreview): HTMLElement {
				const card = document.createElement('div');
				card.className = `mlp-link-preview mlp-lp-${preview.status}`;
				const title = document.createElement('div');
				title.className = 'mlp-lp-title';
				title.textContent = preview.title;
				title.title = 'Open';
				title.addEventListener('mousedown', (event) => {
					if (event.button !== 0) return;
					event.preventDefault();
					this.hide();
					onOpen(href);
				});
				card.appendChild(title);
				if (STATUS_NOTE[preview.status]) {
					const note = document.createElement('div');
					note.className = 'mlp-lp-status';
					note.textContent = STATUS_NOTE[preview.status];
					card.appendChild(note);
				}
				const body = document.createElement('div');
				body.className = 'mlp-lp-body';
				if (preview.status === 'not-markdown') body.textContent = preview.text;
				else renderMarkdownBlocks(body, preview.text);
				if (preview.truncated) {
					const more = document.createElement('div');
					more.className = 'mlp-lp-more';
					more.textContent = '…';
					body.appendChild(more);
				}
				if (body.childNodes.length) card.appendChild(body);
				// Links inside the card open too.
				body.addEventListener('mousedown', (event) => {
					const inner = (event.target as HTMLElement).closest('.mlp-wikilink') as HTMLElement | null;
					if (!inner || event.button !== 0) return;
					event.preventDefault();
					this.hide();
					onOpen(inner.dataset.href ?? '');
				});
				card.addEventListener('mouseenter', () => clearTimeout(this.hideTimer));
				card.addEventListener('mouseleave', () => this.scheduleHide());
				return card;
			}

			private place(card: HTMLElement, link: HTMLElement) {
				const r = link.getBoundingClientRect();
				const vw = document.documentElement.clientWidth;
				const vh = document.documentElement.clientHeight;
				const w = card.offsetWidth;
				const h = card.offsetHeight;
				card.style.left = `${Math.max(8, Math.min(r.left, vw - w - 8))}px`;
				const below = r.bottom + 6;
				card.style.top = `${below + h <= vh - 8 || r.top - h - 6 < 8 ? below : r.top - h - 6}px`;
			}

			destroy() {
				this.hide();
				this.view.dom.removeEventListener('mouseover', this.onOver);
				this.view.dom.removeEventListener('mouseout', this.onOut);
				this.view.scrollDOM.removeEventListener('scroll', this.onScroll);
				document.removeEventListener('mousedown', this.onPress, true);
			}
		},
	);
}
