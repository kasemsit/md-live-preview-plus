import * as vscode from 'vscode';
import * as path from 'node:path';
import type { PlusAnchor, PlusNote } from '../../shared/messages';
import { anchorsInText, findAnchorLine } from '../../shared/plusAnchors';
import { linkFileName, rankMatches } from '../../shared/plusLinks';

/**
 * Wikilinks on the host: `[[name#anchor]]` resolves by file name anywhere in
 * the workspace (Obsidian semantics, not a path relative to the document),
 * opens the note in Live Preview, and moves to the heading or block once that
 * editor has its text.
 */

export interface PlusSession {
	getDocument(): vscode.TextDocument;
	jumpToLine(line: number): void;
}

const sessions = new Set<PlusSession>();
// Target URI → line to jump to once its editor posts `ready` (see takePendingJump).
const pendingJumps = new Map<string, number>();

export function trackSession(session: PlusSession): vscode.Disposable {
	sessions.add(session);
	return new vscode.Disposable(() => sessions.delete(session));
}

/** Called after `init` is sent: the line a wikilink asked this document to open at, if any. */
export function takePendingJump(uri: vscode.Uri): number | undefined {
	const key = uri.toString();
	const line = pendingJumps.get(key);
	pendingJumps.delete(key);
	return line;
}

const EXCLUDE = '**/{node_modules,.git,.obsidian,.trash}/**';

/** Glob-escapes a literal path segment (`[`, `]`, `{`, `}`, `?`, `*`, `!`). */
function globEscape(s: string): string {
	return s.replace(/[[\]{}?*!]/g, (c) => `[${c}]`);
}

export async function resolveWikiTarget(from: vscode.Uri, name: string): Promise<vscode.Uri | undefined> {
	if (!name) return from;
	const rel = linkFileName(name);
	const found = await vscode.workspace.findFiles(`**/${globEscape(rel)}`, EXCLUDE, 50);
	if (!found.length) {
		// Outside a workspace (or not indexed): try beside the current note.
		const beside = vscode.Uri.joinPath(from, '..', rel);
		try {
			await vscode.workspace.fs.stat(beside);
			return beside;
		} catch {
			return undefined;
		}
	}
	const ranked = rankMatches(
		found.map((u) => ({ uri: u, rel: vscode.workspace.asRelativePath(u, false), dir: path.dirname(u.fsPath), fsPath: u.fsPath })),
		rel,
		path.dirname(from.fsPath),
	);
	return ranked[0].uri;
}

async function readLines(uri: vscode.Uri): Promise<string[]> {
	const open = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
	const text = open ? open.getText() : Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
	return text.split(/\r?\n/);
}

export async function openWikilink(session: PlusSession, link: string): Promise<void> {
	const parts = link.split('#');
	const name = parts[0].trim();
	const anchor = parts.length > 1 ? parts[parts.length - 1].trim() : '';
	try {
		const here = session.getDocument().uri;
		const uri = await resolveWikiTarget(here, name);
		if (!uri) {
			void vscode.window.showWarningMessage(`Wikilink target not found: ${name}`);
			return;
		}
		const isMarkdown = /\.(md|markdown)$/i.test(uri.fsPath);
		if (!isMarkdown) {
			await vscode.commands.executeCommand('vscode.open', uri);
			return;
		}
		let line = 0;
		if (anchor) {
			line = findAnchorLine(await readLines(uri), anchor);
			if (!line) void vscode.window.showWarningMessage(`Anchor not found in ${path.basename(uri.fsPath)}: #${anchor}`);
		}
		if (uri.toString() === here.toString()) {
			if (line) session.jumpToLine(line);
			return;
		}
		const key = uri.toString();
		if (line) pendingJumps.set(key, line);
		await vscode.commands.executeCommand('vscode.openWith', uri, 'mdLivePreview.editor');
		if (!line) return;
		// Already open: no `ready` will come, so jump in the existing editor.
		setTimeout(() => {
			if (!pendingJumps.has(key)) return;
			for (const s of [...sessions].reverse()) {
				if (s.getDocument().uri.toString() === key) {
					pendingJumps.delete(key);
					s.jumpToLine(line);
					return;
				}
			}
		}, 500);
	} catch (err) {
		void vscode.window.showWarningMessage(`Wikilink: ${err instanceof Error ? err.message : String(err)}`);
	}
}

let notesCache: { at: number; notes: PlusNote[] } | null = null;

/** Every Markdown note in the workspace, for `[[` completion. */
export async function listNotes(): Promise<PlusNote[]> {
	if (notesCache && Date.now() - notesCache.at < 20_000) return notesCache.notes;
	const found = await vscode.workspace.findFiles('**/*.{md,markdown}', EXCLUDE, 50_000);
	const notes = found
		.map((u) => ({ name: path.basename(u.fsPath).replace(/\.(md|markdown)$/i, ''), path: vscode.workspace.asRelativePath(u, false) }))
		.sort((a, b) => a.name.localeCompare(b.name));
	notesCache = { at: Date.now(), notes };
	return notes;
}

export async function listAnchors(session: PlusSession, target: string): Promise<PlusAnchor[]> {
	const uri = await resolveWikiTarget(session.getDocument().uri, target.trim());
	if (!uri || !/\.(md|markdown)$/i.test(uri.fsPath)) return [];
	try {
		return anchorsInText((await readLines(uri)).join('\n'));
	} catch {
		return [];
	}
}
