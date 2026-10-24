// Copies KaTeX's stylesheet and its woff2 fonts to dist/katex/, beside the
// KaTeX bundle esbuild writes to dist/katex-chunk.js. The stylesheet names the
// fonts by relative URL (fonts/KaTeX_*.woff2), and lists woff2 first, so the
// woff/ttf fallbacks are never requested and are not shipped.
// Run by esbuild.js on every build.
const fs = require('node:fs');
const path = require('node:path');

function buildKatexAssets() {
	const src = path.dirname(require.resolve('katex/dist/katex.min.css'));
	const out = path.join(__dirname, '..', 'dist', 'katex');
	fs.mkdirSync(path.join(out, 'fonts'), { recursive: true });
	fs.copyFileSync(path.join(src, 'katex.min.css'), path.join(out, 'katex.min.css'));
	for (const f of fs.readdirSync(path.join(src, 'fonts'))) {
		if (f.endsWith('.woff2')) fs.copyFileSync(path.join(src, 'fonts', f), path.join(out, 'fonts', f));
	}
	return out;
}

module.exports = { buildKatexAssets };

if (require.main === module) console.log(`wrote ${buildKatexAssets()}`);
