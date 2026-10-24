import * as vscode from 'vscode';
import { createHash } from 'node:crypto';

/**
 * Installs the bundled Thai theme (media/sample-styles/thai-readable.css,
 * Sarabun embedded) into the user's style folder, so a fresh machine looks
 * right without any manual setup.
 *
 * Re-copied whenever the bundled file changes (an upgrade), and switched on
 * only when no theme, or just the stock `vscode.css`, is enabled — a user who
 * chose another theme keeps it.
 */
const THEME = 'thai-readable.css';
const VERSION_KEY = 'mdLivePreview.plusThemeVersion';

export async function seedPlusTheme(context: vscode.ExtensionContext, stylesUri: vscode.Uri): Promise<void> {
	try {
		const bundled = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(context.extensionUri, 'media', 'sample-styles', THEME));
		const version = createHash('sha1').update(bundled).digest('hex').slice(0, 12);
		if (context.globalState.get(VERSION_KEY) === version) return;
		try {
			await vscode.workspace.fs.createDirectory(stylesUri);
		} catch {
			// exists
		}
		await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(stylesUri, THEME), bundled);
		const config = vscode.workspace.getConfiguration('mdLivePreview');
		const enabled = config.get<string[]>('enabledStyles', []);
		if (enabled.length === 0 || (enabled.length === 1 && enabled[0] === 'vscode.css')) {
			await config.update('enabledStyles', [THEME], vscode.ConfigurationTarget.Global);
		}
		await context.globalState.update(VERSION_KEY, version);
	} catch (err) {
		console.error('md-live-preview-plus: theme seeding failed', err);
	}
}
