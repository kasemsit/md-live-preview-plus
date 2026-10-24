// md-live-preview-plus: how a wikilink target names a file (src/editor/plus/wikiOpen.ts).

/** The file name a link points to: `name` gets `.md` unless it already names a file type. */
export function linkFileName(name: string): string {
	if (/\.(md|markdown)$/i.test(name) || /\.[A-Za-z0-9]{1,5}$/.test(name)) return name;
	return `${name}.md`;
}

/**
 * Picks among same-named files the way Obsidian does: an exact workspace path
 * first, then one beside the current note, then the shortest path.
 */
export function rankMatches<T extends { rel: string; dir: string; fsPath: string }>(candidates: T[], want: string, hereDir: string): T[] {
	const norm = (x: string) => x.replace(/\\/g, '/').toLowerCase();
	const score = (c: { rel: string; dir: string }) => (norm(c.rel) === norm(want) ? 0 : 2) + (c.dir === hereDir ? 0 : 1);
	return [...candidates].sort((a, b) => score(a) - score(b) || a.fsPath.length - b.fsPath.length);
}
