import * as vscode from 'vscode';
import type { EditorToHostMessage, HostToEditorMessage } from '../../shared/messages';
import { hasSessionFor, listAnchors, listNotes, openWikilink, previewWikilink, trackSession as trackWikiSession, type PlusSession } from './wikiOpen';
import { forgetSelectionOf, writeSelection } from './selectionFile';
import { handlePlusDo } from './contextMenu';

export { takePendingJump } from './wikiOpen';

/** Registers an open editor; when the last one on a document closes, its selection stops going to Claude. */
export function trackSession(session: PlusSession): vscode.Disposable {
	const tracked = trackWikiSession(session);
	return new vscode.Disposable(() => {
		tracked.dispose();
		const document = session.getDocument();
		if (!hasSessionFor(document.uri)) void forgetSelectionOf(document);
	});
}

/**
 * Host side of md-live-preview-plus for one editor session: the messages the
 * plus webview modules send. Returns true when the message was one of them.
 */
export function handlePlusMessage(
	session: PlusSession,
	post: (message: HostToEditorMessage) => void,
	message: EditorToHostMessage,
): boolean {
	switch (message.type) {
		case 'plusSelection':
			void writeSelection(session.getDocument(), message);
			return true;
		case 'plusListNotes':
			void listNotes().then((notes) => post({ type: 'plusNotes', requestId: message.requestId, notes }));
			return true;
		case 'plusListAnchors':
			void listAnchors(session, message.target).then((anchors) =>
				post({ type: 'plusAnchors', requestId: message.requestId, anchors }),
			);
			return true;
		case 'plusPreview':
			void previewWikilink(session, message.target).then((preview) =>
				post({ type: 'plusPreviewResult', requestId: message.requestId, preview }),
			);
			return true;
		case 'plusDo':
			void handlePlusDo(session, message);
			return true;
		case 'openLink':
			if (!message.href.startsWith('wiki:')) return false;
			void openWikilink(session, message.href.slice('wiki:'.length));
			return true;
		default:
			return false;
	}
}
