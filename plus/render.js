#!/usr/bin/env node
// Renders a Markdown file with the built webview (dist/ + media/) in headless
// Chromium and prints what the plus features produced — a quick check against a
// real document, beside the e2e suite's small fixtures.
//
//   npm run compile && node plus/render.js path/to/note.md [--shot out.png] [--css theme.css] [--lines]
//
// The viewport is very tall so CodeMirror renders the whole document.
const { chromium } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2);
const valued = new Set(['--shot', '--css']);
const file = args.find((a, i) => !a.startsWith('--') && !valued.has(args[i - 1]));
if (!file) {
	console.error('usage: node plus/render.js <note.md> [--shot out.png] [--css theme.css] [--lines]');
	process.exit(2);
}
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const shot = option('--shot');
const css = option('--css') ? fs.readFileSync(option('--css'), 'utf8') : '';

(async () => {
	const browser = await chromium.launch();
	const page = await browser.newPage({ viewport: { width: 900, height: 30000 } });
	page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
	const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
	// KaTeX is fetched on demand; serve it, its stylesheet and fonts from dist/.
	await page.route('https://render.invalid/**', (route) => {
		const rel = new URL(route.request().url()).pathname.slice(1);
		const file = rel === 'katex-chunk.js' ? 'dist/katex-chunk.js' : `dist/${rel}`;
		route.fulfill({ body: fs.readFileSync(path.join(ROOT, file)), contentType: rel.endsWith('.js') ? 'application/javascript' : rel.endsWith('.css') ? 'text/css' : 'font/woff2' });
	});
	await page.setContent(`<!DOCTYPE html><html><head><meta charset="utf-8"/><style>
html,body{margin:0;background:#1e1e1e}#mlp-root{height:100%}
${read('media/webview-ui.css')}${read('media/webview-editor-theme.css')}${read('media/plus.css')}</style></head>
<body><div id="mlp-root"></div><script>window.__posted=[];window.acquireVsCodeApi=()=>({postMessage:m=>window.__posted.push(m),getState:()=>null,setState:()=>{}});
window.mlpKatexChunkUri='https://render.invalid/katex-chunk.js';window.mlpKatexBase='https://render.invalid/katex/';</script>
<script>${read('dist/webview-editor.js').replace(/<\/script>/gi, '<\\/script>')}</script></body></html>`);
	await page.evaluate(
		([text, theme]) => window.postMessage({ type: 'init', text, version: 1, css: theme, codeTheme: 'dark-plus', baseUri: 'https://example.invalid/' }, '*'),
		[fs.readFileSync(file, 'utf8'), css],
	);
	await page.waitForTimeout(1500);
	if (shot) {
		const height = await page.evaluate(() => Math.ceil(Math.max(...[...document.querySelectorAll('.cm-content > *')].map((e) => e.getBoundingClientRect().bottom)) + 24));
		await page.screenshot({ path: shot, clip: { x: 0, y: 0, width: 900, height } });
	}
	const r = await page.evaluate((withLines) => {
		const q = (s) => [...document.querySelectorAll(s)];
		return {
			wikilinks: { body: q('.cm-line .mlp-wikilink').length, inTables: q('table .mlp-wikilink').length, sample: q('.mlp-wikilink').slice(0, 3).map((a) => `${a.textContent} -> ${a.dataset.href}`) },
			tables: q('.mlp-table-wrap').map((w) => ({ inQuote: w.classList.contains('mlp-table-in-quote'), rows: w.querySelectorAll('tr').length, cols: w.querySelector('tr')?.children.length })),
			rawTables: q('.mlp-line-table-raw').length,
			callouts: q('.cm-line.mlp-callout-first').map((l) => `${[...l.classList].find((c) => c.startsWith('mlp-co-'))}: ${l.textContent.slice(0, 50)}`),
			footnotes: { refs: q('.mlp-fn-ref').length, defs: q('.cm-line.mlp-fn-def').length, firstRefs: q('.mlp-fn-ref').slice(0, 8).map((s) => s.textContent) },
			blockIds: q('.mlp-block-id').length,
			math: {
				inline: q('.cm-line .mlp-math:not(.mlp-math-display)').length,
				display: q('.mlp-math-display').length,
				rendered: q('.mlp-math .katex').length,
				errors: q('.mlp-math .katex-error').map((e) => e.getAttribute('title')?.slice(0, 120)),
				// Lines still showing a "$" outside rendered math: money, or math the parser missed.
				leftoverDollar: q('.cm-line').map((l) => { const c = l.cloneNode(true); c.querySelectorAll('.mlp-math').forEach((m) => m.remove()); return c.textContent; }).filter((t) => t.includes('$')).map((t) => t.slice(0, 110)),
			},
			leftoverBrackets: q('.cm-line').filter((l) => /\[\[|\]\]/.test(l.textContent)).map((l) => l.textContent.slice(0, 90)),
			lines: withLines ? q('.cm-line').map((l) => `${l.className} | ${l.textContent.slice(0, 80)}`) : undefined,
		};
	}, args.includes('--lines'));
	console.log(JSON.stringify(r, null, 1));
	await browser.close();
})();
