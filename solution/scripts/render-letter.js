/**
 * Renders the letter to HTML and then to PDF.
 *
 * The prose comes from the Rivet graph. Save its `letter` output to
 * out/letter.txt and run this; without that file the renderer falls back to a
 * deterministic draft assembled from the plan, clearly marked as scaffolding,
 * so layout and pagination stay verifiable without spending a model call.
 *
 * PDF is produced by whichever Chromium is already on the machine
 * (`--headless --print-to-pdf`). No dependency, no install.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { renderLetterHtml, draftFromPlan } from '../src/render/letter.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => JSON.parse(readFileSync(resolve(root, 'out', f), 'utf8'));

const plan = read('letter-plan.json');
const portfolio = read('portfolio.json');
const metrics = read('metrics.json');
const market = read('market.json');

// --- the prose -------------------------------------------------------------
//
// out/letter.txt is where the Rivet graph's output gets pasted. An EMPTY file
// counts as absent: the file ships blank so there is something to open and
// paste into, and rendering a blank page because someone opened it without
// pasting would be a silly way to lose an hour.
const letterPath = resolve(root, 'out/letter.txt');
const rawLetter = existsSync(letterPath) ? readFileSync(letterPath, 'utf8') : '';
const fromGraph = rawLetter.trim().length > 0;
const letterText = fromGraph ? rawLetter : draftFromPlan(plan, portfolio, metrics);

console.log(
  fromGraph
    ? `prose: out/letter.txt (${rawLetter.trim().split(/\s+/).length} words from the Rivet graph)`
    : 'prose: deterministic draft — paste the graph output into out/letter.txt for the real letter',
);

// --- charts ----------------------------------------------------------------
const chartFile = (name) => {
  const p = resolve(root, 'out/charts', `${name}.svg`);
  return existsSync(p) ? readFileSync(p, 'utf8') : null;
};
const policy = JSON.parse(readFileSync(resolve(root, 'config/suitability-policy.json'), 'utf8'));
const placeCharts = policy.letter_budget?.chart_placement?.after_paragraph ?? {};
const charts = Object.fromEntries(
  [...new Set(Object.values(placeCharts))].map((name) => [name, chartFile(name)]),
);
for (const [name, svg] of Object.entries(charts)) {
  if (!svg) console.warn(`  warning: chart "${name}" missing — run scripts/build-charts.js`);
}

// --- provenance ------------------------------------------------------------
const retrieved = market.benchmarks?.cdi?.source?.retrieved_at?.slice(0, 10) ?? null;
const provenance =
  `Dados de mercado obtidos em ${retrieved ?? 'data não registrada'} junto ao Banco Central (SGS e Focus), ` +
  `CVM (Informe Diário de Fundos) e provedor de cotações. Período de referência: ` +
  `${metrics.reference?.period?.start} a ${metrics.reference?.period?.end}.`;

const proposalsParagraph = policy.letter_budget?.proposals_after_paragraph ?? null;
const html = renderLetterHtml({ letterText, plan, portfolio, metrics, charts, provenance, placeCharts, proposalsParagraph });

mkdirSync(resolve(root, 'out'), { recursive: true });
const htmlPath = resolve(root, 'out/letter.html');
writeFileSync(htmlPath, html, 'utf8');
console.log(`wrote ${htmlPath}`);

// --- word budget -----------------------------------------------------------
// Checked here rather than trusted: the plan caps the payload, but the model
// writes the prose and could still run long.
const words = letterText.split(/\s+/).filter(Boolean).length;
const budget = plan.budget?.max_words ?? 800;
console.log(`words: ${words} / ${budget}${words > budget ? '  OVER BUDGET' : ''}`);

// --- PDF -------------------------------------------------------------------
const CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];

const browser = CANDIDATES.find((p) => existsSync(p));
if (!browser) {
  console.warn('no Chromium found — HTML written, PDF skipped. Open out/letter.html and print to PDF.');
  process.exit(0);
}

const pdfPath = resolve(root, 'out/letter.pdf');
try {
  execFileSync(browser, [
    '--headless=new',
    '--disable-gpu',
    '--no-pdf-header-footer',
    `--print-to-pdf=${pdfPath}`,
    `file:///${htmlPath.replace(/\\/g, '/')}`,
  ], { stdio: 'pipe', timeout: 90_000 });

  // Chromium returns before the file is flushed to disk. Checking immediately
  // reports a failure for a PDF that appears half a second later, so we wait
  // for the write to land rather than trusting the exit code.
  const deadline = Date.now() + 15_000;
  let size = 0;
  while (Date.now() < deadline) {
    try {
      size = statSync(pdfPath).size;
      if (size > 0) break;
    } catch { /* not written yet */ }
  }

  if (size > 0) {
    console.log(`wrote ${pdfPath}  (${(size / 1024).toFixed(0)} KB)`);

    // The two-page cap is the one hard requirement in the brief, and the word
    // budget above only approximates it - charts take space that words do not.
    // So the finished PDF is counted. `/Type /Page` appears once per page
    // object; the negative lookahead keeps the `/Pages` tree node out of the
    // tally.
    const pdf = readFileSync(pdfPath, 'latin1');
    const pages = (pdf.match(/\/Type\s*\/Page(?![s])/g) ?? []).length;
    const maxPages = plan.budget?.max_pages ?? 2;
    if (pages === 0) {
      console.warn('pages: could not count pages in the PDF — check it by hand.');
    } else if (pages > maxPages) {
      console.error(`pages: ${pages} / ${maxPages}  OVER THE LIMIT — the brief caps the letter at ${maxPages} pages.`);
      process.exitCode = 1;
    } else {
      console.log(`pages: ${pages} / ${maxPages}`);
    }
  } else {
    console.warn('PDF did not appear within 15s. HTML is written; print it manually.');
  }
} catch (error) {
  console.warn(`PDF step failed: ${error.message.split('\n')[0]}`);
  console.warn('HTML is written; open it and print to PDF manually.');
}
