import type { HostToEditorMessage, PlusAnchor, PlusEditorToHostMessage, PlusNote, PlusPreview } from '../../shared/messages';

/**
 * Request/reply over the webview message channel, for the lists completion
 * needs from the host (the webview cannot read the workspace itself).
 */

type Poster = (message: PlusEditorToHostMessage) => void;

let post: Poster = () => undefined;
let nextId = 1;
const waiting = new Map<number, (value: unknown) => void>();

export function setPlusPoster(poster: Poster): void {
	post = poster;
}

/** Resolves with the host's reply, or with `fallback` if none comes within `timeoutMs`. */
function request<T>(build: (requestId: number) => PlusEditorToHostMessage, fallback: T, timeoutMs = 4000): Promise<T> {
	const requestId = nextId++;
	return new Promise<T>((resolve) => {
		const timer = setTimeout(() => {
			waiting.delete(requestId);
			resolve(fallback);
		}, timeoutMs);
		waiting.set(requestId, (value) => {
			clearTimeout(timer);
			resolve(value as T);
		});
		post(build(requestId));
	});
}

let notesCache: { at: number; notes: Promise<PlusNote[]> } | null = null;
const NOTES_TTL_MS = 30_000;

/** Every note in the workspace, cached for half a minute so each keystroke does not rescan it. */
export function listNotes(): Promise<PlusNote[]> {
	if (!notesCache || Date.now() - notesCache.at > NOTES_TTL_MS) {
		const entry = {
			at: Date.now(),
			// A big workspace's first scan can outlast the timeout; an empty answer
			// is then not cached, so the next keystroke asks again.
			notes: request<PlusNote[] | null>((requestId) => ({ type: 'plusListNotes', requestId }), null, 10_000).then((notes) => {
				if (notes === null && notesCache === entry) notesCache = null;
				return notes ?? [];
			}),
		};
		notesCache = entry;
	}
	return notesCache.notes;
}

export function listAnchors(target: string): Promise<PlusAnchor[]> {
	return request<PlusAnchor[]>((requestId) => ({ type: 'plusListAnchors', requestId, target }), []);
}

export function previewLink(target: string): Promise<PlusPreview | null> {
	return request<PlusPreview | null>((requestId) => ({ type: 'plusPreview', requestId, target }), null);
}

/** Routes a host reply to its request. Returns true when the message was one. */
export function handlePlusReply(message: HostToEditorMessage): boolean {
	if (message.type === 'plusNotes' || message.type === 'plusAnchors' || message.type === 'plusPreviewResult') {
		const resolve = waiting.get(message.requestId);
		waiting.delete(message.requestId);
		resolve?.(message.type === 'plusNotes' ? message.notes : message.type === 'plusAnchors' ? message.anchors : message.preview);
		return true;
	}
	return false;
}
