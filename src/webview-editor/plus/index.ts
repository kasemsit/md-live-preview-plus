import type { Extension } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import type { EditorToHostMessage, HostToEditorMessage } from '../../shared/messages';
import { wikilinkExtension } from './wikilinks';
import { calloutPlugin } from './callouts';
import { footnotePlugin, insertFootnote } from './footnotes';
import { blockIdPlugin } from './blockIds';
import { commentPlugin } from './comments';
import { citationPlugin } from './citations';
import { mathExtension } from './math';
import { linkPreviewExtension } from './linkPreview';
import { selectionReporter } from './selection';
import { plusCompletion } from './completion';
import { handlePlusReply, setPlusPoster } from './hostRequests';

/**
 * md-live-preview-plus: everything this fork adds to the editor webview, as one
 * extension list and one message handler, so main.ts needs two hooks.
 */
export function plusExtensions(post: (message: EditorToHostMessage) => void): Extension[] {
	setPlusPoster(post);
	return [
		wikilinkExtension((href) => post({ type: 'openLink', href })),
		linkPreviewExtension((href) => post({ type: 'openLink', href })),
		calloutPlugin,
		footnotePlugin,
		blockIdPlugin,
		commentPlugin,
		citationPlugin,
		mathExtension,
		selectionReporter(post),
		plusCompletion,
	];
}

/** Handles a plus message from the host. Returns true when it was one. */
export function handlePlusHostMessage(view: EditorView | undefined, message: HostToEditorMessage): boolean {
	if (handlePlusReply(message)) return true;
	if (message.type === 'plusInsertFootnote') {
		if (view) insertFootnote(view);
		return true;
	}
	return false;
}
