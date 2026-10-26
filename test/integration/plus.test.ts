import * as assert from 'assert';
import * as vscode from 'vscode';

/**
 * md-live-preview-plus, inside a real VS Code: the right-click commands that
 * need the real webview — its clipboard above all, which the e2e page (not a
 * secure context) cannot reach — and the document edits they make.
 *
 * The clipboard is the user's own; it is saved and put back around each test.
 */
suite('md-live-preview-plus context menu', () => {
	let file: vscode.Uri;
	let savedClipboard = '';

	setup(async () => {
		const folder = vscode.workspace.workspaceFolders?.[0];
		assert.ok(folder, 'the tests need a workspace folder');
		file = vscode.Uri.joinPath(folder.uri, `plus-${Date.now()}.md`);
		savedClipboard = await vscode.env.clipboard.readText();
	});

	teardown(async () => {
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
		await vscode.env.clipboard.writeText(savedClipboard);
		try {
			await vscode.workspace.fs.delete(file);
		} catch {
			// Already removed.
		}
	});

	async function openPreview(text: string): Promise<vscode.TextDocument> {
		await vscode.workspace.fs.writeFile(file, new TextEncoder().encode(text));
		await vscode.commands.executeCommand('vscode.openWith', file, 'mdLivePreview.editor');
		// The webview has to load and receive its document before it can act.
		await new Promise((resolve) => setTimeout(resolve, 2500));
		return vscode.workspace.openTextDocument(file);
	}

	async function until<T>(read: () => Thenable<T> | T, ok: (value: T) => boolean, ms = 4000): Promise<T> {
		const end = Date.now() + ms;
		let value = await read();
		while (!ok(value) && Date.now() < end) {
			await new Promise((resolve) => setTimeout(resolve, 100));
			value = await read();
		}
		return value;
	}

	test('Copy as Rich Text reaches the system clipboard from the webview', async () => {
		const text = '# Title\n\nA **bold** [[Note|link]] and $x^2$.\n\n<!-- REVIEW: hidden -->\n';
		await openPreview(text);
		await vscode.env.clipboard.writeText('unchanged');
		await vscode.commands.executeCommand('mdLivePreview.plus.copyRichText', { from: text.indexOf('A **'), to: text.length });
		const copied = await until(() => vscode.env.clipboard.readText(), (t) => t !== 'unchanged');
		assert.strictEqual(copied, 'A bold link and $x^2$.');
	});

	test('Copy Link to This Block copies a heading link for the note', async () => {
		await openPreview('# Title\n\nBody.\n');
		await vscode.env.clipboard.writeText('unchanged');
		// From the palette the caret decides; a fresh document has it on the heading.
		await vscode.commands.executeCommand('mdLivePreview.plus.copyBlockLink');
		const copied = await until(() => vscode.env.clipboard.readText(), (t) => t !== 'unchanged');
		const name = file.path.split('/').pop()!.replace(/\.md$/, '');
		assert.strictEqual(copied, `[[${name}#Title]]`);
	});

	test('Renumber Footnotes edits the document', async () => {
		const document = await openPreview('# T\n\nA[^9] b[^4].\n\n[^4]: Four.\n[^9]: Nine.\n');
		await vscode.commands.executeCommand('mdLivePreview.plus.renumberFootnotes');
		const text = await until(() => document.getText(), (t) => t.includes('A[^1]'));
		assert.strictEqual(text, '# T\n\nA[^1] b[^2].\n\n[^2]: Four.\n[^1]: Nine.\n');
	});

	test('every right-click command is registered', async () => {
		const all = new Set(await vscode.commands.getCommands(true));
		const extension = vscode.extensions.getExtension('local.markdown-live-preview-editor-claude')!;
		const menu = extension.packageJSON.contributes.menus['webview/context'] as { command: string }[];
		assert.ok(menu.length >= 18, `only ${menu.length} menu items`);
		for (const { command } of menu) assert.ok(all.has(command), `${command} is in the menu but not registered`);
	});
});

suite('md-live-preview-plus text size', () => {
	const config = () => vscode.workspace.getConfiguration('mdLivePreview');
	teardown(async () => {
		await config().update('plus.textScale', undefined, vscode.ConfigurationTarget.Global);
	});

	test('Larger, Smaller and Reset step the remembered setting', async () => {
		await config().update('plus.textScale', undefined, vscode.ConfigurationTarget.Global);
		await vscode.commands.executeCommand('mdLivePreview.plus.textLarger');
		assert.strictEqual(config().get('plus.textScale'), 1.1);
		await vscode.commands.executeCommand('mdLivePreview.plus.textLarger');
		assert.strictEqual(config().get('plus.textScale'), 1.2);
		await vscode.commands.executeCommand('mdLivePreview.plus.textSmaller');
		assert.strictEqual(config().get('plus.textScale'), 1.1);
		await vscode.commands.executeCommand('mdLivePreview.plus.textReset');
		assert.strictEqual(config().get('plus.textScale'), 1);
	});
});

suite('md-live-preview-plus tracked changes', () => {
	let file: vscode.Uri;
	setup(async () => {
		const folder = vscode.workspace.workspaceFolders![0];
		file = vscode.Uri.joinPath(folder.uri, `track-${Date.now()}.md`);
		await vscode.workspace.fs.writeFile(file, new TextEncoder().encode('# T\n\nThe quick brown fox.\n'));
	});
	teardown(async () => {
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
		try {
			await vscode.workspace.fs.delete(file);
		} catch {
			// gone
		}
	});

	function nextChange(): Promise<vscode.TextDocumentChangeEvent> {
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => reject(new Error('no change event')), 8000);
			const sub = vscode.workspace.onDidChangeTextDocument((e) => {
				if (e.document.uri.toString() !== file.toString() || !e.contentChanges.length) return;
				clearTimeout(timer);
				sub.dispose();
				resolve(e);
			});
		});
	}

	test('a write to disk arrives as a change with no reason and a clean document', async () => {
		await vscode.commands.executeCommand('vscode.openWith', file, 'mdLivePreview.editor');
		await new Promise((resolve) => setTimeout(resolve, 1500));
		const event = nextChange();
		await vscode.workspace.fs.writeFile(file, new TextEncoder().encode('# T\n\nThe quick red fox.\n'));
		const e = await event;
		assert.strictEqual(e.reason, undefined);
		assert.strictEqual(e.document.isDirty, false, 'a reload from disk should leave the document clean');
	});

	test('an edit made inside VS Code leaves the document dirty, so it is not tracked', async () => {
		const document = await vscode.workspace.openTextDocument(file);
		const event = nextChange();
		const edit = new vscode.WorkspaceEdit();
		edit.insert(file, new vscode.Position(2, 0), 'typed ');
		await vscode.workspace.applyEdit(edit);
		const e = await event;
		assert.strictEqual(e.document.isDirty, true);
		await document.save();
	});
});

suite('md-live-preview-plus CRLF files', () => {
	let file: vscode.Uri;
	setup(async () => {
		const folder = vscode.workspace.workspaceFolders![0];
		file = vscode.Uri.joinPath(folder.uri, `crlf-${Date.now()}.md`);
	});
	teardown(async () => {
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
		try {
			await vscode.workspace.fs.delete(file);
		} catch {
			// gone
		}
	});

	async function until<T>(read: () => T, ok: (v: T) => boolean, ms = 5000): Promise<T> {
		const end = Date.now() + ms;
		let v = read();
		while (!ok(v) && Date.now() < end) {
			await new Promise((r) => setTimeout(r, 100));
			v = read();
		}
		return v;
	}

	test('an edit made in the preview lands in the right place in a CRLF file', async () => {
		const lines = ['# T', '', 'Line one with A[^9].', 'Line two.', 'Line three with B[^4].', '', '[^4]: Four.', '[^9]: Nine.', ''];
		await vscode.workspace.fs.writeFile(file, new TextEncoder().encode(lines.join('\r\n')));
		await vscode.commands.executeCommand('vscode.openWith', file, 'mdLivePreview.editor');
		await new Promise((r) => setTimeout(r, 2500));
		const document = await vscode.workspace.openTextDocument(file);
		assert.strictEqual(document.eol, vscode.EndOfLine.CRLF);
		await vscode.commands.executeCommand('mdLivePreview.plus.renumberFootnotes');
		const text = await until(() => document.getText(), (t) => t.includes('A[^1]'));
		const expected = ['# T', '', 'Line one with A[^1].', 'Line two.', 'Line three with B[^2].', '', '[^2]: Four.', '[^1]: Nine.', ''].join('\r\n');
		assert.strictEqual(text, expected);
	});

	test('a change from disk reaches the preview at the right place in a CRLF file', async () => {
		const before = ['# T', '', 'Alpha.', 'Beta[^8].', '', '[^8]: Eight.', ''].join('\r\n');
		await vscode.workspace.fs.writeFile(file, new TextEncoder().encode(before));
		await vscode.commands.executeCommand('vscode.openWith', file, 'mdLivePreview.editor');
		await new Promise((r) => setTimeout(r, 2500));
		const document = await vscode.workspace.openTextDocument(file);
		// Changed on disk below line 1, so the preview must place it by CRLF-aware offsets…
		await vscode.workspace.fs.writeFile(file, new TextEncoder().encode(before.replace('Alpha.', 'Alpha changed.')));
		await until(() => document.getText(), (t) => t.includes('Alpha changed.'));
		await new Promise((r) => setTimeout(r, 500));
		// …which the next preview edit then proves: it lands where it should.
		await vscode.commands.executeCommand('mdLivePreview.plus.renumberFootnotes');
		const text = await until(() => document.getText(), (t) => t.includes('Beta[^1]'));
		assert.strictEqual(text, ['# T', '', 'Alpha changed.', 'Beta[^1].', '', '[^1]: Eight.', ''].join('\r\n'));
	});
});
