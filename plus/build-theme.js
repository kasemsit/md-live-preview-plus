#!/usr/bin/env node
// Builds media/sample-styles/thai-readable.css: plus/styles/thai-readable.theme.css
// with Sarabun embedded, so the theme needs no font installed on the machine.
// Run by esbuild.js on every build; edit the theme source, never the output.
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'media', 'sample-styles', 'thai-readable.css');
const FACES = [
	['Regular', 'normal', 400],
	['Bold', 'normal', 700],
	['Italic', 'italic', 400],
	['BoldItalic', 'italic', 700],
];

function buildTheme() {
	const head =
		'/* Built by plus/build-theme.js from plus/styles/thai-readable.theme.css.\n' +
		' * Sarabun is embedded (Regular, Bold, Italic, Bold Italic): no font install needed.\n' +
		' * Sarabun: Copyright 2018 The Sarabun Project Authors\n' +
		' * (https://github.com/cadsondemak/Sarabun), SIL Open Font License 1.1, see plus/fonts/OFL.txt. */\n';
	const faces = FACES.map(([name, style, weight]) => {
		const b64 = fs.readFileSync(path.join(__dirname, 'fonts', `Sarabun-${name}.ttf`)).toString('base64');
		return (
			`@font-face {\n\tfont-family: "Sarabun Embedded";\n\tfont-style: ${style};\n\tfont-weight: ${weight};\n` +
			`\tfont-display: swap;\n\tsrc: url(data:font/ttf;base64,${b64}) format("truetype");\n}\n`
		);
	}).join('');
	const theme = fs.readFileSync(path.join(__dirname, 'styles', 'thai-readable.theme.css'), 'utf8');
	const css = `${head}${faces}\n${theme}`;
	// Unchanged output is not rewritten, so a watch build does not loop on it.
	if (!fs.existsSync(OUT) || fs.readFileSync(OUT, 'utf8') !== css) fs.writeFileSync(OUT, css);
	return OUT;
}

module.exports = { buildTheme };

if (require.main === module) console.log(`wrote ${buildTheme()}`);
