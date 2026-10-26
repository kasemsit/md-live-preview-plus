/**
 * Offsets in a CRLF file. CodeMirror counts every line break as one character;
 * VS Code counts `\r\n` as two. Upstream passed offsets across unchanged, so in
 * a CRLF file every edit made in the preview landed one character further off
 * for each line above it, and every external change landed off the other way.
 *
 * These are pure functions over the positions of the `\r` of each `\r\n`, so
 * they can be tested without VS Code; src/editor/plus/eol.ts applies them.
 */

/** VS Code offsets of the `\r` in each `\r\n` of `text`, ascending. */
export function crlfPositions(text: string): number[] {
	const out: number[] = [];
	for (let i = text.indexOf('\r\n'); i >= 0; i = text.indexOf('\r\n', i + 2)) out.push(i);
	return out;
}

/** A VS Code offset as a CodeMirror offset: every `\r` before it drops out. */
export function vsToCm(crs: number[], vs: number): number {
	let lo = 0;
	let hi = crs.length;
	while (lo < hi) {
		const mid = (lo + hi) >> 1;
		if (crs[mid] < vs) lo = mid + 1;
		else hi = mid;
	}
	return vs - lo;
}

/** A CodeMirror offset as a VS Code offset: every `\r\n` before it adds one. */
export function cmToVs(crs: number[], cm: number): number {
	// The k-th `\r` sits at CodeMirror offset crs[k] - k.
	let lo = 0;
	let hi = crs.length;
	while (lo < hi) {
		const mid = (lo + hi) >> 1;
		if (crs[mid] - mid < cm) lo = mid + 1;
		else hi = mid;
	}
	return cm + lo;
}
