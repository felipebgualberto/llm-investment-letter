/**
 * Market layer tests.
 *
 * These run against the on-disk HTTP cache (out/cache), which is what makes
 * them deterministic despite exercising real API client code. Run
 * `node scripts/build-market.js` once to populate it; after that the suite is
 * offline and byte-stable. That is the same property the letter relies on.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compoundDailyRates, positionInConsensus, annualiseFromBusinessDays, SGS, BUSINESS_DAYS_PER_YEAR } from '../src/data/bcb.js';
import { toProviderSymbol, TICKER_SUCCESSORS } from '../src/data/quotes.js';

test('daily rates compound, they do not add', () => {
  // Three days at 1% each: 1.01^3 - 1 = 3.0301%, not 3%.
  const obs = [{ value: 1 }, { value: 1 }, { value: 1 }];
  const compounded = compoundDailyRates(obs);
  assert.ok(Math.abs(compounded - 0.030301) < 1e-9);
  assert.ok(compounded > 0.03, 'compounding must exceed the arithmetic sum');
});

test('compounding an empty series yields zero, not NaN', () => {
  assert.equal(compoundDailyRates([]), 0);
});

test('SGS series codes are pinned', () => {
  // A wrong code here is a silently wrong benchmark, so the mapping is frozen.
  assert.equal(SGS.CDI_DAILY, 12);
  assert.equal(SGS.IPCA_MONTHLY, 433);
  assert.equal(SGS.SELIC_TARGET, 432);
});

test('B3 tickers get the .SA suffix and indices do not', () => {
  assert.equal(toProviderSymbol('LREN3'), 'LREN3.SA');
  assert.equal(toProviderSymbol('^BVSP'), '^BVSP');
});

test('the corporate-action registry covers both dead codes in the statement', () => {
  assert.equal(TICKER_SUCCESSORS.ARZZ3.successor, 'AZZA3');
  assert.equal(TICKER_SUCCESSORS.MRFG3.successor, 'MBRF3');
});

test('a house view above the consensus median is placed in the distribution', () => {
  const consensus = { median: 15.0, min: 13.5, max: 15.75 };
  const placement = positionInConsensus(15.5, consensus);
  assert.equal(placement.stance, 'above_consensus');
  assert.equal(placement.gap_vs_median, 0.5);
  assert.ok(placement.percentile_in_range > 85);
  assert.equal(placement.at_or_beyond_extreme, false);
});

test('a house view at the edge of the range is flagged as extreme', () => {
  const consensus = { median: 15.0, min: 13.5, max: 15.75 };
  assert.equal(positionInConsensus(15.75, consensus).at_or_beyond_extreme, true);
  assert.equal(positionInConsensus(13.5, consensus).at_or_beyond_extreme, true);
});

test('a degenerate consensus range returns null instead of dividing by zero', () => {
  assert.equal(positionInConsensus(5, { median: 5, min: 5, max: 5 }), null);
  assert.equal(positionInConsensus(Number.NaN, { median: 5, min: 4, max: 6 }), null);
});

test('annualisation uses the 252-business-day basis, not twelve months', () => {
  // April 2025: 1.0559% compounded over 20 business days. The BCB published
  // 14.15% a.a. for 30/04/2025 (SGS 4389), and the 252-day derivation
  // reproduces it. The naive (1 + monthly)^12 gives 13.43% because it assumes
  // a 240-day year - a 0.72 percentage point error.
  const monthly = 0.010559276;
  const correct = annualiseFromBusinessDays(monthly, 20);
  const naive = (1 + monthly) ** 12 - 1;

  assert.ok(Math.abs(correct - 0.1415) < 0.0001, `expected ~14.15% a.a., got ${correct}`);
  assert.ok(Math.abs(naive - 0.1343) < 0.0001);
  assert.ok(correct - naive > 0.007, 'the naive method understates by ~0.72pp');
  assert.equal(BUSINESS_DAYS_PER_YEAR, 252);
});

test('annualisation refuses impossible inputs instead of returning a number', () => {
  assert.equal(annualiseFromBusinessDays(0.01, 0), null);
  assert.equal(annualiseFromBusinessDays(0.01, -5), null);
  assert.equal(annualiseFromBusinessDays(Number.NaN, 20), null);
});

test('a full year of business days annualises to itself', () => {
  const yearly = 0.1415;
  assert.ok(Math.abs(annualiseFromBusinessDays(yearly, 252) - yearly) < 1e-12);
});
