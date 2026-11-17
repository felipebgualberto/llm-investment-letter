/**
 * Portfolio return and performance attribution.
 *
 * This module produces every number the client letter is allowed to contain.
 * The language model downstream receives its output and may not compute
 * anything of its own.
 *
 * ---------------------------------------------------------------------------
 * DECISION 1: WHAT "THE PORTFOLIO RETURNED X%" MEANS WHEN COVERAGE IS PARTIAL
 * ---------------------------------------------------------------------------
 * 86.94% of the invested balance can be measured from primary sources. The
 * remaining 13.06% cannot: a CDB that matured eight months before the statement
 * and a R$305 fund absent from the CVM registry.
 *
 * Three ways to report a headline figure, only one of them honest:
 *
 *   (a) Assume the unmeasured part returned zero.  Understates. Invents a zero.
 *   (b) Assume it returned CDI.                    Invents a number outright -
 *                                                  the exact sin of the v1.
 *   (c) Report the return OF THE MEASURED PART and state the coverage.
 *
 * We do (c). The letter says "we measured 86.9% of your portfolio; it returned
 * X%", which is a true statement about a well-defined set of assets, and names
 * what was left out. A number with a stated denominator beats a rounder number
 * with a fictional one.
 *
 * ---------------------------------------------------------------------------
 * DECISION 2: ONE RULE FOR THE BEGINNING VALUE, AND A CROSS-CHECK
 * ---------------------------------------------------------------------------
 * Attribution requires each position's value at the START of the month, and the
 * statement only gives the end. Every position therefore uses the same rule:
 *
 *     V0 = V1 / (1 + r)
 *
 * where V1 is the statement's market value and r the return from its primary
 * source (the XP price file for equities, CVM for funds).
 *
 * The tempting alternative for equities - V0 = quantity x prior price - was
 * rejected because it mixes bases. The statement rounds prices to two decimals,
 * so quantity x price does not reproduce the stated position exactly; pairing an
 * observed V0 with a stated V1 makes "return x V0" disagree with "V1 - V0" by a
 * few reais per line. A letter whose own arithmetic does not close is a letter
 * an advisor cannot defend.
 *
 * The observed value is not discarded: it becomes an INDEPENDENT CHECK on the
 * derived one. If quantity x prior price and V1/(1+r) disagree by more than the
 * rounding tolerance, the price file and the statement are telling different
 * stories and that is reported.
 *
 * The rule is exact under one assumption, stated explicitly in the output: no
 * contributions or redemptions during the month. With a cash flow mid-month the
 * true figure would be a money-weighted return, which the inputs cannot
 * support. The assumption is recorded as a flag rather than left implicit.
 *
 * ---------------------------------------------------------------------------
 * DECISION 3: CONTRIBUTIONS MUST SUM TO THE PORTFOLIO RETURN
 * ---------------------------------------------------------------------------
 * Contribution is computed against the BEGINNING total, not the ending weight:
 *
 *     contribution_i = (V1_i - V0_i) / V0_total
 *
 * These sum exactly to the portfolio return, which is asserted at runtime. The
 * common shortcut - ending weight x return - does not add up, and a letter
 * whose parts do not sum to its total is a letter an advisor cannot defend.
 */

import { round, closeTo } from '../lib/numbers.js';

const BASIS = 'V0 = V1 / (1 + r), with V1 the stated position and r the sourced monthly return';

/**
 * Tolerance for the equity cross-check, in reais. The statement rounds prices
 * to two decimals, so on a 1,642-share position the derived and observed start
 * values can legitimately differ by a few reais. Anything larger means the
 * price file and the statement disagree about the position itself.
 */
const CROSS_CHECK_TOLERANCE_BRL = 5.0;

/**
 * Tolerance, in percentage points, between the return implied by XP's price
 * file and the return the market shows for the same ticker and month.
 *
 * Set at 4.5pp deliberately. Corporate actions, adjusted series and a
 * statement's own marking conventions can all move a single-month equity
 * return by a couple of points without either source being wrong. Beyond
 * roughly four points the two are describing different things, and the letter
 * should say so rather than pick a side.
 *
 * The existing v0 cross-check cannot catch this: `prior_price` enters V0 only
 * as a scale factor, so any prior price whatsoever reconciles.
 */
const RETURN_RECONCILIATION_TOLERANCE_PP = 4.5;

/**
 * @param {object} params
 * @param {object} params.portfolio  output of parsePortfolio
 * @param {Map}    params.prices     ticker -> price record from parsePrices
 * @param {object} params.funds      output of measureFunds
 * @param {object} params.market     output of buildMarketSnapshot
 * @param {string} params.referenceDate
 */
export function computePerformance({ portfolio, prices, funds, market, referenceDate }) {
  // Flags raised upstream must survive the module boundary.
  //
  // This module used to start with an empty array, which meant the parser's
  // seven `stale_quota_date` warnings - whose text literally reads "Monthly
  // performance cannot be derived from this figure" - existed in
  // out/portfolio.json and were absent from out/metrics.json. The narration
  // layer reads metrics.json. A caveat that does not reach the renderer is a
  // caveat that does not reach the client.
  const flags = [
    ...(portfolio.data_quality_flags ?? []).map((f) => ({ ...f, origin: 'portfolio_parser' })),
    ...(market?.warnings ?? []).map((f) => ({ ...f, origin: 'market_data' })),
  ];
  const fundByName = new Map((funds?.results ?? []).map((r) => [r.statement_name, r]));

  const measured = [];
  const unmeasured = [];

  for (const holding of portfolio.holdings) {
    const label = holding.ticker ?? holding.name;
    const v1 = holding.market_value;

    // --- equities: both endpoints observed -------------------------------
    if (holding.sleeve === 'stocks') {
      const price = prices.get(holding.ticker);
      if (!price) {
        unmeasured.push({
          label, sleeve: holding.sleeve, market_value: v1, weight: holding.weight,
          reason: `${holding.ticker} is not present in the price file.`,
        });
        continue;
      }
      if (!Number.isFinite(holding.quantity)) {
        unmeasured.push({
          label, sleeve: holding.sleeve, market_value: v1, weight: holding.weight,
          reason: `${holding.ticker} has no quantity in the statement.`,
        });
        continue;
      }

      const r = price.monthly_return;
      const v0 = v1 / (1 + r);

      // Independent check: the price file also implies a start value directly.
      // Agreement confirms that quantity, both prices and the stated position
      // are describing the same holding.
      const v0Observed = holding.quantity * price.prior_price;
      const gap = v0 - v0Observed;
      if (!closeTo(v0, v0Observed, CROSS_CHECK_TOLERANCE_BRL)) {
        flags.push({
          code: 'position_price_disagreement',
          severity: 'warning',
          detail:
            `${label}: derived start value ${round(v0, 2)} vs quantity x prior price ` +
            `${round(v0Observed, 2)} (gap ${round(gap, 2)}). The price file and the ` +
            'statement disagree by more than rounding explains.',
        });
      }

      // Second, independent check: the return the market shows for the same
      // ticker and month. This one CAN detect a wrong prior price, which the
      // value check above structurally cannot.
      const reference = (market?.held_return_reference ?? []).find((h) => h.ticker === holding.ticker);
      let returnReconciliation = { status: 'unavailable' };
      if (reference && Number.isFinite(reference.value)) {
        const gapPp = round((r - reference.value) * 100, 4);
        const divergent = Math.abs(gapPp) > RETURN_RECONCILIATION_TOLERANCE_PP;
        returnReconciliation = {
          price_file_return: round(r, 8),
          market_return: reference.value,
          resolved_symbol: reference.resolved_symbol,
          via_successor: reference.via_successor,
          gap_pp: gapPp,
          sign_flip: Math.sign(r) !== Math.sign(reference.value),
          status: divergent ? 'divergent' : 'consistent',
          tolerance_pp: RETURN_RECONCILIATION_TOLERANCE_PP,
        };
        if (divergent) {
          flags.push({
            code: 'holding_return_divergent',
            severity: 'warning',
            detail:
              `${label}: the price file implies ${round(r * 100, 2)}% for the month while ` +
              `${reference.resolved_symbol} closed at ${round(reference.value * 100, 2)}% ` +
              `(gap ${gapPp} p.p.${returnReconciliation.sign_flip ? ', opposite sign' : ''}). ` +
              'The statement remains the system of record; the divergence is disclosed, not resolved.',
          });
        }
      }

      measured.push({
        label, sleeve: holding.sleeve, name: holding.name ?? label,
        quantity: holding.quantity,
        price_from: price.prior_price,
        price_to: price.current_price,
        v0: round(v0, 2),
        v1: round(v1, 2),
        return: round(r, 8),
        basis: BASIS,
        cross_check: {
          v0_observed: round(v0Observed, 2),
          gap_brl: round(gap, 2),
          status: closeTo(v0, v0Observed, CROSS_CHECK_TOLERANCE_BRL) ? 'consistent' : 'divergent',
        },
        return_reconciliation: returnReconciliation,
        source: 'XP price file',
      });
      continue;
    }

    // --- funds: return observed, start value derived ----------------------
    if (holding.sleeve === 'funds') {
      const fund = fundByName.get(holding.name);
      if (!fund || fund.status !== 'measured') {
        unmeasured.push({
          label, sleeve: holding.sleeve, market_value: v1, weight: holding.weight,
          reason: fund?.reason ?? `No measured monthly return for ${holding.name}.`,
        });
        continue;
      }
      const r = fund.value;
      const v0 = v1 / (1 + r);
      measured.push({
        label, sleeve: holding.sleeve, name: holding.name,
        cnpj: fund.cnpj,
        v0: round(v0, 2),
        v1: round(v1, 2),
        return: round(r, 8),
        basis: BASIS,
        source: `CVM ${fund.dataset}`,
        target_investor: fund.target_investor ?? null,
        renamed_to: fund.renamed ? fund.current_name : null,
      });
      continue;
    }

    // --- fixed income: no measurable monthly return -----------------------
    unmeasured.push({
      label, sleeve: holding.sleeve, market_value: v1, weight: holding.weight,
      reason:
        holding.maturity_date && holding.maturity_date < portfolio.statement_date
          ? `Matured on ${holding.maturity_date}, before the statement date. No return accrues for the reference month.`
          : 'No monthly price or quota series is available for this instrument.',
      matured_on: holding.maturity_date ?? null,
      contracted_rate: holding.rate ?? null,
    });
  }

  if (measured.length === 0) {
    throw new Error('No holding could be measured; refusing to produce a performance report.');
  }

  // --- portfolio-level aggregation ----------------------------------------
  const v0Total = measured.reduce((s, m) => s + m.v0, 0);
  const v1Total = measured.reduce((s, m) => s + m.v1, 0);
  const portfolioReturn = v1Total / v0Total - 1;
  const pnl = v1Total - v0Total;

  for (const m of measured) {
    m.pnl = round(m.v1 - m.v0, 2);
    // Share of the MEASURED base, at the start of the period.
    m.weight_start = round(m.v0 / v0Total, 6);
    m.weight_end = round(m.v1 / v1Total, 6);
    // Share of the client's whole invested balance, for context in the letter.
    m.weight_of_invested = round(m.v1 / portfolio.totals.invested, 6);
    m.contribution_pp = round(((m.v1 - m.v0) / v0Total) * 100, 4);
  }

  // The identity that makes the letter defensible: the parts sum to the whole.
  //
  // Two separate checks, because they can fail for different reasons:
  //   EXACT   on unrounded contributions - a failure here is a real arithmetic
  //           bug and is an error.
  //   DISPLAY on the rounded values the letter will actually print - each line
  //           can drift by half of the last displayed digit, so the tolerance
  //           scales with the number of lines. A failure here is cosmetic, but
  //           a client who adds up the column must still land on the total.
  const exactSum = measured.reduce((s, m) => s + (m.v1 - m.v0) / v0Total, 0);
  if (!closeTo(exactSum, portfolioReturn, 1e-12)) {
    flags.push({
      code: 'attribution_does_not_reconcile',
      severity: 'error',
      detail:
        `Unrounded contributions sum to ${exactSum} but the measured return is ${portfolioReturn}.`,
    });
  }

  const contributionSum = measured.reduce((s, m) => s + m.contribution_pp, 0);
  const displayTolerance = measured.length * 0.00005;
  if (!closeTo(contributionSum, portfolioReturn * 100, displayTolerance)) {
    flags.push({
      code: 'attribution_display_rounding',
      severity: 'warning',
      detail:
        `Rounded contributions sum to ${round(contributionSum, 4)} p.p. against a measured ` +
        `return of ${round(portfolioReturn * 100, 4)} p.p. - beyond what rounding ` +
        `${measured.length} lines explains.`,
    });
  }

  // --- sleeve aggregation --------------------------------------------------
  const sleeves = {};
  for (const m of measured) {
    const s = (sleeves[m.sleeve] ??= { sleeve: m.sleeve, v0: 0, v1: 0, count: 0 });
    s.v0 += m.v0;
    s.v1 += m.v1;
    s.count += 1;
  }
  const bySleeve = Object.values(sleeves).map((s) => ({
    sleeve: s.sleeve,
    count: s.count,
    v0: round(s.v0, 2),
    v1: round(s.v1, 2),
    return: round(s.v1 / s.v0 - 1, 8),
    pnl: round(s.v1 - s.v0, 2),
    contribution_pp: round(((s.v1 - s.v0) / v0Total) * 100, 4),
    weight_of_measured: round(s.v1 / v1Total, 6),
  }));

  // --- coverage ------------------------------------------------------------
  const unmeasuredValue = unmeasured.reduce((s, u) => s + u.market_value, 0);
  const coverage = {
    measured_value: round(v1Total, 2),
    unmeasured_value: round(unmeasuredValue, 2),
    share_of_invested: round(v1Total / portfolio.totals.invested, 6),
    share_of_net_worth: round(v1Total / portfolio.totals.net_worth, 6),
    measured_positions: measured.length,
    total_positions: portfolio.holdings.length,
  };

  // --- benchmark comparison ------------------------------------------------
  const b = market?.benchmarks ?? {};
  const compare = (benchmark) =>
    Number.isFinite(benchmark?.value)
      ? {
          value: benchmark.value,
          excess_pp: round((portfolioReturn - benchmark.value) * 100, 4),
        }
      : null;

  const versus = {
    cdi: compare(b.cdi),
    ibovespa: compare(b.ibovespa),
    ipca: compare(b.ipca),
  };

  // "% do CDI" is the one ratio a Brazilian investor reads natively, and it is
  // emitted for the CDI alone. A generic ratio field invited the narration layer
  // to write "rendeu 6 vezes o IPCA", which means nothing, and it inverts sign
  // in any month of deflation. The inflation comparison belongs in real_return.
  if (versus.cdi && b.cdi.value > 0 && portfolioReturn > 0) {
    versus.cdi.pct_of_cdi = round((portfolioReturn / b.cdi.value) * 100, 2);
  }

  // Fisher, not subtraction: (1 + nominal) / (1 + inflation) - 1.
  if (versus.ipca) versus.ipca.real_return = round((1 + portfolioReturn) / (1 + b.ipca.value) - 1, 8);

  for (const [name, value] of Object.entries(versus)) {
    if (value === null) {
      flags.push({
        code: 'benchmark_unavailable',
        severity: 'warning',
        detail: `No ${name} figure for the reference month; that comparison is omitted from the letter.`,
      });
    }
  }

  // --- assumptions, stated rather than implied -----------------------------
  if (measured.length > 0) {
    flags.push({
      code: 'no_cash_flow_assumption',
      severity: 'info',
      detail:
        'Fund start values are derived as V1/(1+r), which assumes no contributions or ' +
        'redemptions during the reference month. A mid-month flow would require a ' +
        'money-weighted return, which the available inputs cannot support.',
    });
  }

  // --- selection bias, made explicit --------------------------------------
  //
  // The measured set is not a random sample: a position is measured precisely
  // BECAUSE a primary source exists for it. Here the unmeasured remainder is
  // dominated by an instrument that matured eight months ago, so it almost
  // certainly earned nothing, and the measured return is therefore an UPPER
  // BOUND on what the whole portfolio did.
  //
  // Rather than pick one number, the engine states a range under scenarios the
  // reader can check. Each scenario names its assumption; none of them is
  // presented as the answer.
  const unmeasuredValueTotal = unmeasured.reduce((s, u) => s + u.market_value, 0);
  const scenario = (key, labelPt, assumedReturn) => {
    const v0 = unmeasuredValueTotal / (1 + assumedReturn);
    return {
      assumption: key,
      label_pt: labelPt,
      unmeasured_return: round(assumedReturn, 8),
      invested_return: round((v1Total + unmeasuredValueTotal) / (v0Total + v0) - 1, 8),
    };
  };

  const cdiMonthly = b.cdi?.value ?? null;
  const scenarios = [
    scenario('unmeasured_earned_nothing', 'A parcela não medida não rendeu nada', 0),
    cdiMonthly === null ? null : scenario('unmeasured_earned_cdi', 'A parcela não medida rendeu o CDI', cdiMonthly),
    scenario('unmeasured_matched_measured', 'A parcela não medida rendeu como a medida', portfolioReturn),
  ].filter(Boolean);

  const investedReturns = scenarios.map((s) => s.invested_return);

  // Return on total net worth, which is what the client actually experienced.
  // Idle cash is carried at a flat value: it earns nothing by definition, and
  // that is the point - the gap between this and the measured return IS the
  // cost of the idle balance, quantified.
  const cash = portfolio.totals.available_cash ?? 0;
  const netWorthV0 = v0Total + unmeasuredValueTotal + cash;
  const netWorthV1 = v1Total + unmeasuredValueTotal + cash;
  const netWorthReturn = netWorthV0 > 0 ? netWorthV1 / netWorthV0 - 1 : null;

  const sensitivity = {
    note:
      'The measured return covers only the positions with a primary source. That set is ' +
      'selected by data availability, not at random, so the figure is reported with its ' +
      'coverage and with an explicit range rather than as a portfolio-wide number.',
    unmeasured_value: round(unmeasuredValueTotal, 2),
    scenarios,
    invested_return_range: {
      low: round(Math.min(...investedReturns), 8),
      high: round(Math.max(...investedReturns), 8),
    },
    net_worth: {
      return: netWorthReturn === null ? null : round(netWorthReturn, 8),
      idle_cash: round(cash, 2),
      drag_vs_measured_pp:
        netWorthReturn === null ? null : round((portfolioReturn - netWorthReturn) * 100, 4),
      basis:
        'Idle cash and unmeasured positions carried flat. The gap against the measured ' +
        'return is the drag from balances that are not working.',
    },
  };

  const ranked = [...measured].sort((a, b2) => b2.contribution_pp - a.contribution_pp);

  return {
    reference: {
      month: referenceDate.slice(0, 7),
      period: market?.period ?? null,
      statement_date: portfolio.statement_date,
    },
    portfolio_return: round(portfolioReturn, 8),
    pnl: round(pnl, 2),
    v0_total: round(v0Total, 2),
    v1_total: round(v1Total, 2),
    coverage,
    sensitivity,
    by_holding: measured,
    by_sleeve: bySleeve,
    unmeasured,
    attribution: buildAttribution(ranked, contributionSum),
    versus,
    data_quality_flags: flags,
  };
}

/**
 * Split contributors from detractors BY SIGN, never by rank position.
 *
 * Taking the bottom three of a ranked list is the obvious implementation and it
 * is wrong whenever fewer than three positions actually lost money. In April
 * 2025 only MRFG3 was negative, so "the three worst" handed the narration layer
 * ARZZ3 at +0.0022 pp and Ibiuna at +0.1497 pp inside a field named
 * `top_detractors` - and a model given a field with that name will faithfully
 * write "principais detratores" about two positions that made money.
 *
 * That is the v1 failure class reappearing on the deterministic side of the
 * line: not a hallucination by the model, but a false fact handed to it. The
 * counts travel with the lists so the narration can say "apenas uma posicao
 * fechou o mes no negativo" instead of padding a list to three.
 */
function buildAttribution(ranked, contributionSum) {
  const contributors = ranked.filter((m) => m.contribution_pp > 0);
  const detractors = ranked.filter((m) => m.contribution_pp < 0);
  const flat = ranked.filter((m) => m.contribution_pp === 0);
  const brief = (m) => ({ label: m.label, contribution_pp: m.contribution_pp, return: m.return });

  return {
    contributor_count: contributors.length,
    detractor_count: detractors.length,
    flat_count: flat.length,
    top_contributors: contributors.slice(0, 3).map(brief),
    // Reversed so the worst detractor comes first.
    top_detractors: detractors.slice().reverse().slice(0, 3).map(brief),
    sum_check_pp: round(contributionSum, 4),
  };
}
