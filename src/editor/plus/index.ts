import type { EditorToHostMessage, HostToEditorMessage } from '../../shared/messages';
import { listAnchors, listNotes, openWikilink, type PlusSession } from './wikiOpen';
import { writeSelection } from './selectionFile';

export { trackSession, takePendingJump } from './wikiOpen';

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
		case 'openLink':
			if (!message.href.startsWith('wiki:')) return false;
			void openWikilink(session, message.href.slice('wiki:'.length));
			return true;
		default:
			return false;
	}
}
