import { test, expect } from '@playwright/test';
import { mountEditor } from './harness';

for (const theme of ['light', 'dark']) {
	test(`diff lines have distinct colors in ${theme} mode and remain editable`, async ({ page }) => {
		await mountEditor(page, 'Intro\n\n```diff\n--- a/file\n+++ b/file\n@@ -1 +1 @@\n-old\n+new\n unchanged\n```\n\n```\n+plain\n-plain\n```\n');
		await page.evaluate((mode) => {
			document.documentElement.style.setProperty('--vscode-editor-background', mode === 'light' ? '#ffffff' : '#1e1e1e');
			document.documentElement.style.setProperty('--vscode-editor-foreground', mode === 'light' ? '#24292f' : '#d4d4d4');
		}, theme);
		const added = page.locator('.mlp-diff-added');
		const removed = page.locator('.mlp-diff-removed');
		await expect(added).toHaveText('+new');
		await expect(removed).toHaveText('-old');
		await expect(page.locator('.mlp-diff-header')).toHaveCount(2);
		await expect(page.locator('.mlp-diff-hunk')).toHaveText('@@ -1 +1 @@');
		const colors = await page.locator('.mlp-diff-added, .mlp-diff-removed').evaluateAll((lines) => lines.map((line) => ({color: getComputedStyle(line).color, background: getComputedStyle(line).backgroundColor})));
		expect(colors[0].color).not.toBe(colors[1].color);
		expect(colors[0].background).not.toBe(colors[1].background);
		await expect(page.locator('.cm-line', { hasText: '+plain' })).not.toHaveClass(/mlp-diff/);
		await expect(page.locator('.cm-line', { hasText: ' unchanged' })).not.toHaveClass(/mlp-diff/);
		await added.click();
		await page.keyboard.press('End');
		await page.keyboard.type(' edited');
		await expect(added).toHaveText('+new edited');
	});
}
