/**
 * Render the project's Markdown documents as styled Word files.
 *
 * WHY
 * ---
 * The case arrived as .docx and will be opened in Word. Markdown is the right
 * format to WRITE these documents in - it diffs, it lives beside the code, and
 * the page-count checker reads it - but it is the wrong format to hand over: a
 * reviewer opening RELATORIO.md in Notepad sees hashes and pipes.
 *
 * So the .md files stay the source of truth and this produces the deliverable,
 * in the same visual language as the letter: black band, yellow rules, one
 * typeface, XP's own mark on the first page.
 *
 * SCOPE
 * -----
 * The Markdown subset these documents actually use - headings, paragraphs,
 * bold, italic, inline code, links, blockquotes, bullet lists, tables and
 * horizontal rules. It is not a general converter and should not become one; if
 * a document ever needs more, that is a signal the document is doing too much.
 *
 * Run: npm run docx
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Document, Packer, Paragraph, TextRun, ExternalHyperlink, HeadingLevel,
  AlignmentType, BorderStyle, Table, TableRow, TableCell, WidthType, ShadingType,
  ImageRun, LevelFormat, convertInchesToTwip,
} from 'docx';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// --- house identity, matching src/render/brand.js --------------------------
const BLACK = '000000';
const YELLOW = 'FFC709';
const INK = '111111';
const MUTED = '6B7280';
const RULE = 'E5E7EB';
const FONT = 'Segoe UI';
const MONO = 'Consolas';

// A4 content width in DXA (twentieths of a point). 1440 DXA = 1 inch.
const PAGE_W = 11906;
const MARGIN = convertInchesToTwip(0.7);
const CONTENT_W = PAGE_W - MARGIN * 2;

// --- inline Markdown -------------------------------------------------------

/**
 * Split a line into runs, honouring `code`, **bold**, *italic* and [text](url).
 *
 * Written as one pass over a combined pattern rather than nested replaces: a
 * replace chain turns `**[texto](url)**` into overlapping matches and loses the
 * link.
 */
function inlineRuns(text, { bold = false, italics = false, color = INK, size = 20 } = {}) {
  const runs = [];
  const pattern = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  let m;

  const plain = (s, extra = {}) => {
    if (!s) return;
    runs.push(new TextRun({ text: s, font: FONT, size, color, bold, italics, ...extra }));
  };

  while ((m = pattern.exec(text))) {
    plain(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith('`')) {
      runs.push(new TextRun({
        text: tok.slice(1, -1), font: MONO, size: size - 2, color, bold,
      }));
    } else if (tok.startsWith('**')) {
      plain(tok.slice(2, -2), { bold: true });
    } else if (tok.startsWith('*')) {
      plain(tok.slice(1, -1), { italics: true });
    } else {
      const link = tok.match(/^\[([^\]]+)\]\(([^)]+)\)/);
      const label = link[1].replace(/`/g, '');
      const href = link[2];
      // A relative path is not a working hyperlink once the file is opened from
      // a different folder, so only real URLs become links. Everything else is
      // printed as the path it is - which is what a reader needs anyway.
      if (/^https?:/.test(href)) {
        runs.push(new ExternalHyperlink({
          link: href,
          children: [new TextRun({ text: label, font: FONT, size, color: '1F4E79', underline: {} })],
        }));
      } else {
        runs.push(new TextRun({ text: label, font: MONO, size: size - 2, color: INK, bold }));
      }
    }
    last = m.index + tok.length;
  }
  plain(text.slice(last));
  return runs.length ? runs : [new TextRun({ text: '', font: FONT, size })];
}

// --- block Markdown --------------------------------------------------------

const yellowRule = { bottom: { style: BorderStyle.SINGLE, size: 12, color: YELLOW, space: 4 } };
const greyRule = { bottom: { style: BorderStyle.SINGLE, size: 4, color: RULE, space: 6 } };

function tableFrom(rows) {
  const cols = Math.max(...rows.map((r) => r.length));
  // Dual widths: the table declares columnWidths and every cell declares its
  // own, both in DXA. Percentages break in Google Docs.
  const colW = Math.floor(CONTENT_W / cols);
  const widths = Array.from({ length: cols }, () => colW);

  return new Table({
    columnWidths: widths,
    width: { size: colW * cols, type: WidthType.DXA },
    borders: {
      top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE },
      left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: RULE },
      insideVertical: { style: BorderStyle.NONE },
    },
    rows: rows.map((cells, r) => new TableRow({
      children: Array.from({ length: cols }, (_, c) => new TableCell({
        width: { size: colW, type: WidthType.DXA },
        margins: { top: 60, bottom: 60, left: 100, right: 100 },
        shading: r === 0 ? { type: ShadingType.CLEAR, fill: 'F7F7F5' } : undefined,
        borders: r === 0
          ? { bottom: { style: BorderStyle.SINGLE, size: 8, color: INK } }
          : undefined,
        children: [new Paragraph({
          spacing: { before: 0, after: 0 },
          children: inlineRuns(cells[c] ?? '', { bold: r === 0, size: 17 }),
        })],
      })),
    })),
  });
}

function convert(md, { title, subtitle }) {
  const children = [];

  // Letterhead: XP's own mark, on the band it was drawn for.
  const logo = resolve(root, 'assets/xp-logo-on-black.png');
  if (existsSync(logo)) {
    children.push(new Paragraph({
      spacing: { after: 110 },
      children: [new ImageRun({
        type: 'png',
        data: readFileSync(logo),
        transformation: { width: 118, height: 31 },
      })],
    }));
  }

  children.push(new Paragraph({
    spacing: { after: 40 },
    border: yellowRule,
    children: [new TextRun({ text: title, font: FONT, size: 30, bold: true, color: INK })],
  }));
  if (subtitle) {
    children.push(new Paragraph({
      spacing: { before: 80, after: 170 },
      children: inlineRuns(subtitle, { color: MUTED, size: 18 }),
    }));
  }

  const lines = md.split(/\r?\n/);
  let para = [];
  let table = null;
  let fence = null; // collected lines of a ``` block, or null outside one

  const flushPara = () => {
    if (!para.length) return;
    children.push(new Paragraph({
      spacing: { after: 110, line: 268 },
      alignment: AlignmentType.JUSTIFIED,
      children: inlineRuns(para.join(' ')),
    }));
    para = [];
  };
  const flushTable = () => {
    if (!table) return;
    children.push(tableFrom(table));
    children.push(new Paragraph({ spacing: { after: 140 }, children: [] }));
    table = null;
  };

  for (const raw of lines) {
    const t = raw.trim();

    // Fenced code blocks.
    //
    // Without this they collapsed into a single justified paragraph carrying
    // the literal backticks - and in LEIA-ME that paragraph was the list of
    // commands for running the project, run together on one line. Word has no
    // newline inside a paragraph, so each source line becomes its own
    // paragraph, all sharing the same shading so they read as one block.
    if (/^```/.test(t)) {
      if (fence === null) { flushPara(); fence = []; }
      else {
        const last = fence.length - 1;
        fence.forEach((code, i) => {
          children.push(new Paragraph({
            spacing: { before: i === 0 ? 40 : 0, after: i === last ? 150 : 0, line: 240 },
            shading: { type: ShadingType.CLEAR, fill: 'F4F4F2' },
            indent: { left: 160, right: 160 },
            border: {
              left: { style: BorderStyle.SINGLE, size: 12, color: RULE, space: 8 },
              ...(i === 0 ? { top: { style: BorderStyle.SINGLE, size: 2, color: 'F4F4F2', space: 4 } } : {}),
              ...(i === last ? { bottom: { style: BorderStyle.SINGLE, size: 2, color: 'F4F4F2', space: 4 } } : {}),
            },
            children: [new TextRun({
              // A blank line inside the block still needs a run, or Word
              // collapses the paragraph and the spacing goes ragged.
              text: code.length ? code : ' ',
              font: MONO,
              size: 17,
              color: '1F2328',
            })],
          }));
        });
        fence = null;
      }
      continue;
    }
    if (fence !== null) { fence.push(raw.replace(/\t/g, '    ')); continue; }

    if (/^\|/.test(t)) {
      flushPara();
      if (/^\|[\s:|-]+\|$/.test(t)) continue; // separator row
      const cells = t.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
      (table ??= []).push(cells);
      continue;
    }
    flushTable();

    if (t === '') { flushPara(); continue; }

    if (/^---+$/.test(t)) {
      flushPara();
      // A paragraph bottom border, not a one-cell table.
      children.push(new Paragraph({ spacing: { before: 60, after: 160 }, border: greyRule, children: [] }));
      continue;
    }

    const h = t.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      flushPara();
      const level = h[1].length;
      // The document's own H1 is the title block above, so an H1 inside the
      // body is skipped rather than printed twice.
      if (level === 1) continue;
      children.push(new Paragraph({
        heading: level === 2 ? HeadingLevel.HEADING_1 : HeadingLevel.HEADING_2,
        spacing: { before: level === 2 ? 240 : 180, after: level === 2 ? 90 : 70 },
        border: level === 2 ? yellowRule : undefined,
        children: inlineRuns(h[2], { bold: true, size: level === 2 ? 24 : 21 }),
      }));
      continue;
    }

    if (/^>\s?/.test(t)) {
      flushPara();
      children.push(new Paragraph({
        spacing: { before: 70, after: 120, line: 262 },
        indent: { left: 240 },
        border: { left: { style: BorderStyle.SINGLE, size: 18, color: YELLOW, space: 10 } },
        shading: { type: ShadingType.CLEAR, fill: 'F7F7F5' },
        children: inlineRuns(t.replace(/^>\s?/, ''), { color: '333333' }),
      }));
      continue;
    }

    if (/^[-*]\s+/.test(t)) {
      flushPara();
      children.push(new Paragraph({
        numbering: { reference: 'bullets', level: 0 },
        spacing: { after: 55, line: 262 },
        children: inlineRuns(t.replace(/^[-*]\s+/, '')),
      }));
      continue;
    }

    para.push(t);
  }
  flushPara();
  flushTable();

  return new Document({
    creator: 'Felipe Bissoli Gualberto',
    title,
    numbering: {
      config: [{
        reference: 'bullets',
        levels: [{
          level: 0,
          format: LevelFormat.BULLET,
          text: '•',
          alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 340, hanging: 200 } } },
        }],
      }],
    },
    styles: {
      default: {
        heading1: { run: { font: FONT, color: INK }, paragraph: {} },
        heading2: { run: { font: FONT, color: INK }, paragraph: {} },
      },
    },
    sections: [{
      properties: { page: { margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN } } },
      children,
    }],
  });
}

// --- the three documents ---------------------------------------------------

const DOCS = [
  { md: '../docs/LEIA-ME.md', out: '../delivery/LEIA-ME.docx', title: 'Case técnico — carta mensal de investimentos', subtitle: 'Felipe Bissoli Gualberto · setembro de 2026 · comece por aqui' },
  { md: '../docs/RELATORIO.md', out: '../delivery/RELATORIO.docx', title: 'Carta mensal de investimentos — revisão do workflow', subtitle: 'Felipe Bissoli Gualberto · setembro de 2026 · relatório' },
  { md: '../docs/DOSSIE-TECNICO.md', out: '../delivery/DOSSIE-TECNICO.docx', title: 'Dossiê técnico — carta mensal de investimentos XP', subtitle: 'Felipe Bissoli Gualberto · setembro de 2026 · material de apoio, não é o relatório' },
];

for (const d of DOCS) {
  const src = resolve(root, d.md);
  const dst = resolve(root, d.out);
  let md = readFileSync(src, 'utf8');
  // Drop the title block: the letterhead above replaces it.
  md = md.replace(/^#\s+[^\n]*\n/, '').replace(/^\*\*Felipe[^\n]*\n/m, '');
  const doc = convert(md, { title: d.title, subtitle: d.subtitle });
  mkdirSync(dirname(dst), { recursive: true });
  writeFileSync(dst, await Packer.toBuffer(doc));
  const kb = (readFileSync(dst).length / 1024).toFixed(0);
  console.log(`${basename(d.md).padEnd(22)} -> ${basename(d.out).padEnd(22)} ${kb} KB`);
}
