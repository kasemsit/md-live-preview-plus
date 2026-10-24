import { test, expect, type Page } from '@playwright/test';
import { mountEditor, postToWebview } from './harness';

// md-live-preview-plus features, driven through the real webview bundle.
// Every document starts with a heading line: a fresh editor puts the caret at
// position 0, and a line holding the caret shows its raw source.

type Posted = { type: string; [k: string]: unknown };
const posted = (page: Page) => page.evaluate(() => (window as unknown as { __posted: Posted[] }).__posted);

test.describe('wikilinks', () => {
	const DOC = [
		'# Title',
		'',
		'See [[Laws/TH - PDPA 2562#^ma-32|ม.32(2)]] and [[Plain note]].',
		'',
		'| law | note |',
		'|---|---|',
		'| [[Laws/TH - PDPA 2562#^ma-39\\|ม.39]] | [[Other#Heading|unescaped]] |',
		'',
		'End.',
	].join('\n');

	test.beforeEach(async ({ page }) => {
		await mountEditor(page, DOC);
	});

	test('render as their label and keep the target', async ({ page }) => {
		const links = page.locator('.cm-line .mlp-wikilink');
		await expect(links).toHaveCount(2);
		await expect(links.nth(0)).toHaveText('ม.32(2)');
		await expect(links.nth(0)).toHaveAttribute('data-href', 'wiki:Laws/TH - PDPA 2562#^ma-32');
		await expect(links.nth(1)).toHaveText('Plain note');
		await expect(page.locator('.cm-content')).not.toContainText('[[');
	});

	test('a press opens the link through the host', async ({ page }) => {
		await page.locator('.cm-line .mlp-wikilink').first().click();
		const open = (await posted(page)).filter((m) => m.type === 'openLink');
		expect(open.at(-1)?.href).toBe('wiki:Laws/TH - PDPA 2562#^ma-32');
	});

	test('render inside table cells, escaped or not, without splitting the row', async ({ page }) => {
		const table = page.locator('.mlp-table-wrap table');
		await expect(table.locator('tr').last().locator('td')).toHaveCount(2);
		const links = table.locator('.mlp-wikilink');
		await expect(links).toHaveText(['ม.39', 'unescaped']);
		await expect(links.nth(1)).toHaveAttribute('data-href', 'wiki:Other#Heading');
		await links.nth(1).click();
		const open = (await posted(page)).filter((m) => m.type === 'openLink');
		expect(open.at(-1)?.href).toBe('wiki:Other#Heading');
	});

	test('a table in code mode shows the raw link', async ({ page }) => {
		await page.locator('.mlp-table-wrap .mlp-code-mode-btn').click();
		await expect(page.locator('.cm-content')).toContainText('[[Other#Heading|unescaped]]');
		await expect(page.locator('.mlp-line-table-raw .mlp-wikilink')).toHaveCount(0);
	});

	test('the caret on the line shows the source', async ({ page }) => {
		await page.locator('.cm-line').filter({ hasText: 'See' }).click({ position: { x: 4, y: 6 } });
		await expect(page.locator('.cm-content')).toContainText('See [[Laws/TH - PDPA 2562#^ma-32|ม.32(2)]] and [[Plain note]].');
	});
});

test('a wikilink in a table header row keeps the table', async ({ page }) => {
	await mountEditor(page, '# T\n\n| [[a|A]] | b |\n|---|---|\n| 1 | 2 |\n');
	await expect(page.locator('.mlp-table-wrap table th')).toHaveCount(2);
	await expect(page.locator('.mlp-table-wrap th .mlp-wikilink')).toHaveText('A');
});

test.describe('callouts and quoted tables', () => {
	const DOC = [
		'# Title',
		'',
		'> [!warning] Mind the gap',
		'> Body line.',
		'',
		'> [!tip]',
		'> Untitled.',
		'',
		'> [!note] With a table',
		'> Text before the table.',
		'> | a | b |',
		'> |---|---|',
		'> | c | [[x|y]] |',
		'',
		'End.',
	].join('\n');

	test.beforeEach(async ({ page }) => {
		await mountEditor(page, DOC);
	});

	test('colour every line and replace the marker with an icon', async ({ page }) => {
		const warning = page.locator('.cm-line.mlp-co-orange');
		await expect(warning).toHaveCount(2);
		await expect(warning.first()).toHaveClass(/mlp-callout-first/);
		await expect(warning.first().locator('.mlp-callout-icon svg')).toHaveCount(1);
		await expect(warning.first().locator('.mlp-callout-title')).toHaveText('Mind the gap');
		await expect(page.locator('.cm-content')).not.toContainText('[!warning]');
	});

	test('an untitled callout shows its type name', async ({ page }) => {
		await expect(page.locator('.cm-line.mlp-co-cyan .mlp-callout-title')).toHaveText('Tip');
	});

	test('a table inside a callout renders and is framed', async ({ page }) => {
		const wrap = page.locator('.mlp-table-wrap.mlp-table-in-quote');
		await expect(wrap).toHaveCount(1);
		await expect(wrap.locator('tr')).toHaveCount(2);
		await expect(wrap.locator('.mlp-wikilink')).toHaveText('y');
		await expect(page.locator('.cm-line').filter({ hasText: 'Text before the table.' })).toHaveCount(1);
	});
});

test.describe('footnotes', () => {
	const DOC = [
		'# Title',
		'',
		'First[^b] and second[^1] and missing[^zz].',
		'',
		'[^1]: The one.',
		'[^b]: The **bee**',
		'  continued.',
		'',
		'End.',
	].join('\n');

	test.beforeEach(async ({ page }) => {
		await mountEditor(page, DOC);
	});

	test('number references by first citation; leave undefined ones raw', async ({ page }) => {
		await expect(page.locator('.cm-line .mlp-fn-ref')).toHaveText(['1', '2']);
		await expect(page.locator('.cm-content')).toContainText('missing[^zz]');
	});

	test('definitions show their number and a back-link', async ({ page }) => {
		await expect(page.locator('.mlp-fn-def-num')).toHaveText(['2.↩', '1.↩']);
		await expect(page.locator('.cm-line.mlp-fn-def-first')).toHaveCount(1);
	});

	test('hovering shows the note, continuation included', async ({ page }) => {
		const ref = page.locator('.cm-line .mlp-fn').first();
		await ref.hover();
		const card = ref.locator('.mlp-fn-pop');
		await expect(card).toBeVisible();
		await expect(card).toContainText('The bee continued.');
		await expect(card.locator('strong')).toHaveText('bee');
	});

	test('pressing a reference flashes its definition', async ({ page }) => {
		await page.locator('.cm-line .mlp-fn-ref').first().click();
		await expect(page.locator('.mlp-fn-flashbox')).toHaveCount(1);
	});

	test('the insert command adds the next number and its definition', async ({ page }) => {
		await page.locator('.cm-line').filter({ hasText: 'End.' }).click();
		await page.keyboard.press('End');
		await postToWebview(page, { type: 'plusInsertFootnote' });
		await page.keyboard.type('New note.');
		await expect(page.locator('.cm-content')).toContainText('[^2]: New note.');
		await expect(page.locator('.cm-line .mlp-fn-ref')).toHaveText(['1', '2', '3']);
	});
});

test('block ids are dimmed, not hidden', async ({ page }) => {
	await mountEditor(page, '# T\n\nA provision. ^ma-32\n\nEnd.\n');
	await expect(page.locator('.mlp-block-id')).toHaveText('^ma-32');
	await expect(page.locator('.mlp-block-id')).toHaveCSS('opacity', '0.4');
});

test('the selection is reported as Markdown source with line numbers', async ({ page }) => {
	await mountEditor(page, '# T\n\nSome **bold** text.\n\nEnd.\n');
	await page.locator('.cm-line').filter({ hasText: 'End.' }).click();
	await page.keyboard.press('ArrowUp');
	await page.keyboard.press('ArrowUp');
	await page.keyboard.press('Home');
	await page.keyboard.press('Shift+End');
	await expect
		.poll(async () => (await posted(page)).filter((m) => m.type === 'plusSelection').at(-1))
		.toMatchObject({ text: 'Some **bold** text.', startLine: 3, endLine: 3 });
});

test.describe('completion', () => {
	test('[[ offers workspace notes and closes the link', async ({ page }) => {
		await mountEditor(page, '# T\n\nx\n');
		await page.locator('.cm-line').last().click();
		await page.keyboard.press('End');
		await page.keyboard.type(' [[');
		await expect.poll(async () => (await posted(page)).some((m) => m.type === 'plusListNotes')).toBe(true);
		const req = (await posted(page)).filter((m) => m.type === 'plusListNotes').at(-1)!;
		await postToWebview(page, {
			type: 'plusNotes',
			requestId: req.requestId,
			notes: [
				{ name: 'Alpha note', path: 'A/Alpha note.md' },
				{ name: 'Beta', path: 'B/Beta.md' },
				{ name: 'Beta', path: 'C/Beta.md' },
			],
		});
		await page.keyboard.type('alp');
		await expect(page.locator('.cm-tooltip-autocomplete li').first()).toContainText('Alpha note');
		// Same-named notes are offered by path, so the link resolves to one file.
		await expect(page.locator('.cm-tooltip-autocomplete li')).toHaveCount(1);
		// The list ignores keys for its first 75 ms, so a fast Enter is not taken as a pick.
		await page.waitForTimeout(150);
		await page.keyboard.press('Enter');
		await page.keyboard.type('!');
		await expect(page.locator('.cm-content')).toContainText('x [[Alpha note]]!');
	});

	test('[[# offers this document\'s headings', async ({ page }) => {
		await mountEditor(page, '# T\n\n## Second part\n\nx\n');
		await page.locator('.cm-line').last().click();
		await page.keyboard.press('End');
		await page.keyboard.type(' [[#Sec');
		await expect(page.locator('.cm-tooltip-autocomplete li').first()).toContainText('Second part');
		await page.waitForTimeout(150);
		await page.keyboard.press('Enter');
		await expect(page.locator('.cm-content')).toContainText('[[#Second part]]');
	});
});

test.describe('wikilink hover preview', () => {
	test('shows the target block in a card, and its title opens the note', async ({ page }) => {
		await mountEditor(page, '# T\n\nSee [[Laws/TH - PDPA#^ma-32|ม.32]] here.\n\nEnd.\n');
		await page.locator('.cm-line .mlp-wikilink').hover();
		await expect.poll(async () => (await posted(page)).some((m) => m.type === 'plusPreview')).toBe(true);
		const req = (await posted(page)).filter((m) => m.type === 'plusPreview').at(-1)!;
		expect(req.target).toBe('Laws/TH - PDPA#^ma-32');
		await postToWebview(page, {
			type: 'plusPreviewResult',
			requestId: req.requestId,
			preview: {
				title: 'TH - PDPA › ^ma-32',
				text: '### มาตรา 32 — สิทธิคัดค้าน\n\n> มาตรา ๓๒ เจ้าของข้อมูลมีสิทธิคัดค้าน\n> (๑) ข้อหนึ่ง\n\n| a | [[x|y]] |\n|---|---|\n| 1 | 2 |',
				status: 'ok',
				truncated: false,
			},
		});
		const card = page.locator('.mlp-link-preview');
		await expect(card).toBeVisible();
		await expect(card.locator('.mlp-lp-h3')).toHaveText('มาตรา 32 — สิทธิคัดค้าน');
		await expect(card.locator('.mlp-lp-quote')).toContainText('มาตรา ๓๒ เจ้าของข้อมูลมีสิทธิคัดค้าน');
		await expect(card.locator('.mlp-lp-quote br')).toHaveCount(1);
		await expect(card.locator('.mlp-lp-table th')).toHaveCount(2);
		await card.locator('.mlp-lp-title').click();
		expect((await posted(page)).filter((m) => m.type === 'openLink').at(-1)?.href).toBe('wiki:Laws/TH - PDPA#^ma-32');
		await expect(card).toHaveCount(0);
	});

	test('the card closes when the pointer leaves', async ({ page }) => {
		await mountEditor(page, '# T\n\nSee [[Other]] here.\n\nEnd.\n');
		await page.locator('.cm-line .mlp-wikilink').hover();
		await expect.poll(async () => (await posted(page)).some((m) => m.type === 'plusPreview')).toBe(true);
		const req = (await posted(page)).filter((m) => m.type === 'plusPreview').at(-1)!;
		await postToWebview(page, { type: 'plusPreviewResult', requestId: req.requestId, preview: { title: 'Other', text: 'Body.', status: 'ok', truncated: false } });
		await expect(page.locator('.mlp-link-preview')).toBeVisible();
		await page.mouse.move(990, 690);
		await expect(page.locator('.mlp-link-preview')).toHaveCount(0);
	});
});

test('links to notes that do not exist are marked', async ({ page }) => {
	await mountEditor(page, '# T\n\n[[Exists]], [[Missing note]], [[Folder/Deep|deep]], [[pic.png]], [[#T]].\n\nEnd.\n');
	await expect.poll(async () => (await posted(page)).some((m) => m.type === 'plusListNotes')).toBe(true);
	const req = (await posted(page)).filter((m) => m.type === 'plusListNotes').at(-1)!;
	await postToWebview(page, {
		type: 'plusNotes',
		requestId: req.requestId,
		notes: [
			{ name: 'Exists', path: 'Exists.md' },
			{ name: 'Deep', path: 'A/Folder/Deep.md' },
		],
	});
	await expect(page.locator('.mlp-wikilink-unresolved')).toHaveText(['Missing note']);
});

test.describe('foldable callouts', () => {
	const DOC = '# T\n\n> [!faq]- Folded question\n> Hidden answer.\n\n> [!tip]+ Open tip\n> Visible body.\n\n> [!note]- Folded table\n> | a | b |\n> |---|---|\n> | c | d |\n\nEnd.\n';

	test('[!type]- starts folded, [!type]+ starts open, the chevron toggles', async ({ page }) => {
		await mountEditor(page, DOC);
		const content = page.locator('.cm-content');
		await expect(content).not.toContainText('Hidden answer.');
		await expect(content).toContainText('Visible body.');
		await expect(page.locator('.mlp-callout-fold')).toHaveCount(3);
		await page.locator('.mlp-callout-fold').first().click();
		await expect(content).toContainText('Hidden answer.');
		await page.locator('.mlp-callout-fold').nth(1).click();
		await expect(content).not.toContainText('Visible body.');
	});

	test('a folded callout holding a table opens to the rendered table', async ({ page }) => {
		await mountEditor(page, DOC);
		await expect(page.locator('.mlp-table-in-quote')).toHaveCount(0);
		await page.locator('.mlp-callout-fold').nth(2).click();
		await expect(page.locator('.mlp-table-in-quote tr')).toHaveCount(2);
	});
});

test('HTML comments are tinted, on their own lines or inline', async ({ page }) => {
	await mountEditor(page, '# T\n\n<!-- REVIEW one\ntwo -->\n\nText <!-- inline --> end.\n\nEnd.\n');
	await expect(page.locator('.cm-line.mlp-comment-line')).toHaveCount(2);
	await expect(page.locator('.cm-line.mlp-comment-line-first')).toContainText('REVIEW one');
	await expect(page.locator('.mlp-comment')).toHaveText('<!-- inline -->');
	await expect(page.locator('.mlp-comment-marker')).toHaveCount(4);
});

test.describe('citations', () => {
	const DOC = '# T\n\nAs shown [@smith2020; @lee2019] and [@typo].\n\n| claim | source |\n|---|---|\n| x | [@smith2020] |\n\nEnd.\n';

	test('each key links to its reference note; a missing one is marked', async ({ page }) => {
		await mountEditor(page, DOC);
		const keys = page.locator('.cm-line .mlp-cite');
		await expect(keys).toHaveText(['@smith2020', '@lee2019', '@typo']);
		await expect(page.locator('.cm-line .mlp-cite-group')).toHaveCount(2);
		await expect(page.locator('.cm-content')).toContainText('[@smith2020; @lee2019]');
		const req = (await posted(page)).filter((m) => m.type === 'plusListNotes').at(-1)!;
		await postToWebview(page, {
			type: 'plusNotes',
			requestId: req.requestId,
			notes: [
				{ name: '@smith2020', path: 'References/@smith2020.md' },
				{ name: '@lee2019', path: 'References/@lee2019.md' },
			],
		});
		await expect(page.locator('.mlp-cite.mlp-wikilink-unresolved')).toHaveText(['@typo']);
		await keys.first().click();
		expect((await posted(page)).filter((m) => m.type === 'openLink').at(-1)?.href).toBe('wiki:@smith2020');
	});

	test('render inside table cells and hover-preview like wikilinks', async ({ page }) => {
		await mountEditor(page, DOC);
		const cell = page.locator('.mlp-table-wrap .mlp-cite');
		await expect(cell).toHaveText('@smith2020');
		await cell.hover();
		await expect.poll(async () => (await posted(page)).some((m) => m.type === 'plusPreview')).toBe(true);
		expect((await posted(page)).filter((m) => m.type === 'plusPreview').at(-1)?.target).toBe('@smith2020');
	});
});

test('a selection made inside a rendered table reaches Claude as source', async ({ page }) => {
	await mountEditor(page, '# T\n\n| col a | col b |\n|---|---|\n| alpha **beta** gamma | delta |\n\nEnd.\n');
	// Select "beta" inside the first body cell, as a drag would.
	await page.evaluate(() => {
		const strong = document.querySelector('.mlp-table-wrap td strong')!;
		const range = document.createRange();
		range.selectNodeContents(strong);
		const sel = document.getSelection()!;
		sel.removeAllRanges();
		sel.addRange(range);
	});
	await expect
		.poll(async () => (await posted(page)).filter((m) => m.type === 'plusSelection').at(-1))
		.toMatchObject({ text: 'beta', startLine: 5, endLine: 5 });
	// Across two cells: both cells' source.
	await page.evaluate(() => {
		const cells = document.querySelectorAll('.mlp-table-wrap td');
		const range = document.createRange();
		range.setStart(cells[0].firstChild!, 0);
		range.setEnd(cells[1].firstChild!, 2);
		const sel = document.getSelection()!;
		sel.removeAllRanges();
		sel.addRange(range);
	});
	await expect
		.poll(async () => (await posted(page)).filter((m) => m.type === 'plusSelection').at(-1)?.text)
		.toBe('alpha **beta** gamma | delta');
});

test('a real mouse drag across rendered cells reaches Claude as source', async ({ page }) => {
	await mountEditor(page, '# T\n\n| name | state |\n| --- | --- |\n| Alice | OK |\n\nAfter the table.\n');
	await page.locator('.cm-line').filter({ hasText: 'After' }).click();
	const a = (await page.locator('[data-mlp-row="1"][data-mlp-col="0"]').boundingBox())!;
	const b = (await page.locator('[data-mlp-row="1"][data-mlp-col="1"]').boundingBox())!;
	await page.mouse.move(a.x + 5, a.y + a.height / 2);
	await page.mouse.down();
	await page.mouse.move(b.x + b.width - 5, b.y + b.height / 2, { steps: 5 });
	await page.mouse.up();
	await expect
		.poll(async () => (await posted(page)).filter((m) => m.type === 'plusSelection').at(-1))
		.toMatchObject({ text: 'Alice | OK', startLine: 5, endLine: 5 });
});

test.describe('math', () => {
	const DOC = [
		'# T',
		'',
		'Inline $a_i$ and $b_j$ here, but $5 and $10 is money.',
		'',
		'$$\\sum_{i=1}^n x_i$$',
		'',
		'where',
		'$$',
		'\\frac{a}{b} = c',
		'$$',
		'',
		'| term | value |',
		'|---|---|',
		'| $\\alpha$ | 1 |',
		'',
		'End.',
	].join('\n');

	test('inline math renders, and underscores in it are not emphasis', async ({ page }) => {
		await mountEditor(page, DOC);
		const line = page.locator('.cm-line').filter({ hasText: 'money' });
		await expect(line.locator('.mlp-math .katex')).toHaveCount(2);
		await expect(line.locator('em')).toHaveCount(0);
		await expect(line).toContainText('$5 and $10 is money.');
	});

	test('display math renders on one line and as a $$ block', async ({ page }) => {
		await mountEditor(page, DOC);
		await expect(page.locator('.cm-line .mlp-math-display .katex-display')).toHaveCount(1);
		const block = page.locator('.mlp-math-block');
		await expect(block.locator('.katex-display')).toHaveCount(1);
		await expect(block.locator('.mfrac')).toHaveCount(1);
		// The source is gone from the lines (KaTeX keeps the TeX only in hidden MathML).
		await expect(page.locator('.cm-line').filter({ hasText: '\\frac{a}{b} = c' })).toHaveCount(0);
	});

	test('clicking a $$ block shows its source', async ({ page }) => {
		await mountEditor(page, DOC);
		await page.locator('.mlp-math-block').click();
		await expect(page.locator('.cm-line').filter({ hasText: '\\frac{a}{b} = c' })).toHaveCount(1);
		await expect(page.locator('.mlp-math-block')).toHaveCount(0);
	});

	test('math renders inside table cells', async ({ page }) => {
		await mountEditor(page, DOC);
		await expect(page.locator('.mlp-table-wrap td .mlp-math .katex')).toHaveCount(1);
	});

	test('the caret inside inline math shows its source', async ({ page }) => {
		await mountEditor(page, DOC);
		const line = page.locator('.cm-line').filter({ hasText: 'money' });
		await line.locator('.mlp-math').first().click();
		await expect(page.locator('.cm-line').filter({ hasText: 'money' })).toContainText('$a_i$');
	});
});

// ── Right-click menu ──
// VS Code's own menu cannot be opened in a page, so each test does what it
// does: a `contextmenu` event on the element (which the editor remembers),
// then the `plusRun` message the host sends when an item is chosen.

type Edit = { type: 'edit'; changes: { from: number; to: number; insert: string }[] };

/** The document after every edit the editor has sent the host. */
async function docText(page: Page, initial: string): Promise<string> {
	await page.waitForTimeout(400); // edits are flushed after 250 ms
	let text = initial;
	for (const e of (await posted(page)).filter((m) => m.type === 'edit') as unknown as Edit[]) {
		for (const c of [...e.changes].sort((a, b) => b.from - a.from)) text = text.slice(0, c.from) + c.insert + text.slice(c.to);
	}
	return text;
}

async function rightClick(page: Page, selector: string, nth = 0): Promise<void> {
	const box = (await page.locator(selector).nth(nth).boundingBox())!;
	await page.evaluate(
		([sel, n, x, y]) => {
			const el = document.querySelectorAll(sel as string)[n as number];
			el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x as number, clientY: y as number, button: 2 }));
		},
		[selector, nth, box.x + 4, box.y + box.height / 2],
	);
}

const run = (page: Page, command: string, range?: { from: number; to: number }) => postToWebview(page, { type: 'plusRun', command, range });
const lastDo = async (page: Page) => (await posted(page)).filter((m) => m.type === 'plusDo').at(-1);

test.describe('right-click menu', () => {
	test('elements tell VS Code what they are, so the menu shows the right items', async ({ page }) => {
		await mountEditor(page, '# T\n\nText [[Note]] and $x$.\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\nNote[^1].\n\n[^1]: Def.\n');
		const root = JSON.parse((await page.locator('.cm-editor').getAttribute('data-vscode-context'))!);
		expect(root).toMatchObject({ mlpEditor: true, mlpHasSelection: false, mlpHasFootnotes: true });
		await expect(page.locator('.cm-line .mlp-wikilink')).toHaveAttribute('data-vscode-context', '{"mlpLink":true}');
		await expect(page.locator('.cm-line .mlp-math')).toHaveAttribute('data-vscode-context', '{"mlpMath":true}');
		await expect(page.locator('.mlp-table-wrap')).toHaveAttribute('data-vscode-context', '{"mlpTable":true}');
		await page.locator('.cm-line').filter({ hasText: 'Text' }).click({ position: { x: 4, y: 6 } });
		await page.keyboard.press('Shift+End');
		await expect.poll(async () => JSON.parse((await page.locator('.cm-editor').getAttribute('data-vscode-context'))!).mlpHasSelection).toBe(true);
	});

	test('Copy Link to This Block adds a block id to a paragraph, or reuses one', async ({ page }) => {
		const DOC = '# T\n\n### มาตรา 32 — สิทธิคัดค้าน ^ma-32\n\nA paragraph\nover two lines.\n\nEnd.\n';
		await mountEditor(page, DOC);
		await rightClick(page, '.cm-line', 2); // the heading
		await run(page, 'copyBlockLink');
		await expect.poll(() => lastDo(page)).toMatchObject({ action: 'copyBlockLink', anchor: '^ma-32' });
		await rightClick(page, '.cm-line', 4); // first line of the paragraph
		await run(page, 'copyBlockLink');
		await expect.poll(() => lastDo(page)).toMatchObject({ action: 'copyBlockLink' });
		const anchor = String((await lastDo(page))!.anchor);
		expect(anchor).toMatch(/^\^[a-z0-9]{6}$/);
		expect(await docText(page, DOC)).toContain(`over two lines. ${anchor}\n`);
	});

	test('a table gets its block id on its own line after it', async ({ page }) => {
		const DOC = '# T\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\nEnd.\n';
		await mountEditor(page, DOC);
		await rightClick(page, '.mlp-table-wrap td');
		await run(page, 'copyBlockLink');
		await expect.poll(() => lastDo(page)).toMatchObject({ action: 'copyBlockLink' });
		const anchor = String((await lastDo(page))!.anchor);
		expect(await docText(page, DOC)).toContain(`| 1 | 2 |\n\n${anchor}\n\nEnd.`);
	});

	test('Add REVIEW Comment quotes the selection after its paragraph', async ({ page }) => {
		const DOC = '# T\n\nSome draft sentence here.\nEnd.\n\nNext.\n';
		await mountEditor(page, DOC);
		await run(page, 'addReviewComment', undefined);
		// With no right-click, the caret (line 1) decides; select first.
		await page.locator('.cm-line').filter({ hasText: 'Some draft' }).click({ position: { x: 4, y: 6 } });
		await page.keyboard.press('Shift+End');
		await run(page, 'addReviewComment');
		await page.keyboard.type('check this');
		expect(await docText(page, DOC)).toContain('End.\n\n<!-- REVIEW "Some draft sentence here.": check this -->\n\nNext.');
	});

	test('Renumber Footnotes relabels by order of citation', async ({ page }) => {
		const DOC = '# T\n\nFirst[^7] then[^2] and[^b].\n\n[^2]: Two.\n[^7]: Seven.\n[^b]: Bee.\n';
		await mountEditor(page, DOC);
		await run(page, 'renumberFootnotes');
		expect(await docText(page, DOC)).toBe('# T\n\nFirst[^1] then[^2] and[^3].\n\n[^2]: Two.\n[^1]: Seven.\n[^3]: Bee.\n');
	});

	test('table items: insert, delete, sort, copy', async ({ page }) => {
		const DOC = '# T\n\n| name | n |\n|---|---|\n| bee | 10 |\n| ant | 9 |\n\nEnd.\n';
		await mountEditor(page, DOC);
		await rightClick(page, '[data-mlp-row="1"][data-mlp-col="1"]');
		await run(page, 'table.sortAscending');
		await expect(page.locator('.mlp-table-wrap td').first()).toHaveText('ant');
		await rightClick(page, '[data-mlp-row="1"][data-mlp-col="0"]');
		await run(page, 'table.insertRowBelow');
		await expect(page.locator('.mlp-table-wrap tr')).toHaveCount(4);
		await rightClick(page, '[data-mlp-row="1"][data-mlp-col="1"]');
		await run(page, 'table.deleteColumn');
		await expect(page.locator('.mlp-table-wrap th')).toHaveCount(1);
		await rightClick(page, '[data-mlp-row="1"][data-mlp-col="0"]');
		await run(page, 'table.copyTsv');
		await expect.poll(() => lastDo(page)).toMatchObject({ action: 'copy', text: 'name\nant\n\nbee' });
	});

	test('Copy TeX and Open Link to the Side act on what was right-clicked', async ({ page }) => {
		await mountEditor(page, '# T\n\nSee [[Other#H|other]] and $\\frac{a}{b}$.\n\nEnd.\n');
		await rightClick(page, '.cm-line .mlp-math');
		await run(page, 'copyTex');
		await expect.poll(() => lastDo(page)).toMatchObject({ action: 'copy', text: '\\frac{a}{b}' });
		await rightClick(page, '.cm-line .mlp-wikilink');
		await run(page, 'openLinkBeside');
		await expect.poll(() => lastDo(page)).toMatchObject({ action: 'openBeside', href: 'wiki:Other#H' });
	});

	test('Copy as Rich Text puts semantic HTML on the clipboard', async ({ page }) => {
		const DOC = '# T\n\n## Section\n\nA **bold** [[Note|link]], a cite [@smith2020] and $x^2$.\n\n<!-- REVIEW: not for the reader -->\n\n- one\n- two\n\n| a | b |\n|---|---|\n| 1 | 2 |\n';
		await mountEditor(page, DOC);
		// The test page is not a secure context, so it has no async clipboard;
		// VS Code's webview does. Stand one in that records what is written.
		await page.evaluate(() => {
			const w = window as unknown as Record<string, unknown>;
			w.ClipboardItem = class {
				constructor(private readonly data: Record<string, Blob>) {}
				getType(type: string) {
					return Promise.resolve(this.data[type]);
				}
			};
			Object.defineProperty(navigator, 'clipboard', {
				value: {
					write: async (items: { getType(t: string): Promise<Blob> }[]) => {
						w.__clipHtml = await (await items[0].getType('text/html')).text();
						w.__clipText = await (await items[0].getType('text/plain')).text();
					},
				},
			});
		});
		await run(page, 'copyRichText', { from: DOC.indexOf('## Section'), to: DOC.length });
		await expect.poll(() => lastDo(page)).toMatchObject({ action: 'notify', message: 'Copied as rich text.' });
		const html = String(await page.evaluate(() => (window as unknown as Record<string, unknown>).__clipHtml));
		const text = String(await page.evaluate(() => (window as unknown as Record<string, unknown>).__clipText));
		expect(text).toContain('Section\n');
		expect(text).toContain('a\tb');
		expect(html).toContain('<h2>Section</h2>');
		expect(html).toContain('<strong>bold</strong>');
		expect(html).toContain('link');
		expect(html).not.toContain('[[');
		expect(html).toContain('[@smith2020]');
		expect(html).toContain('$x^2$');
		expect(html).not.toContain('REVIEW');
		expect(html).toMatch(/<ul><li>one<\/li><li>two<\/li><\/ul>/);
		expect(html).toContain('<th>a</th>');
		expect(html).not.toContain('class=');
	});
});

test.describe('underline', () => {
	test('Ctrl+U wraps the selection in <u>…</u> and again unwraps it', async ({ page }) => {
		const DOC = '# T\n\nsome words here\n';
		await mountEditor(page, DOC);
		await page.locator('.cm-line').filter({ hasText: 'some words' }).click({ position: { x: 4, y: 6 } });
		await page.keyboard.press('Home');
		await page.keyboard.press('Shift+End');
		await page.keyboard.press('Control+u');
		expect(await docText(page, DOC)).toBe('# T\n\n<u>some words here</u>\n');
		await page.keyboard.press('Control+u');
		expect(await docText(page, DOC)).toBe(DOC);
	});

	test('<u>…</u> renders underlined with the tags hidden, in text and in tables', async ({ page }) => {
		await mountEditor(page, '# T\n\nA <u>marked</u> word.\n\n| a | b |\n|---|---|\n| <u>cell **bold**</u> | 2 |\n\nEnd.\n');
		const line = page.locator('.cm-line').filter({ hasText: 'marked' });
		await expect(line.locator('.mlp-underline')).toHaveText('marked');
		await expect(line).toHaveText('A marked word.');
		await expect(page.locator('.mlp-table-wrap td u')).toHaveText('cell bold');
		await expect(page.locator('.mlp-table-wrap td u strong')).toHaveText('bold');
	});
});

test('Search Google / Google Scholar open the selection as a query', async ({ page }) => {
	await mountEditor(page, '# T\n\nHungarian algorithm **assignment** & matching\n\nEnd.\n');
	await page.locator('.cm-line').filter({ hasText: 'Hungarian' }).click({ position: { x: 4, y: 6 } });
	await page.keyboard.press('Home');
	await page.keyboard.press('Shift+End');
	await run(page, 'searchScholar');
	await expect.poll(() => lastDo(page)).toMatchObject({
		action: 'openUrl',
		url: 'https://scholar.google.com/scholar?q=Hungarian%20algorithm%20assignment%20matching',
	});
	await run(page, 'searchGoogle');
	await expect.poll(() => lastDo(page)).toMatchObject({ url: 'https://www.google.com/search?q=Hungarian%20algorithm%20assignment%20matching' });
});

test.describe('image embeds ![[…]]', () => {
	// A 1×1 PNG, standing in for the URI the host would hand back.
	const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

	test('the host finds the file by name; the image shows at the given width', async ({ page }) => {
		await mountEditor(page, '# T\n\nBefore.\n\n![[am03-dustbin.png|200]]\n\nAfter.\n');
		await expect.poll(async () => (await posted(page)).some((m) => m.type === 'plusResolveEmbed')).toBe(true);
		const req = (await posted(page)).filter((m) => m.type === 'plusResolveEmbed').at(-1)!;
		expect(req.target).toBe('am03-dustbin.png');
		await postToWebview(page, { type: 'plusEmbedResult', requestId: req.requestId, src: PNG });
		const img = page.locator('.cm-line img.mlp-embed-image');
		await expect(img).toHaveAttribute('src', PNG);
		await expect(img).toHaveCSS('width', '200px');
		await expect(page.locator('.cm-content')).not.toContainText('![[');
	});

	test('a missing file says so; the caret on the line shows the source', async ({ page }) => {
		await mountEditor(page, '# T\n\n![[nope.png]]\n\nAfter.\n');
		await expect.poll(async () => (await posted(page)).some((m) => m.type === 'plusResolveEmbed')).toBe(true);
		const req = (await posted(page)).filter((m) => m.type === 'plusResolveEmbed').at(-1)!;
		await postToWebview(page, { type: 'plusEmbedResult', requestId: req.requestId, src: null });
		await expect(page.locator('.mlp-embed-missing')).toHaveText('nope.png not found in the workspace');
		await page.locator('.mlp-embed-missing').click();
		await expect(page.locator('.cm-content')).toContainText('![[nope.png]]');
	});
});
