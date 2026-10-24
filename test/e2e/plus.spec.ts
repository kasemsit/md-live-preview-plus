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
