/**
 * Equity fundamentals used to screen buy candidates against the client profile.
 *
 * The profile says the client may hold "ações de empresas consolidadas listadas
 * em bolsas de valores que historicamente pagam dividendos anuais". To act on
 * that sentence a machine needs to know which companies actually paid dividends
 * - and that is a fact to be looked up, not a judgement to be made by a
 * language model from memory.
 *
 * Yahoo's chart endpoint returns dividend EVENTS alongside prices, so the
 * trailing yield is computed from the actual payment history over the lookback
 * window, ending at the reference date. No figure here originates in a prompt.
 *
 * Volatility is included for the same reason: "moderado" implies tolerance for
 * some volatility, not for any amount, and an annualised standard deviation of
 * daily returns is a defensible, reproducible way to rank candidates.
 */

import { getJson } from './http.js';
import { toEpochSeconds, addDays, addMonths } from '../lib/dates.js';
import { round } from '../lib/numbers.js';
import { toProviderSymbol } from './quotes.js';

const CHART_BASE = 'https://query1.finance.yahoo.com/v8/finance/chart';

/** Trading days per year, used to annualise daily volatility. */
const TRADING_DAYS = 252;

/**
 * Price history plus dividend events for one ticker, over `lookbackMonths`
 * ending at `referenceDate`.
 */
export async function fetchHistory(ticker, referenceDate, lookbackMonths = 12, options = {}) {
  const symbol = toProviderSymbol(ticker);
  const start = addMonths(referenceDate, -lookbackMonths);

  const url =
    `${CHART_BASE}/${encodeURIComponent(symbol)}` +
    `?period1=${toEpochSeconds(start)}&period2=${toEpochSeconds(addDays(referenceDate, 4))}` +
    '&interval=1d&events=div';

  const { data, retrieved_at } = await getJson(url, { ...options, acceptStatuses: [404] });
  const result = data?.chart?.result?.[0];
  if (!result) {
    const error = new Error(`No history for ${symbol}: ${data?.chart?.error?.description ?? 'not found'}`);
    error.code = 'SYMBOL_NOT_FOUND';
    throw error;
  }

  const timestamps = result.timestamp ?? [];
  const rawCloses = result.indicators?.quote?.[0]?.close ?? [];
  const closes = timestamps
    .map((t, i) => ({
      date: new Date(t * 1000 - 3 * 3_600_000).toISOString().slice(0, 10),
      close: rawCloses[i],
    }))
    .filter((row) => Number.isFinite(row.close) && row.date <= referenceDate);

  const dividendMap = result.events?.dividends ?? {};
  const dividends = Object.values(dividendMap)
    .map((d) => ({
      date: new Date(d.date * 1000 - 3 * 3_600_000).toISOString().slice(0, 10),
      amount: d.amount,
    }))
    .filter((d) => Number.isFinite(d.amount) && d.date >= start && d.date <= referenceDate)
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    ticker,
    symbol,
    name: result.meta?.longName ?? result.meta?.shortName ?? ticker,
    closes,
    dividends,
    window: { start, end: referenceDate, months: lookbackMonths },
    source: { provider: 'Yahoo Finance', url, retrieved_at },
  };
}

/** Annualised standard deviation of daily log returns. */
export function annualisedVolatility(closes) {
  if (closes.length < 20) return null;
  const returns = [];
  for (let i = 1; i < closes.length; i += 1) {
    returns.push(Math.log(closes[i].close / closes[i - 1].close));
  }
  const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (returns.length - 1);
  return round(Math.sqrt(variance) * Math.sqrt(TRADING_DAYS), 6);
}

/** Maximum peak-to-trough decline over the window. */
export function maxDrawdown(closes) {
  if (closes.length < 2) return null;
  let peak = closes[0].close;
  let worst = 0;
  for (const row of closes) {
    if (row.close > peak) peak = row.close;
    const drawdown = row.close / peak - 1;
    if (drawdown < worst) worst = drawdown;
  }
  return round(worst, 6);
}

/**
 * Fundamentals for one ticker, measured over the window ending at the
 * reference date.
 *
 * @returns {Promise<object>} always includes `status`; never throws for a
 *   ticker that simply cannot be priced, so one bad symbol cannot blank the
 *   whole screen.
 */
export async function fetchFundamentals(ticker, referenceDate, options = {}) {
  try {
    const history = await fetchHistory(ticker, referenceDate, options.lookbackMonths ?? 12, options);
    const { closes, dividends } = history;

    if (closes.length === 0) {
      return { ticker, status: 'no_price_history' };
    }

    const lastClose = closes[closes.length - 1].close;
    const dividendsPaid = dividends.reduce((s, d) => s + d.amount, 0);

    return {
      ticker,
      status: 'ok',
      name: history.name,
      last_close: round(lastClose, 4),
      last_close_date: closes[closes.length - 1].date,
      dividends_paid_per_share: round(dividendsPaid, 6),
      dividend_events: dividends.length,
      dividend_dates: dividends.map((d) => d.date),
      trailing_dividend_yield: lastClose > 0 ? round(dividendsPaid / lastClose, 6) : null,
      annualised_volatility: annualisedVolatility(closes),
      max_drawdown: maxDrawdown(closes),
      observations: closes.length,
      window: history.window,
      source: history.source,
    };
  } catch (error) {
    return {
      ticker,
      status: error.code === 'SYMBOL_NOT_FOUND' ? 'symbol_not_found' : 'fetch_failed',
      detail: error.message,
    };
  }
}

/** Fundamentals for a list of tickers, one failure never blanking the rest. */
export async function fetchFundamentalsBatch(tickers, referenceDate, options = {}) {
  return Promise.all(tickers.map((t) => fetchFundamentals(t, referenceDate, options)));
}
