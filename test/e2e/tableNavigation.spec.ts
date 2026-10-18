import { test, expect } from '@playwright/test';
import { mountEditor } from './harness';

const TABLE = '| A | B | C |\n| --- | --- | --- |\n| one | two | three |\n| four | five | six |\n';

test('arrow keys move in all directions, save edits once, and stay in the same table', async ({ page }) => {
	await mountEditor(page, TABLE + '\nBetween tables.\n\n' + TABLE + '\nAfter.\n');
	const table = page.locator('.mlp-table').nth(1);
	const cell = (row: number, col: number) => table.locator(`[data-mlp-row="${row}"][data-mlp-col="${col}"]`);
	await cell(1, 0).click();
	await page.keyboard.press('End');
	await page.keyboard.type(' edited');
	for (const [key, row, col] of [
		['ArrowRight', 1, 1], ['ArrowDown', 2, 1], ['ArrowLeft', 2, 0], ['ArrowUp', 1, 0],
	] as const) {
		await page.keyboard.press(key);
		await expect(cell(row, col)).toBeFocused();
		await expect(cell(row, col)).toHaveClass(/mlp-table-cell-editing/);
	}
	await expect(cell(1, 0)).toHaveText('one edited');
	await expect(page.locator('.mlp-table').first()).not.toContainText('edited');
	await page.keyboard.press('ArrowRight');
	await expect(cell(1, 1)).toBeFocused();
	await page.keyboard.type('replacement');
	await page.keyboard.press('ArrowDown');
	await expect(cell(2, 1)).toBeFocused();
	await expect(cell(1, 1)).toHaveText('replacement');
	await expect(page.locator('.mlp-table')).toHaveCount(2);
});

test('arrows stop at the grid edges without wrapping or leaving the cell', async ({ page }) => {
	await mountEditor(page, TABLE + '\nAfter.\n');
	for (const [row, col, keys] of [[0, 0, ['ArrowLeft', 'ArrowUp']], [2, 2, ['ArrowRight', 'ArrowDown']]] as const) {
		const cell = page.locator(`[data-mlp-row="${row}"][data-mlp-col="${col}"]`);
		await cell.click();
		for (const key of keys) {
			await page.keyboard.press(key);
			await expect(cell).toBeFocused();
		}
	}
});

test('Shift arrows select text and composing arrows do not change cells', async ({ page }) => {
	await mountEditor(page, TABLE + '\nAfter.\n');
	const cell = page.locator('[data-mlp-row="1"][data-mlp-col="0"]');
	await cell.click();
	await page.keyboard.press('End');
	await page.keyboard.press('Shift+ArrowLeft');
	await expect(cell).toBeFocused();
	expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('e');
	await cell.dispatchEvent('keydown', { key: 'ArrowDown', isComposing: true });
	await expect(cell).toBeFocused();
});

test('table corners are rounded and single cell borders remain visible', async ({ page }) => {
	await mountEditor(page, TABLE + '\nAfter.\n');
	const metrics = await page.locator('.mlp-table').evaluate(table => {
		const cells = table.querySelectorAll('th, td');
		return {
			radius: getComputedStyle(table).borderTopLeftRadius,
			first: getComputedStyle(cells[0]).borderTopLeftRadius,
			last: getComputedStyle(cells[cells.length - 1]).borderBottomRightRadius,
			inner: getComputedStyle(cells[0]).borderRightWidth,
		};
	});
	expect(metrics).toEqual({ radius: '6px', first: '5px', last: '5px', inner: '1px' });
	await page.screenshot({ path: 'test-results/table-rounded.png' });
});

for (const width of [360, 1100]) {
	test(`column add control stays beside the table, below its toolbar at ${width}px`, async ({ page }) => {
		await page.setViewportSize({ width, height: 700 });
		await mountEditor(page, TABLE + '\nAfter.\n');
		const table = page.locator('.mlp-table');
		const control = page.locator('.mlp-table-add-col');
		await table.hover();
		const bounds = (await table.boundingBox())!;
		const add = (await control.boundingBox())!;
		const toolbar = (await page.locator('.mlp-table-toolbar').boundingBox())!;
		expect(add.y).toBeCloseTo(bounds.y, 0);
		expect(add.y + add.height).toBeCloseTo(bounds.y + bounds.height, 0);
		expect(add.y).toBeGreaterThanOrEqual(toolbar.y + toolbar.height);
		expect(add.x).toBeGreaterThan(bounds.x + bounds.width);
		await control.click();
		await expect(table.locator('th')).toHaveCount(4);
	});
}
