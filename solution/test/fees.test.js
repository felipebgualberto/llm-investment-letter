/**
 * Fund fees, and each fund against the benchmark it declared.
 *
 * The fee tests exist mostly for one case: a rate published today that takes
 * effect after the month being reported. Getting it wrong is invisible - the
 * wrong number is perfectly plausible - so it has to be caught by a test rather
 * than by a reader.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { annualCost } from '../src/data/cvm-fees.js';
import { fundsVsDeclaredBenchmark } from '../src/engine/fund-benchmark.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => JSON.parse(readFileSync(resolve(root, 'out', f), 'utf8'));

const funds = read('funds.json');
const metrics = read('metrics.json');
const market = read('market.json');

// --- the date trap ---------------------------------------------------------

test('a fee that takes effect after the reference date is not used', () => {
  // Truxt Long Bias publishes 1,90% from 2022-12-29 and 2,00% from 2025-06-16.
  // The statement is dated 2025-05-07. Taking the newest row prints 2,00% - a
  // fee that did not exist in the month being reported.
  const truxt = funds.cost.lines.find((l) => /Truxt/i.test(l.label));
  assert.ok(truxt, 'the fixture must contain the Truxt position');
  assert.equal(truxt.administration_pct, 1.9);
  assert.equal(truxt.administration_in_force_since, '2022-12-29');
});

test('discarding a future fee row is recorded, not silent', () => {
  const flag = metrics.data_quality_flags.find((f) => f.code === 'fee_version_not_yet_in_force');
  assert.ok(flag, 'the discarded row must leave a trace');
  assert.match(flag.detail, /2025-04-30/);
  assert.equal(flag.origin, 'cvm_fees');
});

test('among rows already in force, the latest one wins', () => {
  // Brave publishes 0,17% from 2020-05-28 and 0,90% from 2020-11-23. Both
  // precede the reference date, so the later one is the one in force.
  const brave = funds.cost.lines.find((l) => /Brave/i.test(l.label));
  assert.equal(brave.administration_pct, 0.9);
  assert.equal(brave.administration_in_force_since, '2020-11-23');
});

// --- arithmetic ------------------------------------------------------------

test('each line is its own position value times its own rate', () => {
  for (const l of funds.cost.lines) {
    if (l.administration_pct === null) continue;
    const expected = (l.market_value * l.administration_pct) / 100;
    assert.ok(
      Math.abs(l.annual_cost_brl - expected) < 0.01,
      `${l.label}: ${l.annual_cost_brl} != ${expected}`,
    );
  }
});

test('the total is the sum of the lines, and the average is derived from it', () => {
  const summed = funds.cost.lines.reduce((s, l) => s + (l.annual_cost_brl ?? 0), 0);
  assert.ok(Math.abs(summed - funds.cost.annual_cost_brl) < 0.01);
  assert.ok(Math.abs(funds.cost.monthly_cost_brl * 12 - funds.cost.annual_cost_brl) < 0.15);

  const implied = (funds.cost.annual_cost_brl / funds.cost.priced_value_brl) * 100;
  assert.ok(Math.abs(implied - funds.cost.weighted_average_pct) < 0.01);
});

test('coverage is stated, because one fund could not be priced', () => {
  // Trend Investback never resolved to a CNPJ, so it has no published fee. The
  // weighted average is over what could be priced and says so - the same rule
  // the returns engine follows for the measured share of the portfolio.
  assert.ok(funds.cost.coverage < 1, 'the fixture should have an unpriced position');
  assert.ok(funds.cost.unpriced_value_brl > 0);
  const unpriced = funds.cost.lines.filter((l) => l.administration_pct === null);
  assert.ok(unpriced.length > 0);
  for (const l of unpriced) assert.ok(l.reason, 'an unpriced line must say why');
});

test('a performance fee is never converted into reais', () => {
  // It depends on a high-water mark and an accrual calendar that no public
  // dataset carries. A number would look measured while being guessed.
  for (const l of funds.cost.lines) {
    assert.ok(!('performance_cost_brl' in l));
    if (l.performance) assert.ok(Number.isFinite(l.performance.rate_pct));
  }
});

test('an unreadable rate is dropped rather than printed', () => {
  const holdings = [{ statement_name: 'X', cnpj: '11111111111111', market_value: 1000 }];
  const fees = new Map([
    ['11111111111111', { administration: { rate_pct: null, in_force_since: '2020-01-01' }, performance: null }],
  ]);
  const cost = annualCost(holdings, fees);
  assert.equal(cost.annual_cost_brl, 0);
  assert.equal(cost.lines[0].annual_cost_brl, null);
  assert.ok(cost.lines[0].reason);
});

// --- declared benchmarks ---------------------------------------------------

test('a fund is measured against the indicator it declared, not against the CDI', () => {
  const rows = metrics.funds_vs_declared_benchmark.rows;
  const constellation = rows.find((r) => /Constellation/i.test(r.label));
  assert.equal(constellation.declared_benchmark, 'Ibovespa');
  assert.equal(constellation.benchmark_key, 'ibovespa');
  // market.json is not uniform: `cdi` is a bare number and `ibovespa` is an
  // object carrying its own provenance. The engine reads both shapes, and so
  // must this assertion - an earlier version compared against the object and
  // failed on correct code.
  const ibov = market.benchmarks.ibovespa;
  const ibovValue = typeof ibov === 'number' ? ibov : ibov.value;
  assert.ok(
    Math.abs(constellation.benchmark_return - ibovValue) < 1e-9,
    'the Ibovespa fund must be compared to the Ibovespa',
  );

  const riza = rows.find((r) => /Riza/i.test(r.label));
  assert.equal(riza.benchmark_key, 'cdi');
});

test('a fund that declared nothing is never assigned a benchmark by inference', () => {
  // Guessing from the name or the ANBIMA class is exactly the plausible-sounding
  // invention this project exists to prevent.
  const rows = metrics.funds_vs_declared_benchmark.rows;
  const undeclared = rows.filter((r) => r.status === 'no_declared_benchmark');
  assert.ok(undeclared.length > 0, 'the fixture should contain one');
  for (const r of undeclared) {
    assert.equal(r.benchmark_key, null);
    assert.equal(r.excess_pp, null);
    assert.ok(r.reason);
  }
});

test('excess is the fund minus its own benchmark, in points', () => {
  for (const r of metrics.funds_vs_declared_benchmark.rows) {
    if (r.status !== 'compared') continue;
    const expected = (r.fund_return - r.benchmark_return) * 100;
    assert.ok(Math.abs(r.excess_pp - expected) < 0.001, `${r.label}: ${r.excess_pp} vs ${expected}`);
  }
});

test('"percent of benchmark" is withheld when the benchmark fell', () => {
  // Against an index that lost 2%, "200% of the benchmark" is a loss twice as
  // large, and it reads as praise.
  const fallen = fundsVsDeclaredBenchmark(
    [{ statement_name: 'F', status: 'measured', value: -0.04, declared_benchmark: 'Ibovespa', cnpj: '1' }],
    { benchmarks: { ibovespa: -0.02 } },
  );
  const row = fallen.rows[0];
  assert.equal(row.status, 'compared');
  assert.ok(Math.abs(row.excess_pp - -2) < 0.001);
  assert.equal(row.pct_of_benchmark, null);
});

test('an unrecognised declaration does not silently fall back to the CDI', () => {
  const out = fundsVsDeclaredBenchmark(
    [{ statement_name: 'F', status: 'measured', value: 0.02, declared_benchmark: 'IMA-B 5', cnpj: '1' }],
    { benchmarks: { cdi: 0.0105 } },
  );
  assert.equal(out.rows[0].status, 'series_unavailable');
  assert.equal(out.rows[0].excess_pp, null);
  assert.match(out.rows[0].reason, /IMA-B 5/);
});

test('the summary counts only what was actually compared', () => {
  const s = metrics.funds_vs_declared_benchmark.summary;
  const rows = metrics.funds_vs_declared_benchmark.rows;
  assert.equal(s.compared, rows.filter((r) => r.status === 'compared').length);
  assert.equal(s.beat + s.trailed, s.compared);
  assert.ok(s.total >= s.compared);
});

// --- the letter ------------------------------------------------------------

test('the cost reaches the letter as a formatted figure', () => {
  const plan = read('letter-plan.json');
  const h = plan.letter.headline;
  assert.ok(h.fund_cost_annual?.display, 'the summary panel needs the annual cost');
  assert.match(h.fund_cost_annual.display, /^R\$ /);
  assert.match(h.fund_cost_pct.display, /a\.a\.$/);
  assert.equal(h.fund_cost_annual.value, funds.cost.annual_cost_brl);
});
