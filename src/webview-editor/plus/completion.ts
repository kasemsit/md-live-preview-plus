import {
	autocompletion,
	type Completion,
	type CompletionContext,
	type CompletionResult,
	type CompletionSource,
} from '@codemirror/autocomplete';
import type { EditorState, Extension } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import type { PlusAnchor, PlusNote } from '../../shared/messages';
import { listAnchors, listNotes } from './hostRequests';
import { insertFootnote, scanFootnotes } from './footnotes';
import { anchorsInText } from '../../shared/plusAnchors';

/**
 * Completion for what Obsidian completes: note names after `[[`, headings and
 * block ids after `[[note#` / `[[note#^`, and footnote labels after `[^`.
 */

/** Inserts `text`, then `close` unless the next characters already are `close` (closeBrackets put them there). */
function applyClosing(text: string, close: string) {
	return (view: EditorView, _c: Completion, from: number, to: number) => {
		const after = view.state.sliceDoc(to, to + close.length);
		const insert = after === close ? text : text + close;
		view.dispatch({
			changes: { from, to, insert },
			selection: { anchor: from + text.length + close.length },
		});
	};
}

/**
 * What to write for each note: its bare name where that is unique in the
 * workspace, its path otherwise — the "shortest path when possible" rule
 * Obsidian uses, so links stay short and still resolve to one file.
 */
export function linkTexts(notes: PlusNote[]): string[] {
	const count = new Map<string, number>();
	for (const n of notes) count.set(n.name.toLowerCase(), (count.get(n.name.toLowerCase()) ?? 0) + 1);
	return notes.map((n) => (count.get(n.name.toLowerCase())! > 1 ? n.path.replace(/\.(md|markdown)$/i, '') : n.name));
}

const noteSource: CompletionSource = async (context: CompletionContext): Promise<CompletionResult | null> => {
	const m = context.matchBefore(/\[\[[^[\]|#\n]*$/);
	if (!m) return null;
	const notes = await listNotes();
	if (context.aborted || !notes.length) return null;
	const texts = linkTexts(notes);
	return {
		from: m.from + 2,
		validFor: /^[^[\]|#\n]*$/,
		options: notes.map((note, i) => {
			const folder = note.path.includes('/') ? note.path.slice(0, note.path.lastIndexOf('/')) : '';
			return { label: note.name, detail: folder, apply: applyClosing(texts[i], ']]'), type: 'text' };
		}),
	};
};

/** Headings and block ids of the document being edited, without a round trip to the host. */
export function anchorsOf(state: EditorState): PlusAnchor[] {
	return anchorsInText(state.doc.toString());
}

const anchorSource: CompletionSource = async (context: CompletionContext): Promise<CompletionResult | null> => {
	const m = context.matchBefore(/\[\[([^[\]|#\n]*)#(\^?)[^[\]|#\n]*$/);
	if (!m) return null;
	const parts = /\[\[([^[\]|#\n]*)#(\^?)/.exec(m.text)!;
	const target = parts[1].trim();
	const blocksOnly = parts[2] === '^';
	const anchors = target ? await listAnchors(target) : anchorsOf(context.state);
	if (context.aborted) return null;
	const from = m.from + parts[0].length - parts[2].length;
	const options: Completion[] = anchors
		.filter((a) => !blocksOnly || a.kind === 'block')
		.map((a) =>
			a.kind === 'heading'
				? { label: a.text, detail: '#'.repeat(a.level ?? 1), apply: applyClosing(a.text, ']]'), type: 'keyword' }
				: { label: `^${a.text}`, detail: 'block', apply: applyClosing(`^${a.text}`, ']]'), type: 'constant' },
		);
	return options.length ? { from, validFor: /^\^?[^[\]|#\n]*$/, options } : null;
};

const footnoteSource = (context: CompletionContext): CompletionResult | null => {
	const m = context.matchBefore(/\[\^[^\]\s]*$/);
	if (!m) return null;
	const scan = scanFootnotes(context.state.doc);
	const options: Completion[] = [...scan.defs.entries()].map(([label, def]) => ({
		label,
		detail: def.text.length > 60 ? `${def.text.slice(0, 60)}…` : def.text,
		apply: applyClosing(label, ']'),
		type: 'variable',
	}));
	options.push({
		label: 'new footnote',
		detail: 'add [^n] here and its note at the end',
		boost: -1,
		type: 'function',
		apply: (view, _c, _from, to) => {
			// Drop the "[^…" typed so far (and the "]" closeBrackets added), then insert properly.
			const close = view.state.sliceDoc(to, to + 1) === ']' ? 1 : 0;
			view.dispatch({ changes: { from: m.from, to: to + close, insert: '' } });
			insertFootnote(view);
		},
	});
	return { from: m.from + 2, validFor: /^[^\]\s]*$/, options };
};

export const plusCompletion: Extension = autocompletion({
	override: [noteSource, anchorSource, footnoteSource],
	icons: false,
});
