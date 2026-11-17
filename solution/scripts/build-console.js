/**
 * Builds out/console.html — the page an advisor actually opens.
 *
 * Runs last in the pipeline, after the letter and the annex exist, because it
 * links to both. Reads only the engine's output files; writes one self-contained
 * HTML page next to them, so the whole `out/` folder can be zipped and sent.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderConsoleHtml, moneyAtStake, workItems, flatten } from '../src/render/console.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => JSON.parse(readFileSync(resolve(root, 'out', f), 'utf8'));

const plan = read('letter-plan.json');
const portfolio = read('portfolio.json');
const metrics = read('metrics.json');
const market = read('market.json');

const chartFile = (name) => {
  const p = resolve(root, 'out/charts', `${name}.svg`);
  return existsSync(p) ? readFileSync(p, 'utf8') : null;
};

const findings = [...(plan.letter?.findings ?? []), ...(plan.advisor_annex?.findings ?? [])];
const stake = moneyAtStake(findings, portfolio);
const items = workItems(plan);

// One entry, shaped as a list. The console is a queue of clients even when the
// queue has one row: writing it as a special case for a single account would
// have to be undone the moment a second statement arrives, and the whole
// argument for the page is what it looks like at 300.
const clients = [
  {
    id: String(portfolio.client?.account ?? 'client'),
    name: portfolio.client?.name ?? '',
    account: portfolio.client?.account ?? '',
    net_worth: portfolio.totals?.net_worth,
    month_return: metrics.sensitivity?.net_worth?.return ?? metrics.portfolio_return,
    measured_return: metrics.portfolio_return,
    pnl: metrics.pnl,
    coverage: metrics.coverage?.share_of_invested,
    fund_cost: metrics.fund_costs?.annual_cost_brl ?? null,
    fund_cost_pct: metrics.fund_costs?.weighted_average_pct ?? null,
    concentration: metrics.concentration ?? null,
    period: metrics.reference?.period?.label_pt ?? '',
    month: metrics.reference?.month ?? null,
    stake,
    open_items: flatten(items).length,
    items,
    charts: {
      positions: chartFile('positions'),
      attribution: chartFile('attribution'),
    },
  },
];

const html = renderConsoleHtml({
  clients,
  advisor: {
    name: portfolio.advisor?.name ?? '',
    code: portfolio.advisor?.code ?? '',
  },
  // Stamped from the clock on purpose: this is the only file in the project
  // whose job is to say how fresh it is. Everything else derives its dates from
  // the statement, so that a rebuild reproduces byte for byte.
  generatedAt: new Date().toLocaleString('pt-BR'),
  dataRetrieved: market.benchmarks?.cdi?.source?.retrieved_at?.slice(0, 10) ?? null,
});

mkdirSync(resolve(root, 'out'), { recursive: true });
const out = resolve(root, 'out/console.html');
writeFileSync(out, html, 'utf8');

console.log(`wrote ${out}`);
console.log(
  `console: ${clients.length} cliente(s), ${flatten(items).length} itens decidíveis em ${items.length} blocos, ` +
    `R$ ${stake.action_required.toLocaleString('pt-BR', { maximumFractionDigits: 0 })} aguardando ação ` +
    `em ${stake.positions} posições`,
);
