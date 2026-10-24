import * as vscode from 'vscode';
import * as path from 'node:path';
import { extractLinks, keysForNote, type OutgoingLink } from '../../shared/plusBacklinks';
import { EXCLUDE, openAtLine } from './wikiOpen';

/**
 * Backlinks: which notes link to the one being read, with the line that does
 * it. Wikilinks count, and so do Pandoc citations — `[@key]` in a draft is a
 * link to the reference note `@key.md`.
 *
 * The index is built the first time the view is shown (reading every note in
 * the workspace once), then kept current from file-system events, so it
 * reflects what is saved on disk.
 */

const VIEW_ID = 'mdLivePreview.plus.backlinks';
const OPEN_COMMAND = 'mdLivePreview.plus.openAt';
const REFRESH_COMMAND = 'mdLivePreview.plus.refreshBacklinks';
const IGNORED = /[\\/](node_modules|\.git|\.obsidian|\.trash)[\\/]/;

class LinkIndex {
	// target key → source URI → links from that source
	private readonly byTarget = new Map<string, Map<string, OutgoingLink[]>>();
	// source URI → the target keys it contributed, for removal on change
	private readonly bySource = new Map<string, Set<string>>();
	private building: Promise<void> | null = null;
	private readonly changed = new vscode.EventEmitter<void>();
	readonly onDidChange = this.changed.event;

	ensureBuilt(): Promise<void> {
		this.building ??= this.build();
		return this.building;
	}

	private async build(): Promise<void> {
		const files = await vscode.workspace.findFiles('**/*.{md,markdown}', EXCLUDE, 100_000);
		for (let i = 0; i < files.length; i += 64) {
			await Promise.all(files.slice(i, i + 64).map((uri) => this.index(uri, false)));
		}
		this.changed.fire();
	}

	async index(uri: vscode.Uri, notify = true): Promise<void> {
		if (IGNORED.test(uri.fsPath)) return;
		let text: string;
		try {
			text = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
		} catch {
			this.remove(uri, notify);
			return;
		}
		this.remove(uri, false);
		const source = uri.toString();
		const keys = new Set<string>();
		for (const link of extractLinks(text)) {
			keys.add(link.key);
			let sources = this.byTarget.get(link.key);
			if (!sources) this.byTarget.set(link.key, (sources = new Map()));
			const list = sources.get(source);
			if (list) list.push(link);
			else sources.set(source, [link]);
		}
		this.bySource.set(source, keys);
		if (notify) this.changed.fire();
	}

	remove(uri: vscode.Uri, notify = true): void {
		const source = uri.toString();
		for (const key of this.bySource.get(source) ?? []) this.byTarget.get(key)?.delete(source);
		this.bySource.delete(source);
		if (notify) this.changed.fire();
	}

	/** Links to `note` from other notes, grouped by source and sorted by source path. */
	backlinks(note: vscode.Uri): { source: vscode.Uri; links: OutgoingLink[] }[] {
		const self = note.toString();
		const merged = new Map<string, Map<number, OutgoingLink>>();
		for (const key of keysForNote(vscode.workspace.asRelativePath(note, false))) {
			for (const [source, links] of this.byTarget.get(key) ?? []) {
				if (source === self) continue;
				let byLine = merged.get(source);
				if (!byLine) merged.set(source, (byLine = new Map()));
				for (const link of links) if (!byLine.has(link.line)) byLine.set(link.line, link);
			}
		}
		return [...merged.entries()]
			.map(([source, byLine]) => ({
				source: vscode.Uri.parse(source),
				links: [...byLine.values()].sort((a, b) => a.line - b.line),
			}))
			.sort((a, b) => vscode.workspace.asRelativePath(a.source).localeCompare(vscode.workspace.asRelativePath(b.source)));
	}
}

type Node =
	| { kind: 'file'; source: vscode.Uri; links: OutgoingLink[] }
	| { kind: 'line'; source: vscode.Uri; link: OutgoingLink };

class BacklinksTree implements vscode.TreeDataProvider<Node> {
	private readonly changed = new vscode.EventEmitter<void>();
	readonly onDidChangeTreeData = this.changed.event;
	note: vscode.Uri | undefined;
	groups: { source: vscode.Uri; links: OutgoingLink[] }[] = [];

	constructor(private readonly index: LinkIndex) {}

	recompute(): void {
		this.groups = this.note ? this.index.backlinks(this.note) : [];
		this.changed.fire();
	}

	getChildren(node?: Node): Node[] {
		if (!node) return this.groups.map((g) => ({ kind: 'file' as const, ...g }));
		if (node.kind === 'file') return node.links.map((link) => ({ kind: 'line' as const, source: node.source, link }));
		return [];
	}

	getTreeItem(node: Node): vscode.TreeItem {
		if (node.kind === 'file') {
			const rel = vscode.workspace.asRelativePath(node.source, false);
			const item = new vscode.TreeItem(
				path.basename(rel).replace(/\.(md|markdown)$/i, ''),
				this.groups.length <= 8 || node.links.length <= 2
					? vscode.TreeItemCollapsibleState.Expanded
					: vscode.TreeItemCollapsibleState.Collapsed,
			);
			item.resourceUri = node.source;
			item.description = `${path.dirname(rel) === '.' ? '' : path.dirname(rel)}${node.links.length > 1 ? ` · ${node.links.length}` : ''}`;
			item.tooltip = rel;
			item.iconPath = vscode.ThemeIcon.File;
			item.command = { command: OPEN_COMMAND, title: 'Open', arguments: [node.source, node.links[0]?.line ?? 0] };
			return item;
		}
		const { text, label, line } = node.link;
		const at = text.indexOf(label);
		const item = new vscode.TreeItem(
			{ label: text || label, highlights: at >= 0 ? [[at, at + label.length]] : [] },
			vscode.TreeItemCollapsibleState.None,
		);
		item.description = `line ${line}`;
		item.tooltip = new vscode.MarkdownString().appendText(text);
		item.command = { command: OPEN_COMMAND, title: 'Open', arguments: [node.source, line] };
		return item;
	}
}

/** The note the view describes: the active Live Preview, else an ordinary Markdown editor. */
export function registerBacklinks(context: vscode.ExtensionContext, activeDocument: () => vscode.Uri | undefined): void {
	const index = new LinkIndex();
	const tree = new BacklinksTree(index);
	const view = vscode.window.createTreeView(VIEW_ID, { treeDataProvider: tree, showCollapseAll: true });
	let timer: ReturnType<typeof setTimeout> | undefined;

	const refresh = async () => {
		if (!view.visible) return;
		// Focus moving to a non-note tab (Claude's panel, a terminal) keeps the
		// last note rather than emptying the view.
		const note = activeDocument() ?? tree.note;
		if (!note) {
			view.message = 'Open a note to see what links to it.';
			view.description = undefined;
			return;
		}
		if (tree.note?.toString() !== note.toString()) view.message = 'Indexing links…';
		await index.ensureBuilt();
		tree.note = note;
		tree.recompute();
		const files = tree.groups.length;
		const lines = tree.groups.reduce((n, g) => n + g.links.length, 0);
		view.description = files ? `${files} note${files === 1 ? '' : 's'}` : undefined;
		view.message = files
			? lines > files
				? `${lines} links from ${files} notes`
				: undefined
			: `No notes link to ${path.basename(note.fsPath).replace(/\.(md|markdown)$/i, '')}.`;
	};
	const schedule = () => {
		clearTimeout(timer);
		timer = setTimeout(() => void refresh(), 150);
	};

	const watcher = vscode.workspace.createFileSystemWatcher('**/*.{md,markdown}');
	context.subscriptions.push(
		view,
		watcher,
		watcher.onDidChange((uri) => void index.index(uri)),
		watcher.onDidCreate((uri) => void index.index(uri)),
		watcher.onDidDelete((uri) => index.remove(uri)),
		index.onDidChange(schedule),
		view.onDidChangeVisibility(schedule),
		vscode.window.tabGroups.onDidChangeTabs(schedule),
		vscode.window.onDidChangeActiveTextEditor(schedule),
		vscode.commands.registerCommand(OPEN_COMMAND, (uri: vscode.Uri, line: number) => openAtLine(uri, line)),
		vscode.commands.registerCommand(REFRESH_COMMAND, () => void refresh()),
	);
	schedule();
}
