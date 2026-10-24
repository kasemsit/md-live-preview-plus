/**
 * Word-level diff for tracked changes (webview-editor/plus/trackChanges.ts).
 *
 * VS Code reports a file reloaded from disk as one replacement spanning every
 * changed line, so the region is diffed again here, word by word — Thai
 * included, through the platform's word segmenter — to show what actually
 * changed rather than a whole block.
 */

export interface DiffHunk {
	/** Offset in the new text where the change sits. */
	from: number;
	/** End of the inserted text in the new text (`from` when nothing was inserted). */
	to: number;
	/** The text that was removed at `from` ('' when nothing was). */
	deleted: string;
}

const segmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter('th', { granularity: 'word' }) : null;

export function tokenize(text: string): string[] {
	if (!text) return [];
	if (segmenter) return Array.from(segmenter.segment(text), (s) => s.segment);
	return text.match(/\s+|[\p{L}\p{N}_]+|./gsu) ?? [];
}

/** Myers' O(ND) diff over token arrays; returns per-token ops. */
function diffOps(a: string[], b: string[]): ('=' | '-' | '+')[] {
	const n = a.length;
	const m = b.length;
	const max = n + m;
	const v = new Map<number, number>([[1, 0]]);
	const trace: Map<number, number>[] = [];
	for (let d = 0; d <= max; d++) {
		trace.push(new Map(v));
		for (let k = -d; k <= d; k += 2) {
			let x = k === -d || (k !== d && (v.get(k - 1) ?? 0) < (v.get(k + 1) ?? 0)) ? (v.get(k + 1) ?? 0) : (v.get(k - 1) ?? 0) + 1;
			let y = x - k;
			while (x < n && y < m && a[x] === b[y]) {
				x++;
				y++;
			}
			v.set(k, x);
			if (x >= n && y >= m) {
				// Walk the trace back to the start.
				const ops: ('=' | '-' | '+')[] = [];
				let cx = n;
				let cy = m;
				for (let dd = d; dd > 0; dd--) {
					const pv = trace[dd];
					const kk = cx - cy;
					const prevK = kk === -dd || (kk !== dd && (pv.get(kk - 1) ?? 0) < (pv.get(kk + 1) ?? 0)) ? kk + 1 : kk - 1;
					const px = pv.get(prevK) ?? 0;
					const py = px - prevK;
					while (cx > px && cy > py) {
						ops.push('=');
						cx--;
						cy--;
					}
					ops.push(cx === px ? '+' : '-');
					cx = px;
					cy = py;
				}
				while (cx > 0 && cy > 0) {
					ops.push('=');
					cx--;
					cy--;
				}
				return ops.reverse();
			}
		}
	}
	return [];
}

/**
 * The changes between `before` and `after` as hunks positioned in `after`.
 * Hunks separated only by whitespace are merged, which reads better than a
 * row of one-word changes. Past `maxTokens` the whole region is one hunk.
 */
export function diffWords(before: string, after: string, maxTokens = 6000): DiffHunk[] {
	if (before === after) return [];
	const a = tokenize(before);
	const b = tokenize(after);
	if (a.length + b.length > maxTokens) return [{ from: 0, to: after.length, deleted: before }];
	const ops = diffOps(a, b);
	const hunks: DiffHunk[] = [];
	let ai = 0;
	let bi = 0;
	let pos = 0;
	let open: DiffHunk | null = null;
	let gap = '';
	let gapLen = 0;
	for (const op of ops) {
		if (op === '=') {
			const tok = b[bi];
			if (open && /^\s+$/.test(tok) && gapLen === 0) {
				// Hold a single whitespace token: merge if another change follows.
				gap = tok;
				gapLen = tok.length;
			} else {
				if (open) hunks.push(open);
				open = null;
				gap = '';
				gapLen = 0;
			}
			pos += tok.length;
			ai++;
			bi++;
			continue;
		}
		if (!open) open = { from: pos, to: pos, deleted: '' };
		else if (gapLen) {
			open.to += gapLen;
			open.deleted += gap;
			gap = '';
			gapLen = 0;
		}
		if (op === '-') {
			open.deleted += a[ai++];
		} else {
			open.to += b[bi].length;
			pos += b[bi++].length;
		}
	}
	if (open) hunks.push(open);
	return hunks;
}
