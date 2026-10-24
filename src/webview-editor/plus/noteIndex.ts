import type { PlusNote } from '../../shared/messages';
import { listNotes } from './hostRequests';
import { splitTarget } from '../../shared/plusWikilinks';

/**
 * Which notes exist, so a wikilink to a missing one can be shown as such (as
 * Obsidian does) instead of looking like every other link until it is clicked.
 *
 * Until the host has answered — or when it reports no notes at all, as outside
 * a workspace — nothing is marked: "unknown" must never read as "missing".
 */

let names: Set<string> | null = null;
let suffixes: Set<string> | null = null;
let signature = '';
const listeners = new Set<() => void>();

const key = (s: string) => s.replace(/\\/g, '/').replace(/\.(md|markdown)$/i, '').toLowerCase();

function build(notes: PlusNote[]): void {
	names = new Set();
	suffixes = new Set();
	for (const note of notes) {
		names.add(note.name.toLowerCase());
		// Every trailing part of the path, so `[[Laws/TH - x]]` matches `vault/Laws/TH - x.md`.
		const parts = key(note.path).split('/');
		for (let i = 0; i < parts.length; i++) suffixes.add(parts.slice(i).join('/'));
	}
}

/** Asks the host for the note list (cached there and here) and notifies when it changed. */
export async function refreshNoteIndex(): Promise<void> {
	const notes = await listNotes();
	if (!notes.length) return;
	const sig = `${notes.length}:${notes.map((n) => n.path).join('|')}`;
	if (sig === signature) return;
	signature = sig;
	build(notes);
	for (const listener of listeners) listener();
}

export function onNoteIndexChange(listener: () => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

/** True only when the index is loaded and the link's note is not in it. */
export function isUnresolved(target: string): boolean {
	if (!names || !suffixes) return false;
	const { name } = splitTarget(target);
	if (!name) return false; // [[#heading]]: this document
	const k = key(name);
	if (/\.[a-z0-9]{1,5}$/i.test(k)) return false; // an attachment: the index holds notes only
	return !names.has(k) && !suffixes.has(k);
}
