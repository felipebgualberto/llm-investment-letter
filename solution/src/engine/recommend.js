/**
 * Recommendation engine.
 *
 * Turns suitability findings plus a screened candidate universe into concrete,
 * sized proposals. Every proposal carries the evidence that produced it, so the
 * language model downstream can only rephrase it - never originate it.
 *
 * THE CHAIN THAT MAKES A RECOMMENDATION DEFENSIBLE
 * ------------------------------------------------
 * The challenge asks for advice aligned with (A) the client's risk profile and
 * (B) the research house's view. Both links are made explicit and traceable:
 *
 *   (A) profile   "ações de empresas consolidadas que historicamente pagam
 *                  dividendos anuais" -> a screen over measured dividend
 *                  history, not a judgement call.
 *
 *   (B) house     XP projects a 15.50% terminal Selic against a Focus median
 *                 of 15.00% - the 89th percentile of 140 institutions. A house
 *                 that expects rates higher for longer than the market is a
 *                 house whose idle-cash advice should favour post-fixed income.
 *                 The tilt is DERIVED from the parsed projection table and the
 *                 API consensus, not asserted.
 *
 * THE CANDIDATE UNIVERSE IS CLOSED
 * --------------------------------
 * Buy candidates come only from the tickers XP priced in its own file. The
 * engine cannot propose a name nobody at XP put in front of it, which removes
 * the most dangerous failure mode of an LLM advisor: a confident, well-argued
 * recommendation to buy something the firm never covered.
 */

import { round } from '../lib/numbers.js';

/**
 * Read the house's rate stance out of the parsed macro table and the Focus
 * consensus. Returns null when either side is missing, so the caller omits the
 * tilt rather than inventing one.
 */
export function deriveRateStance(market) {
  const selic = (market?.house_view_vs_consensus ?? []).find((c) => c.indicator === 'Selic');
  if (!selic) return null;

  const hawkish = selic.gap_vs_median > 0;
  return {
    indicator: 'Selic',
    house_value: selic.house_value,
    consensus_median: selic.consensus_median,
    consensus_range: [selic.consensus_min, selic.consensus_max],
    percentile_in_range: selic.percentile_in_range,
    respondents: selic.respondents,
    survey_date: selic.survey_date,
    stance: hawkish ? 'above_consensus' : selic.gap_vs_median < 0 ? 'below_consensus' : 'at_consensus',
    tilt: hawkish ? 'favour_post_fixed_income' : 'neutral',
    // Every number in this sentence is formatted, not interpolated raw. It reads
    // "15.5%" straight out of JSON, which is correct in a data file and wrong on
    // a Brazilian page - and this string is quoted verbatim in the letter's
    // rationale inputs, the annex and the advisor console.
    rationale: hawkish
      ? `A casa projeta Selic de ${dec(selic.house_value)}% contra mediana de ${dec(selic.consensus_median)}% ` +
        `entre ${selic.respondents} instituições (percentil ${dec(selic.percentile_in_range, 1)} da faixa). ` +
        'Expectativa de juro alto por mais tempo favorece pós-fixado e indexados à inflação.'
      : 'A projeção da casa está em linha ou abaixo do consenso; sem viés explícito para caixa.',
  };
}

/**
 * Above this gap, the price file XP supplied and the market close for the same
 * date are not describing the same instrument on the same terms, and the
 * divergence is reported with the candidate.
 */
const PRICE_RECONCILIATION_TOLERANCE = 0.05;

/**
 * Screen the candidate universe against the profile's product rules using
 * measured fundamentals.
 *
 * A NOTE ON WHICH PRICE THE YIELD USES
 * ------------------------------------
 * Trailing dividend yield is dividends-per-share divided by price, and the two
 * must come from the same source. Dividing market dividends by the price file's
 * figure would repeat exactly the mistake corrected in the returns engine:
 * pairing numerators and denominators from different books. The yield is
 * therefore computed entirely from market data.
 *
 * The price file is not ignored, though - it is reconciled. For this dataset
 * the two disagree by up to 19% (PETR4: R$37.12 in the file against a R$29.99
 * market close for the same date), which is itself a finding worth surfacing
 * rather than smoothing over.
 */
export function screenCandidates(universe, fundamentals, rules) {
  const screen = rules.equity_screen;
  const byTicker = new Map(fundamentals.map((f) => [f.ticker, f]));

  return universe.map((row) => {
    const f = byTicker.get(row.ticker);

    if (!f || f.status !== 'ok') {
      return {
        ticker: row.ticker,
        status: 'not_screened',
        reason: f?.detail ?? `No fundamentals available (${f?.status ?? 'missing'}).`,
      };
    }

    const reasons = [];
    if (f.dividend_events < screen.min_dividend_events) {
      reasons.push(
        `${f.dividend_events} pagamento(s) de dividendo em ${screen.lookback_months} meses, ` +
        `mínimo ${screen.min_dividend_events}`,
      );
    }
    if ((f.trailing_dividend_yield ?? 0) < screen.min_trailing_dividend_yield) {
      reasons.push(
        `dividend yield de ${pct(f.trailing_dividend_yield)} nos últimos ${screen.lookback_months} meses, ` +
        `mínimo ${pct(screen.min_trailing_dividend_yield)}`,
      );
    }

    // Reconcile the two price sources rather than silently preferring one.
    const gap = f.last_close > 0 ? row.current_price / f.last_close - 1 : null;
    const priceReconciliation = {
      xp_price_file: row.current_price,
      market_close: f.last_close,
      market_close_date: f.last_close_date,
      gap: gap === null ? null : round(gap, 6),
      status:
        gap === null ? 'unavailable'
          : Math.abs(gap) <= PRICE_RECONCILIATION_TOLERANCE ? 'consistent'
          : 'divergent',
      note:
        'Dividend yield is computed from market data on both sides. The price file is ' +
        'reconciled against it, not blended with it.',
    };

    return {
      ticker: row.ticker,
      name: f.name,
      status: reasons.length === 0 ? 'eligible' : 'rejected',
      rejection_reasons: reasons,
      measured: {
        trailing_dividend_yield: f.trailing_dividend_yield,
        dividend_events: f.dividend_events,
        dividends_paid_per_share: f.dividends_paid_per_share,
        annualised_volatility: f.annualised_volatility,
        max_drawdown: f.max_drawdown,
        last_close: f.last_close,
        monthly_return: row.monthly_return,
        window: f.window,
      },
      price_reconciliation: priceReconciliation,
      source: f.source,
    };
  });
}

/**
 * Apply the SAME profile screen to the equities the client already owns.
 *
 * The screen existed only for the buy universe, which is an asymmetry a
 * reviewer finds immediately: the letter cites "ações de empresas consolidadas
 * que historicamente pagam dividendos anuais" to justify proposing PETR4, and
 * never asks the question of the four positions already in the account. Two of
 * them fail it.
 *
 * This also gives the HAPV3 review a footing that does not depend on entry
 * price, on the month's move, or on the disputed price file - it rests on the
 * client's own signed profile and on measured dividend history.
 *
 * Output is REVIEW FLAGS, never sell instructions. A holding acquired before a
 * company stopped paying dividends is not a mis-sale, and the letter must not
 * imply that it is.
 *
 * @param {Array<{ticker: string, market_value: number, weight: number}>} held
 * @param {object[]} fundamentals  measured fundamentals, keyed by resolved symbol
 * @param {object} rules           profile rules from the policy config
 * @param {Map<string,object>} [successors]  ticker -> validation row
 */
export function screenHeldEquities(held, fundamentals, rules, successors = new Map()) {
  const screen = rules.equity_screen;
  const byTicker = new Map(fundamentals.map((f) => [f.ticker, f]));

  return held.map((position) => {
    const succession = successors.get(position.ticker);
    const resolved = succession?.status === 'superseded' ? succession.successor : position.ticker;
    const f = byTicker.get(resolved);

    if (!f || f.status !== 'ok') {
      return {
        ticker: position.ticker,
        resolved_symbol: resolved,
        status: 'not_screened',
        reason: f?.detail ?? `No fundamentals available for ${resolved}.`,
        market_value: position.market_value,
        weight: position.weight,
      };
    }

    const reasons = [];
    if (f.dividend_events < screen.min_dividend_events) {
      reasons.push(
        `${f.dividend_events} pagamento(s) de dividendo nos últimos ${screen.lookback_months} meses, ` +
        `contra o mínimo de ${screen.min_dividend_events} adotado para o perfil`,
      );
    }
    if ((f.trailing_dividend_yield ?? 0) < screen.min_trailing_dividend_yield) {
      reasons.push(
        `dividend yield de ${pct(f.trailing_dividend_yield)}, contra o mínimo de ` +
        `${pct(screen.min_trailing_dividend_yield)}`,
      );
    }

    return {
      ticker: position.ticker,
      resolved_symbol: resolved,
      via_successor: resolved !== position.ticker ? resolved : null,
      name: f.name,
      status: reasons.length === 0 ? 'meets_profile_screen' : 'fails_profile_screen',
      reasons,
      market_value: position.market_value,
      weight: position.weight,
      measured: {
        trailing_dividend_yield: f.trailing_dividend_yield,
        dividend_events: f.dividend_events,
        annualised_volatility: f.annualised_volatility,
      },
      profile_basis: {
        quote: 'Ações de Empresas Consolidadas com Dividendos',
        source: 'Client risk profile, Produtos Financeiros Compatíveis, item a',
      },
      source: f.source,
    };
  });
}

/**
 * Rank eligible candidates. Yield per unit of volatility, so a high payer that
 * swings violently does not automatically outrank a steadier one - which is
 * what "moderado" means in one number.
 */
function rankEligible(screened) {
  return screened
    .filter((c) => c.status === 'eligible')
    .map((c) => ({
      ...c,
      score: c.measured.annualised_volatility
        ? round(c.measured.trailing_dividend_yield / c.measured.annualised_volatility, 6)
        : 0,
    }))
    .sort((a, b) => b.score - a.score);
}

/**
 * @param {object} params
 * @param {object} params.portfolio
 * @param {object} params.suitability  assessSuitability output
 * @param {object[]} params.universe   candidateUniverse output (price rows)
 * @param {object[]} params.fundamentals
 * @param {object} params.market
 * @param {object} params.policy
 * @param {string} params.profileSlug
 */
export function buildRecommendations({
  portfolio, suitability, universe, fundamentals, market, policy, profileSlug,
}) {
  const rules = policy.profiles[profileSlug];
  const limits = policy.recommendation_limits;
  const stance = deriveRateStance(market);
  const recommendations = [];

  const finding = (code) => suitability.findings.find((f) => f.code === code);

  /**
   * Records that a recommendation exists BECAUSE of a finding.
   *
   * Without this link a downstream reader sees two separate items worth
   * R$ 40.478,75 - "titulo vencido ainda consta na posicao" and "confirmar a
   * liquidacao do titulo" - and cannot tell that they are one problem and its
   * fix. The advisor console listed that money twice until this field existed.
   *
   * A buy candidate addresses no finding and correctly carries null: it is an
   * opportunity, not a repair, and nothing in the portfolio is wrong without it.
   */
  const addresses = (f) => (f ? { code: f.code, position: f.position?.label ?? null } : null);

  // -------------------------------------------------------------------------
  // 1. Put the idle cash to work
  // -------------------------------------------------------------------------
  const idle = finding('idle_cash_above_policy');
  const matured = suitability.findings.filter((f) => f.code === 'matured_instrument_in_position');

  if (idle) {
    const maturedValue = matured.reduce((s, f) => s + (f.position?.value_brl ?? 0), 0);
    const deployable = round(idle.quantified.excess_cash_brl, 2);

    recommendations.push({
      id: 'deploy-idle-cash',
      addresses_finding: addresses(idle),
      action: 'evaluate_allocation',
      priority: 1,
      instrument_class: stance?.tilt === 'favour_post_fixed_income' ? 'renda_fixa_pos_fixada' : 'renda_fixa',
      headline: 'Proposta: alocar o saldo parado em renda fixa pós-fixada',
      amount_brl: deployable,
      evidence: {
        idle_cash_brl: idle.position.value_brl,
        share_of_net_worth: idle.measured.share_of_net_worth,
        policy_limit: idle.threshold.share_of_net_worth,
        forgone_yield_12m_brl: idle.quantified.forgone_yield_12m_brl,
        cdi_annualised: idle.quantified.cdi_annualised,
        matured_and_pending_brl: maturedValue > 0 ? round(maturedValue, 2) : null,
        combined_idle_brl: round(idle.position.value_brl + maturedValue, 2),
      },
      profile_basis: {
        quote: 'Instrumentos de Renda Fixa com Classificação BB+ ou Superior',
        source: 'Client risk profile, Produtos Financeiros Compatíveis, item b',
      },
      house_basis: stance,
      rationale_inputs: [
        `Saldo disponível de ${brl(idle.position.value_brl)} representa ${pct(idle.measured.share_of_net_worth)} do patrimônio.`,
        // Quote the cost of the ACTION being proposed, not the cost of the whole
        // idle balance: the recommendation deploys the excess above the policy
        // reserve, and pairing it with the larger figure overstates the payoff.
        idle.quantified.forgone_yield_12m_on_excess_brl !== null
          ? `A ${pct(idle.quantified.cdi_annualised)} ao ano, aplicar ${brl(deployable)} recupera ` +
            `${brl(idle.quantified.forgone_yield_12m_on_excess_brl)} em 12 meses.`
          : null,
        maturedValue > 0
          ? `Etapa seguinte, condicionada à liquidação do CDB vencido: mais ${brl(maturedValue)}, ` +
            `totalizando ${brl(deployable + maturedValue)} a realocar.`
          : null,
        stance?.rationale ?? null,
      ].filter(Boolean),
      requires_advisor_confirmation: true,
    });
  }

  // -------------------------------------------------------------------------
  // 2. Settle the matured instrument
  // -------------------------------------------------------------------------
  for (const f of matured) {
    recommendations.push({
      id: `settle-${slug(f.position.label)}`,
      addresses_finding: addresses(f),
      action: 'confirm_settlement',
      priority: 1,
      headline: 'Pendência: confirmar liquidação de título vencido',
      amount_brl: f.position.value_brl,
      evidence: {
        maturity_date: f.measured.maturity_date,
        statement_date: f.measured.statement_date,
        days_since_maturity: f.measured.days_since_maturity,
        contracted_rate: f.measured.contracted_rate,
        weight: f.position.weight,
      },
      rationale_inputs: [
        // Brazilian date format: this string is client-facing, and an ISO date
        // in a letter reads as a leak from a database. The raw value stays in
        // `evidence.maturity_date` for the advisor annex.
        `${f.position.label} venceu em ${brDate(f.measured.maturity_date)}, ${f.measured.days_since_maturity} dias antes da data do extrato.`,
        'Enquanto a liquidação não for confirmada, este valor não pode ser tratado como remunerado.',
      ],
      requires_advisor_confirmation: true,
    });
  }

  // -------------------------------------------------------------------------
  // 3. Buy candidates from the closed universe
  // -------------------------------------------------------------------------
  const screened = screenCandidates(universe, fundamentals, rules);
  const ranked = rankEligible(screened);
  const shown = ranked.slice(0, limits.max_buy_candidates);

  for (const [i, candidate] of shown.entries()) {
    recommendations.push({
      id: `buy-${candidate.ticker.toLowerCase()}`,
      addresses_finding: null,
      action: 'evaluate_purchase',
      priority: 2 + i,
      instrument_class: 'acoes',
      ticker: candidate.ticker,
      headline: `Candidato para análise: ${candidate.ticker}`,
      evidence: candidate.measured,
      profile_basis: {
        quote: 'Ações de Empresas Consolidadas com Dividendos',
        source: 'Client risk profile, Produtos Financeiros Compatíveis, item a',
        screen: {
          min_trailing_dividend_yield: rules.equity_screen.min_trailing_dividend_yield,
          min_dividend_events: rules.equity_screen.min_dividend_events,
          assumption: rules.equity_screen.assumption,
        },
      },
      price_reconciliation: candidate.price_reconciliation,
      rationale_inputs: [
        `Pagou ${candidate.measured.dividend_events} dividendos nos últimos ${candidate.measured.window.months} meses, ` +
        `dividend yield de ${pct(candidate.measured.trailing_dividend_yield)} sobre o preço de mercado.`,
        `Volatilidade anualizada de ${pct(candidate.measured.annualised_volatility)}.`,
        'Candidato extraído da lista de ativos precificados pela própria XP.',
        candidate.price_reconciliation?.status === 'divergent'
          ? `Atenção: o arquivo de preços da XP marca ${brl(candidate.price_reconciliation.xp_price_file)} ` +
            `contra fechamento de mercado de ${brl(candidate.price_reconciliation.market_close)} em ` +
            `${candidate.price_reconciliation.market_close_date} (${pct(candidate.price_reconciliation.gap, 1)}). ` +
            'Confirmar a fonte de preço antes de dimensionar a ordem.'
          : null,
      ].filter(Boolean),
      source: candidate.source,
      requires_advisor_confirmation: true,
    });
  }

  // -------------------------------------------------------------------------
  // 4. Positions to review for reduction
  // -------------------------------------------------------------------------
  for (const f of suitability.findings.filter((x) => x.code === 'position_deeply_below_cost')) {
    const monthly = f.measured.return_reference_month;
    recommendations.push({
      id: `review-${slug(f.position.label)}`,
      addresses_finding: addresses(f),
      action: 'review_for_reduction',
      priority: 5,
      ticker: f.position.label,
      headline: `Revisão sugerida: posição em ${f.position.label}`,
      amount_brl: f.position.value_brl,
      evidence: {
        return_since_purchase: f.measured.return_since_purchase,
        return_reference_month: monthly,
        average_price: f.measured.average_price,
        last_price: f.measured.last_price,
        weight: f.position.weight,
      },
      rationale_inputs: [
        `Acumula ${pct(f.measured.return_since_purchase)} desde a compra em ${f.measured.investment_date ?? 'data não informada'}.`,
        // The month's move is stated as a fact and NOTHING is inferred from it.
        //
        // An earlier version added "o que abre uma janela para redução com menor
        // perda realizada". That is single-month market timing, and the client's
        // own signed profile says the opposite in as many words: "resistir à
        // tentação de realizar movimentos bruscos baseados em oscilações de
        // curto prazo". Advice that contradicts the document it claims to follow
        // is worse than no advice.
        monthly !== null
          ? `No mês de referência a posição variou ${pct(monthly)}, o que não altera o resultado acumulado.`
          : null,
        'A revisão se apoia no perfil, que privilegia empresas consolidadas pagadoras de dividendos, e não no movimento do mês.',
      ].filter(Boolean),
      requires_advisor_confirmation: true,
    });
  }

  recommendations.sort((a, b) => a.priority - b.priority);

  return {
    generated_for: portfolio.client?.name ?? null,
    profile: suitability.profile,
    house_stance: stance,
    recommendations,
    universe_report: {
      considered: universe.length,
      screened: screened.length,
      eligible: ranked.length,
      shown: shown.length,
      truncated_by_policy: Math.max(0, ranked.length - shown.length),
      rejected: screened
        .filter((c) => c.status === 'rejected')
        .map((c) => ({ ticker: c.ticker, reasons: c.rejection_reasons })),
      not_screened: screened
        .filter((c) => c.status === 'not_screened')
        .map((c) => ({ ticker: c.ticker, reason: c.reason })),
      price_divergences: screened
        .filter((c) => c.price_reconciliation?.status === 'divergent')
        .map((c) => ({
          ticker: c.ticker,
          xp_price_file: c.price_reconciliation.xp_price_file,
          market_close: c.price_reconciliation.market_close,
          gap: c.price_reconciliation.gap,
        })),
    },
    all_require_advisor_confirmation: true,
    // Emitted as data, not left to a prompt to remember. The renderer must
    // print every one of these or fail; a disclosure that lives only as a
    // root-level boolean is a disclosure the reader never sees.
    disclosures: policy.disclosures?.required ?? [],
  };
}

// --- small helpers used only for building human-readable rationale strings ---

/**
 * Percentages for CLIENT-FACING text, in Brazilian notation.
 *
 * These strings go straight into the letter, so the decimal mark has to be a
 * comma. Mixing "19.30%" into a paragraph that also says "R$ 74.672,62" reads
 * as a bug to the one person whose opinion matters, and it is the kind of
 * detail that makes an otherwise careful document look machine-made.
 */
function pct(value, digits = 2) {
  if (value === null || value === undefined) return 'n/d';
  return `${(value * 100).toFixed(digits).replace('.', ',')}%`;
}

/**
 * A plain number already expressed in percent, with a comma decimal mark.
 *
 * Trailing zeros are kept. Stripping them produced "Selic de 15,50% contra
 * mediana de 15%" in the same sentence, and two figures being compared should
 * be written to the same precision or the comparison looks sloppier than it is.
 */
function dec(value, digits = 2) {
  if (!Number.isFinite(value)) return 'n/d';
  return Number(value).toFixed(digits).replace('.', ',');
}

function brl(value) {
  return value === null || value === undefined
    ? 'n/d'
    : `R$ ${value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** "2024-09-05" -> "05/09/2024". Nobody writes an ISO date to a client. */
function brDate(iso) {
  const m = String(iso ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : (iso ?? 'data não informada');
}

function slug(value) {
  return String(value)
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

