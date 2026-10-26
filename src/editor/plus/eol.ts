import * as vscode from 'vscode';
import type { CodeBlockTokens, TextChange } from '../../shared/messages';
import { crlfPositions, cmToVs, vsToCm } from '../../shared/plusEol';

/**
 * The CRLF bridge between the editor webview (CodeMirror: a line break is one
 * character) and the document (VS Code: `\r\n` is two). See shared/plusEol.ts.
 * In an LF document every function here is the identity.
 */

const isCrlf = (document: vscode.TextDocument) => document.eol === vscode.EndOfLine.CRLF;

/** Converters for the document as it is now. */
export function eolMap(document: vscode.TextDocument): { position(cm: number): vscode.Position; toCm(vs: number): number } {
	if (!isCrlf(document)) return { position: (cm) => document.positionAt(cm), toCm: (vs) => vs };
	const crs = crlfPositions(document.getText());
	return { position: (cm) => document.positionAt(cmToVs(crs, cm)), toCm: (vs) => vsToCm(crs, vs) };
}

/**
 * A change event's edits in CodeMirror offsets. The ranges describe the
 * document before the change, whose text is gone; but every line break before
 * a position is one `\r\n`, so a position on line L is L characters further on
 * in VS Code's count.
 */
export function changesForEditor(event: vscode.TextDocumentChangeEvent): TextChange[] {
	const crlf = isCrlf(event.document);
	return event.contentChanges.map((c) => ({
		from: c.rangeOffset - (crlf ? c.range.start.line : 0),
		to: c.rangeOffset + c.rangeLength - (crlf ? c.range.end.line : 0),
		insert: c.text,
	}));
}

/** Code-highlight tokens (VS Code offsets) in CodeMirror offsets. */
export function tokensForEditor(document: vscode.TextDocument, blocks: CodeBlockTokens[]): CodeBlockTokens[] {
	if (!isCrlf(document)) return blocks;
	const { toCm } = eolMap(document);
	return blocks.map((b) => ({
		from: toCm(b.from),
		to: toCm(b.to),
		tokens: b.tokens.map((t) => ({ ...t, from: toCm(t.from), to: toCm(t.to) })),
	}));
}
