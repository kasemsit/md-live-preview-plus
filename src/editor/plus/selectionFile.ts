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
 *
 * A status bar item shows what Claude will be given with the next prompt;
 * clicking it stops sending. Selecting text in an ordinary editor also stops
 * it, since that selection is the newer one and Claude Code attaches it itself.
 */

const MAX_AGE_MS = 30 * 60 * 1000; // the hook ignores older selections
const CLEAR_COMMAND = 'mdLivePreview.plus.clearClaudeSelection';

const dir = () => path.join(os.homedir(), '.claude');
const file = () => path.join(dir(), 'live-preview-selection.json');

let status: vscode.StatusBarItem | undefined;
let expiry: ReturnType<typeof setTimeout> | undefined;
let showing = false;

function showStatus(fsPath: string, text: string, startLine?: number, endLine?: number): void {
	if (!status) return;
	clearTimeout(expiry);
	if (!text) {
		status.hide();
		showing = false;
		return;
	}
	const name = path.basename(fsPath);
	const where = startLine ? (startLine === endLine ? `${name}:${startLine}` : `${name}:${startLine}–${endLine}`) : name;
	status.text = `$(comment-discussion) Claude: ${where}`;
	status.tooltip = new vscode.MarkdownString(
		`The text selected in the Live Preview goes to Claude Code with your next prompt.\n\n` +
			`\`${fsPath}\`${startLine ? `, lines ${startLine}–${endLine}` : ''}\n\nClick to stop sending it.`,
	);
	status.show();
	showing = true;
	expiry = setTimeout(() => {
		status?.hide();
		showing = false;
	}, MAX_AGE_MS);
}

async function writeRecord(record: Record<string, unknown>): Promise<void> {
	try {
		await fs.promises.writeFile(file(), JSON.stringify(record));
	} catch {
		// best effort: a failed write only means Claude does not see this selection
	}
}

/** Stops sending the current Live Preview selection to Claude. */
export async function clearSelection(): Promise<void> {
	if (!fs.existsSync(dir())) return;
	await writeRecord({ file: '', text: '', time: Date.now() });
	showStatus('', '');
}

export function initSelectionStatus(context: vscode.ExtensionContext): void {
	status = vscode.window.createStatusBarItem('mdLivePreview.plus.claudeSelection', vscode.StatusBarAlignment.Right, 100);
	status.name = 'Live Preview selection for Claude';
	status.command = CLEAR_COMMAND;
	context.subscriptions.push(
		status,
		vscode.commands.registerCommand(CLEAR_COMMAND, () => clearSelection()),
		vscode.window.onDidChangeTextEditorSelection((event) => {
			const scheme = event.textEditor.document.uri.scheme;
			if (showing && (scheme === 'file' || scheme === 'untitled') && event.selections.some((s) => !s.isEmpty)) {
				void clearSelection();
			}
		}),
	);
}

export async function writeSelection(
	document: vscode.TextDocument,
	message: Extract<PlusEditorToHostMessage, { type: 'plusSelection' }>,
): Promise<void> {
	if (!vscode.workspace.getConfiguration('mdLivePreview').get('plus.shareSelectionWithClaude', true)) return;
	if (!fs.existsSync(dir())) return;
	if (message.text && document.isDirty) {
		try {
			await document.save();
		} catch {
			// unsaved: the file says so below
		}
	}
	await writeRecord({
		file: document.uri.fsPath,
		text: message.text,
		startLine: message.startLine,
		endLine: message.endLine,
		from: message.from,
		to: message.to,
		docVersion: document.version,
		time: Date.now(),
		dirty: document.isDirty,
	});
	showStatus(document.uri.fsPath, message.text, message.startLine, message.endLine);
}

/** When a Live Preview closes, a selection it sent stops applying. */
export async function forgetSelectionOf(document: vscode.TextDocument): Promise<void> {
	try {
		const current = JSON.parse(await fs.promises.readFile(file(), 'utf8')) as { file?: string; text?: string };
		if (current.text && current.file === document.uri.fsPath) await clearSelection();
	} catch {
		// no selection file
	}
}
