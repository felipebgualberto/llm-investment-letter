/**
 * Renders the advisor annex to HTML and then to PDF.
 *
 * Unlike the client letter, this script needs no prose from anywhere: it reads
 * the engine's own output files and prints them. There is no `letter.txt`
 * equivalent and no model call, which is the point - see src/render/annex.js.
 *
 * The annex has no page limit. The client letter is capped at two pages by the
 * brief; the advisor's copy is capped by how much evidence there is.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { renderAnnexHtml } from '../src/render/annex.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => JSON.parse(readFileSync(resolve(root, 'out', f), 'utf8'));

const plan = read('letter-plan.json');
const portfolio = read('portfolio.json');
const metrics = read('metrics.json');
const market = read('market.json');
const recommendations = read('recommendations.json');

// The forensic consensus charts live only here. Missing files are reported
// rather than silently skipped: an annex whose section 7 is empty because
// build-charts never ran would look like a finding rather than a bug.
const chartFile = (name) => {
  const p = resolve(root, 'out/charts', `${name}.svg`);
  return existsSync(p) ? readFileSync(p, 'utf8') : null;
};
const charts = Object.fromEntries(
  ['consensus-selic', 'consensus-ipca', 'consensus', 'benchmarks', 'allocation', 'positions'].map((n) => [n, chartFile(n)]),
);
for (const [name, svg] of Object.entries(charts)) {
  if (!svg) console.warn(`  warning: chart "${name}" missing — run scripts/build-charts.js`);
}

const retrieved = market.benchmarks?.cdi?.source?.retrieved_at?.slice(0, 10) ?? null;
const provenance =
  `Dados obtidos em ${retrieved ?? 'data não registrada'} junto ao Banco Central (SGS e Boletim Focus), ` +
  `CVM (Informe Diário de Fundos e cadastro de classes) e provedor de cotações. ` +
  `Período de referência: ${metrics.reference?.period?.start} a ${metrics.reference?.period?.end}.`;

const html = renderAnnexHtml({ plan, portfolio, metrics, recommendations, charts, provenance });

mkdirSync(resolve(root, 'out'), { recursive: true });
const htmlPath = resolve(root, 'out/annex.html');
writeFileSync(htmlPath, html, 'utf8');
console.log(`wrote ${htmlPath}`);

const findings = (plan.letter?.findings?.length ?? 0) + (plan.advisor_annex?.findings?.length ?? 0);
console.log(
  `annex: ${findings} pontos de atenção, ` +
    `${plan.advisor_annex?.recommendations?.length ?? 0} sugestões diferidas, ` +
    `${plan.advisor_annex?.full_attribution?.length ?? 0} posições apuradas, ` +
    `${plan.advisor_annex?.data_quality_flags?.length ?? 0} flags de qualidade`,
);

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
  console.warn('no Chromium found — HTML written, PDF skipped. Open out/annex.html and print to PDF.');
  process.exit(0);
}

const pdfPath = resolve(root, 'out/annex.pdf');
try {
  execFileSync(browser, [
    '--headless=new',
    '--disable-gpu',
    '--no-pdf-header-footer',
    `--print-to-pdf=${pdfPath}`,
    `file:///${htmlPath.replace(/\\/g, '/')}`,
  ], { stdio: 'pipe', timeout: 90_000 });

  // Chromium returns before the file is flushed; wait for the write to land.
  const deadline = Date.now() + 15_000;
  let size = 0;
  while (Date.now() < deadline) {
    try {
      size = statSync(pdfPath).size;
      if (size > 0) break;
    } catch { /* not written yet */ }
  }

  if (size > 0) {
    const pdf = readFileSync(pdfPath, 'latin1');
    const pages = (pdf.match(/\/Type\s*\/Page(?![s])/g) ?? []).length;
    console.log(`wrote ${pdfPath}  (${(size / 1024).toFixed(0)} KB, ${pages || '?'} páginas)`);
  } else {
    console.warn('PDF did not appear within 15s. HTML is written; print it manually.');
  }
} catch (error) {
  console.warn(`PDF step failed: ${error.message.split('\n')[0]}`);
  console.warn('HTML is written; open it and print to PDF manually.');
}
