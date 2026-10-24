import * as vscode from 'vscode';

/**
 * Which document changes the preview marks as tracked changes (see
 * webview-editor/plus/trackChanges.ts): a reload from disk — Claude or another
 * program writing the file, a git checkout. A file reloaded from disk is not
 * dirty afterwards and has no undo/redo reason; the user's own typing in a
 * text editor, undo/redo, and edits by other extensions all leave it dirty or
 * carry a reason, and are not marked.
 */
export function isTrackedChange(event: vscode.TextDocumentChangeEvent): boolean {
	if (!vscode.workspace.getConfiguration('mdLivePreview').get('plus.trackExternalChanges', true)) return false;
	return event.reason === undefined && !event.document.isDirty;
}
