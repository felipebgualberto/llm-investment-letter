import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePortfolio } from '../src/parse/portfolio.js';
import { parsePrices } from '../src/parse/prices.js';
import { computePerformance } from '../src/engine/returns.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const portfolio = parsePortfolio(readFileSync(resolve(root, '../Input/XP - Albert_s portfolio.txt'), 'utf8'));
const { prices } = parsePrices(readFileSync(resolve(root, '../Input/profitability_calc_wip.csv'), 'utf8'));
const funds = JSON.parse(readFileSync(resolve(root, 'out/funds.json'), 'utf8'));
const market = JSON.parse(readFileSync(resolve(root, 'out/market.json'), 'utf8'));

const perf = computePerformance({ portfolio, prices, funds, market, referenceDate: '2025-04-30' });
const find = (label) => perf.by_holding.find((h) => h.label === label);
const sleeve = (name) => perf.by_sleeve.find((s) => s.sleeve === name);

test('the price file is read - the v1 workflow never opened it', () => {
  assert.equal(prices.size, 12);
  assert.equal(prices.get('LREN3').prior_price, 15.55);
  assert.equal(prices.get('LREN3').current_price, 16.94);
  assert.ok(Math.abs(prices.get('LREN3').monthly_return - 0.0893891) < 1e-6);
});

test('contributions sum exactly to the measured return', () => {
  // The defining identity of the report. If it fails, the letter contains a
  // table whose column does not add up to its own total.
  // Recomputed from the ROUNDED values the report publishes, so the tolerance
  // is set by two-decimal money rounding, not by floating point. The engine
  // asserts the exact identity internally on unrounded figures.
  const sum = perf.by_holding.reduce((s, h) => s + (h.v1 - h.v0) / perf.v0_total, 0);
  assert.ok(Math.abs(sum - perf.portfolio_return) < 1e-7, `sum ${sum} vs ${perf.portfolio_return}`);
  assert.ok(Math.abs(perf.attribution.sum_check_pp - perf.portfolio_return * 100) < 0.001);
});

test('return x start value equals P&L on every line', () => {
  for (const h of perf.by_holding) {
    assert.ok(
      Math.abs(h.v0 * h.return - h.pnl) < 0.02,
      `${h.label}: ${h.v0} x ${h.return} = ${h.v0 * h.return} but P&L is ${h.pnl}`,
    );
  }
});

test('the derived start value agrees with quantity x prior price', () => {
  // Independent confirmation that the statement and the price file describe
  // the same positions. Gaps are cents-level rounding, never structural.
  for (const h of perf.by_holding.filter((x) => x.cross_check)) {
    assert.equal(h.cross_check.status, 'consistent');
    assert.ok(Math.abs(h.cross_check.gap_brl) < 5);
  }
});

test('equity sleeve return matches an independent hand calculation', () => {
  // Hand check: sum(qty x prior) = 58,382.08 -> sum(qty x current) = 60,308.05
  assert.ok(Math.abs(sleeve('stocks').return - 0.032989) < 1e-4);
});

test('individual returns match their sources', () => {
  assert.ok(Math.abs(find('HAPV3').return - 0.7644444) < 1e-5);
  // 10.26 / 12.27 - 1 = -0.16381418. Worth pinning precisely: the first draft
  // of this test carried a hand-typed -0.1637978 and the engine was right.
  assert.ok(Math.abs(find('MRFG3').return + 0.16381418) < 1e-7);
  assert.ok(Math.abs(find('Brave I FIC FIM CP').return - 0.0119) < 1e-8);
});

test('coverage is reported, never assumed away', () => {
  assert.ok(Math.abs(perf.coverage.share_of_invested - 0.8694) < 0.0005);
  assert.ok(Math.abs(perf.coverage.share_of_net_worth - 0.7016) < 0.0005);
  assert.equal(perf.coverage.measured_positions, 10);
  assert.equal(perf.coverage.total_positions, 12);
});

test('the matured CDB is excluded with a reason, not accrued', () => {
  const cdb = perf.unmeasured.find((u) => u.label.startsWith('CDB'));
  assert.ok(cdb, 'the CDB must appear in the unmeasured list');
  assert.equal(cdb.matured_on, '2024-09-05');
  assert.match(cdb.reason, /Matured on 2024-09-05/);
  // It must not have leaked into the measured set under any guise.
  assert.equal(perf.by_holding.filter((h) => h.label.startsWith('CDB')).length, 0);
});

test('benchmarks come from the market snapshot, never from a model', () => {
  assert.ok(Math.abs(perf.versus.cdi.value - 0.0105593) < 1e-5);
  assert.ok(Math.abs(perf.versus.ibovespa.value - 0.0369) < 1e-3);
  assert.equal(perf.versus.ipca.value, 0.0043);
  // Beat CDI, trailed the Ibovespa - the honest shape of this month.
  assert.ok(perf.versus.cdi.excess_pp > 0);
  assert.ok(perf.versus.ibovespa.excess_pp < 0);
});

test('the real return is compounded against inflation, not subtracted', () => {
  const expected = (1 + perf.portfolio_return) / (1 + perf.versus.ipca.value) - 1;
  assert.ok(Math.abs(perf.versus.ipca.real_return - expected) < 1e-7);
  // Simple subtraction would give a different, slightly larger number.
  assert.notEqual(perf.versus.ipca.real_return, perf.portfolio_return - perf.versus.ipca.value);
});

test('no error-level flags survive a clean run', () => {
  assert.deepEqual(perf.data_quality_flags.filter((f) => f.severity === 'error'), []);
});

test('the no-cash-flow assumption is stated, not left implicit', () => {
  assert.ok(perf.data_quality_flags.some((f) => f.code === 'no_cash_flow_assumption'));
});

test('the measured return is published with its selection bias, not as a portfolio figure', () => {
  // A position is measured BECAUSE a primary source exists for it, so the
  // measured set is not a random sample. Here the unmeasured remainder is
  // dominated by an instrument that matured eight months earlier, which makes
  // the measured return an upper bound on the whole portfolio.
  const s = perf.sensitivity;
  assert.ok(s, 'metrics must carry a sensitivity block');
  assert.equal(s.scenarios.length, 3);
  assert.ok(s.invested_return_range.low < perf.portfolio_return);
  assert.ok(Math.abs(s.invested_return_range.high - perf.portfolio_return) < 1e-9);
  // Nothing-earned is the floor; matching the measured part is the ceiling.
  assert.ok(Math.abs(s.invested_return_range.low - 0.02271) < 0.0001);
});

test('every sensitivity scenario names the assumption it rests on', () => {
  for (const scenario of perf.sensitivity.scenarios) {
    assert.ok(scenario.assumption, 'each scenario must be keyed by its assumption');
    assert.ok(scenario.label_pt.length > 10, 'and be stateable in plain Portuguese');
    assert.ok(Number.isFinite(scenario.unmeasured_return));
  }
});

test('net worth return quantifies the drag of balances that are not working', () => {
  const nw = perf.sensitivity.net_worth;
  // R$74,672.62 idle plus a matured CDB cost 0.8pp against the measured return.
  assert.ok(Math.abs(nw.return - 0.018247) < 0.0001);
  assert.ok(nw.drag_vs_measured_pp > 0.7 && nw.drag_vs_measured_pp < 0.9);
  assert.equal(nw.idle_cash, 74672.62);
  // The drag must be exactly the difference, never an independently rounded number.
  assert.ok(Math.abs(nw.drag_vs_measured_pp - (perf.portfolio_return - nw.return) * 100) < 0.001);
});

test('contributors and detractors are split by sign, never by rank position', () => {
  // April 2025 had exactly one negative position. Taking "the bottom three"
  // put ARZZ3 (+0.0022pp) and Ibiuna (+0.1497pp) inside a field named
  // top_detractors, which a narration layer would faithfully describe as
  // "principais detratores" - a false statement of fact about two positions
  // that made money.
  const a = perf.attribution;
  assert.equal(a.detractor_count, 1);
  assert.equal(a.contributor_count, 9);
  assert.equal(a.top_detractors.length, 1);
  assert.equal(a.top_detractors[0].label, 'MRFG3');
  for (const d of a.top_detractors) assert.ok(d.contribution_pp < 0);
  for (const c of a.top_contributors) assert.ok(c.contribution_pp > 0);
});

test('upstream flags survive into the metrics the narration layer reads', () => {
  // The seven stale-quota warnings say "Monthly performance cannot be derived
  // from this figure". They lived in portfolio.json and never reached
  // metrics.json, which is the file the renderer consumes.
  const codes = perf.data_quality_flags.map((f) => f.code);
  assert.ok(codes.includes('stale_quota_date'), 'parser warnings must propagate');
  assert.ok(
    perf.data_quality_flags.some((f) => f.origin === 'portfolio_parser'),
    'propagated flags must record where they came from',
  );
});

test('each held equity return is reconciled against an independent market return', () => {
  for (const h of perf.by_holding.filter((x) => x.sleeve === 'stocks')) {
    const r = h.return_reconciliation;
    assert.ok(r && r.status !== 'unavailable', `${h.label} must carry a market reconciliation`);
    assert.ok(Number.isFinite(r.gap_pp));
  }
  // MRFG3 is the case that matters: the price file says -16.38%, MBRF3 closed
  // at +18.94%. Opposite signs must be detected, not averaged away.
  const mrfg = perf.by_holding.find((h) => h.label === 'MRFG3');
  assert.equal(mrfg.return_reconciliation.sign_flip, true);
  assert.equal(mrfg.return_reconciliation.via_successor, 'MBRF3');
  assert.equal(mrfg.return_reconciliation.status, 'divergent');
});

test('a divergent holding return raises a warning, and never rewrites the number', () => {
  assert.ok(perf.data_quality_flags.some((f) => f.code === 'holding_return_divergent'));
  // The statement stays the system of record: the published return is still
  // the price file's, not the market's.
  const hapv = perf.by_holding.find((h) => h.label === 'HAPV3');
  assert.ok(Math.abs(hapv.return - 0.7644444) < 1e-5);
});

test('the CDI ratio is emitted only for the CDI, and only when meaningful', () => {
  assert.ok(perf.versus.cdi.pct_of_cdi > 200 && perf.versus.cdi.pct_of_cdi < 300);
  // "rendeu 6 vezes o IPCA" is not a sentence anyone should publish.
  assert.equal(perf.versus.ipca.pct_of_cdi, undefined);
  assert.equal(perf.versus.ipca.ratio, undefined);
  assert.equal(perf.versus.ibovespa.ratio, undefined);
});
