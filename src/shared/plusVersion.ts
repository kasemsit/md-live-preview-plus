// md-live-preview-plus: release-version comparison for the update check (src/editor/plus/updateCheck.ts).

/** Release tag → [major, minor, patch]. The early `v0.4.0-plus.N` tags read as 0.4.N. */
export function parseReleaseTag(tag: string): number[] | null {
	const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-plus\.(\d+))?$/.exec(tag.trim());
	if (!m) return null;
	return m[4] !== undefined ? [+m[1], +m[2], +m[4]] : [+m[1], +m[2], +m[3]];
}

export function isNewer(latest: number[], installed: number[]): boolean {
	for (let i = 0; i < 3; i++) {
		const a = latest[i] ?? 0;
		const b = installed[i] ?? 0;
		if (a !== b) return a > b;
	}
	return false;
}
