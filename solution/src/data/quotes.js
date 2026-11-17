/**
 * Equity price connector (Yahoo Finance chart API, no key required).
 *
 * Used for two distinct jobs:
 *
 *   1. BENCHMARK - the IBOVESPA close on the last trading day of the reference
 *      month and of the month before it. The v1 letter compared the portfolio
 *      to a benchmark that existed nowhere in the inputs; this is a real one.
 *
 *   2. TICKER VALIDATION - confirming that the codes carried in the client's
 *      statement still trade. Two of Albert's four codes do not: ARZZ3 and
 *      MRFG3 were both replaced by corporate actions. A pipeline that only ever
 *      reads the static CSV can never discover that. This is the strongest
 *      argument for having an external source in the loop at all.
 *
 * NOTE ON AUTHORITY
 * -----------------
 * This provider is NOT used to overwrite the client's custodied position or
 * P&L. The statement and the price file supplied by XP are the system of
 * record. External prices are used for context and for audit, and any
 * divergence is reported rather than silently applied.
 */

import { getJson } from './http.js';
import { toEpochSeconds, addDays, addMonths, startOfMonth, endOfMonth } from '../lib/dates.js';
import { round } from '../lib/numbers.js';

const CHART_BASE = 'https://query1.finance.yahoo.com/v8/finance/chart';

/** B3 tickers carry a .SA suffix on Yahoo; indices such as ^BVSP do not. */
export function toProviderSymbol(ticker) {
  return ticker.startsWith('^') ? ticker : `${ticker}.SA`;
}

/**
 * Ticker successions caused by corporate actions, each verified against the
 * provider by resolveSuccessor() before it is ever surfaced to a user.
 * This registry is data, not logic, so it can be maintained without a code
 * change when the next merger happens.
 */
export const TICKER_SUCCESSORS = {
  ARZZ3: { successor: 'AZZA3', reason: 'Arezzo & Co merged with Grupo Soma to form Azzas 2154' },
  MRFG3: { successor: 'MBRF3', reason: 'Marfrig reorganised with BRF into MBRF' },
};

/**
 * Daily closes for a symbol over a date interval.
 * @returns {Promise<{symbol, name, currency, closes: Array<{date, close}>, retrieved_at, url}>}
 */
export async function dailyCloses(symbol, startIso, endIso, options = {}) {
  // period2 is exclusive of bars stamped later in the day, so a request ending
  // exactly at month end drops the month-end session. Reaching a few days past
  // the interval and filtering afterwards is the only reliable way to capture
  // the last trading day of the month.
  const url =
    `${CHART_BASE}/${encodeURIComponent(symbol)}` +
    `?period1=${toEpochSeconds(startIso)}&period2=${toEpochSeconds(addDays(endIso, 4))}&interval=1d`;

  // A 404 from Yahoo carries a JSON body naming the failure; we need to read it
  // to tell "this symbol never existed" apart from "the provider is down".
  const { data, retrieved_at } = await getJson(url, { ...options, acceptStatuses: [404] });
  const result = data?.chart?.result?.[0];

  if (!result) {
    const message = data?.chart?.error?.description ?? 'symbol not found';
    const error = new Error(`No price series for ${symbol}: ${message}`);
    error.code = 'SYMBOL_NOT_FOUND';
    throw error;
  }

  const timestamps = result.timestamp ?? [];
  const rawCloses = result.indicators?.quote?.[0]?.close ?? [];

  const closes = timestamps
    .map((t, i) => ({
      // Bars are stamped at the session open in exchange time (UTC-3 for B3),
      // so converting in UTC would push a 10:00 BRT bar onto the correct day
      // but a late bar onto the next one. Shifting into exchange time first
      // keeps every bar on its true trading date.
      date: new Date(t * 1000 - 3 * 3_600_000).toISOString().slice(0, 10),
      close: rawCloses[i],
    }))
    // Yahoo emits nulls for halted sessions. Dropping them is safe here because
    // we only ever read the LAST close of a month, never a running series.
    .filter((row) => Number.isFinite(row.close))
    // Trim the lookahead buffer added to period2 above.
    .filter((row) => row.date <= endIso);

  if (closes.length === 0) {
    const error = new Error(`Price series for ${symbol} came back empty for ${startIso}..${endIso}`);
    error.code = 'EMPTY_SERIES';
    throw error;
  }

  return {
    symbol,
    name: result.meta?.longName ?? result.meta?.shortName ?? symbol,
    currency: result.meta?.currency ?? null,
    closes,
    retrieved_at,
    url,
  };
}

/** Last close on or before `iso` from an ascending close series. */
function lastCloseOnOrBefore(closes, iso) {
  let found = null;
  for (const row of closes) {
    if (row.date <= iso) found = row;
    else break;
  }
  return found;
}

/**
 * Return of `symbol` over the calendar month containing `refIso`, measured
 * from the last close of the PREVIOUS month to the last close of the reference
 * month. Using last-close-to-last-close rather than first-to-last is what makes
 * the figure comparable to a fund's monthly quota variation.
 */
export async function monthlyReturn(symbol, refIso, options = {}) {
  const monthEnd = endOfMonth(refIso);
  const priorMonthEnd = endOfMonth(addMonths(startOfMonth(refIso), -1));
  // Reach back far enough to always capture the prior month's last session,
  // even across a long holiday run.
  const windowStart = addMonths(startOfMonth(refIso), -1);

  const series = await dailyCloses(symbol, windowStart, monthEnd, options);

  const base = lastCloseOnOrBefore(series.closes, priorMonthEnd);
  const final = lastCloseOnOrBefore(series.closes, monthEnd);

  if (!base || !final || base.date === final.date) {
    throw new Error(
      `Cannot compute a monthly return for ${symbol}: missing a month boundary close ` +
        `(base=${base?.date ?? 'none'}, final=${final?.date ?? 'none'}).`,
    );
  }

  return {
    symbol,
    name: series.name,
    from: { date: base.date, close: round(base.close, 4) },
    to: { date: final.date, close: round(final.close, 4) },
    value: round(final.close / base.close - 1, 8),
    source: { provider: 'Yahoo Finance', url: series.url, retrieved_at: series.retrieved_at },
  };
}

/**
 * Confirm that a ticker still trades. When it does not, look up the registry
 * and VERIFY the successor resolves on the provider before proposing it, so we
 * never tell an advisor to look at a code that is itself dead.
 *
 * @returns {Promise<{ticker, status, name?, successor?, successor_name?, reason?, detail?}>}
 */
export async function validateTicker(ticker, referenceDate, options = {}) {
  const symbol = toProviderSymbol(ticker);
  // Probe the reference month, not today. Two reasons: the question we actually
  // want answered is "was this a tradable code at the statement date", and a
  // window derived from wall-clock time would change the cache key every day,
  // which would break reproducibility of the letter.
  const probeEnd = endOfMonth(referenceDate);
  const probeStart = addMonths(startOfMonth(referenceDate), -1);

  try {
    const series = await dailyCloses(symbol, probeStart, probeEnd, options);
    return { ticker, status: 'active', name: series.name };
  } catch (error) {
    if (error.code !== 'SYMBOL_NOT_FOUND' && error.code !== 'EMPTY_SERIES') throw error;

    const known = TICKER_SUCCESSORS[ticker];
    if (!known) {
      return {
        ticker,
        status: 'unresolved',
        detail: `${ticker} does not resolve at the provider and no successor is registered.`,
      };
    }

    try {
      const successorSeries = await dailyCloses(
        toProviderSymbol(known.successor),
        probeStart,
        probeEnd,
        options,
      );
      return {
        ticker,
        status: 'superseded',
        successor: known.successor,
        successor_name: successorSeries.name,
        reason: known.reason,
      };
    } catch {
      return {
        ticker,
        status: 'unresolved',
        detail:
          `${ticker} does not resolve and its registered successor ` +
          `${known.successor} does not resolve either.`,
      };
    }
  }
}

/**
 * Validate a list of tickers concurrently.
 *
 * Uses allSettled rather than all: one unreachable symbol must not erase the
 * verdict for the other three. A rejected probe becomes an explicit
 * 'check_failed' row, so an advisor can tell the difference between "this code
 * is dead" and "we could not check this code".
 */
export async function validateTickers(tickers, referenceDate, options = {}) {
  const settled = await Promise.allSettled(
    tickers.map((t) => validateTicker(t, referenceDate, options)),
  );
  return settled.map((outcome, i) =>
    outcome.status === 'fulfilled'
      ? outcome.value
      : {
          ticker: tickers[i],
          status: 'check_failed',
          detail: outcome.reason?.message ?? 'unknown error',
        },
  );
}
