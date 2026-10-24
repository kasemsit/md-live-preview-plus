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
import { underlineExtension } from './underline';
import { embedPlugin } from './embeds';
import { spacingPlugin } from './spacing';
import { reapplyTextScale, setTextScale } from './textScale';
import { linkPreviewExtension } from './linkPreview';
import { selectionReporter } from './selection';
import { plusCompletion } from './completion';
import { handlePlusReply, setPlusPoster } from './hostRequests';
import { contextMenuExtension, runPlusCommand } from './contextMenu';

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
		underlineExtension,
		embedPlugin,
		spacingPlugin,
		selectionReporter(post),
		contextMenuExtension(post),
		plusCompletion,
	];
}

/** Handles a plus message from the host. Returns true when it was one. */
export function handlePlusHostMessage(view: EditorView | undefined, message: HostToEditorMessage): boolean {
	if (handlePlusReply(message)) return true;
	if (message.type === 'plusTextScale') {
		setTextScale(view, message.scale);
		return true;
	}
	// Not ours, but a new document or theme changes the size the text scale multiplies.
	if (message.type === 'init' || message.type === 'applyCss') reapplyTextScale();
	if (message.type === 'plusRun') {
		if (view) runPlusCommand(view, message.command, message.range);
		return true;
	}
	if (message.type === 'plusInsertFootnote') {
		if (view) insertFootnote(view);
		return true;
	}
	return false;
}
