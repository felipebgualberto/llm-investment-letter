/**
 * Banco Central do Brasil connectors.
 *
 * Two independent public APIs, no authentication required:
 *
 *   SGS (Sistema Gerenciador de Séries Temporais)
 *     Realised data: CDI, Selic, IPCA, FX. This is what the portfolio is
 *     measured AGAINST.
 *
 *   Expectativas / Focus (Olinda OData)
 *     Forward-looking market consensus collected from ~140 institutions. This
 *     is what XP's house view is COMPARED TO - the letter can then say whether
 *     the recommendation follows or diverges from the market, which no single
 *     input document in the challenge could support on its own.
 */

import { getJson } from './http.js';
import { toBrDate, monthWindow } from '../lib/dates.js';
import { round } from '../lib/numbers.js';

const SGS_BASE = 'https://api.bcb.gov.br/dados/serie/bcdata.sgs';
const FOCUS_BASE =
  'https://olinda.bcb.gov.br/olinda/servico/Expectativas/versao/v1/odata/ExpectativasMercadoAnuais';

/**
 * SGS series codes used by this pipeline.
 * Kept in one place because a wrong code is a silently wrong benchmark.
 */
export const SGS = {
  CDI_DAILY: 12,        // CDI, % per day
  CDI_ANNUAL: 4389,     // CDI, % per year, 252-business-day basis
  SELIC_DAILY: 11,      // Selic, % per day
  SELIC_TARGET: 432,    // Copom target rate, % per year
  IPCA_MONTHLY: 433,    // IPCA, % per month
  USD_BRL: 1,           // BRL per USD, sell side
};

/**
 * Business days in a Brazilian financial year.
 *
 * This constant is the whole reason annualisation is not a one-liner. Raising a
 * monthly return to the twelfth power implicitly assumes 12 x 20 = 240 business
 * days, and every Brazilian rate is quoted on a 252-day basis. For April 2025
 * the difference is not academic:
 *
 *   (1 + 1.0559%)^12 - 1                  = 13.4335%   (240-day, wrong)
 *   (1 + daily)^252 - 1                   = 14.1507%   (252-day, correct)
 *   CDI published by the BCB on 30/04/25  = 14.15%     (matches to 4 decimals)
 *
 * A 0.72 percentage point error on a R$74k idle balance is R$536 a year of
 * misquoted opportunity cost in a client letter.
 */
export const BUSINESS_DAYS_PER_YEAR = 252;

/**
 * Fetch a raw SGS series for a closed date interval.
 * @returns {Promise<{observations: Array<{date: string, value: number}>, retrieved_at: string, url: string}>}
 */
export async function sgsSeries(code, startIso, endIso, options = {}) {
  const url =
    `${SGS_BASE}.${code}/dados?formato=json` +
    `&dataInicial=${toBrDate(startIso)}&dataFinal=${toBrDate(endIso)}`;

  const { data, retrieved_at } = await getJson(url, options);

  if (!Array.isArray(data)) {
    throw new Error(`SGS series ${code} did not return an array for ${startIso}..${endIso}`);
  }
  if (data.length === 0) {
    throw new Error(
      `SGS series ${code} returned no observations for ${startIso}..${endIso}. ` +
        'Refusing to continue with an empty benchmark.',
    );
  }

  const observations = data.map((row) => {
    const [d, m, y] = row.data.split('/');
    const value = Number(row.valor);
    if (!Number.isFinite(value)) {
      throw new Error(`SGS series ${code} returned a non-numeric value: ${JSON.stringify(row)}`);
    }
    return { date: `${y}-${m}-${d}`, value };
  });

  return { observations, retrieved_at, url };
}

/**
 * Compound a series of DAILY percentage rates.
 *
 * Interest rates chain multiplicatively, they do not add. For April 2025 the
 * twenty daily CDI factors compound to 1.0559% while their arithmetic sum is
 * 1.0506% - a 0.5 basis point gap in one month, but a materially wrong figure
 * once annualised. The letter quotes the compounded value.
 *
 *   total = PRODUCT(1 + rate_i / 100) - 1
 */
export function compoundDailyRates(observations) {
  const factor = observations.reduce((acc, o) => acc * (1 + o.value / 100), 1);
  return factor - 1;
}

/**
 * Annualise a return realised over `businessDays` business days, on the
 * 252-day basis Brazilian rates are quoted on.
 *
 *   daily  = (1 + total) ^ (1 / businessDays) - 1
 *   annual = (1 + daily) ^ 252 - 1
 *
 * Never use (1 + monthly) ^ 12: see BUSINESS_DAYS_PER_YEAR above.
 */
export function annualiseFromBusinessDays(totalReturn, businessDays) {
  if (!Number.isFinite(totalReturn) || !Number.isFinite(businessDays) || businessDays <= 0) {
    return null;
  }
  const daily = (1 + totalReturn) ** (1 / businessDays) - 1;
  return (1 + daily) ** BUSINESS_DAYS_PER_YEAR - 1;
}

/**
 * Realised CDI for the calendar month containing `refIso`, as a decimal
 * fraction (0.010559 === 1.0559%).
 */
export async function cdiForMonth(refIso, options = {}) {
  const { start, end } = monthWindow(refIso);
  const { observations, retrieved_at, url } = await sgsSeries(SGS.CDI_DAILY, start, end, options);
  const monthly = compoundDailyRates(observations);
  const derivedAnnual = annualiseFromBusinessDays(monthly, observations.length);

  // The BCB also publishes the annualised rate directly. Quoting the published
  // figure and checking our own derivation against it is the same discipline
  // used everywhere else in this pipeline: two independent paths to one number.
  let publishedAnnual = null;
  try {
    const annual = await sgsSeries(SGS.CDI_ANNUAL, start, end, options);
    const last = annual.observations[annual.observations.length - 1];
    publishedAnnual = {
      value: round(last.value / 100, 8),
      as_of: last.date,
      source: { provider: 'BCB SGS', series: SGS.CDI_ANNUAL, url: annual.url, retrieved_at: annual.retrieved_at },
    };
  } catch {
    // The annualised series is a convenience, not a dependency: the derived
    // figure stands on its own if the extra request fails.
  }

  const gap =
    publishedAnnual === null || derivedAnnual === null
      ? null
      : round(derivedAnnual - publishedAnnual.value, 8);

  return {
    indicator: 'CDI',
    period: { start, end },
    business_days: observations.length,
    value: round(monthly, 8),
    method: 'compounded daily factors',
    annualised: {
      // Prefer the published rate; fall back to our own derivation.
      value: publishedAnnual?.value ?? (derivedAnnual === null ? null : round(derivedAnnual, 8)),
      basis: `${BUSINESS_DAYS_PER_YEAR} business days`,
      published: publishedAnnual,
      derived: derivedAnnual === null ? null : round(derivedAnnual, 8),
      cross_check: gap === null ? { status: 'unavailable' } : {
        gap,
        status: Math.abs(gap) < 0.0005 ? 'consistent' : 'divergent',
      },
    },
    source: { provider: 'BCB SGS', series: SGS.CDI_DAILY, url, retrieved_at },
  };
}

/**
 * Realised IPCA for the calendar month containing `refIso`.
 * SGS publishes this series stamped on the first day of the month.
 */
export async function ipcaForMonth(refIso, options = {}) {
  const { start, end } = monthWindow(refIso);
  const { observations, retrieved_at, url } = await sgsSeries(SGS.IPCA_MONTHLY, start, end, options);
  const match = observations.find((o) => o.date.slice(0, 7) === refIso.slice(0, 7));
  if (!match) {
    throw new Error(`IPCA for ${refIso.slice(0, 7)} is not published yet.`);
  }
  return {
    indicator: 'IPCA',
    period: { start, end },
    value: round(match.value / 100, 8),
    source: { provider: 'BCB SGS', series: SGS.IPCA_MONTHLY, url, retrieved_at },
  };
}

/** Copom target Selic in force on the last day of the reference month, % per year. */
export async function selicTargetAt(refIso, options = {}) {
  const { start, end } = monthWindow(refIso);
  const { observations, retrieved_at, url } = await sgsSeries(SGS.SELIC_TARGET, start, end, options);
  const last = observations[observations.length - 1];
  return {
    indicator: 'Selic target',
    as_of: last.date,
    value_pct_year: last.value,
    source: { provider: 'BCB SGS', series: SGS.SELIC_TARGET, url, retrieved_at },
  };
}

/** BRL per USD on the last business day of the reference month. */
export async function usdBrlAt(refIso, options = {}) {
  const { start, end } = monthWindow(refIso);
  const { observations, retrieved_at, url } = await sgsSeries(SGS.USD_BRL, start, end, options);
  const last = observations[observations.length - 1];
  return {
    indicator: 'USD/BRL',
    as_of: last.date,
    value: last.value,
    source: { provider: 'BCB SGS', series: SGS.USD_BRL, url, retrieved_at },
  };
}

/**
 * Focus market consensus for one indicator and one reference year, as of the
 * most recent survey on or before `asOfIso`.
 *
 * baseCalculo=0 is the headline basis published in the Boletim Focus: every
 * response collected in the last 30 days (~140 institutions). baseCalculo=1
 * narrows to the last five business days (~67), which is more current but much
 * thinner. We take 0 and record the respondent count so the letter can be
 * explicit about what it is quoting.
 *
 * Minimo/Maximo matter as much as the median: they let us place XP's house view
 * inside the distribution of the whole market rather than merely beside it.
 */
export async function focusConsensus(indicator, referenceYear, asOfIso, options = {}) {
  const filter = [
    `Indicador eq '${indicator}'`,
    `DataReferencia eq '${referenceYear}'`,
    `Data le '${asOfIso}'`,
    'baseCalculo eq 0',
  ].join(' and ');

  const url =
    `${FOCUS_BASE}?%24format=json&%24top=1&%24orderby=Data%20desc` +
    `&%24filter=${encodeURIComponent(filter)}`;

  const { data, retrieved_at } = await getJson(url, options);
  const row = data?.value?.[0];
  if (!row) {
    throw new Error(
      `Focus returned no survey for ${indicator} / ${referenceYear} on or before ${asOfIso}.`,
    );
  }

  return {
    indicator,
    reference_year: String(referenceYear),
    survey_date: row.Data,
    median: row.Mediana,
    mean: row.Media,
    min: row.Minimo,
    max: row.Maximo,
    std_dev: row.DesvioPadrao,
    respondents: row.numeroRespondentes,
    source: { provider: 'BCB Focus (Olinda)', url, retrieved_at },
  };
}

/**
 * The Focus consensus for one indicator and reference year, as a TIME SERIES.
 *
 * This is the single most valuable series in the project, and not for the
 * reason it looks like. The v1 letter published "a Selic deve se estabilizar em
 * 9%". The Focus median for Selic 2025 was exactly 9,00% in May 2024, and 3,97%
 * for IPCA 2025 in October 2024 - which is what the v1 published for inflation.
 *
 * The v1 was not inventing at random. It was reciting the market consensus of
 * its own training window while a February 2025 document sat in its context
 * saying 15,50% and 6,1%. Plotting this series against those two points turns
 * the argument for deterministic extraction from a claim into a picture.
 *
 * @param {string} indicator
 * @param {number|string} referenceYear
 * @param {string} fromIso  first survey date to include
 * @param {string} toIso    last survey date to include
 */
export async function focusHistory(indicator, referenceYear, fromIso, toIso, options = {}) {
  const filter = [
    `Indicador eq '${indicator}'`,
    `DataReferencia eq '${referenceYear}'`,
    `Data ge '${fromIso}'`,
    `Data le '${toIso}'`,
    'baseCalculo eq 0',
  ].join(' and ');

  const url =
    `${FOCUS_BASE}?%24format=json&%24top=2000&%24orderby=Data%20asc` +
    `&%24select=Data,Mediana,Media,Minimo,Maximo,numeroRespondentes` +
    `&%24filter=${encodeURIComponent(filter)}`;

  const { data, retrieved_at } = await getJson(url, options);
  const rows = data?.value ?? [];
  if (rows.length === 0) {
    throw new Error(`Focus returned no history for ${indicator} / ${referenceYear} in ${fromIso}..${toIso}.`);
  }

  // One point per month keeps the series readable in a chart without
  // resampling or smoothing anything: we take the last survey of each month,
  // which is a real observation rather than a computed average.
  const byMonth = new Map();
  for (const row of rows) {
    byMonth.set(row.Data.slice(0, 7), {
      date: row.Data,
      median: row.Mediana,
      mean: row.Media,
      min: row.Minimo,
      max: row.Maximo,
      respondents: row.numeroRespondentes,
    });
  }

  return {
    indicator,
    reference_year: String(referenceYear),
    period: { start: fromIso, end: toIso },
    points: [...byMonth.values()].sort((a, b) => a.date.localeCompare(b.date)),
    observations: rows.length,
    sampling: 'last survey of each month',
    source: { provider: 'BCB Focus (Olinda)', url, retrieved_at },
  };
}

/**
 * Where a house forecast sits inside the Focus distribution.
 * Returns null when the range is degenerate, rather than dividing by zero.
 */
export function positionInConsensus(houseValue, consensus) {
  const { min, max, median } = consensus;
  if (!Number.isFinite(houseValue) || !Number.isFinite(min) || !Number.isFinite(max)) return null;
  const span = max - min;
  if (span <= 0) return null;

  const percentile = round(((houseValue - min) / span) * 100, 1);
  let stance;
  if (houseValue > median) stance = 'above_consensus';
  else if (houseValue < median) stance = 'below_consensus';
  else stance = 'at_consensus';

  return {
    house_value: houseValue,
    consensus_median: median,
    gap_vs_median: round(houseValue - median, 4),
    percentile_in_range: percentile,
    at_or_beyond_extreme: houseValue >= max || houseValue <= min,
    stance,
  };
}
