import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePortfolio } from '../src/parse/portfolio.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const raw = readFileSync(resolve(root, '../Input/XP - Albert_s portfolio.txt'), 'utf8');
const p = parsePortfolio(raw);

const find = (label) => p.holdings.find((h) => (h.ticker ?? h.name) === label);
const errors = () => p.data_quality_flags.filter((f) => f.severity === 'error');

test('identifies the client, not the example name from a prompt', () => {
  assert.equal(p.client.name, 'Albert da Silva');
  assert.equal(p.client.account, '792854');
  assert.equal(p.statement_date, '2025-05-07');
  assert.equal(p.advisor.name, 'Antonio Bicudo');
  assert.equal(p.advisor.code, 'A7699');
});

test('totals satisfy invested + cash === net worth', () => {
  assert.equal(p.totals.net_worth, 386858.82);
  assert.equal(p.totals.invested, 312186.20);
  assert.equal(p.totals.available_cash, 74672.62);
  assert.ok(Math.abs(p.totals.invested + p.totals.available_cash - p.totals.net_worth) < 0.01);
});

test('all twelve holdings are recovered across three sleeves', () => {
  assert.equal(p.holdings.length, 12);
  assert.equal(p.sleeve_totals.stocks.count, 4);
  assert.equal(p.sleeve_totals.funds.count, 7);
  assert.equal(p.sleeve_totals.fixed_income.count, 1);
});

test('sleeve market values match the statement subtotals exactly', () => {
  assert.equal(p.sleeve_totals.stocks.market_value, 60311.79);
  assert.equal(p.sleeve_totals.funds.market_value, 211395.66);
  assert.equal(p.sleeve_totals.fixed_income.market_value, 40478.75);
});

test('Half A / Half B ordinal join is correct for stocks', () => {
  const lren = find('LREN3');
  assert.equal(lren.quantity, 1642);
  assert.equal(lren.average_price, 29.05);
  assert.equal(lren.last_price, 16.94);
  assert.equal(lren.investment_date, '2021-04-22');

  const hapv = find('HAPV3');
  assert.equal(hapv.quantity, 1547);
  assert.equal(hapv.last_price, 3.97);
});

test('the inverted Ibiuna row is recovered, not dropped or misassigned', () => {
  const ibiuna = find('Ibiuna Hedge ST Advisory FIC FIM');
  assert.ok(ibiuna, 'Ibiuna holding must exist');
  assert.equal(ibiuna.market_value, 11601.02);
  assert.equal(ibiuna.applied_amount, 8674.51);
  assert.equal(ibiuna.category, 'multimarket');
  assert.ok(
    p.data_quality_flags.some((f) => f.code === 'source_row_order_inverted'),
    'the inversion must be reported, not silently absorbed',
  );
});

test('fund categories are recovered by heuristic and labelled as such', () => {
  assert.equal(find('Riza Lotus Plus Advisory FIC FIRF REF DI CP').category, 'fixed_income');
  assert.equal(find('STK Long Biased FIC FIA').category, 'equity');
  assert.equal(find('Truxt Long Bias Advisory FIC FIM').category, 'equity');
  assert.equal(find('Brave I FIC FIM CP').category, 'multimarket');
  for (const h of p.holdings.filter((x) => x.sleeve === 'funds')) {
    assert.equal(h.category_source, 'name_heuristic');
  }
});

test('every reconciliation identity closes - no errors raised', () => {
  assert.deepEqual(errors(), [], 'a reconciliation error means the parse cannot be trusted');
});

test('stale and matured instruments are flagged, never silently corrected', () => {
  const stale = p.data_quality_flags.filter((f) => f.code === 'stale_quota_date');
  assert.equal(stale.length, 7, 'all seven funds carry a 2024 quota date');
  assert.ok(p.data_quality_flags.some((f) => f.code === 'matured_instrument_still_listed'));
  assert.equal(find('CDB BANCO C6 CONSIGNADO S.A. - SET/2024').maturity_date, '2024-09-05');
});

test('idle cash is quantified for the recommendation engine', () => {
  assert.ok(Math.abs(p.cash_share_of_net_worth - 0.1930) < 0.0001);
});
