import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAmbiguousNumber, parsePercent, parseBrDate } from '../src/lib/numbers.js';

test('US-style values from the statement', () => {
  assert.equal(parseAmbiguousNumber('R$27,812.04'), 27812.04);
  assert.equal(parseAmbiguousNumber('R$386,858.82'), 386858.82);
  assert.equal(parseAmbiguousNumber('R$305.44'), 305.44);
});

test('BR-style values from the same statement', () => {
  assert.equal(parseAmbiguousNumber('R$ 30.000,00'), 30000);
  assert.equal(parseAmbiguousNumber('R$ 83.267,36'), 83267.36);
  assert.equal(parseAmbiguousNumber('R$ 29,05'), 29.05);
});

test('integers and negatives', () => {
  assert.equal(parseAmbiguousNumber('1642'), 1642);
  assert.equal(parseAmbiguousNumber('-41,7%'), -41.7);
});

test('the three-digit tail rule disambiguates thousands from decimals', () => {
  assert.equal(parseAmbiguousNumber('1.000'), 1000);  // BR thousands
  assert.equal(parseAmbiguousNumber('1,000'), 1000);  // US thousands
  assert.equal(parseAmbiguousNumber('1.00'), 1);      // decimal
  assert.equal(parseAmbiguousNumber('1,00'), 1);      // decimal
});

test('percentages become decimal fractions', () => {
  assert.equal(parsePercent('8.91%'), 0.0891);
  assert.equal(parsePercent('-41,7%'), -0.417);
  assert.equal(parsePercent('30.81%'), 0.3081);
});

test('dates normalise to ISO', () => {
  assert.equal(parseBrDate('22/04/2021'), '2021-04-22');
  assert.equal(parseBrDate('07/05/2025, 19:24'), '2025-05-07');
  assert.equal(parseBrDate('sem data'), null);
});

test('garbage in, NaN out (never a silent zero)', () => {
  assert.ok(Number.isNaN(parseAmbiguousNumber('')));
  assert.ok(Number.isNaN(parseAmbiguousNumber('R$')));
  assert.ok(Number.isNaN(parseAmbiguousNumber(null)));
});
