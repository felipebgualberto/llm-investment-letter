import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseMacro, houseValue } from '../src/parse/macro.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const raw = readFileSync(resolve(root, '../Input/XP - Macro analysis.txt'), 'utf8');
const macro = parseMacro(raw);

test('reads the report identity', () => {
  assert.equal(macro.report_date, '2025-02-06');
  assert.equal(macro.title, 'Brasil Macro Mensal');
});

test('extracts the XP house view straight from the projections table', () => {
  assert.equal(houseValue(macro, 'Selic', 2025), 15.5);
  assert.equal(houseValue(macro, 'IPCA', 2025), 6.1);
  assert.equal(houseValue(macro, 'Câmbio', 2025), 6.2);
  assert.equal(houseValue(macro, 'PIB Total', 2025), 2);
});

test('the 2026 column is read as well, proving column alignment', () => {
  assert.equal(houseValue(macro, 'Selic', 2026), 12.5);
  assert.equal(houseValue(macro, 'IPCA', 2026), 4.5);
  assert.equal(houseValue(macro, 'Câmbio', 2026), 6.4);
});

test('historical columns match the published table', () => {
  // 2021 is a strong alignment check: every row moved sharply that year.
  assert.equal(houseValue(macro, 'Selic', 2021), 9.25);
  assert.equal(houseValue(macro, 'IPCA', 2021), 10.1);
  assert.equal(houseValue(macro, 'PIB Total', 2021), 4.8);
});

test('the duplicated copy of the table agrees with the first', () => {
  assert.equal(
    macro.data_quality_flags.filter((f) => f.code === 'macro_table_copies_disagree').length,
    0,
  );
});

test('no extraction errors', () => {
  assert.deepEqual(macro.data_quality_flags.filter((f) => f.severity === 'error'), []);
});

test('the figures the v1 letter published are absent from the source', () => {
  // The v1 output claimed Selic 9%, BRL 4.70 and IPCA 4.0% for 2025.
  // None of them appear in XP's own projections. This test is the regression
  // guard for the defect that motivated the whole rewrite.
  const values2025 = Object.values(macro.house_view).map((r) => r.by_year[2025]);
  assert.ok(!values2025.includes(9), 'Selic 9% must not be derivable from the report');
  assert.ok(!values2025.includes(4.7), 'BRL 4.70 must not be derivable from the report');
  assert.ok(!values2025.includes(4.0), 'IPCA 4.0% must not be derivable from the report');
});

test('houseValue returns null for a projection the report does not carry', () => {
  assert.equal(houseValue(macro, 'Selic', 2099), null);
  assert.equal(houseValue(macro, 'Bitcoin', 2025), null);
});
