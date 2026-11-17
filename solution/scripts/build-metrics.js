import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deriveReferenceDate, referenceOverrideFromArgv } from '../src/lib/reference.js';
import { parsePortfolio } from '../src/parse/portfolio.js';
import { parsePrices } from '../src/parse/prices.js';
import { computePerformance } from '../src/engine/returns.js';
import { fundsVsDeclaredBenchmark } from '../src/engine/fund-benchmark.js';
import { concentration, positionsForConcentration } from '../src/engine/concentration.js';
import { assertNoErrors } from '../src/lib/guard.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const inputs = resolve(root, '../Input');
const referenceOverride = referenceOverrideFromArgv();

const portfolio = parsePortfolio(readFileSync(resolve(inputs, 'XP - Albert_s portfolio.txt'), 'utf8'));

// Reference month comes from the statement, not the wall clock. See src/lib/reference.js.
const reference = deriveReferenceDate(portfolio, { override: referenceOverride });
const referenceDate = reference.date;
const { prices } = parsePrices(readFileSync(resolve(inputs, 'profitability_calc_wip.csv'), 'utf8'));
const funds = JSON.parse(readFileSync(resolve(root, 'out/funds.json'), 'utf8'));
const market = JSON.parse(readFileSync(resolve(root, 'out/market.json'), 'utf8'));

const perf = computePerformance({ portfolio, prices, funds, market, referenceDate });

// Each fund against the indicator IT declared to the CVM, not against a house
// default. See src/engine/fund-benchmark.js.
perf.funds_vs_declared_benchmark = fundsVsDeclaredBenchmark(funds.results, market);
perf.fund_costs = funds.cost ?? null;

// Thirteen positions, two of which are 43,6% of the money. A count says
// 'diversified'; the effective number says what the portfolio behaves like.
perf.concentration = concentration(positionsForConcentration(portfolio));

// Flags raised while pricing the funds belong in the same list as every other
// data-quality note. The 'fee row not yet in force' flag in particular is the
// evidence behind the fee the annex prints.
if (funds.data_quality_flags?.length) {
  perf.data_quality_flags = [...(perf.data_quality_flags ?? []), ...funds.data_quality_flags];
}
assertNoErrors('build-metrics', perf.data_quality_flags);
writeFileSync(resolve(root, 'out/metrics.json'), JSON.stringify(perf, null, 2), 'utf8');

const pct = (v, d = 2) => (v * 100).toFixed(d) + '%';
const brl = (v) => 'R$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

console.log(`REFERENCIA: ${perf.reference.period?.label_pt ?? perf.reference.month}\n`);
console.log(`RETORNO DA PARCELA MEDIDA: ${pct(perf.portfolio_return, 3)}   (${brl(perf.pnl)})`);
console.log(`  base inicial ${brl(perf.v0_total)} -> final ${brl(perf.v1_total)}`);
console.log(`  cobertura: ${pct(perf.coverage.share_of_invested)} do investido | ${pct(perf.coverage.share_of_net_worth)} do patrimonio\n`);

console.log('ATRIBUICAO POR ATIVO (contribuicao em p.p. sobre a base medida):');
for (const m of [...perf.by_holding].sort((a, b) => b.contribution_pp - a.contribution_pp)) {
  console.log(
    `  ${String(m.contribution_pp.toFixed(3)).padStart(7)} p.p.  ` +
    `${m.label.slice(0, 40).padEnd(40)} ret ${pct(m.return, 2).padStart(9)}  ` +
    `peso ${pct(m.weight_start).padStart(7)}  ${brl(m.pnl).padStart(15)}`,
  );
}
console.log(`  ${'-'.repeat(7)}`);
console.log(`  ${perf.attribution.sum_check_pp.toFixed(3).padStart(7)} p.p.  SOMA (deve bater com o retorno acima)\n`);

console.log('POR CLASSE:');
for (const s of perf.by_sleeve) {
  console.log(`  ${s.sleeve.padEnd(8)} ret ${pct(s.return, 3).padStart(9)}  contrib ${s.contribution_pp.toFixed(3).padStart(7)} p.p.  ${brl(s.pnl).padStart(15)}`);
}

console.log('\nVERSUS BENCHMARKS:');
for (const [k, v] of Object.entries(perf.versus)) {
  if (!v) { console.log(`  ${k.padEnd(10)} indisponivel`); continue; }
  console.log(`  ${k.padEnd(10)} ${pct(v.value, 3).padStart(9)}   excesso ${String(v.excess_pp.toFixed(3)).padStart(8)} p.p.` + (v.real_return !== undefined ? `   ganho real ${pct(v.real_return, 3)}` : ''));
}

console.log('\nNAO MEDIDO:');
for (const u of perf.unmeasured) console.log(`  ${brl(u.market_value).padStart(15)}  ${pct(u.weight).padStart(7)}  ${u.label}\n      ${u.reason}`);

console.log('\nFLAGS:');
for (const f of perf.data_quality_flags) console.log(`  [${f.severity}] ${f.code}: ${f.detail}`);
