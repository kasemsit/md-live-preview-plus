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
