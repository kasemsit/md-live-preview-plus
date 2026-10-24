import * as vscode from 'vscode';
import { isNewer, parseReleaseTag } from '../../shared/plusVersion';

/**
 * This build is distributed through GitHub Releases, not the Marketplace, so
 * nothing updates it. Once a day (unless `mdLivePreview.plus.checkForUpdates`
 * is off) ask GitHub for the latest release and offer its page when it is newer.
 */

const RELEASES = 'https://api.github.com/repos/kasemsit/md-live-preview-plus/releases/latest';
const LAST_CHECK_KEY = 'mdLivePreview.plusLastUpdateCheck';
const DAY_MS = 24 * 60 * 60 * 1000;

export async function checkForUpdate(context: vscode.ExtensionContext): Promise<void> {
	const config = vscode.workspace.getConfiguration('mdLivePreview');
	if (!config.get('plus.checkForUpdates', true)) return;
	if (Date.now() - context.globalState.get<number>(LAST_CHECK_KEY, 0) < DAY_MS) return;
	await context.globalState.update(LAST_CHECK_KEY, Date.now());
	try {
		const res = await fetch(RELEASES, {
			headers: { 'User-Agent': 'md-live-preview-plus', Accept: 'application/vnd.github+json' },
			signal: AbortSignal.timeout(8000),
		});
		if (!res.ok) return;
		const release = (await res.json()) as { tag_name?: string; html_url?: string };
		const latest = parseReleaseTag(String(release.tag_name ?? ''));
		const installed = String(context.extension.packageJSON.version);
		if (!latest || !isNewer(latest, installed.split('.').map(Number))) return;
		const pick = await vscode.window.showInformationMessage(
			`md-live-preview-plus ${release.tag_name} is available (installed ${installed}).`,
			'Open release page',
			"Don't check again",
		);
		if (pick === 'Open release page' && release.html_url) await vscode.env.openExternal(vscode.Uri.parse(release.html_url));
		else if (pick === "Don't check again") await config.update('plus.checkForUpdates', false, vscode.ConfigurationTarget.Global);
	} catch {
		// offline or rate-limited: try again tomorrow
	}
}
