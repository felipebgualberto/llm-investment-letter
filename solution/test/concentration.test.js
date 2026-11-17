/**
 * Concentration: the Herfindahl index and the effective number of positions.
 *
 * The measure is only worth printing if it is exactly right, because it looks
 * like a fact and reads like a judgement. These tests pin the arithmetic to
 * cases whose answer is known without computing anything.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { concentration, positionsForConcentration } from '../src/engine/concentration.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => JSON.parse(readFileSync(resolve(root, 'out', f), 'utf8'));

// --- the identity that defines the measure ---------------------------------

test('N equal positions have an effective number of exactly N', () => {
  // This is the whole reason the index is reported as a count rather than as a
  // number between 0 and 1: on the one input where the answer is obvious, it
  // has to come out obvious.
  for (const n of [2, 4, 10]) {
    const equal = Array.from({ length: n }, (_, i) => ({ label: `P${i}`, value: 1000 }));
    const c = concentration(equal);
    assert.ok(
      Math.abs(c.effective_positions - n) < 1e-6,
      `${n} equal positions gave ${c.effective_positions}`,
    );
  }
});

test('one position holding everything gives an effective number of one', () => {
  const c = concentration([{ label: 'A', value: 5000 }]);
  assert.equal(c.effective_positions, 1);
  assert.equal(c.hhi, 1);
  assert.equal(c.positions_to_half, 1);
});

test('inequality always lowers the effective number below the count', () => {
  const c = concentration([
    { label: 'big', value: 9000 },
    { label: 'small', value: 500 },
    { label: 'tiny', value: 500 },
  ]);
  assert.equal(c.positions_held, 3);
  assert.ok(c.effective_positions < 3);
  assert.ok(c.effective_positions > 1);
});

test('a position of zero or negative value is excluded rather than counted', () => {
  // A zero-value line would add nothing to the index and one to the count,
  // reporting a portfolio as more diversified for holding something worthless.
  const c = concentration([
    { label: 'A', value: 1000 },
    { label: 'B', value: 1000 },
    { label: 'empty', value: 0 },
    { label: 'bad', value: null },
  ]);
  assert.equal(c.positions_held, 2);
  assert.ok(Math.abs(c.effective_positions - 2) < 1e-6);
});

test('an empty portfolio returns null instead of dividing by zero', () => {
  assert.equal(concentration([]), null);
  assert.equal(concentration([{ label: 'A', value: 0 }]), null);
});

// --- what it runs on -------------------------------------------------------

test('idle cash counts as a position', () => {
  // Measuring over the invested total only would treat the idle 19,3% as if it
  // did not exist, and report a MORE concentrated portfolio than the client has.
  const portfolio = read('portfolio.json');
  const positions = positionsForConcentration(portfolio);
  assert.equal(positions.length, portfolio.holdings.length + 1);
  const cash = positions.find((p) => /Saldo/i.test(p.label));
  assert.equal(cash.value, portfolio.totals.available_cash);

  const total = positions.reduce((s, p) => s + p.value, 0);
  assert.ok(
    Math.abs(total - portfolio.totals.net_worth) < 0.01,
    'the positions must sum to net worth, or the weights are against the wrong base',
  );
});

test('positions_to_half is the smallest count reaching half the money', () => {
  const c = concentration([
    { label: 'a', value: 40 },
    { label: 'b', value: 30 },
    { label: 'c', value: 20 },
    { label: 'd', value: 10 },
  ]);
  // 40% alone is not half; 40 + 30 is.
  assert.equal(c.positions_to_half, 2);
});

test('the largest position and the top-two share are reported', () => {
  const c = concentration([
    { label: 'a', value: 50 },
    { label: 'b', value: 30 },
    { label: 'c', value: 20 },
  ]);
  assert.equal(c.largest.label, 'a');
  assert.ok(Math.abs(c.largest.weight - 0.5) < 1e-9);
  assert.ok(Math.abs(c.top_two_share - 0.8) < 1e-9);
});

// --- what reaches the page -------------------------------------------------

test("the real portfolio's numbers are internally consistent", () => {
  const c = read('metrics.json').concentration;
  assert.ok(c, 'the build must produce a concentration block');
  assert.ok(Math.abs(1 / c.hhi - c.effective_positions) < 0.01);
  assert.ok(c.effective_positions < c.positions_held, 'this portfolio is not equally weighted');
  assert.ok(c.positions_to_half >= 1 && c.positions_to_half <= c.positions_held);
});

test('the caveat travels with the number', () => {
  // An effective count of 6,4 read as "adequately diversified" would be worse
  // than not reporting it: the index sees weights, never holdings, so two funds
  // owning the same twenty stocks look like two positions.
  const c = read('metrics.json').concentration;
  assert.match(c.caveat, /não .*risco|risco/i);
  assert.ok(c.basis.includes('Herfindahl'));
});

test('the sentence under the ring uses the engine numbers verbatim', () => {
  const c = read('metrics.json').concentration;
  const svg = readFileSync(resolve(root, 'out/charts/positions.svg'), 'utf8');
  assert.ok(svg.includes(`${c.positions_held} posições`), 'the held count must match');
  assert.ok(
    svg.includes(c.effective_positions.toFixed(1).replace('.', ',')),
    'the effective count must match the engine, not be re-derived in the renderer',
  );
});
