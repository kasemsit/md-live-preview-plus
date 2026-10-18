import { test, expect } from '@playwright/test';
import { mountEditor, postToWebview } from './harness';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

for (const theme of ['github-like', 'vscode']) {
	test(`first diff row stays the same height as the next row with ${theme} CSS`, async ({ page }) => {
		await mountEditor(page, 'Intro\n\n```diff\n-古い説明\n+新しい説明\n\n そのままの説明\n```\n');
		await postToWebview(page, { type: 'applyCss', css: readFileSync(join(__dirname, '../../media/sample-styles', `${theme}.css`), 'utf8') });
		const removed = (await page.locator('.mlp-diff-removed').boundingBox())!;
		const added = (await page.locator('.mlp-diff-added').boundingBox())!;
		expect(removed.height).toBeCloseTo(added.height, 0);
		await page.screenshot({ path: `test-results/diff-row-height-${theme}.png` });
	});
}

for (const mode of ['light', 'dark']) {
	test(`diff toolbar is compact and neutral in ${mode} mode, and copy is centered`, async ({ page }) => {
		await mountEditor(page, 'Before.\n\n```diff\n-old explanation\n+new explanation\n\n unchanged\n```\n\nAfter.\n');
		await page.evaluate(mode => {
			document.documentElement.style.setProperty('--vscode-textCodeBlock-background', mode === 'light' ? '#eeeeee' : '#2d333b');
			document.documentElement.style.setProperty('--vscode-editor-background', mode === 'light' ? '#ffffff' : '#1e1e1e');
			document.documentElement.style.setProperty('--vscode-editor-foreground', mode === 'light' ? '#24292f' : '#d4d4d4');
			Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text: string) => { (window as any).__copied = text; } } });
		}, mode);
		const toolbar = page.locator('.mlp-code-toolbar-line');
		const first = page.locator('.mlp-diff-removed');
		const bar = (await toolbar.boundingBox())!;
		const row = (await first.boundingBox())!;
		// Retain space around the restored 20px button frame.
		expect(bar.height).toBe(28);
		expect(row.y).toBeCloseTo(bar.y + bar.height, 0);
		expect(row.height).toBeLessThan(25);
		expect(await toolbar.evaluate(el => getComputedStyle(el).backgroundColor)).not.toBe(await first.evaluate(el => getComputedStyle(el).backgroundColor));
		const copy = page.locator('.mlp-copy-code-btn');
		const button = (await copy.boundingBox())!;
		const icon = (await copy.locator('svg').boundingBox())!;
		expect(Math.abs(button.x + button.width / 2 - icon.x - icon.width / 2)).toBeLessThan(1);
		expect(Math.abs(button.y + button.height / 2 - icon.y - icon.height / 2)).toBeLessThan(1);
		expect(button.y).toBeGreaterThanOrEqual(bar.y);
		expect(button.y + button.height).toBeLessThanOrEqual(row.y);
		await page.screenshot({ path: `test-results/code-toolbar-${mode}.png` });
		await copy.click();
		await expect(copy).toHaveClass(/mlp-copy-code-btn-done/);
		expect(await page.evaluate(() => (window as any).__copied)).toBe('-old explanation\n+new explanation\n\n unchanged');
		await expect(copy.locator('svg')).toHaveCount(1, { timeout: 3000 });
		await toolbar.locator('.mlp-code-mode-btn').click();
		await expect(page.locator('.cm-content')).toContainText('```diff');
	});
}

test('single-line and nested code blocks keep compact toolbars while editing', async ({ page }) => {
	await mountEditor(page, 'Intro\n\n```js\nconst value = 1;\n```\n\n- Nested\n\n  ```diff\n  -old\n  +new\n  ```\n\nAfter\n');
	await expect(page.locator('.mlp-code-toolbar-line')).toHaveCount(2);
	await page.locator('.cm-line', { hasText: 'const value = 1;' }).click();
	await page.keyboard.press('End');
	await page.keyboard.type(' // edited');
	await expect(page.locator('.cm-line', { hasText: 'const value = 1; // edited' })).toBeVisible();
	await expect(page.locator('.mlp-copy-code-btn')).toHaveCount(2);
	await expect(page.locator('.mlp-diff-removed')).toHaveText('-old');
});

test('headers display the language, its alias, or text for an unspecified language', async ({ page }) => {
	await mountEditor(page, 'Intro\n\n```html example\n<div>Hello</div>\n```\n\n```js\nconst value = 1;\n```\n\n```\nplain\n```\n');
	await expect(page.locator('.mlp-code-language')).toHaveText(['html', 'js', 'text']);
	await page.screenshot({ path: 'test-results/code-language-headers.png' });
});

test('clicking or double-clicking the language and blank header space never opens source', async ({ page }) => {
	await mountEditor(page, 'Before\n\n```html\n<div>Hello</div>\n```\n\nAfter\n');
	const before = page.locator('.cm-line', { hasText: /^Before$/ });
	await before.click();
	await page.keyboard.press('End');
	const header = page.locator('.mlp-code-toolbar-line');
	await page.locator('.mlp-code-language').click();
	await page.locator('.mlp-code-language').dblclick();
	const box = (await header.boundingBox())!;
	for (const [x, y] of [[box.width / 2, box.height / 2], [2, 2], [box.width - 2, box.height - 2]]) {
		await header.click({ position: { x, y } });
		await expect(page.locator('.mlp-code-language')).toHaveText('html');
		await expect(page.locator('.cm-content')).not.toContainText('```html');
	}
	await page.keyboard.type(' edited');
	await expect(page.locator('.cm-line', { hasText: /^Before edited$/ })).toBeVisible();
	await expect(page.locator('.cm-content')).not.toContainText('```html');
});

test('source button still edits the language and refreshes the header for the same length name', async ({ page }) => {
	await mountEditor(page, 'Intro\n\n```html\n{}\n```\n\nAfter\n');
	await page.locator('.mlp-code-toolbar-actions .mlp-code-mode-btn').click();
	await expect(page.locator('.cm-content')).toContainText('```html');
	await page.keyboard.press('Home');
	await page.keyboard.press('Shift+End');
	await page.keyboard.insertText('```json');
	await page.locator('.cm-line', { hasText: /^After$/ }).click();
	await expect(page.locator('.mlp-code-language')).toHaveText('json');
	await expect(page.locator('.cm-content')).not.toContainText('```json');
});

test('long language names keep the controls inside a narrow header', async ({ page }) => {
	await page.setViewportSize({ width: 360, height: 700 });
	await mountEditor(page, 'Intro\n\n```a-very-long-language-name-that-is-not-installed-and-does-not-fit\nplain\n```\n');
	const header = (await page.locator('.mlp-code-toolbar-line').boundingBox())!;
	const actions = (await page.locator('.mlp-code-toolbar-actions').boundingBox())!;
	expect(actions.x).toBeGreaterThan(header.x);
	expect(actions.x + actions.width).toBeLessThanOrEqual(header.x + header.width);
	await expect(page.locator('.mlp-copy-code-btn')).toBeVisible();
});
