import { test, expect, type Locator, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mountEditor, openSearch, postToWebview } from './harness';

const ROOT = join(__dirname, '../..');

async function expectCenteredIcon(button: Locator): Promise<void> {
	const box = (await button.boundingBox())!;
	const svg = (await button.locator(':scope > svg').boundingBox())!;
	expect(box.width).toBe(28);
	expect(box.height).toBe(20);
	const iconSize = await button.evaluate(el => el.classList.contains('mlp-code-mode-btn') ? 14 : 13);
	expect(svg.width).toBe(iconSize);
	expect(svg.height).toBe(iconSize);
	expect(Math.abs(box.x + box.width / 2 - svg.x - svg.width / 2)).toBeLessThan(0.6);
	expect(Math.abs(box.y + box.height / 2 - svg.y - svg.height / 2)).toBeLessThan(0.6);
}

for (const theme of ['github-like', 'vscode']) {
	test(`code header joins the body and leaves space around centered icons with ${theme} CSS`, async ({ page }) => {
		await mountEditor(page, 'Intro\n\n```cpp\n#include <iostream>\nint main() { return 0; }\n```\n\nAfter\n\n| Name | Value |\n| --- | --- |\n| A | 1 |\n');
		await page.evaluate(() => {
			document.body.className = 'vscode-dark';
			document.documentElement.style.setProperty('--vscode-textCodeBlock-background', '#2d333b');
		});
		await postToWebview(page, { type: 'applyCss', css: readFileSync(join(ROOT, 'media/sample-styles', `${theme}.css`), 'utf8') });
		const header = page.locator('.mlp-code-toolbar-line');
		const first = page.locator('.mlp-line-code-after-toolbar');
		const bottom = page.locator('.mlp-line-code-last');
		const frame = (await header.boundingBox())!;
		await expect(header).toHaveCSS('overflow', 'clip');
		const overflow = await header.evaluate(el => ({ client: el.clientHeight, scroll: el.scrollHeight }));
		expect(overflow.scroll).toBeLessThanOrEqual(overflow.client);
		for (const row of [first, bottom]) {
			const box = (await row.boundingBox())!;
			expect(box.x).toBeCloseTo(frame.x, 0);
			expect(box.width).toBeCloseTo(frame.width, 0);
			expect(await row.evaluate(el => getComputedStyle(el).backgroundColor)).toBe(await header.evaluate(el => getComputedStyle(el).backgroundColor));
		}
		expect(await first.evaluate(el => getComputedStyle(el).borderTopLeftRadius)).toBe('0px');
		const radius = await page.locator('.mlp-table').evaluate(el => getComputedStyle(el).borderTopLeftRadius);
		await expect(header).toHaveCSS('border-top-left-radius', radius);
		await expect(bottom).toHaveCSS('border-bottom-left-radius', radius);
		for (const button of await header.locator('button').all()) {
			await expectCenteredIcon(button);
			const box = (await button.boundingBox())!;
			expect(box.y - frame.y).toBeGreaterThanOrEqual(2);
			expect(frame.y + frame.height - box.y - box.height).toBeGreaterThanOrEqual(2);
			expect(frame.x + frame.width - box.x - box.width).toBeGreaterThanOrEqual(8);
		}
		await page.screenshot({ path: `test-results/control-header-${theme}.png` });
	});
}

for (const width of [360, 1000]) {
	test(`file-backed draw.io has a separate header at ${width}px, including page and zoom controls`, async ({ page }) => {
		await page.setViewportSize({ width, height: 700 });
		await mountEditor(page, 'Intro\n\n![AWS diagram](showcase.drawio)\n\nAfter\n');
		await expect.poll(async () => page.evaluate(() => (window as any).__posted.find((m: any) => m.type === 'readDrawioFile')?.requestId)).toBeDefined();
		const requestId = await page.evaluate(() => (window as any).__posted.find((m: any) => m.type === 'readDrawioFile').requestId);
		await postToWebview(page, { type: 'drawioFile', requestId, text: readFileSync(join(ROOT, 'sample/showcase.drawio'), 'utf8') });
		const wrap = page.locator('.mlp-drawio-wrap');
		const toolbar = wrap.locator('.mlp-mermaid-toolbar');
		await expect(wrap.locator('.mlp-mermaid-canvas svg')).toBeVisible();
		await expect(wrap.locator('.mlp-drawio-page-label')).toHaveText('1/2');
		await page.mouse.move(width - 1, 699);
		for (const button of await toolbar.locator('button:visible').all()) {
			await expect(button).toHaveCSS('opacity', '0.55');
			await expectCenteredIcon(button);
		}
		const assertHeader = async () => {
			const bar = (await toolbar.boundingBox())!;
			const diagram = (await wrap.locator('.mlp-mermaid').boundingBox())!;
			expect(bar.y + bar.height).toBeLessThanOrEqual(diagram.y + 0.5);
			const frame = (await wrap.boundingBox())!;
			for (const button of await toolbar.locator('button:visible').all()) {
				const box = (await button.boundingBox())!;
				expect(box.x).toBeGreaterThanOrEqual(frame.x);
				expect(box.x + box.width).toBeLessThanOrEqual(frame.x + frame.width);
			}
		};
		await assertHeader();
		await page.screenshot({ path: `test-results/control-drawio-${width}.png` });
		await toolbar.getByRole('button', { name: 'Next page', exact: true }).click();
		await expect(wrap.locator('.mlp-drawio-page-label')).toHaveText('2/2');
		await toolbar.getByRole('button', { name: /^Switch to actual size/ }).click();
		await expect(wrap.locator('.mlp-mermaid-native')).toBeVisible();
		await assertHeader();
		await toolbar.getByRole('button', { name: /^Zoom in/ }).click();
		await toolbar.getByRole('button', { name: /^Reset the view/ }).click();
		await expect(wrap.locator('.mlp-mermaid-native')).toHaveCount(0);
	});
}

test('controls and search options follow the active VS Code palette when it changes', async ({ page }) => {
	await mountEditor(page, 'Intro\n\n```ts\nconst note = 1;\n```\n\nAfter\n');
	for (const [icon, hover, active, activeInk] of [
		['#edc34a', '#59324c', '#74415f', '#fff1e0'],
		['#4c2879', '#d1c0ec', '#633c92', '#ffffff'],
	]) {
		await page.evaluate(({ icon, hover, active, activeInk }) => {
			for (const [key, value] of Object.entries({ 'icon-foreground': icon, 'toolbar-hoverBackground': hover, 'inputOption-activeBackground': active, 'inputOption-activeForeground': activeInk })) {
				document.documentElement.style.setProperty(`--vscode-${key}`, value);
			}
		}, { icon, hover, active, activeInk });
		const button = page.locator('.mlp-copy-code-btn');
		await button.hover();
		await expect(button).toHaveCSS('color', await resolvedColor(page, icon));
		await expect(button).toHaveCSS('background-color', await resolvedColor(page, hover));
		await openSearch(page);
		const option = page.locator('.cm-search label:has(input[name="case"])');
		if (!(await option.locator('input').isChecked())) await option.click();
		expect(await option.evaluate(el => getComputedStyle(el).backgroundColor)).toBe(await resolvedColor(page, active));
		expect(await option.evaluate(el => getComputedStyle(el).color)).toBe(await resolvedColor(page, activeInk));
		await page.keyboard.press('Escape');
	}
});

async function resolvedColor(page: Page, value: string): Promise<string> {
	return page.evaluate(color => {
		const probe = document.createElement('span');
		probe.style.color = color;
		document.body.append(probe);
		const resolved = getComputedStyle(probe).color;
		probe.remove();
		return resolved;
	}, value);
}

test('table source control appears on hover or keyboard focus, while other controls stay visible', async ({ page }) => {
	await mountEditor(page, 'Intro\n\n| Name | Value |\n| --- | --- |\n| A | 1 |\n\n```ts\nconst note = 1;\n```\n\nAfter\n');
	const table = page.locator('.mlp-table-wrap');
	const button = table.locator('.mlp-code-mode-btn');
	await page.mouse.move(999, 699);
	await expect(button).toHaveCSS('opacity', '0');
	await expect(page.locator('.mlp-code-toolbar-actions .mlp-code-mode-btn')).toHaveCSS('opacity', '0.55');
	await table.hover();
	await expect(button).toHaveCSS('opacity', '1');
	await page.mouse.move(999, 699);
	await expect(button).toHaveCSS('opacity', '0');
	await button.focus();
	await page.keyboard.press('Tab');
	await page.keyboard.press('Shift+Tab');
	await expect(button).toBeFocused();
	await expect(button).toHaveCSS('opacity', '1');
	await button.press('Enter');
	await expect(page.locator('.cm-content')).toContainText('| Name | Value |');
});

test('outline, theme cards, badges and actions use their VS Code theme colors', async ({ page }) => {
	const palette = ':root{--vscode-foreground:#27384b;--vscode-editor-background:#f3f0fa;--vscode-editorWidget-background:#ebe5f5;--vscode-list-hoverBackground:#d4c6e5;--vscode-list-hoverForeground:#34244e;--vscode-focusBorder:#6e4d9b;--vscode-badge-background:#724c90;--vscode-badge-foreground:#fff1ff;--vscode-button-background:#624489;--vscode-button-hoverBackground:#4e306e;--vscode-button-foreground:#fff0ff}';
	for (const view of ['outline', 'sidebar']) {
		await page.setViewportSize({ width: 360, height: 800 });
		await page.setContent(`<style>${palette}${readFileSync(join(ROOT, 'media/webview-ui.css'), 'utf8')}${readFileSync(join(ROOT, `media/webview-${view}-style.css`), 'utf8')}</style><div id="mlp-${view}-root"></div>`);
		await page.evaluate(() => {
			(window as any).mlpLocale = 'en';
			(window as any).acquireVsCodeApi = () => ({ postMessage: () => {} });
		});
		await page.addScriptTag({ content: readFileSync(join(ROOT, `dist/webview-${view}.js`), 'utf8') });
		if (view === 'outline') {
			await postToWebview(page, { type: 'update', headings: [{ level: 1, text: 'Heading', line: 0 }] });
			const item = page.locator('.mlp-outline-item');
			await item.hover();
			await expect(item).toHaveCSS('background-color', 'rgb(212, 198, 229)');
			await expect(item).toHaveCSS('color', 'rgb(52, 36, 78)');
		} else {
			await postToWebview(page, { type: 'init', styles: [{ id: 'default', name: 'Default', enabled: true, css: '' }], settings: { defaultEditor: 'prompt', codeTheme: 'auto' }, themeKind: 'vscode-light' });
			await expect(page.locator('.mlp-card-selected')).toHaveCSS('border-color', 'rgb(110, 77, 155)');
			await expect(page.locator('.mlp-badge')).toHaveCSS('background-color', 'rgb(114, 76, 144)');
			await expect(page.locator('.mlp-badge')).toHaveCSS('color', 'rgb(255, 241, 255)');
			const action = page.locator('.mlp-new-style');
			await expect(action).toHaveCSS('background-color', 'rgb(98, 68, 137)');
			await expect(action).toHaveCSS('color', 'rgb(255, 240, 255)');
			await action.hover();
			await expect(action).toHaveCSS('background-color', 'rgb(78, 48, 110)');
		}
	}
});
