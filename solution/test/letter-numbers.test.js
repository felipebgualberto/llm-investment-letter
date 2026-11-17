import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  validateLetterNumbers, buildAllowList, extractPrintedNumbers, parseLocaleNumber,
} from '../src/validate/letter-numbers.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const payload = JSON.parse(readFileSync(resolve(root, 'out/letter-plan.json'), 'utf8'));

/** The v1 letter, condensed to the sentences carrying its invented figures. */
const V1_LETTER = `Prezado João,
Seu portfolio apresentou um retorno total de 3,5%, ligeiramente abaixo do benchmark, que
registrou uma performance superior em 0,2 pontos percentuais. Os fundos alcancaram um retorno
de 17,4%. As acoes representam 19,32% do portfolio e o CDB Banco C6 totaliza 12,97%.
As projecoes de PIB sao de 2% para 2025, com inflacao de 4,0%. A Selic deve se estabilizar
em 9%. O real deve encerrar 2024 a R$ 4,70.
Atenciosamente, Antonio Bicudo`;

test('a figure that exists nowhere in the payload is rejected', () => {
  const r = validateLetterNumbers(V1_LETTER, payload);
  const rejected = r.unsourced.map((u) => u.text);
  assert.ok(rejected.some((t) => t.includes('17,4')), 'the invented fund return must be caught');
  assert.ok(rejected.some((t) => t.includes('19,32')), 'a weight absent from this payload must be caught');
  assert.ok(rejected.some((t) => t.includes('4,70')), 'the invented FX rate must be caught');
  assert.equal(r.needs_repair, true);
});

test('coverage against the v1 letter is exactly three of seven, and that is documented', () => {
  // Pinning the measured number so the claim in the README stays true. The
  // other four coincide with real portfolio weights (8,9977 / 4,0111 / 3,4991)
  // and with the policy's 2% dividend floor - a ceiling of value matching, not
  // a defect. See the module header.
  const r = validateLetterNumbers(V1_LETTER, payload);
  assert.equal(r.unsourced.length, 3);
});

test('a letter using only payload figures passes clean', () => {
  const honest =
    'Prezado Albert da Silva, a parcela medida rendeu 2,62% no mes contra CDI de 1,06%, ' +
    'um excesso de 1,57 pontos percentuais. Sugerimos aplicar R$ 35.986,74, o que recupera ' +
    'R$ 5.092,12 em 12 meses.';
  const r = validateLetterNumbers(honest, payload);
  assert.equal(r.needs_repair, false, `unexpected: ${r.unsourced.map((u) => u.text).join(', ')}`);
  assert.equal(r.violations, 'none');
});

test('structural numbers are not treated as data', () => {
  const r = validateLetterNumbers('Em abril de 2025 foram 2 propostas, no dia 30.', payload);
  assert.equal(r.needs_repair, false);
});

test('a count can never license a percentage', () => {
  // The payload carries contributor_count: 9. Printing "9 posicoes" is fine;
  // printing "Selic de 9%" must not be authorised by that count.
  const { all, percentSafe } = buildAllowList({ contributor_count: 9, findings: [1, 2] });
  assert.ok(all.has(9));
  assert.ok(!percentSafe.has(9), 'a bare integer must not enter the percent-safe list');
});

test('a fraction is percent-safe in its scaled form', () => {
  const { percentSafe } = buildAllowList({ cdi: 0.0105593 });
  assert.ok(percentSafe.has(1.06), '0.0105593 must authorise "1,06%"');
});

test('dates in engine-written strings cannot license a rate', () => {
  // "2025-04-30" tokenises into 2025, -04, -30. That stray 4 previously
  // authorised the v1 letter's "inflacao de 4,0%".
  const { percentSafe } = buildAllowList({ note: 'medido em 2025-04-30 e 2024-09-05' });
  assert.ok(!percentSafe.has(4), 'a month number must not become a percentage');
  assert.ok(!percentSafe.has(30));
});

test('bare counts inside engine sentences cannot license a rate', () => {
  const { percentSafe } = buildAllowList({ line: 'Pagou 6 dividendos em 244 dias' });
  assert.ok(!percentSafe.has(6));
  assert.ok(!percentSafe.has(244));
});

test('percentages written by the engine into a sentence are authoritative', () => {
  const { percentSafe } = buildAllowList({ line: 'dividend yield de 25,11% sobre o preco' });
  assert.ok(percentSafe.has(25.11));
});

test('notation is captured so money, percent and bare numbers are told apart', () => {
  const items = extractPrintedNumbers('R$ 1.234,56 e 12,97% e 42 e 1,57 pontos percentuais');
  assert.equal(items.find((i) => i.value === 1234.56).is_money, true);
  assert.equal(items.find((i) => i.value === 12.97).is_percent, true);
  assert.equal(items.find((i) => i.value === 42).is_percent, false);
  assert.equal(items.find((i) => i.value === 1.57).is_percent, true, '"pontos percentuais" is a percentage');
});

test('both decimal conventions parse', () => {
  assert.equal(parseLocaleNumber('1.234,56'), 1234.56);
  assert.equal(parseLocaleNumber('1,234.56'), 1234.56);
  assert.equal(parseLocaleNumber('12,97'), 12.97);
  assert.ok(Number.isNaN(parseLocaleNumber('sem numero')));
});
