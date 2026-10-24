import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { PlusEditorToHostMessage } from '../../shared/messages';

/**
 * Writes the preview's selection to ~/.claude/live-preview-selection.json,
 * where the UserPromptSubmit hook in plus/hooks/ reads it and hands it to
 * Claude Code. A webview's selection is invisible to VS Code itself, so this
 * file is the only way Claude can see it.
 *
 * A dirty document is saved first, so the line numbers sent match the file on
 * disk that Claude will edit. Nothing is written when ~/.claude does not exist
 * (Claude Code is not installed) or when the setting is off.
 */
export async function writeSelection(
	document: vscode.TextDocument,
	message: Extract<PlusEditorToHostMessage, { type: 'plusSelection' }>,
): Promise<void> {
	if (!vscode.workspace.getConfiguration('mdLivePreview').get('plus.shareSelectionWithClaude', true)) return;
	const dir = path.join(os.homedir(), '.claude');
	if (!fs.existsSync(dir)) return;
	if (message.text && document.isDirty) {
		try {
			await document.save();
		} catch {
			// unsaved: the file says so below
		}
	}
	const record = {
		file: document.uri.fsPath,
		text: message.text,
		startLine: message.startLine,
		endLine: message.endLine,
		from: message.from,
		to: message.to,
		docVersion: document.version,
		time: Date.now(),
		dirty: document.isDirty,
	};
	try {
		await fs.promises.writeFile(path.join(dir, 'live-preview-selection.json'), JSON.stringify(record));
	} catch {
		// best effort: a failed write only means Claude does not see this selection
	}
}
