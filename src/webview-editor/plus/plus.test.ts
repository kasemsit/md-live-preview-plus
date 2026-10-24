import { describe, it, expect } from 'vitest';
import { EditorState } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { ensureSyntaxTree } from '@codemirror/language';
import type { SyntaxNode } from '@lezer/common';
import { GFM } from '../gfmTableFix';
import { alignedBlockRange, readCellSpans } from '../livePreviewPlugin';
import { findCitations, findWikilinks, insideWikilink, splitTarget } from '../../shared/plusWikilinks';
import { cleanLine, extractLinks, keysForNote } from '../../shared/plusBacklinks';
import { quotePrefixLength } from './table';
import { scanFootnotes, nextFootnoteLabel } from './footnotes';
import { CALLOUT_HEAD, calloutStyle } from './callouts';
import { linkTexts } from './completion';
import { anchorsInText, extractPreview, findAnchorLine } from '../../shared/plusAnchors';
import { isNewer, parseReleaseTag } from '../../shared/plusVersion';
import { linkFileName, rankMatches } from '../../shared/plusLinks';

function parse(doc: string): { state: EditorState; tables: SyntaxNode[] } {
	const state = EditorState.create({ doc, extensions: [markdown({ extensions: GFM })] });
	const tree = ensureSyntaxTree(state, state.doc.length, 5000);
	if (!tree) throw new Error('syntax tree did not finish parsing in time');
	const tables: SyntaxNode[] = [];
	tree.iterate({
		enter(node) {
			if (node.name === 'Table') tables.push(node.node);
		},
	});
	return { state, tables };
}

describe('wikilink syntax', () => {
	it('finds target, label and the label offsets', () => {
		const text = 'a [[Laws/TH - PDPA#^ma-32|ม.32(2)]] b [[Plain]]';
		const [one, two] = findWikilinks(text);
		expect(one.target).toBe('Laws/TH - PDPA#^ma-32');
		expect(one.label).toBe('ม.32(2)');
		expect(text.slice(one.labelFrom, one.labelTo)).toBe('ม.32(2)');
		expect(two.label).toBe('Plain');
		expect(text.slice(two.labelFrom, two.labelTo)).toBe('Plain');
	});

	it('accepts the escaped separator used inside tables', () => {
		const [link] = findWikilinks('[[note\\|label]]');
		expect(link.target).toBe('note');
		expect(link.label).toBe('label');
	});

	it('reports pipes inside links only', () => {
		const text = '| [[a|b]] | c |';
		const inside = insideWikilink(text);
		expect(inside(text.indexOf('|', 2))).toBe(true);
		expect(inside(0)).toBe(false);
		expect(inside(text.lastIndexOf('|'))).toBe(false);
	});

	it('an unclosed [[ does not swallow the row', () => {
		const text = '| [[a | b |';
		expect(insideWikilink(text)(text.indexOf('|', 2))).toBe(false);
	});

	it('splits off the last anchor', () => {
		expect(splitTarget('Note#H1#H2')).toEqual({ name: 'Note', anchor: 'H2' });
		expect(splitTarget('#^id')).toEqual({ name: '', anchor: '^id' });
	});
});

describe('tables (PlusTable)', () => {
	it('keeps a header row holding [[a|b]] as two columns', () => {
		const { tables } = parse('| [[a|A]] | b |\n|---|---|\n| 1 | 2 |\n');
		expect(tables).toHaveLength(1);
	});

	it('reads body cells without splitting at a link pipe', () => {
		const { state, tables } = parse('| x | y |\n|---|---|\n| [[a|A]] | [[b\\|B]] |\n');
		const row = tables[0].getChild('TableRow')!;
		expect(readCellSpans(state, row).map((c) => c.text)).toEqual(['[[a|A]]', '[[b\\|B]]']);
	});

	it('lets a table interrupt a paragraph inside a blockquote', () => {
		const { state, tables } = parse('> text\n> | a | b |\n> |---|---|\n> | c | d |\n');
		expect(tables).toHaveLength(1);
		const range = alignedBlockRange(state, tables[0].from, tables[0].to);
		expect(range?.from).toBe(state.doc.line(2).from);
	});

	it('still refuses to widen over a list marker', () => {
		const { state, tables } = parse('- | a | b |\n  |---|---|\n  | c | d |\n');
		expect(alignedBlockRange(state, tables[0].from, tables[0].to)).toBeNull();
	});

	it('measures quote prefixes', () => {
		expect(quotePrefixLength('> | a |')).toBe(2);
		expect(quotePrefixLength('> > |---|')).toBe(4);
		expect(quotePrefixLength('|---|')).toBe(0);
	});
});

describe('footnotes', () => {
	const doc = (text: string) => EditorState.create({ doc: text }).doc;

	it('numbers defined labels by first citation, continuation lines joined', () => {
		const scan = scanFootnotes(doc('a[^x] b[^1] c[^nope]\n\n[^1]: one\n[^x]: ex\n  more\n'));
		expect([...scan.order.entries()]).toEqual([
			['x', 1],
			['1', 2],
		]);
		expect(scan.defs.get('x')?.text).toBe('ex more');
		expect(scan.firstDefLine).toBe(3);
	});

	it('numbers an uncited definition after the cited ones', () => {
		const scan = scanFootnotes(doc('a[^b]\n\n[^a]: A\n[^b]: B\n'));
		expect(scan.order.get('a')).toBe(2);
	});

	it('picks the next numeric label', () => {
		expect(nextFootnoteLabel('a[^3] b[^x] c[^10]')).toBe('11');
		expect(nextFootnoteLabel('none')).toBe('1');
	});
});

describe('callouts', () => {
	it('parses type, fold marker and title', () => {
		const m = CALLOUT_HEAD.exec('> [!warning]- Mind it')!;
		expect([m[2], m[3], m[4]]).toEqual(['warning', '-', 'Mind it']);
	});

	it('maps aliases and unknown types', () => {
		expect(calloutStyle('Caution').colour).toBe('orange');
		expect(calloutStyle('whatever')).toEqual(calloutStyle('note'));
	});
});

describe('anchors', () => {
	const text = '# Top\n\n## Second  part\n\nPara ^blk-1\n\n```\n# not a heading\n```\n';

	it('lists headings and block ids, skipping code', () => {
		expect(anchorsInText(text)).toEqual([
			{ kind: 'heading', text: 'Top', level: 1 },
			{ kind: 'heading', text: 'Second  part', level: 2 },
			{ kind: 'block', text: 'blk-1' },
		]);
	});

	it('finds the line of a heading (case and spacing ignored) or a block id', () => {
		const lines = text.split('\n');
		expect(findAnchorLine(lines, 'second part')).toBe(3);
		expect(findAnchorLine(lines, '^blk-1')).toBe(5);
		expect(findAnchorLine(lines, 'not a heading')).toBe(0);
	});
});

describe('link resolution', () => {
	it('adds .md only where the name has no file type', () => {
		expect(linkFileName('Laws/TH - PDPA 2562')).toBe('Laws/TH - PDPA 2562.md');
		expect(linkFileName('scan.pdf')).toBe('scan.pdf');
		expect(linkFileName('Note.md')).toBe('Note.md');
	});

	it('prefers the exact path, then the current folder, then the shortest path', () => {
		const c = (rel: string, dir: string) => ({ rel, dir, fsPath: `/w/${rel}` });
		const ranked = rankMatches([c('deep/x/Note.md', '/w/deep/x'), c('Note.md', '/w'), c('here/Note.md', '/w/here')], 'Note.md', '/w/here');
		expect(ranked.map((r) => r.rel)).toEqual(['Note.md', 'here/Note.md', 'deep/x/Note.md']);
	});

	it('completion writes the bare name unless it is ambiguous', () => {
		expect(
			linkTexts([
				{ name: 'A', path: 'x/A.md' },
				{ name: 'B', path: 'x/B.md' },
				{ name: 'b', path: 'y/b.md' },
			]),
		).toEqual(['A', 'x/B', 'y/b']);
	});
});

describe('update check versions', () => {
	it('reads plain and early plus tags', () => {
		expect(parseReleaseTag('v0.5.1')).toEqual([0, 5, 1]);
		expect(parseReleaseTag('v0.4.0-plus.2')).toEqual([0, 4, 2]);
		expect(parseReleaseTag('nightly')).toBeNull();
	});

	it('compares component-wise', () => {
		expect(isNewer([0, 5, 0], [0, 4, 9])).toBe(true);
		expect(isNewer([0, 4, 2], [0, 4, 2])).toBe(false);
		expect(isNewer([0, 4, 1], [0, 4, 2])).toBe(false);
	});
});

describe('hover preview extraction', () => {
	const law = [
		'---',
		'title: x',
		'---',
		'',
		'# TH - PDPA',
		'',
		'### มาตรา 31 — สิทธิให้โอนย้าย ^ma-31',
		'',
		'> มาตรา ๓๑ ...',
		'',
		'### มาตรา 32 — สิทธิคัดค้าน ^ma-32',
		'',
		'> มาตรา ๓๒ บรรทัดหนึ่ง',
		'> (๑) บรรทัดสอง',
		'',
		'## หมวด 4',
		'',
		'First line of a paragraph',
		'second line ^para-1',
		'',
		'| a | b |',
		'| 1 | 2 |',
		'^table-1',
		'',
		'- item one',
		'- item two ^li-2',
	];

	it('a block id on a heading previews the heading section, ids removed', () => {
		const p = extractPreview(law, '^ma-32');
		expect(p.text).toBe('### มาตรา 32 — สิทธิคัดค้าน\n\n> มาตรา ๓๒ บรรทัดหนึ่ง\n> (๑) บรรทัดสอง');
		expect(p.anchorFound).toBe(true);
	});

	it('a heading anchor previews its section up to the next heading of the same level', () => {
		expect(extractPreview(law, 'หมวด 4').text.split('\n')[0]).toBe('## หมวด 4');
		expect(extractPreview(law, 'หมวด 4').text).toContain('- item two');
	});

	it('a paragraph id previews the whole paragraph', () => {
		expect(extractPreview(law, '^para-1').text).toBe('First line of a paragraph\nsecond line');
	});

	it('an id on its own line previews the block above it', () => {
		expect(extractPreview(law, '^table-1').text).toBe('| a | b |\n| 1 | 2 |');
	});

	it('a list item id previews that item', () => {
		expect(extractPreview(law, '^li-2').text).toBe('- item two');
	});

	it('no anchor, or a missing one, previews the opening after the frontmatter', () => {
		expect(extractPreview(law, '').text.split('\n')[0]).toBe('# TH - PDPA');
		const missing = extractPreview(law, '^nope');
		expect(missing.anchorFound).toBe(false);
		expect(missing.text.split('\n')[0]).toBe('# TH - PDPA');
	});

	it('cuts long sections', () => {
		const long = ['# H', ...Array.from({ length: 100 }, (_, i) => `line ${i}`)];
		const p = extractPreview(long, 'H');
		expect(p.truncated).toBe(true);
		expect(p.text.split('\n').length).toBe(40);
	});
});

describe('citations', () => {
	it('finds keys in bracketed groups', () => {
		const text = 'As shown [@smith2020; see -@lee2019, p. 3] and [@a].';
		expect(findCitations(text).map((c) => c.key)).toEqual(['smith2020', 'lee2019', 'a']);
		const [first] = findCitations(text);
		expect(text.slice(first.from, first.to)).toBe('@smith2020');
		expect(text.slice(first.groupFrom, first.groupTo)).toBe('[@smith2020; see -@lee2019, p. 3]');
	});

	it('ignores e-mail addresses, wikilinks to reference notes, and links', () => {
		expect(findCitations('[mail a@b.com]')).toEqual([]);
		expect(findCitations('[[References/@smith2020|Smith 2020]]')).toEqual([]);
		expect(findCitations('[[@smith2020]]')).toEqual([]);
		expect(findCitations('[@x](https://x.org)')).toEqual([]);
	});

	it('does not take trailing punctuation into the key', () => {
		expect(findCitations('[@key.]')[0].key).toBe('key');
	});
});

describe('backlink index text', () => {
	const note = [
		'---',
		'related: "[[Ignored in frontmatter]]"',
		'---',
		'- See [[Laws/TH - PDPA#^ma-32|ม.32]] and [[Other]].',
		'> Cited [@smith2020].',
		'```',
		'[[In code]]',
		'```',
		'Same-note [[#Heading]] link.',
	].join('\n');

	it('extracts wikilinks and citations with lines, skipping frontmatter, code and same-note links', () => {
		expect(extractLinks(note).map((l) => [l.key, l.line, l.label])).toEqual([
			['laws/th - pdpa', 4, 'ม.32'],
			['other', 4, 'Other'],
			['@smith2020', 5, '@smith2020'],
		]);
	});

	it('cleans a line for display', () => {
		expect(cleanLine('- See [[Laws/TH - PDPA#^ma-32|ม.32]] here ^blk-1')).toBe('See ม.32 here');
		expect(cleanLine('> > quoted [[x]]')).toBe('quoted x');
	});

	it('indexes a note under its name and every trailing part of its path', () => {
		expect(keysForNote('Laws/TH - PDPA.md')).toEqual(['laws/th - pdpa', 'th - pdpa']);
		expect(keysForNote('References/@smith2020.md')).toEqual(['references/@smith2020', '@smith2020']);
	});
});
