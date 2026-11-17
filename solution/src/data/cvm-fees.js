/**
 * What the client's funds cost, from the regulator's own registry.
 *
 * WHY THIS IS IN THE LETTER AT ALL
 * --------------------------------
 * A monthly letter reports what the portfolio earned and never what it charged.
 * The fee is the one number in the whole relationship that is certain: the
 * return is a forecast that came true or did not, and the administration fee is
 * deducted whatever happens. A letter that reports a 2,62% month against a
 * 1,06% CDI, and stays silent about R$ 1.980 a year leaving the account, is
 * telling a true story with a piece missing.
 *
 * It costs nothing to add. The CVM publishes both fee tables inside
 * cad_fi_hist.zip, the same archive this project already downloads to resolve
 * historical fund names, so no new request is made.
 *
 * THE TRAP, AND WHY THE WHOLE PROJECT IS BUILT THIS WAY
 * -----------------------------------------------------
 * Fees are versioned. Truxt Long Bias carries two rows:
 *
 *     1,90%   valid from 2022-12-29
 *     2,00%   valid from 2025-06-16
 *
 * The statement is dated 2025-05-07. The obvious implementation - take the most
 * recent row - prints 2,00%, a fee that did not exist on the date being
 * reported, and inflates the client's stated annual cost by R$ 12,52. It would
 * also be undetectable: 2,00% is a perfectly plausible fee for that fund.
 *
 * So the rule here is the same rule used to resolve fund identity: take the row
 * in force ON THE REFERENCE DATE, and never the newest one. This module exists
 * as much to demonstrate that rule as to report the number.
 *
 * WHAT IS AND IS NOT COMPUTED
 * ---------------------------
 * The administration fee is a stated annual percentage, so an annual cost in
 * reais follows directly from the position value. The PERFORMANCE fee is not
 * computed: it depends on a high-water mark and on the fund's own accrual
 * calendar, neither of which is in any public dataset. It is reported as the
 * rate and the hurdle the fund declared, and never turned into a number of
 * reais that would look measured while being guessed.
 */

import { extractMatching } from '../lib/unzip.js';
import { parseAmbiguousNumber } from '../lib/numbers.js';
import { normalizeCnpj } from './cvm-registry.js';

/**
 * A published administration fee above this is almost certainly a parsing
 * error rather than a real charge - the bi-locale rules that read "1.960000"
 * as 1,96 would read a malformed "1.960" as 1960.
 */
const MAX_PLAUSIBLE_FEE_PCT = 20;

const FEE_FILES = {
  admin: {
    pattern: /cad_fi_hist_taxa_adm\.csv$/i,
    rateCol: 'TAXA_ADM',
    noteCol: 'INF_TAXA_ADM',
    fromCol: 'DT_INI_TAXA_ADM',
  },
  performance: {
    pattern: /cad_fi_hist_taxa_perfm\.csv$/i,
    rateCol: 'VL_TAXA_PERFM',
    noteCol: 'DS_TAXA_PERFM',
    fromCol: 'DT_INI_TAXA_PERFM',
  },
};

function splitCsv(content) {
  const text = content.toString('latin1');
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  return { header: lines[0].split(';').map((h) => h.trim()), rows: lines.slice(1) };
}

/**
 * Read one fee table and keep, per CNPJ, the row in force on `asOfDate`.
 *
 * Rows whose start date is AFTER the reference date are discarded outright -
 * that is the whole point. Rows with an unreadable rate are kept as a note
 * rather than dropped, so a fund with an unparseable fee reports "declarada,
 * não legível" instead of silently reporting nothing.
 */
function readFeeTable(buffer, spec, wanted, asOfDate, flags) {
  const { content, name } = extractMatching(buffer, spec.pattern);
  const { header, rows } = splitCsv(content);

  const idx = {};
  for (const col of [ 'CNPJ_FUNDO', spec.rateCol, spec.noteCol, spec.fromCol ]) {
    idx[col] = header.indexOf(col);
    if (idx[col] === -1) throw new Error(`Column "${col}" missing from ${name}.`);
  }

  const best = new Map();
  let discardedAsFuture = 0;

  for (const row of rows) {
    const cells = row.split(';');
    const cnpj = normalizeCnpj(cells[idx.CNPJ_FUNDO] ?? '');
    if (!wanted.has(cnpj)) continue;

    const from = (cells[idx[spec.fromCol]] ?? '').trim() || null;
    if (from && asOfDate && from > asOfDate) {
      discardedAsFuture += 1;
      continue;
    }

    // Later start date wins among the rows that had already taken effect.
    const current = best.get(cnpj);
    if (current && current.from && from && current.from >= from) continue;
    if (current && current.from && !from) continue;

    const raw = (cells[idx[spec.rateCol]] ?? '').trim();
    const note = (cells[idx[spec.noteCol]] ?? '').trim();
    let rate = raw ? parseAmbiguousNumber(raw) : null;

    if (rate !== null && (!Number.isFinite(rate) || rate < 0 || rate > MAX_PLAUSIBLE_FEE_PCT)) {
      flags.push({
        code: 'fee_out_of_plausible_range',
        severity: 'warning',
        detail: `${cnpj}: published ${spec.rateCol} of "${raw}" parsed to ${rate}, outside 0-${MAX_PLAUSIBLE_FEE_PCT}%. Treated as unreadable.`,
        origin: 'cvm_fees',
      });
      rate = null;
    }

    best.set(cnpj, { rate, note: note || null, from, raw });
  }

  if (discardedAsFuture > 0) {
    flags.push({
      code: 'fee_version_not_yet_in_force',
      severity: 'info',
      detail:
        `${discardedAsFuture} ${spec.rateCol} row(s) start after ${asOfDate} and were ignored. ` +
        'Using the newest row instead of the one in force would report a fee that did not exist on the statement date.',
      origin: 'cvm_fees',
    });
  }

  return best;
}

/**
 * Fees in force on `asOfDate` for a set of CNPJs.
 *
 * @param {Buffer} historyBuffer  the cad_fi_hist.zip already fetched by the registry
 * @param {string[]} cnpjs
 * @param {string} asOfDate  ISO date; the reference date, never today
 * @returns {{fees: Map<string, object>, flags: object[]}}
 */
export function feesAsOf(historyBuffer, cnpjs, asOfDate) {
  const wanted = new Set(cnpjs.map(normalizeCnpj).filter(Boolean));
  const flags = [];
  if (wanted.size === 0) return { fees: new Map(), flags };

  const admin = readFeeTable(historyBuffer, FEE_FILES.admin, wanted, asOfDate, flags);
  const performance = readFeeTable(historyBuffer, FEE_FILES.performance, wanted, asOfDate, flags);

  const fees = new Map();
  for (const cnpj of wanted) {
    const a = admin.get(cnpj) ?? null;
    const p = performance.get(cnpj) ?? null;
    if (!a && !p) {
      flags.push({
        code: 'fee_not_published',
        severity: 'info',
        detail: `${cnpj}: no administration or performance fee row in force on ${asOfDate}.`,
        origin: 'cvm_fees',
      });
      continue;
    }
    fees.set(cnpj, {
      cnpj,
      as_of: asOfDate,
      administration: a
        ? { rate_pct: a.rate, in_force_since: a.from, note: a.note }
        : null,
      performance: p && p.rate !== null && p.rate > 0
        ? { rate_pct: p.rate, in_force_since: p.from, terms: p.note }
        : p
          ? { rate_pct: 0, in_force_since: p.from, terms: p.note }
          : null,
      source: {
        provider: 'CVM Dados Abertos',
        url: 'https://dados.cvm.gov.br/dados/FI/CAD/DADOS/cad_fi_hist.zip',
        files: ['cad_fi_hist_taxa_adm.csv', 'cad_fi_hist_taxa_perfm.csv'],
        rule: 'row in force on the reference date, not the most recent row',
      },
    });
  }

  return { fees, flags };
}

/**
 * Annual cost of the fund sleeve, in reais.
 *
 * Deliberately reports the cost of the part it could price and states the
 * coverage, exactly as the returns engine does. A weighted average fee computed
 * over only the priced positions, presented as if it covered all of them, would
 * be the same selection-bias error the returns engine goes to some trouble to
 * avoid.
 *
 * @param {Array<{cnpj: string, market_value: number, statement_name: string}>} holdings
 * @param {Map<string, object>} fees
 */
export function annualCost(holdings, fees) {
  const lines = [];
  let priced = 0;
  let unpriced = 0;
  let annual = 0;

  for (const h of holdings) {
    const fee = h.cnpj ? fees.get(normalizeCnpj(h.cnpj)) : null;
    const rate = fee?.administration?.rate_pct ?? null;

    if (rate === null || !Number.isFinite(h.market_value)) {
      unpriced += h.market_value ?? 0;
      lines.push({
        label: h.statement_name,
        cnpj: h.cnpj ?? null,
        market_value: h.market_value ?? null,
        administration_pct: null,
        annual_cost_brl: null,
        performance: fee?.performance ?? null,
        reason: fee ? 'fee published but not readable' : 'no fee published for the reference date',
      });
      continue;
    }

    const cost = (h.market_value * rate) / 100;
    priced += h.market_value;
    annual += cost;
    lines.push({
      label: h.statement_name,
      cnpj: h.cnpj,
      market_value: h.market_value,
      administration_pct: rate,
      administration_in_force_since: fee.administration.in_force_since,
      annual_cost_brl: Math.round(cost * 100) / 100,
      performance: fee.performance ?? null,
    });
  }

  lines.sort((a, b) => (b.annual_cost_brl ?? -1) - (a.annual_cost_brl ?? -1));

  return {
    lines,
    priced_value_brl: Math.round(priced * 100) / 100,
    unpriced_value_brl: Math.round(unpriced * 100) / 100,
    coverage: priced + unpriced > 0 ? priced / (priced + unpriced) : 0,
    annual_cost_brl: Math.round(annual * 100) / 100,
    monthly_cost_brl: Math.round((annual / 12) * 100) / 100,
    weighted_average_pct: priced > 0 ? Math.round((annual / priced) * 100 * 10000) / 10000 : null,
    basis:
      'Administration fee only, applied to the position value on the statement date. ' +
      'Performance fees are reported as declared rates and are not converted to reais, ' +
      'because they depend on a high-water mark no public dataset carries.',
  };
}
