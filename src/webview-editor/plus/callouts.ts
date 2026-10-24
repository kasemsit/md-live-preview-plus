import { Decoration, type DecorationSet, type EditorView, ViewPlugin, type ViewUpdate, WidgetType } from '@codemirror/view';
import type { EditorState, Extension, Range } from '@codemirror/state';
import { syntaxTree, codeFolding, foldEffect, unfoldEffect, foldedRanges } from '@codemirror/language';
import { cursorTouchesRange, blockRevealChanged } from '../cmUtils';
import { blockReplacedLines } from '../livePreviewPlugin';

/**
 * Obsidian callouts: a blockquote whose first line is `> [!type] Title`
 * (`+`/`-` fold markers accepted, not acted on).
 *
 * Every line of the quote gets `mlp-callout mlp-co-<colour>` (plus `-first` /
 * `-last`); on the title line `[!type]` becomes an icon, followed by the type
 * name when no title is given. The raw source shows while the caret is on the
 * title line. Colours and shapes live in media/plus.css.
 *
 * Folding follows Obsidian: `[!type]-` starts folded, `[!type]+` starts open,
 * and either gets a chevron on its title that folds or opens it. The fold is
 * CodeMirror's own (`codeFolding`), so a folded body is skipped by the caret.
 */

// Simple 24x24 stroke icons (stroke = currentColor), drawn for this extension.
const ICONS: Record<string, string> = {
	info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.01"/>',
	warn: '<path d="M12 3 2.5 20h19z"/><path d="M12 10v5M12 17.5v.01"/>',
	danger: '<path d="M8 3h8l5 5v8l-5 5H8l-5-5V8z"/><path d="M12 8v5M12 16v.01"/>',
	ok: '<circle cx="12" cy="12" r="9"/><path d="m8 12.5 2.7 2.7L16.5 9.5"/>',
	fail: '<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/>',
	ask: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .8-1 1.5v.7M12 17v.01"/>',
	tip: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"/>',
	note: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
	list: '<path d="M8 6h12M8 12h12M8 18h12M4 6v.01M4 12v.01M4 18v.01"/>',
	quote: '<path d="M7 7H4v6h3l-1 4M17 7h-3v6h3l-1 4"/>',
};

/** Obsidian's built-in types and aliases → [colour, icon]. Unknown types read as "note". */
export const CALLOUT_TYPES: Record<string, [string, string]> = {
	note: ['blue', 'note'],
	info: ['blue', 'info'],
	todo: ['blue', 'ok'],
	abstract: ['cyan', 'list'],
	summary: ['cyan', 'list'],
	tldr: ['cyan', 'list'],
	tip: ['cyan', 'tip'],
	hint: ['cyan', 'tip'],
	important: ['cyan', 'tip'],
	success: ['green', 'ok'],
	check: ['green', 'ok'],
	done: ['green', 'ok'],
	question: ['yellow', 'ask'],
	help: ['yellow', 'ask'],
	faq: ['yellow', 'ask'],
	warning: ['orange', 'warn'],
	caution: ['orange', 'warn'],
	attention: ['orange', 'warn'],
	failure: ['red', 'fail'],
	fail: ['red', 'fail'],
	missing: ['red', 'fail'],
	danger: ['red', 'danger'],
	error: ['red', 'danger'],
	bug: ['red', 'danger'],
	example: ['purple', 'list'],
	quote: ['gray', 'quote'],
	cite: ['gray', 'quote'],
};

export const CALLOUT_HEAD = /^([ \t]*>[ \t]?)\[!([A-Za-z][\w-]*)\]([+-]?)[ \t]*(.*)$/;

export function calloutStyle(type: string): { colour: string; icon: string } {
	const [colour, icon] = CALLOUT_TYPES[type.toLowerCase()] ?? CALLOUT_TYPES.note;
	return { colour, icon };
}

class CalloutIconWidget extends WidgetType {
	constructor(
		private readonly type: string,
		private readonly label: string,
	) {
		super();
	}
	eq(other: CalloutIconWidget): boolean {
		return other.type === this.type && other.label === this.label;
	}
	toDOM(): HTMLElement {
		const span = document.createElement('span');
		span.className = 'mlp-callout-icon';
		span.innerHTML =
			'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
			ICONS[calloutStyle(this.type).icon] +
			'</svg>';
		if (this.label) {
			const title = document.createElement('span');
			title.className = 'mlp-callout-title';
			title.textContent = this.label;
			span.appendChild(title);
		}
		return span;
	}
	ignoreEvent(): boolean {
		return false;
	}
}

/** The body range a callout folds: from the end of its title line to the end of its last line. */
interface FoldRange {
	from: number;
	to: number;
}

function isFolded(state: EditorState, range: FoldRange): boolean {
	let folded = false;
	foldedRanges(state).between(range.from, range.from, (from) => {
		if (from === range.from) folded = true;
	});
	return folded;
}

function toggleFold(view: EditorView, range: FoldRange): void {
	const { state } = view;
	if (isFolded(state, range)) {
		const effects: ReturnType<typeof unfoldEffect.of>[] = [];
		foldedRanges(state).between(range.from, range.from, (from, to) => {
			if (from === range.from) effects.push(unfoldEffect.of({ from, to }));
		});
		view.dispatch({ effects });
		return;
	}
	// A caret inside the body would vanish into the fold; move it past the callout.
	const sel = state.selection.main;
	const inside = sel.head > range.from && sel.head <= range.to;
	const after = Math.min(range.to + 1, state.doc.length);
	view.dispatch({ effects: foldEffect.of(range), ...(inside ? { selection: { anchor: after } } : {}) });
}

class FoldToggleWidget extends WidgetType {
	constructor(
		private readonly range: FoldRange,
		private readonly folded: boolean,
	) {
		super();
	}
	eq(other: FoldToggleWidget): boolean {
		return other.range.from === this.range.from && other.range.to === this.range.to && other.folded === this.folded;
	}
	toDOM(view: EditorView): HTMLElement {
		const button = document.createElement('span');
		button.className = this.folded ? 'mlp-callout-fold mlp-callout-fold-closed' : 'mlp-callout-fold';
		button.title = this.folded ? 'Open' : 'Fold';
		button.innerHTML =
			'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
		button.addEventListener('mousedown', (event) => {
			if (event.button !== 0) return;
			event.preventDefault();
			event.stopPropagation();
			toggleFold(view, this.range);
		});
		return button;
	}
	ignoreEvent(): boolean {
		return true;
	}
}

function build(view: EditorView, startFolded: FoldRange[]): DecorationSet {
	const { state } = view;
	const { doc } = state;
	const out: Range<Decoration>[] = [];
	const seen = new Set<number>();
	for (const { from, to } of view.visibleRanges) {
		syntaxTree(state).iterate({
			from,
			to,
			enter: (node) => {
				if (node.name !== 'Blockquote') return;
				if (seen.has(node.from)) return false;
				seen.add(node.from);
				const head = doc.lineAt(node.from);
				const m = CALLOUT_HEAD.exec(head.text);
				if (!m) return false;
				const { colour } = calloutStyle(m[2]);
				const last = doc.lineAt(node.to).number;
				const fold: FoldRange | null = m[3] && last > head.number ? { from: head.to, to: doc.line(last).to } : null;
				const folded = fold ? isFolded(state, fold) : false;
				if (fold && m[3] === '-') startFolded.push(fold);
				const replaced = blockReplacedLines(state, node.node);
				for (let n = head.number; n <= (folded ? head.number : last); n++) {
					if (replaced.has(n)) continue;
					let cls = `mlp-callout mlp-co-${colour}`;
					if (n === head.number) cls += ' mlp-callout-first';
					if (n === last || folded) cls += ' mlp-callout-last';
					if (folded) cls += ' mlp-callout-folded';
					out.push(Decoration.line({ class: cls }).range(doc.line(n).from));
				}
				if (!cursorTouchesRange(state, head.from, head.to)) {
					if (fold) out.push(Decoration.widget({ widget: new FoldToggleWidget(fold, folded), side: -1 }).range(head.to));
					const markFrom = head.from + m[1].length;
					const markTo = markFrom + m[2].length + 3 + m[3].length;
					const rest = head.text.slice(markTo - head.from);
					const titleFrom = markTo + (rest.length - rest.trimStart().length);
					const label = m[4].trim() ? '' : m[2].charAt(0).toUpperCase() + m[2].slice(1);
					out.push(Decoration.replace({ widget: new CalloutIconWidget(m[2], label) }).range(markFrom, titleFrom));
					if (titleFrom < head.to) out.push(Decoration.mark({ class: 'mlp-callout-title' }).range(titleFrom, head.to));
				}
				return false;
			},
		});
	}
	return Decoration.set(out, true);
}

const calloutDecorations = ViewPlugin.fromClass(
	class {
		decorations: DecorationSet;
		// Title-line ends of `[!type]-` callouts already folded once, so one the
		// user opened is not folded again on the next rebuild.
		private initiallyFolded = new Set<number>();
		constructor(private readonly view: EditorView) {
			this.decorations = this.rebuild();
		}
		update(update: ViewUpdate) {
			if (update.docChanged) {
				this.initiallyFolded = new Set([...this.initiallyFolded].map((p) => update.changes.mapPos(p)));
			}
			if (
				update.docChanged ||
				update.viewportChanged ||
				update.selectionSet ||
				update.transactions.some((tr) =>
					tr.effects.some((e) => e.is(blockRevealChanged) || e.is(foldEffect) || e.is(unfoldEffect)),
				)
			) {
				this.decorations = this.rebuild();
			}
		}
		private rebuild(): DecorationSet {
			const startFolded: FoldRange[] = [];
			const decorations = build(this.view, startFolded);
			const fresh = startFolded.filter((r) => !this.initiallyFolded.has(r.from));
			if (fresh.length) {
				for (const r of fresh) this.initiallyFolded.add(r.from);
				// Not allowed while the view is updating; run right after.
				queueMicrotask(() => this.view.dispatch({ effects: fresh.map((r) => foldEffect.of(r)) }));
			}
			return decorations;
		}
	},
	{ decorations: (v) => v.decorations },
);

const foldPlaceholder = codeFolding({
	placeholderDOM: () => {
		const span = document.createElement('span');
		span.className = 'mlp-callout-fold-placeholder';
		return span;
	},
});

export const calloutPlugin: Extension = [foldPlaceholder, calloutDecorations];
