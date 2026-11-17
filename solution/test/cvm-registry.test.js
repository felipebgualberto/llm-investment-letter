import { test } from 'node:test';
import assert from 'node:assert/strict';
import { distinctiveTokens, resolveFund, normalizeCnpj } from '../src/data/cvm-registry.js';

/**
 * A miniature name index reproducing the real traps found in the live CVM data:
 * renamed funds, roman-numeral series, feeder/master/manager collisions, and
 * near-identical short tokens (ST vs STH).
 */
const INDEX = {
  names: [
    // Brave: renamed twice and converted to a FIDC. Only the COMMERCIAL name
    // still carries "Brave I", which is what the client statement quotes.
    { cnpj: '35726300000137', name: 'BRAVE I FUNDO DE INVESTIMENTO EM COTAS DE FUNDOS DE INVESTIMENTO MULTIMERCADO CREDITO PRIVADO', source: 'historical_commercial', from: '2020-01-31', to: null },
    { cnpj: '35726300000137', name: 'BRAVE I FUNDO DE INVESTIMENTO EM COTAS DE FUNDOS DE INVESTIMENTO MULTIMERCADO CREDITO PRIVADO', source: 'historical_legal', from: '2020-01-31', to: '2024-05-13' },
    { cnpj: '35726300000137', name: 'BRAVE 90 FUNDO DE INVESTIMENTO EM COTAS DE FUNDOS DE INVESTIMENTO EM DIREITOS CREDITORIOS', source: 'current_class', from: null, to: null },
    // Sibling series that must NOT be confused with Brave I.
    { cnpj: '36015243000140', name: 'BRAVE II HIGH YIELD FUNDO DE INVESTIMENTO MULTIMERCADO CREDITO PRIVADO', source: 'current_class', from: null, to: null },
    { cnpj: '41196241000135', name: 'BRAVE III HIGH GRADE FI EM COTAS DE FUNDOS DE INVESTIMENTO MULTIMERCADO CREDITO PRIVADO', source: 'current_class', from: null, to: null },
    { cnpj: '37627843000122', name: 'DNA BRAVE GLOBAL FUNDO DE INVESTIMENTO EM ACOES BDR NIVEL I', source: 'current_class', from: null, to: null },

    // Feeder / master / manager collision.
    { cnpj: '12282747000169', name: 'STK LONG BIASED FIC DE FUNDOS DE INVESTIMENTO FINANCEIRO DE ACOES', source: 'current_class', from: null, to: null },
    { cnpj: '12297830000101', name: 'STK LONG BIASED MASTER FUNDO DE INVESTIMENTO FINANCEIRO EM ACOES', source: 'current_class', from: null, to: null },
    { cnpj: '14476715000120', name: 'MANAGER STK LONG BIASED FIF CLASSE DE INVESTIMENTO EM COTAS EM ACOES', source: 'current_class', from: null, to: null },

    // Short-token trap.
    { cnpj: '30493349000173', name: 'IBIUNA HEDGE ST ADVISORY FIF - CLASSE DE INVESTIMENTO EM COTAS MULTIMERCADO', source: 'current_class', from: null, to: null },
    { cnpj: '15799713000134', name: 'IBIUNA HEDGE STH FIF - CLASSE DE INVESTIMENTO EM COTAS MULTIMERCADO', source: 'current_class', from: null, to: null },
  ],
  classesByCnpj: new Map([
    ['35726300000137', { current_name: 'BRAVE 90 FUNDO DE INVESTIMENTO EM COTAS DE FUNDOS DE INVESTIMENTO EM DIREITOS CREDITORIOS', class_type: 'Classe', situation: 'Em Funcionamento Normal', target_investor: 'Qualificado' }],
    ['12282747000169', { current_name: 'STK LONG BIASED FIC DE FUNDOS DE INVESTIMENTO FINANCEIRO DE ACOES', class_type: 'Classe', situation: 'Em Funcionamento Normal', target_investor: 'Qualificado' }],
    ['30493349000173', { current_name: 'IBIUNA HEDGE ST ADVISORY FIF - CLASSE DE INVESTIMENTO EM COTAS MULTIMERCADO', class_type: 'Classe', situation: 'Em Funcionamento Normal', target_investor: 'Publico Geral' }],
  ]),
};

test('legal boilerplate is stripped, product identity survives', () => {
  assert.deepEqual(
    distinctiveTokens('Riza Lotus Plus Advisory FIC FIRF REF DI CP'),
    ['RIZA', 'LOTUS', 'PLUS', 'ADVISORY'],
  );
});

test('roman numerals are kept: they are series identifiers, not noise', () => {
  // Regression guard. Treating "I" as boilerplate reduced the client's largest
  // fund holding to a single token and made it unresolvable, while also
  // colliding Brave I, Brave II and Brave III into one another.
  assert.deepEqual(distinctiveTokens('Brave I FIC FIM CP'), ['BRAVE', 'I']);
  assert.deepEqual(distinctiveTokens('Brave II High Yield'), ['BRAVE', 'II', 'HIGH', 'YIELD']);
});

test('a fund renamed out of existence is found through its historical name', () => {
  const m = resolveFund('Brave I FIC FIM CP', INDEX, '2025-05-07');
  assert.equal(m.status, 'matched');
  assert.equal(m.cnpj, '35726300000137');
  assert.ok(m.matched_name.startsWith('BRAVE I'));
  assert.equal(m.renamed, true);
  assert.ok(m.current_name.startsWith('BRAVE 90'));
});

test('the sibling series are not confused with each other', () => {
  assert.equal(resolveFund('Brave II High Yield', INDEX, '2025-05-07').cnpj, '36015243000140');
  assert.equal(resolveFund('Brave III High Grade', INDEX, '2025-05-07').cnpj, '41196241000135');
});

test('minimality discards MASTER and MANAGER classes in favour of the feeder', () => {
  const m = resolveFund('STK Long Biased FIC FIA', INDEX, '2025-05-07');
  assert.equal(m.status, 'matched');
  assert.equal(m.cnpj, '12282747000169');
  assert.deepEqual(m.extra_tokens, []);
});

test('token equality, not substring, separates ST from STH', () => {
  const m = resolveFund('Ibiuna Hedge ST Advisory FIC FIM', INDEX, '2025-05-07');
  assert.equal(m.status, 'matched');
  assert.equal(m.cnpj, '30493349000173');
});

test('several names of the SAME fund are one identity, not an ambiguity', () => {
  // Brave I appears three times in the index under two CNPJ-identical records.
  const m = resolveFund('Brave I FIC FIM CP', INDEX, '2025-05-07');
  assert.notEqual(m.status, 'ambiguous');
});

test('two DIFFERENT funds matching equally well is reported as ambiguous', () => {
  const twins = {
    names: [
      { cnpj: '1', name: 'ALFA BETA FUNDO DE INVESTIMENTO FINANCEIRO', source: 'current_class', from: null, to: null },
      { cnpj: '2', name: 'ALFA BETA FI FINANCEIRO EM COTAS DE FUNDOS DE INVESTIMENTO', source: 'current_class', from: null, to: null },
    ],
    classesByCnpj: new Map(),
  };
  const m = resolveFund('Alfa Beta FIC FIM', twins, '2025-05-07');
  assert.equal(m.status, 'ambiguous');
  assert.equal(m.candidates.length, 2);
});

test('a name too generic to identify a product is refused', () => {
  const m = resolveFund('Brave FIC FIM CP', INDEX, '2025-05-07');
  assert.equal(m.status, 'too_generic');
  assert.deepEqual(m.distinctive, ['BRAVE']);
});

test('an absent fund reports the tokens it searched for', () => {
  const m = resolveFund('Trend Investback FIC FIRF Simples', INDEX, '2025-05-07');
  assert.equal(m.status, 'not_found');
  assert.deepEqual(m.distinctive, ['TREND', 'INVESTBACK']);
});

test('the suitability attributes travel with the match', () => {
  const m = resolveFund('Brave I FIC FIM CP', INDEX, '2025-05-07');
  assert.equal(m.target_investor, 'Qualificado');
  assert.equal(m.situation, 'Em Funcionamento Normal');
});

test('CNPJ formatting is normalised', () => {
  assert.equal(normalizeCnpj('35.726.300/0001-37'), '35726300000137');
  assert.equal(normalizeCnpj('35726300000137'), '35726300000137');
});
