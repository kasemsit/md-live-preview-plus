import { EditorView } from '@codemirror/view';
import type { Extension } from '@codemirror/state';
import type { PlusEditorToHostMessage } from '../../shared/messages';

/**
 * Reports the selection to the host, which writes it where a Claude Code hook
 * picks it up. A webview's selection is invisible to VS Code, so without this
 * Claude cannot see what is selected in the preview.
 *
 * The text is the Markdown source of the selection (not the rendered text),
 * with 1-based line numbers, so an edit can be made at exactly that place.
 * Debounced: a drag fires a selection change per pixel.
 */
export function selectionReporter(post: (message: PlusEditorToHostMessage) => void): Extension {
	let timer: ReturnType<typeof setTimeout> | undefined;
	let last = '';
	return EditorView.updateListener.of((update) => {
		if (!update.selectionSet && !update.docChanged) return;
		clearTimeout(timer);
		timer = setTimeout(() => {
			const { state } = update.view;
			const r = state.selection.main;
			const message: PlusEditorToHostMessage = r.empty
				? { type: 'plusSelection', text: '' }
				: {
						type: 'plusSelection',
						text: state.sliceDoc(r.from, r.to),
						from: r.from,
						to: r.to,
						startLine: state.doc.lineAt(r.from).number,
						endLine: state.doc.lineAt(r.to).number,
					};
			const key = JSON.stringify(message);
			if (key === last) return;
			last = key;
			post(message);
		}, 300);
	});
}
