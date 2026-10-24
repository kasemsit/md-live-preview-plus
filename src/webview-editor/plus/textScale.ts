import { EditorView } from '@codemirror/view';

/**
 * The reader's text size (Larger Text / Smaller Text in the right-click menu),
 * a factor over whatever size the CSS theme sets. The theme sizes the reading
 * column once and everything else in `em`, so scaling that one size scales
 * headings, tables and formulas with it. The factor itself is a VS Code
 * setting, so it is remembered and shared by every open preview; the host
 * sends it after each `init`.
 */

let scale = 1;

function apply(view: EditorView | null): void {
	let style = document.getElementById('mlp-plus-text-scale') as HTMLStyleElement | null;
	if (!style) {
		style = document.createElement('style');
		style.id = 'mlp-plus-text-scale';
		document.head.appendChild(style);
	}
	// Measure the theme's own size with the override off, then scale that.
	style.textContent = '';
	if (!view) return;
	if (scale !== 1) {
		const base = parseFloat(getComputedStyle(view.contentDOM).fontSize) || 16;
		style.textContent = `.cm-editor .cm-content.cm-content { font-size: ${(base * scale).toFixed(2)}px !important; }`;
	}
	view.requestMeasure();
}

export function setTextScale(view: EditorView | undefined, next: number): void {
	scale = next;
	apply(view ?? null);
}

/** After the theme CSS (or the document) changed: the base size may have too. */
export function reapplyTextScale(): void {
	setTimeout(() => {
		const root = document.querySelector('.cm-editor') as HTMLElement | null;
		apply(root ? EditorView.findFromDOM(root) : null);
	}, 0);
}
