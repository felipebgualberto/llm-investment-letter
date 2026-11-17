/**
 * Count the printed pages of a Markdown document.
 *
 * WHY THIS EXISTS
 * ---------------
 * The brief asks for a report of one to two pages. On the morning of the
 * deadline the report was 6.541 words - roughly fifteen pages - because it had
 * been grown a section at a time and nobody had measured it. The letter has had
 * a page counter since the day it first ran long; the report did not, and that
 * asymmetry is exactly how a hard requirement gets missed.
 *
 * So the report is measured the same way the letter is: rendered, printed, and
 * counted from the PDF rather than estimated from a word count.
 *
 * The Markdown subset here covers what these documents actually use - headings,
 * bold, inline code, links, blockquotes, tables, lists, rules. It is a checking
 * tool, not a publishing pipeline: if it ever needs more than this, the right
 * move is a real converter, not more regexes.
 *
 * Run: npm run report-pages
 */

import { readFileSync, writeFileSync, existsSync, statSync, mkdirSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = resolve(root, process.argv[2] ?? '../docs/RELATORIO.md');
const maxPages = Number(process.argv[3] ?? 2);

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Inline formatting, applied after the block structure is settled. */
const inline = (s) =>
  esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

function toHtml(md) {
  const out = [];
  const lines = md.split(/\r?\n/);
  let para = [];
  let inTable = false;

  const flush = () => {
    if (para.length) out.push(`<p>${inline(para.join(' '))}</p>`);
    para = [];
  };
  const endTable = () => {
    if (inTable) {
      out.push('</tbody></table>');
      inTable = false;
    }
  };

  for (const line of lines) {
    const t = line.trim();

    if (/^\|/.test(t)) {
      // A separator row (|---|---|) closes the header rather than printing.
      if (/^\|[\s:|-]+\|$/.test(t)) continue;
      const cells = t.slice(1, -1).split('|').map((c) => inline(c.trim()));
      if (!inTable) {
        flush();
        out.push(`<table><thead><tr>${cells.map((c) => `<th>${c}</th>`).join('')}</tr></thead><tbody>`);
        inTable = true;
      } else {
        out.push(`<tr>${cells.map((c) => `<td>${c}</td>`).join('')}</tr>`);
      }
      continue;
    }
    endTable();

    if (t === '') { flush(); continue; }
    if (/^---+$/.test(t)) { flush(); out.push('<hr>'); continue; }

    const h = t.match(/^(#{1,6})\s+(.*)$/);
    if (h) { flush(); out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); continue; }

    if (/^>\s?/.test(t)) { flush(); out.push(`<blockquote>${inline(t.replace(/^>\s?/, ''))}</blockquote>`); continue; }
    if (/^[-*]\s+/.test(t)) { flush(); out.push(`<li>${inline(t.replace(/^[-*]\s+/, ''))}</li>`); continue; }

    para.push(t);
  }
  flush();
  endTable();
  return out.join('\n');
}

const md = readFileSync(target, 'utf8');
const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><style>
  @page { size: A4; margin: 18mm 18mm 16mm; }
  body { font: 10pt/1.45 'Segoe UI', system-ui, Helvetica, Arial, sans-serif; color: #111; margin: 0; }
  h1 { font-size: 16pt; margin: 0 0 6px; }
  h2 { font-size: 11.5pt; margin: 14px 0 5px; }
  h3 { font-size: 10.5pt; margin: 11px 0 4px; }
  p { margin: 0 0 7px; text-align: justify; }
  li { margin: 0 0 3px 16px; }
  blockquote { margin: 7px 0; padding-left: 10px; border-left: 3px solid #ddd; color: #444; }
  hr { border: none; border-top: 1px solid #ddd; margin: 10px 0; }
  table { width: 100%; border-collapse: collapse; font-size: 8.6pt; margin: 6px 0; }
  th, td { text-align: left; padding: 3px 5px; border-bottom: 1px solid #e5e7eb; vertical-align: top; }
  code { font-family: ui-monospace, Consolas, monospace; font-size: 9pt; }
</style></head><body>${toHtml(md)}</body></html>`;

const outDir = resolve(root, 'out');
mkdirSync(outDir, { recursive: true });
const htmlPath = resolve(outDir, `${basename(target, '.md')}.check.html`);
const pdfPath = resolve(outDir, `${basename(target, '.md')}.check.pdf`);
writeFileSync(htmlPath, html, 'utf8');

const CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome',
];
const browser = CANDIDATES.find((p) => existsSync(p));
if (!browser) {
  console.warn(`no Chromium found - wrote ${htmlPath}, count the pages by hand.`);
  process.exit(0);
}

execFileSync(browser, [
  '--headless=new', '--disable-gpu', '--no-pdf-header-footer',
  `--print-to-pdf=${pdfPath}`, `file:///${htmlPath.replace(/\\/g, '/')}`,
], { stdio: 'pipe', timeout: 90_000 });

const deadline = Date.now() + 15_000;
let size = 0;
while (Date.now() < deadline) {
  try { size = statSync(pdfPath).size; if (size > 0) break; } catch { /* not yet */ }
}

const words = md.split(/\s+/).filter(Boolean).length;
if (size === 0) {
  console.warn('PDF did not appear; count by hand.');
  process.exit(0);
}
const pages = (readFileSync(pdfPath, 'latin1').match(/\/Type\s*\/Page(?![s])/g) ?? []).length;
console.log(`${basename(target)}: ${words} palavras, ${pages} página(s) / ${maxPages}`);
if (pages > maxPages) {
  console.error(`  ACIMA DO LIMITE — o enunciado pede no máximo ${maxPages} páginas.`);
  process.exitCode = 1;
}
