import { Decoration, type DecorationSet, EditorView, showPanel, type Panel, WidgetType } from '@codemirror/view';
import { ChangeSet, StateEffect, StateField, type Extension, type Range, type Text } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import type { SyntaxNode } from '@lezer/common';
import type { TextChange } from '../../shared/messages';
import { diffWords } from '../../shared/plusDiff';
import { isBlockRevealed, setBlockRevealed, blockRevealChanged } from '../cmUtils';

/**
 * Tracked changes: when the file changes on disk while it is open — Claude
 * editing it, a git checkout, another program — the preview shows what
 * changed, word by word, on the rendered page: insertions in green, deletions
 * struck through in red, each with ✓ (keep) and ✗ (undo it), and a bar with
 * the count, Next, Accept all and Reject all.
 *
 * The host says which updates to track (`plusTrackNext`, see documentSync.ts):
 * a reload from disk, not the user's own typing elsewhere, not undo/redo.
 * Rejecting is an ordinary edit, so it reaches the file and can be undone.
 * Nothing is stored: closing the preview forgets the marks.
 */

interface Hunk {
	id: number;
	from: number;
	to: number;
	deleted: string;
}

let nextId = 1;
const addHunks = StateEffect.define<Hunk[]>();
const removeHunks = StateEffect.define<number[] | 'all'>();

const hunksField = StateField.define<Hunk[]>({
	create: () => [],
	update(hunks, tr) {
		let out = hunks;
		if (tr.docChanged && out.length) {
			out = out
				.map((h) => {
					const from = tr.changes.mapPos(h.from, h.to > h.from ? 1 : -1);
					const to = Math.max(from, tr.changes.mapPos(h.to, -1));
					return { ...h, from, to };
				})
				// A hunk whose insertion was edited away and that deleted nothing is gone.
				.filter((h) => h.to > h.from || h.deleted);
		}
		for (const e of tr.effects) {
			if (e.is(addHunks)) out = [...out, ...e.value].sort((a, b) => a.from - b.from);
			else if (e.is(removeHunks)) out = e.value === 'all' ? [] : out.filter((h) => !(e.value as number[]).includes(h.id));
		}
		return out;
	},
});

class DeletedWidget extends WidgetType {
	constructor(private readonly text: string) {
		super();
	}
	eq(other: DeletedWidget): boolean {
		return other.text === this.text;
	}
	toDOM(): HTMLElement {
		const span = document.createElement('span');
		span.className = 'mlp-track-del';
		span.textContent = this.text;
		return span;
	}
}

class HunkControls extends WidgetType {
	constructor(private readonly id: number) {
		super();
	}
	eq(other: HunkControls): boolean {
		return other.id === this.id;
	}
	toDOM(view: EditorView): HTMLElement {
		const wrap = document.createElement('span');
		wrap.className = 'mlp-track-controls';
		const button = (label: string, title: string, run: () => void) => {
			const b = document.createElement('button');
			b.type = 'button';
			b.textContent = label;
			b.title = title;
			b.addEventListener('mousedown', (event) => {
				event.preventDefault();
				event.stopPropagation();
				run();
			});
			wrap.appendChild(b);
		};
		button('✓', 'Keep this change', () => view.dispatch({ effects: removeHunks.of([this.id]) }));
		button('✗', 'Undo this change', () => rejectHunks(view, [this.id]));
		return wrap;
	}
	ignoreEvent(): boolean {
		return true;
	}
}

const insertedMark = Decoration.mark({ class: 'mlp-track-ins' });

const decorations = EditorView.decorations.compute([hunksField], (state) => {
	const out: Range<Decoration>[] = [];
	for (const h of state.field(hunksField)) {
		if (h.deleted) out.push(Decoration.widget({ widget: new DeletedWidget(h.deleted), side: -1 }).range(h.from));
		if (h.to > h.from) out.push(insertedMark.range(h.from, h.to));
		out.push(Decoration.widget({ widget: new HunkControls(h.id), side: 1 }).range(h.to));
	}
	return Decoration.set(out, true);
});

function rejectHunks(view: EditorView, ids: number[] | 'all'): void {
	const hunks = view.state.field(hunksField).filter((h) => ids === 'all' || ids.includes(h.id));
	if (!hunks.length) return;
	view.dispatch({
		changes: hunks.map((h) => ({ from: h.from, to: h.to, insert: h.deleted })),
		effects: removeHunks.of(hunks.map((h) => h.id)),
	});
}

function nextHunk(view: EditorView): void {
	const hunks = view.state.field(hunksField);
	if (!hunks.length) return;
	const head = view.state.selection.main.head;
	const target = hunks.find((h) => h.from > head) ?? hunks[0];
	view.dispatch({ selection: { anchor: target.from }, effects: EditorView.scrollIntoView(target.from, { y: 'center' }) });
	view.focus();
}

function bar(view: EditorView): Panel {
	const dom = document.createElement('div');
	dom.className = 'mlp-track-bar';
	const label = document.createElement('span');
	label.className = 'mlp-track-bar-label';
	dom.appendChild(label);
	const button = (text: string, title: string, run: () => void) => {
		const b = document.createElement('button');
		b.type = 'button';
		b.textContent = text;
		b.title = title;
		b.addEventListener('mousedown', (event) => {
			event.preventDefault();
			run();
		});
		dom.appendChild(b);
	};
	button('Next', 'Go to the next change', () => nextHunk(view));
	button('Accept all', 'Keep every change', () => view.dispatch({ effects: removeHunks.of('all') }));
	button('Reject all', 'Undo every change', () => rejectHunks(view, 'all'));
	const sync = () => {
		const n = view.state.field(hunksField).length;
		label.textContent = `${n} change${n === 1 ? '' : 's'} from outside the editor`;
	};
	sync();
	return { dom, top: true, update: sync };
}

const panel = showPanel.compute([hunksField], (state) => (state.field(hunksField).length ? bar : null));

export const trackChangesExtension: Extension = [hunksField, decorations, panel];

// ── Turning a tracked update into hunks ──

let trackNext = false;

/** The host says the next `externalUpdate` came from disk and should be shown. */
export function trackNextUpdate(): void {
	trackNext = true;
}

/**
 * Called before the editor applies an `externalUpdate`; when it is to be
 * tracked, diffs each changed region once the update has landed.
 */
export function beforeExternalUpdate(view: EditorView | undefined, changes: TextChange[]): void {
	if (!trackNext || !view) return;
	trackNext = false;
	const before: Text = view.state.doc;
	queueMicrotask(() => {
		const set = ChangeSet.of(changes, before.length);
		const hunks: Hunk[] = [];
		for (const c of changes) {
			const start = set.mapPos(c.from, -1);
			for (const d of diffWords(before.sliceString(c.from, c.to), c.insert)) {
				hunks.push({ id: nextId++, from: start + d.from, to: start + d.to, deleted: d.deleted });
			}
		}
		if (!hunks.length) return;
		// A change inside a rendered table would be hidden by the table widget:
		// show such tables as source until the changes are dealt with.
		let revealed = false;
		for (const h of hunks) {
			for (let n: SyntaxNode | null = syntaxTree(view.state).resolveInner(h.from, 1); n; n = n.parent) {
				if (n.name !== 'Table') continue;
				const lineFrom = view.state.doc.lineAt(n.from).from;
				if (!isBlockRevealed(lineFrom)) {
					setBlockRevealed(lineFrom, true);
					revealed = true;
				}
				break;
			}
		}
		view.dispatch({ effects: revealed ? [addHunks.of(hunks), blockRevealChanged.of(null)] : addHunks.of(hunks) });
	});
}
