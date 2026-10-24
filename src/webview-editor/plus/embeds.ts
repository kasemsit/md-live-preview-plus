import { Decoration, type DecorationSet, type EditorView, ViewPlugin, type ViewUpdate, WidgetType } from '@codemirror/view';
import type { Range } from '@codemirror/state';
import { cursorTouchesRange, blockRevealChanged } from '../cmUtils';
import { inSourceContext } from './wikilinks';
import { resolveEmbed } from './hostRequests';

/**
 * Obsidian image embeds: `![[name.png]]`, `![[name.png|300]]` (width) or
 * `![[name.png|300x200]]`. The file is found by name anywhere in the workspace
 * — Obsidian keeps attachments in their own folder — by the host, which hands
 * back a URI the webview may load. The source shows while the caret is on the
 * line; clicking the image puts the caret there.
 */

export const IMAGE_EMBED = /!\[\[([^[\]|\n]+?\.(?:png|jpe?g|gif|svg|webp|bmp|avif))(?:\|([^[\]\n]*))?\]\]/gi;

class EmbedImageWidget extends WidgetType {
	constructor(
		private readonly target: string,
		private readonly size: string,
	) {
		super();
	}
	eq(other: EmbedImageWidget): boolean {
		return other.target === this.target && other.size === this.size;
	}
	toDOM(view: EditorView): HTMLElement {
		const wrap = document.createElement('span');
		wrap.className = 'mlp-embed mlp-embed-loading';
		const img = document.createElement('img');
		img.className = 'mlp-image mlp-embed-image';
		const dims = /^\s*(\d+)(?:\s*x\s*(\d+))?\s*$/.exec(this.size);
		if (dims) {
			img.style.width = `${dims[1]}px`;
			if (dims[2]) img.style.height = `${dims[2]}px`;
		}
		img.alt = dims || !this.size ? this.target : this.size;
		const remeasure = () => view.requestMeasure();
		img.addEventListener('load', () => {
			wrap.classList.remove('mlp-embed-loading');
			remeasure();
		});
		img.addEventListener('error', () => {
			wrap.className = 'mlp-embed mlp-embed-missing';
			wrap.textContent = `${this.target} could not be loaded`;
			remeasure();
		});
		wrap.appendChild(img);
		void resolveEmbed(this.target).then((src) => {
			if (src) img.src = src;
			else {
				wrap.className = 'mlp-embed mlp-embed-missing';
				wrap.textContent = `${this.target} not found in the workspace`;
				remeasure();
			}
		});
		return wrap;
	}
	ignoreEvent(): boolean {
		// Let a click place the caret, which shows the source (as for ![](…) images).
		return false;
	}
}

function build(view: EditorView): DecorationSet {
	const { state } = view;
	const out: Range<Decoration>[] = [];
	for (const { from, to } of view.visibleRanges) {
		for (let pos = from; pos <= to; ) {
			const line = state.doc.lineAt(pos);
			pos = line.to + 1;
			if (!line.text.includes('![[') || cursorTouchesRange(state, line.from, line.to)) continue;
			for (const m of line.text.matchAll(IMAGE_EMBED)) {
				const s = line.from + m.index!;
				if (inSourceContext(state, s)) continue;
				const widget = new EmbedImageWidget(m[1].trim(), (m[2] ?? '').trim());
				out.push(Decoration.replace({ widget }).range(s, s + m[0].length));
			}
		}
	}
	return Decoration.set(out, true);
}

export const embedPlugin = ViewPlugin.fromClass(
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
