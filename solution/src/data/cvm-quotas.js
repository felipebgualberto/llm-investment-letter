/**
 * CVM quota data: monthly returns for funds, from two different datasets.
 *
 * WHY TWO
 * -------
 * CVM splits its reporting by fund species, and a fund can move between them:
 *
 *   INF_DIARIO      financial funds (FI/FIF). Daily quota per CNPJ.
 *                   Return = last quota of the month / last quota of the
 *                   previous month - 1.
 *
 *   INF_MENSAL_FIDC receivables funds (FIDC). Monthly, per subclass/series,
 *                   and it publishes the monthly return ALREADY COMPUTED
 *                   (TAB_X_VL_RENTAB_MES).
 *
 * Albert's largest fund holding lives in the second dataset because it was
 * converted into a FIDC in November 2024, after he bought it. A resolver that
 * only knows about INF_DIARIO reports "no data" for 23.24% of the portfolio.
 *
 * The lookup therefore tries INF_DIARIO first and falls back to FIDC, and the
 * result always records which dataset answered.
 */

import { getBuffer } from './http.js';
import { extractMatching } from '../lib/unzip.js';
import { endOfMonth, startOfMonth, addMonths } from '../lib/dates.js';
import { round } from '../lib/numbers.js';

const DAILY_URL = (yyyymm) =>
  `https://dados.cvm.gov.br/dados/FI/DOC/INF_DIARIO/DADOS/inf_diario_fi_${yyyymm}.zip`;
const FIDC_URL = (yyyymm) =>
  `https://dados.cvm.gov.br/dados/FIDC/DOC/INF_MENSAL/DADOS/inf_mensal_fidc_${yyyymm}.zip`;

/** A class with fewer shareholders than this is exclusive, not a retail feeder. */
export const MIN_SHAREHOLDERS = 50;

function parseCsv(buffer) {
  const text = new TextDecoder('iso-8859-1').decode(buffer);
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  return { header: lines[0].split(';'), rows: lines.slice(1) };
}

const normalizeCnpj = (v) => String(v).replace(/\D/g, '');

/** "2025-04-30" -> "202504" */
const yyyymm = (iso) => iso.slice(0, 7).replace('-', '');

/**
 * Join key for a FIDC series.
 *
 * CVM spells the same series differently across the Table X files - tab_X_1
 * writes "Subclasse Senior Serie 1" with the circumflex, tab_X_2 and tab_X_3
 * write it without. Joining on the literal label silently produces two orphan
 * records: one holding the shareholder count, the other holding the return.
 * The series is therefore keyed on an accent- and case-folded form, while the
 * original label is preserved for display.
 */
function seriesKey(label) {
  return String(label)
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

// ---------------------------------------------------------------------------
// INF_DIARIO - financial funds
// ---------------------------------------------------------------------------

/** Daily quotas for a set of CNPJs from one monthly INF_DIARIO archive. */
export async function fetchDailyQuotas(month, cnpjs, options = {}) {
  const { buffer } = await getBuffer(DAILY_URL(month), options);
  const { content } = extractMatching(buffer, /\.csv$/i);
  const { header, rows } = parseCsv(content);

  const iCnpj = header.indexOf('CNPJ_FUNDO_CLASSE');
  const iDate = header.indexOf('DT_COMPTC');
  const iQuota = header.indexOf('VL_QUOTA');
  const iNet = header.indexOf('VL_PATRIM_LIQ');
  const iHolders = header.indexOf('NR_COTST');
  if (iCnpj === -1 || iQuota === -1) {
    throw new Error(`Unexpected INF_DIARIO layout for ${month}: ${header.join(';')}`);
  }

  const wanted = new Set(cnpjs.map(normalizeCnpj));
  const series = new Map([...wanted].map((c) => [c, []]));

  for (const row of rows) {
    const cells = row.split(';');
    const cnpj = normalizeCnpj(cells[iCnpj] ?? '');
    if (!wanted.has(cnpj)) continue;
    const quota = Number(cells[iQuota]);
    if (!Number.isFinite(quota)) continue;
    series.get(cnpj).push({
      date: cells[iDate],
      quota,
      net_assets: Number(cells[iNet]) || null,
      shareholders: Number(cells[iHolders]) || null,
    });
  }

  for (const list of series.values()) list.sort((a, b) => a.date.localeCompare(b.date));
  return series;
}

// ---------------------------------------------------------------------------
// INF_MENSAL_FIDC - receivables funds
// ---------------------------------------------------------------------------

/**
 * FIDC monthly figures per subclass, joined across the three Table X files:
 *   tab_X_1  shareholders per series
 *   tab_X_2  quota count and quota value per series
 *   tab_X_3  the monthly return per series, already computed by the fund
 */
export async function fetchFidcMonthly(month, cnpjs, options = {}) {
  const { buffer } = await getBuffer(FIDC_URL(month), options);
  const wanted = new Set(cnpjs.map(normalizeCnpj));
  const bySeries = new Map(); // "cnpj|series" -> record

  const read = (pattern, fields) => {
    const { content } = extractMatching(buffer, pattern);
    const { header, rows } = parseCsv(content);
    const iCnpj = header.indexOf('CNPJ_FUNDO_CLASSE');
    const iSeries = header.indexOf('TAB_X_CLASSE_SERIE');
    const iDate = header.indexOf('DT_COMPTC');
    if (iCnpj === -1 || iSeries === -1) return;

    for (const row of rows) {
      const cells = row.split(';');
      const cnpj = normalizeCnpj(cells[iCnpj] ?? '');
      if (!wanted.has(cnpj)) continue;
      const series = (cells[iSeries] ?? '').trim();
      const key = `${cnpj}|${seriesKey(series)}`;
      const record = bySeries.get(key) ?? { cnpj, series, date: cells[iDate] ?? null };
      for (const [prop, column] of Object.entries(fields)) {
        const i = header.indexOf(column);
        if (i !== -1) {
          const value = Number(cells[i]);
          record[prop] = Number.isFinite(value) ? value : null;
        }
      }
      bySeries.set(key, record);
    }
  };

  read(/tab_X_1_\d{6}\.csv$/i, { shareholders: 'TAB_X_NR_COTST' });
  read(/tab_X_2_\d{6}\.csv$/i, { quota_count: 'TAB_X_QT_COTA', quota: 'TAB_X_VL_COTA' });
  read(/tab_X_3_\d{6}\.csv$/i, { return_pct: 'TAB_X_VL_RENTAB_MES' });

  const byCnpj = new Map([...wanted].map((c) => [c, []]));
  for (const record of bySeries.values()) byCnpj.get(record.cnpj)?.push(record);
  return byCnpj;
}

/**
 * Pick the series a retail client would actually hold: the one with real
 * shareholders. Subordinated tranches routinely report zero holders and zero
 * value, and a naive "first row wins" would report a 0.00% return.
 */
function pickRetailSeries(seriesList) {
  const withHolders = seriesList.filter((s) => (s.shareholders ?? 0) > 0);
  if (withHolders.length === 0) return null;
  return withHolders.sort((a, b) => (b.shareholders ?? 0) - (a.shareholders ?? 0))[0];
}

// ---------------------------------------------------------------------------
// Unified monthly return
// ---------------------------------------------------------------------------

/**
 * Monthly return for each resolved fund, trying INF_DIARIO then FIDC.
 *
 * @param {object[]} matches resolved funds carrying a `cnpj`
 * @param {string} referenceDate
 */
export async function monthlyReturns(matches, referenceDate, options = {}) {
  const cnpjs = matches.filter((m) => m.cnpj).map((m) => m.cnpj);
  if (cnpjs.length === 0) return [];

  const refMonth = yyyymm(referenceDate);
  const priorMonth = yyyymm(addMonths(startOfMonth(referenceDate), -1));
  const monthEnd = endOfMonth(referenceDate);

  const [dailyNow, dailyPrior] = await Promise.all([
    fetchDailyQuotas(refMonth, cnpjs, options),
    fetchDailyQuotas(priorMonth, cnpjs, options),
  ]);

  // Only reach for the FIDC archive if something is actually missing from
  // INF_DIARIO - it is a separate multi-megabyte download.
  const missing = cnpjs.filter((c) => (dailyNow.get(c) ?? []).length === 0);
  let fidcNow = new Map();
  let fidcPrior = new Map();
  if (missing.length > 0) {
    [fidcNow, fidcPrior] = await Promise.all([
      fetchFidcMonthly(refMonth, missing, options),
      fetchFidcMonthly(priorMonth, missing, options),
    ]);
  }

  return matches
    .filter((m) => m.cnpj)
    .map((match) => {
      const daily = dailyNow.get(match.cnpj) ?? [];
      const dailyBase = dailyPrior.get(match.cnpj) ?? [];

      // --- path 1: financial fund, compute from daily quotas ---------------
      if (daily.length > 0 && dailyBase.length > 0) {
        const last = daily[daily.length - 1];
        const base = dailyBase[dailyBase.length - 1];

        if (last.shareholders !== null && last.shareholders < MIN_SHAREHOLDERS) {
          return {
            ...match,
            status: 'implausible_match',
            shareholders: last.shareholders,
            reason:
              `${match.current_name ?? match.matched_name} reports ${last.shareholders} ` +
              'shareholder(s) - an exclusive or master class, not a retail feeder.',
          };
        }

        return {
          ...match,
          status: 'measured',
          dataset: 'INF_DIARIO',
          method: 'closing quota of prior month to closing quota of reference month',
          from: { date: base.date, quota: base.quota },
          to: { date: last.date, quota: last.quota },
          value: round(last.quota / base.quota - 1, 8),
          shareholders: last.shareholders,
          net_assets: last.net_assets,
          business_days: daily.length,
          as_of: monthEnd,
          source: { provider: 'CVM Dados Abertos', url: DAILY_URL(refMonth) },
        };
      }

      // --- path 2: receivables fund, use the published monthly return ------
      const series = pickRetailSeries(fidcNow.get(match.cnpj) ?? []);
      if (series && Number.isFinite(series.return_pct)) {
        if ((series.shareholders ?? 0) < MIN_SHAREHOLDERS) {
          return {
            ...match,
            status: 'implausible_match',
            shareholders: series.shareholders,
            reason: `${match.current_name} series "${series.series}" has ${series.shareholders} shareholder(s).`,
          };
        }

        // Cross-check against the quota move. FIDC quota values are published
        // to two decimals, so this can only confirm the order of magnitude -
        // it is recorded, not used to override the published figure.
        const priorSeries = pickRetailSeries(fidcPrior.get(match.cnpj) ?? []);
        const quotaImplied =
          priorSeries && priorSeries.quota > 0 ? series.quota / priorSeries.quota - 1 : null;

        return {
          ...match,
          status: 'measured',
          dataset: 'INF_MENSAL_FIDC',
          method: 'monthly return as published by the fund (TAB_X_VL_RENTAB_MES)',
          series: series.series,
          value: round(series.return_pct / 100, 8),
          quota: series.quota,
          shareholders: series.shareholders,
          as_of: series.date ?? monthEnd,
          cross_check: quotaImplied === null
            ? { status: 'unavailable' }
            : {
                status: Math.abs(quotaImplied - series.return_pct / 100) < 0.01 ? 'consistent' : 'divergent',
                quota_implied: round(quotaImplied, 6),
                note: 'FIDC quota values are rounded to two decimals; this check confirms magnitude only.',
              },
          source: { provider: 'CVM Dados Abertos', url: FIDC_URL(refMonth) },
        };
      }

      return {
        ...match,
        status: 'no_quota_data',
        reason:
          `${match.cnpj} appears in neither INF_DIARIO nor INF_MENSAL_FIDC for ` +
          `${priorMonth}/${refMonth}. The class may have launched, merged or closed.`,
      };
    });
}
