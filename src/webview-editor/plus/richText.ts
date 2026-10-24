import { renderInlineInto } from '../tableCellInline';
import { cellInlineHooks } from '../livePreviewPlugin';
import { insideWikilink } from '../../shared/plusWikilinks';

/**
 * Markdown → HTML for pasting into Word, Google Docs or an e-mail ("Copy as
 * Rich Text"). The tags are the plain semantic ones those programs map to
 * their own styles — h1–h6, p, ul/ol, blockquote, table — with no classes.
 *
 * What only means something inside the vault is reduced to its text: a
 * wikilink to its label, a citation to `[@key]`, a footnote reference to its
 * number, math to its TeX. Notes to the writer (`<!-- … -->`) and block ids are
 * left out.
 */

function clean(root: HTMLElement): void {
	for (const fn of Array.from(root.querySelectorAll('.mlp-fn'))) {
		const sup = document.createElement('sup');
		sup.textContent = fn.querySelector('.mlp-fn-ref')?.textContent ?? '';
		fn.replaceWith(sup);
	}
	for (const m of Array.from(root.querySelectorAll<HTMLElement>('[data-mlp-tex]'))) {
		m.replaceWith(document.createTextNode(`$${m.dataset.mlpTex}$`));
	}
	for (const a of Array.from(root.querySelectorAll('.mlp-wikilink'))) a.replaceWith(document.createTextNode(a.textContent ?? ''));
	for (const g of Array.from(root.querySelectorAll('.mlp-cite-group'))) g.replaceWith(document.createTextNode(g.textContent ?? ''));
	for (const a of Array.from(root.querySelectorAll('a[data-href]'))) {
		const href = a.getAttribute('data-href') ?? '';
		if (/^[a-z][a-z0-9+.-]*:/i.test(href)) a.setAttribute('href', href);
		else a.replaceWith(...Array.from(a.childNodes));
	}
	for (const img of Array.from(root.querySelectorAll('img'))) img.replaceWith(document.createTextNode(img.getAttribute('alt') ?? ''));
	for (const el of Array.from(root.querySelectorAll('*'))) {
		for (const attr of Array.from(el.attributes)) {
			if (attr.name === 'class' || attr.name === 'title' || attr.name.startsWith('data-')) el.removeAttribute(attr.name);
		}
	}
}

function inline(parent: HTMLElement, text: string): void {
	const span = document.createElement('span');
	renderInlineInto(span, text.replace(/\s+\^[A-Za-z0-9][A-Za-z0-9-]*\s*$/, ''), cellInlineHooks);
	clean(span);
	parent.append(...Array.from(span.childNodes));
}

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

const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(?:\[([ xX])\]\s+)?(.*)$/;
const BLOCK_ID_ONLY = /^\s*\^[A-Za-z0-9][A-Za-z0-9-]*\s*$/;

function renderBlocks(parent: HTMLElement, lines: string[]): void {
	const add = <K extends keyof HTMLElementTagNameMap>(tag: K): HTMLElementTagNameMap[K] => {
		const el = document.createElement(tag);
		parent.appendChild(el);
		return el;
	};
	let para: HTMLParagraphElement | null = null;
	for (let i = 0; i < lines.length; ) {
		const line = lines[i];
		if (!line.trim() || BLOCK_ID_ONLY.test(line)) {
			para = null;
			i++;
			continue;
		}
		if (/^\s*<!--/.test(line)) {
			while (i < lines.length && !lines[i].includes('-->')) i++;
			i++;
			para = null;
			continue;
		}
		if (/^\s*(```|~~~)/.test(line)) {
			const fence = line.trim().slice(0, 3);
			let end = i + 1;
			while (end < lines.length && !lines[end].trim().startsWith(fence)) end++;
			const code = document.createElement('code');
			code.textContent = lines.slice(i + 1, end).join('\n');
			add('pre').appendChild(code);
			i = end + 1;
			para = null;
			continue;
		}
		if (/^\s*\$\$/.test(line)) {
			let end = i;
			if (!/\$\$.*\$\$\s*$/.test(line.trim())) {
				end = i + 1;
				while (end < lines.length && !/\$\$\s*$/.test(lines[end])) end++;
			}
			add('p').textContent = lines.slice(i, end + 1).join('\n').trim();
			i = end + 1;
			para = null;
			continue;
		}
		const h = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
		if (h) {
			inline(add(`h${h[1].length}` as 'h1'), h[2]);
			i++;
			para = null;
			continue;
		}
		if (/^\s*>/.test(line)) {
			const body: string[] = [];
			while (i < lines.length && /^\s*>/.test(lines[i])) body.push(lines[i++].replace(/^\s*>[ \t]?/, ''));
			const quote = add('blockquote');
			const head = /^\[!([A-Za-z][\w-]*)\][+-]?\s*(.*)$/.exec(body[0] ?? '');
			if (head) {
				const strong = document.createElement('strong');
				inline(strong, head[2] || head[1].charAt(0).toUpperCase() + head[1].slice(1));
				const p = document.createElement('p');
				p.appendChild(strong);
				quote.appendChild(p);
				body.shift();
			}
			renderBlocks(quote, body);
			para = null;
			continue;
		}
		if (/^\s*\|/.test(line)) {
			const table = add('table');
			table.setAttribute('border', '1');
			table.style.borderCollapse = 'collapse';
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
			para = null;
			continue;
		}
		if (LIST_ITEM.test(line)) {
			const stack: { indent: number; list: HTMLElement }[] = [];
			let lastItem: HTMLElement | null = null;
			while (i < lines.length) {
				const m = LIST_ITEM.exec(lines[i]);
				if (!m) {
					// A continuation line of the item above.
					if (lastItem && /^\s+\S/.test(lines[i]) && !BLOCK_ID_ONLY.test(lines[i])) {
						lastItem.appendChild(document.createElement('br'));
						inline(lastItem, lines[i].trim());
						i++;
						continue;
					}
					break;
				}
				const indent = m[1].length;
				while (stack.length && indent < stack[stack.length - 1].indent) stack.pop();
				if (!stack.length || indent > stack[stack.length - 1].indent) {
					const list = document.createElement(/\d/.test(m[2]) ? 'ol' : 'ul');
					(stack.length && lastItem ? lastItem : parent).appendChild(list);
					stack.push({ indent, list });
				}
				lastItem = document.createElement('li');
				if (m[3]) lastItem.append(m[3] === ' ' ? '☐ ' : '☑ ');
				inline(lastItem, m[4]);
				stack[stack.length - 1].list.appendChild(lastItem);
				i++;
			}
			para = null;
			continue;
		}
		if (!para) para = add('p');
		else para.appendChild(document.createElement('br'));
		inline(para, line.trim());
		i++;
	}
}

export function markdownToHtml(markdown: string): string {
	const root = document.createElement('div');
	renderBlocks(root, markdown.split('\n'));
	return root.innerHTML;
}

/** The text a program receives when it takes only plain text from the clipboard. */
export function htmlToText(html: string): string {
	const root = document.createElement('div');
	root.innerHTML = html.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|h\d|li|tr|blockquote|pre)>/gi, '$&\n');
	for (const cell of Array.from(root.querySelectorAll('td, th'))) cell.append('\t');
	return (root.textContent ?? '').replace(/\t\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
