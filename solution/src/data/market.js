/**
 * Market snapshot assembly.
 *
 * Combines four independent sources into the single contract the calculation
 * and recommendation engines consume:
 *
 *   realised benchmarks   BCB SGS      what the portfolio is measured against
 *   forward consensus     BCB Focus    what ~140 institutions expect
 *   index prices          Yahoo        IBOVESPA month return
 *   house view            XP report    parsed, never asked of an LLM
 *
 * Every figure carries its provider, URL and retrieval timestamp, so any number
 * that reaches the client letter can be traced back to a request that can be
 * replayed. That audit trail is the reason the validation layer downstream can
 * be strict.
 *
 * DEGRADATION POLICY
 * ------------------
 * A provider that fails does not take the whole letter down, but it never
 * degrades into a silent zero either. The affected block is omitted and a
 * warning is recorded; downstream layers must check for absence and say so in
 * plain Portuguese rather than filling the gap.
 */

import { cdiForMonth, ipcaForMonth, selicTargetAt, usdBrlAt, focusConsensus, focusHistory, positionInConsensus } from './bcb.js';
import { monthlyReturn, validateTickers, toProviderSymbol } from './quotes.js';
import { houseValue } from '../parse/macro.js';
import { monthWindow, endOfMonth } from '../lib/dates.js';

const IBOVESPA = '^BVSP';

/**
 * Indicators compared between XP's house view and the Focus consensus.
 * `focusIndicator` must match the Focus vocabulary exactly.
 */
const COMPARISONS = [
  { indicator: 'Selic', focusIndicator: 'Selic', unit: '% a.a.', direction: 'higher_is_tighter' },
  { indicator: 'IPCA', focusIndicator: 'IPCA', unit: '% a.a.', direction: 'higher_is_worse' },
  { indicator: 'Câmbio', focusIndicator: 'Câmbio', unit: 'R$/US$', direction: 'higher_is_weaker_brl' },
  { indicator: 'PIB Total', focusIndicator: 'PIB Total', unit: '%', direction: 'higher_is_better' },
];

/** Run a producer, capturing failure as a warning instead of a crash. */
async function attempt(label, warnings, producer) {
  try {
    return await producer();
  } catch (error) {
    warnings.push({
      code: 'provider_unavailable',
      severity: 'warning',
      detail: `${label}: ${error.message}`,
    });
    return null;
  }
}

/**
 * @param {object} params
 * @param {string} params.referenceDate  any ISO date inside the reference month
 * @param {object} params.macro          output of parseMacro()
 * @param {string[]} [params.tickers]    client tickers to validate
 * @param {boolean} [params.refresh]     bypass the HTTP cache
 */
export async function buildMarketSnapshot({ referenceDate, macro, tickers = [], refresh = false }) {
  const warnings = [];
  const options = { refresh };
  const window = monthWindow(referenceDate);
  const monthEnd = endOfMonth(referenceDate);
  const consensusYear = Number(referenceDate.slice(0, 4));

  // --- realised benchmarks, fetched concurrently --------------------------
  const [cdi, ipca, selic, usdBrl, ibov] = await Promise.all([
    attempt('CDI (SGS 12)', warnings, () => cdiForMonth(referenceDate, options)),
    attempt('IPCA (SGS 433)', warnings, () => ipcaForMonth(referenceDate, options)),
    attempt('Selic target (SGS 432)', warnings, () => selicTargetAt(referenceDate, options)),
    attempt('USD/BRL (SGS 1)', warnings, () => usdBrlAt(referenceDate, options)),
    attempt('IBOVESPA (Yahoo)', warnings, () => monthlyReturn(IBOVESPA, referenceDate, options)),
  ]);

  // --- forward-looking consensus vs house view ----------------------------
  const consensus = {};
  const houseVsConsensus = [];

  for (const spec of COMPARISONS) {
    const focus = await attempt(`Focus ${spec.focusIndicator}`, warnings, () =>
      focusConsensus(spec.focusIndicator, consensusYear, monthEnd, options),
    );
    if (!focus) continue;
    consensus[spec.indicator] = focus;

    const house = houseValue(macro, spec.indicator, consensusYear);
    if (house === null) {
      warnings.push({
        code: 'house_view_missing',
        severity: 'info',
        detail: `XP report carries no ${spec.indicator} projection for ${consensusYear}; comparison omitted.`,
      });
      continue;
    }

    const placement = positionInConsensus(house, focus);
    if (placement) {
      houseVsConsensus.push({
        indicator: spec.indicator,
        unit: spec.unit,
        direction: spec.direction,
        reference_year: consensusYear,
        survey_date: focus.survey_date,
        respondents: focus.respondents,
        ...placement,
        consensus_min: focus.min,
        consensus_max: focus.max,
      });
    }
  }

  // --- how the consensus itself moved, for the chart ----------------------
  //
  // Not decoration. This series is what shows that the v1 letter's figures were
  // the market consensus of its own training window rather than random
  // invention: the Focus median for Selic 2025 was exactly 9,00% in May 2024.
  const consensusHistory = {};
  for (const indicator of ['Selic', 'IPCA']) {
    const history = await attempt(`Focus history ${indicator}`, warnings, () =>
      focusHistory(indicator, consensusYear, `${consensusYear - 2}-01-01`, monthEnd, options),
    );
    if (history) consensusHistory[indicator] = history;
  }

  // --- ticker validation against a live source ----------------------------
  const tickerValidation = tickers.length
    ? await attempt('Ticker validation (Yahoo)', warnings, () =>
        validateTickers(tickers, referenceDate, options),
      )
    : [];

  // --- an independent monthly return for each HELD ticker ------------------
  //
  // The price file XP supplied is the only source for the equity sleeve's
  // return, and nothing corroborates it. The candidate screen already
  // reconciles the same file against the market for names the client does NOT
  // own and finds gaps up to 56%; leaving the names he DOES own unchecked is
  // the asymmetry a reviewer will find first.
  //
  // Returns are compared, never price levels: a retro-adjusted series (HAPV3
  // was grouped 15:1) makes a level comparison meaningless while the return
  // stays valid. Dead codes are routed through their successor.
  const heldReturns = [];
  for (const row of tickerValidation ?? []) {
    const symbol = row.status === 'superseded' ? row.successor : row.ticker;
    if (!symbol) continue;
    const measured = await attempt(`Reference return for ${row.ticker}`, warnings, () =>
      monthlyReturn(toProviderSymbol(symbol), referenceDate, options),
    );
    if (!measured) continue;
    heldReturns.push({
      ticker: row.ticker,
      resolved_symbol: symbol,
      via_successor: row.status === 'superseded' ? row.successor : null,
      value: measured.value,
      from: measured.from,
      to: measured.to,
      source: measured.source,
    });
  }

  for (const row of tickerValidation ?? []) {
    if (row.status === 'superseded') {
      warnings.push({
        code: 'ticker_superseded',
        severity: 'warning',
        detail: `${row.ticker} no longer trades: replaced by ${row.successor} (${row.successor_name}). ${row.reason}.`,
      });
    } else if (row.status === 'unresolved' || row.status === 'check_failed') {
      warnings.push({
        code: row.status === 'check_failed' ? 'ticker_check_failed' : 'ticker_unresolved',
        severity: 'warning',
        detail: row.detail,
      });
    }
  }

  return {
    reference_month: referenceDate.slice(0, 7),
    period: { start: window.start, end: window.end, label_pt: window.label },
    benchmarks: {
      cdi,
      ipca,
      ibovespa: ibov,
      selic_target: selic,
      usd_brl: usdBrl,
    },
    consensus,
    house_view_vs_consensus: houseVsConsensus,
    consensus_history: consensusHistory,
    consensus_history: consensusHistory,
    house_view_as_of: macro?.report_date ?? null,
    ticker_validation: tickerValidation ?? [],
    held_return_reference: heldReturns,
    warnings,
    built_at: new Date().toISOString(),
  };
}
