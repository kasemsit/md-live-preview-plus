/**
 * Extra passes for `renderInlineInto` (table cells, footnote cards).
 *
 * A pass may rewrite the source before it is parsed and finish the rendered
 * DOM afterwards — wikilinks swap themselves for placeholders the Markdown
 * parser cannot break apart, then turn the placeholders into links.
 *
 * Passes register themselves from their own modules, which keeps
 * tableCellInline.ts free of imports that would loop back into it.
 */
export interface InlinePassResult {
	text: string;
	finish?: (root: HTMLElement) => void;
}
export type InlinePass = (text: string) => InlinePassResult;

const passes: InlinePass[] = [];

export function registerInlinePass(pass: InlinePass): void {
	if (!passes.includes(pass)) passes.push(pass);
}

export function withInlinePasses(text: string, root: HTMLElement, render: (text: string) => void): void {
	const finishers: ((root: HTMLElement) => void)[] = [];
	for (const pass of passes) {
		const result = pass(text);
		text = result.text;
		if (result.finish) finishers.push(result.finish);
	}
	render(text);
	for (const finish of finishers) finish(root);
}
