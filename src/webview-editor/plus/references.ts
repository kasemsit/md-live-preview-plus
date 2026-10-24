import type { EditorState } from '@codemirror/state';
import type { SyntaxNode, Tree } from '@lezer/common';
import { syntaxTree } from '@codemirror/language';

/**
 * `[text]` on its own is a link only when the document defines `[text]: url`
 * (CommonMark's shortcut reference link). @lezer/markdown does not resolve
 * references, so it marks every bracketed phrase as a Link node, and the stock
 * renderer drew `[0.8, 1.0]`, `[sic]` or `[ฎีกา 1689/2518]` as an empty link
 * with its brackets hidden. These helpers tell the two apart.
 */

const cache = new WeakMap<Tree, Set<string>>();
const normalize = (label: string) => label.trim().replace(/\s+/g, ' ').toLowerCase();

/** The labels of every `[label]: url` definition in the document. */
export function definedReferences(state: EditorState): Set<string> {
	const tree = syntaxTree(state);
	let labels = cache.get(tree);
	if (!labels) {
		const found = new Set<string>();
		tree.iterate({
			enter: (node) => {
				// Definitions are blocks; nothing inline can hold one.
				if (/^(Paragraph|ATXHeading\d|SetextHeading\d|FencedCode|CodeBlock|HTMLBlock|Table|BlockMath)$/.test(node.name)) return false;
				if (node.name !== 'LinkReference') return;
				const label = node.node.getChild('LinkLabel');
				if (label) found.add(normalize(state.sliceDoc(label.from + 1, label.to - 1)));
				return false;
			},
		});
		cache.set(tree, (labels = found));
	}
	return labels;
}

/** `[text]` alone: no `(url)`, no `[ref]` after it. */
export function isShortcutLink(node: SyntaxNode): boolean {
	return !node.getChild('URL') && !node.getChild('LinkLabel') && node.getChildren('LinkMark').length === 2;
}

/** A bracketed phrase the document defines no reference for — plain text, not a link. */
export function isUndefinedReferenceLink(state: EditorState, node: SyntaxNode): boolean {
	if (!isShortcutLink(node)) return false;
	const [open, close] = node.getChildren('LinkMark');
	return !definedReferences(state).has(normalize(state.sliceDoc(open.to, close.from)));
}
