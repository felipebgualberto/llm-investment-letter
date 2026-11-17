/**
 * Letter planner: decides WHAT goes in the two-page letter, before any language
 * model sees the payload.
 *
 * WHY THIS MODULE IS THE THESIS, NOT A FORMATTING DETAIL
 * ------------------------------------------------------
 * The engine produces far more than two pages hold: nine suitability findings,
 * six recommendations, ten attribution lines, four benchmarks and a set of
 * mandatory disclosures. Something has to be cut.
 *
 * The tempting shortcut is to hand the model everything and write "keep it to
 * two pages" in the prompt. That hands the model the single most consequential
 * editorial decision in the product - which of the client's findings he never
 * hears about - and it does so invisibly, differently on every run, with no way
 * to test it. It is the same mistake as asking a model to compute a return,
 * wearing different clothes.
 *
 * So selection is a rule, the rule lives in config, and what was dropped is
 * counted and disclosed rather than silently omitted. The narration node
 * receives a payload that already fits, and its only job is language.
 *
 * The annex is not a dumping ground: it is addressed to the ADVISOR. Operational
 * items - update a ticker after a corporate action, confirm a fund's identity -
 * are work for the person managing the account, not news for the client. That
 * split is also what lets one advisor cover three times as many clients, which
 * is the stated goal of the whole product.
 */

import { round } from '../lib/numbers.js';

/**
 * Every figure travels with the string the letter should print.
 *
 * THE BUG THAT MADE THIS NECESSARY
 * --------------------------------
 * The first real run produced: "o CDI teve uma rentabilidade que resultou em um
 * excesso em relação ao portfólio". Word salad, and the model was right to
 * write it. The payload gave it `cdi.value = 0.0105588`, and every prompt says
 * "do not perform arithmetic of any kind". Turning 0.0105588 into "1,06%" IS
 * arithmetic. Forbidden from converting and unwilling to invent, the model did
 * the only honest thing left: it talked around the number.
 *
 * The same run produced "cobrindo 100% do portfólio" - a figure that is simply
 * false, coverage being 86,94% - because the payload carried no coverage field
 * at all and the model filled the hole.
 *
 * So the engine formats and the model places. A `display` string in Brazilian
 * notation next to every value removes both failure modes at once: nothing is
 * left to convert, and nothing is left to guess.
 */
const fmt = {
  // One minus sign across the whole letter. Mixing a hyphen in "-16,38%" with a
  // typographic minus in "−1,14 p.p." is the kind of inconsistency a reader
  // notices without being able to name.
  pct: (v, d = 2) =>
    Number.isFinite(v)
      ? `${v < 0 ? '−' : ''}${Math.abs(v * 100).toFixed(d).replace('.', ',')}%`
      : null,
  pp: (v, d = 2) =>
    Number.isFinite(v) ? `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(d).replace('.', ',')} p.p.` : null,
  brl: (v) =>
    Number.isFinite(v)
      ? `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : null,
};

/** Pair a raw value with the string the letter must print for it. */
const shown = (value, display) => (value === null || value === undefined ? null : { value, display });

/** "2024-09-05" -> "05/09/2024". Nobody writes an ISO date to a client. */
const brDate = (iso) => {
  const m = String(iso ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : null;
};

/**
 * One small, flat, display-only payload per prompt.
 *
 * THE BUG THAT MADE THIS NECESSARY
 * --------------------------------
 * The second real run produced a letter with no figures at all: "a rentabilidade
 * medida foi positiva, cobrindo a maior parte do portfólio". Three causes, all
 * in the payload rather than the prompt:
 *
 *   1. The prompt told the model to read `headline.measured_return.display`
 *      while the real path was `letter.headline.measured_return.display`. It
 *      looked, did not find, and - correctly, per its instructions - said less
 *      rather than guess.
 *   2. It was handed 21 KB containing the advisor annex, reconciliation checks
 *      and the full attribution table, to write one 110-word paragraph.
 *   3. The disclosures were in the payload, so it reproduced them even though
 *      the prompt said not to. A model restates what it can see.
 *
 * So each prompt now gets its own object, flat, with the exact keys its
 * instructions name, and carrying ONLY display strings - no raw values, no
 * thresholds, no `source: "house policy"` to leak into client-facing prose.
 * The full plan still exists for auditing and feeds the validator.
 */
function buildPromptPayloads({ headline, attribution, benchmarks, letterRecs, omissions, portfolio, metrics, market, houseStance }) {
  const brief = (h) => (h ? { ativo: h.label, contribuicao: h.display, retorno_no_mes: h.return_display } : null);

  const performance = {
    periodo: metrics.reference?.period?.label_pt ?? null,
    rentabilidade_medida: headline.measured_return?.display ?? null,
    resultado_em_reais: headline.pnl?.display ?? null,
    cobertura_da_carteira: headline.coverage_of_invested?.display ?? null,
    rentabilidade_do_patrimonio: headline.net_worth_return?.display ?? null,
    custo_do_saldo_parado: headline.idle_cash_drag_pp?.display ?? null,
    o_que_e_custo_do_saldo_parado:
      'A diferenca entre o retorno da parcela investida e o retorno do patrimonio inteiro. ' +
      'E quanto custa manter parte do dinheiro sem aplicacao.',
    maior_contribuicao: brief(attribution.contributors[0]),
    maior_detracao: brief(attribution.detractors[0]),
    quantas_posicoes_subiram: attribution.contributor_count,
    quantas_posicoes_cairam: attribution.detractor_count,
    comparacoes: Object.values(benchmarks).map((b) => ({
      referencia: b.label_pt,
      variacao_no_mes: b.display,
      diferenca_para_a_carteira: b.excess_display,
      ganho_acima_da_inflacao: b.real_return_display ?? undefined,
    })),
  };

  const recommendations = {
    propostas: letterRecs.map((r) => ({
      titulo: r.headline,
      valor: r.amount_brl
        ? `R$ ${r.amount_brl.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        : null,
      // Only client-facing reasoning. Thresholds, policy sources and assumption
      // flags stay in suitability.json where the advisor can audit them.
      motivos: r.rationale_inputs ?? [],
      vencimento: brDate(r.evidence?.maturity_date) ?? undefined,
    })),
    outras_preparadas: omissions.find((o) => o.kind === 'recommendations_deferred')?.count ?? 0,
  };

  const selic = (market?.house_view_vs_consensus ?? []).find((c) => c.indicator === 'Selic');
  const ipca = (market?.house_view_vs_consensus ?? []).find((c) => c.indicator === 'IPCA');
  const asPct = (v) => (Number.isFinite(v) ? `${v.toFixed(2).replace('.', ',')}%` : null);

  // The IMPLICATION, not just the indicators.
  //
  // A run that shipped only the raw figures produced: "taxas mais altas podem
  // impactar negativamente a valorização de ativos de renda fixa" - two
  // paragraphs before proposing to buy post-fixed fixed income. Both cannot be
  // true. High rates hurt PRE-fixed and long duration; they are exactly what
  // makes POST-fixed attractive, which is why the proposal exists.
  //
  // The engine already derives that conclusion (house_stance.tilt) from the
  // parsed projection table and the Focus consensus. Leaving the model to
  // re-derive it was the same mistake as leaving it to compute a return: it
  // reasoned, and it reasoned backwards.
  const TILT_PT = {
    favour_post_fixed_income:
      'O ambiente de juros altos por mais tempo favorece a renda fixa PÓS-FIXADA e os ' +
      'títulos indexados à inflação, que acompanham a taxa. Não diga que juros altos ' +
      'prejudicam a renda fixa: isso vale para prefixados e prazos longos, não para o ' +
      'que está sendo proposto.',
    neutral:
      'A projeção da casa está em linha com o consenso; não há viés explícito para a ' +
      'alocação de caixa.',
  };

  const macro = {
    ano_de_referencia: selic?.reference_year ?? null,
    data_da_pesquisa: brDate(selic?.survey_date) ?? null,
    instituicoes_consultadas: selic?.respondents ?? null,
    o_que_isso_significa: TILT_PT[houseStance?.tilt] ?? TILT_PT.neutral,
    indicadores: [selic, ipca].filter(Boolean).map((c) => ({
      indicador: c.indicator === 'Selic' ? 'Selic' : 'IPCA',
      projecao_da_xp: asPct(c.house_value),
      mediana_do_mercado: asPct(c.consensus_median),
      menor_projecao: asPct(c.consensus_min),
      maior_projecao: asPct(c.consensus_max),
      posicao_da_xp_na_faixa: Number.isFinite(c.percentile_in_range)
        ? `percentil ${String(c.percentile_in_range).replace('.', ',')}`
        : null,
      xp_esta: c.stance === 'above_consensus' ? 'acima do consenso' : c.stance === 'below_consensus' ? 'abaixo do consenso' : 'em linha com o consenso',
    })),
  };

  const composer = {
    cliente: portfolio?.client?.name ?? null,
    assessor: portfolio?.advisor?.name ?? null,
    codigo_do_assessor: portfolio?.advisor?.code ?? null,
    periodo: metrics.reference?.period?.label_pt ?? null,
    // Omission notices are deliberately ABSENT, for the same reason the
    // compliance block is. They were here, and the run paraphrased one of them
    // and dropped the other entirely - so the client was never told that five
    // further findings existed. A disclosure that survives only if the model
    // remembers it is not a disclosure. src/render/letter.js prints them.
    aviso:
      'As informações de conformidade e os avisos sobre o que não coube nesta carta ' +
      'são impressos separadamente. Não os reproduza nem os mencione.',
  };

  return { macro, performance, recommendations, composer };
}

/**
 * @param {object} params
 * @param {object} params.metrics       computePerformance output
 * @param {object} params.suitability   assessSuitability output
 * @param {object} params.recommendations buildRecommendations output
 * @param {object} params.policy        config/suitability-policy.json
 */
export function planLetter({ metrics, suitability, recommendations, policy, portfolio, market }) {
  const budget = policy.letter_budget;
  const omissions = [];

  // --- findings ------------------------------------------------------------
  const bySeverity = (list) => (severity) => list.filter((f) => f.severity === severity);
  const findingsBy = bySeverity(suitability.findings);

  const letterFindings = budget.findings.in_letter.flatMap(findingsBy);
  const summarised = budget.findings.summarised_with_count.flatMap(findingsBy);
  const annexFindings = budget.findings.advisor_annex_only.flatMap(findingsBy);

  if (summarised.length > 0) {
    omissions.push({
      kind: 'findings_summarised',
      count: summarised.length,
      severity: budget.findings.summarised_with_count.join(', '),
      disclosure_pt:
        `Outros ${summarised.length} pontos de atenção de menor urgência foram identificados ` +
        'e serão tratados por seu assessor.',
    });
  }
  if (annexFindings.length > 0) {
    omissions.push({
      kind: 'findings_to_annex',
      count: annexFindings.length,
      severity: budget.findings.advisor_annex_only.join(', '),
      disclosure_pt: null, // operational; the client does not need to be told
    });
  }

  // --- attribution ---------------------------------------------------------
  const attributionBudget = budget.attribution;
  const contributors = metrics.attribution.top_contributors.slice(0, attributionBudget.max_contributors);
  const detractors = metrics.attribution.top_detractors.slice(0, attributionBudget.max_detractors);

  const shownLabels = new Set([...contributors, ...detractors].map((h) => h.label));
  const remainder = metrics.by_holding.filter((h) => !shownLabels.has(h.label));
  const remainderPp = round(remainder.reduce((s, h) => s + h.contribution_pp, 0), 4);

  const withDisplay = (list) =>
    list.map((h) => ({ ...h, display: fmt.pp(h.contribution_pp), return_display: fmt.pct(h.return) }));

  const attribution = {
    contributors: withDisplay(contributors),
    detractors: withDisplay(detractors),
    // A single reconciling line, so the column the client can add up still
    // reaches the headline return instead of falling short by the hidden rows.
    remainder: attributionBudget.remainder_line && remainder.length > 0
      ? {
          label_pt: attributionBudget.remainder_label_pt,
          count: remainder.length,
          contribution_pp: remainderPp,
          display: fmt.pp(remainderPp),
        }
      : null,
    total_pp: metrics.attribution.sum_check_pp,
    total_display: fmt.pp(metrics.attribution.sum_check_pp),
    detractor_count: metrics.attribution.detractor_count,
    contributor_count: metrics.attribution.contributor_count,

    // Which sleeve each measured position belongs to, and the position that
    // moved each sleeve most.
    //
    // The chart used to rank every holding together and take the top few, which
    // returned three equities every time: equities are 22% of the measured
    // portfolio and swing hardest, so magnitude alone always picks them. That
    // left the funds - 78% of the measured portfolio and +1,89 of the +2,62
    // p.p. earned - inside an anonymous "demais posições" bar. A client's
    // largest sleeve must not be the unnamed one.
    sleeve_of: Object.fromEntries(metrics.by_holding.map((h) => [h.label, h.sleeve])),
    sleeve_movers: metrics.by_holding.reduce((acc, h) => {
      (acc[h.sleeve] ??= []).push({
        label: h.label,
        contribution_pp: h.contribution_pp,
        return: h.return,
      });
      return acc;
    }, {}),
  };

  // Largest absolute mover first within each sleeve: the position that explains
  // most of what that class did, whichever direction it went.
  for (const list of Object.values(attribution.sleeve_movers)) {
    list.sort((a, b) => Math.abs(b.contribution_pp) - Math.abs(a.contribution_pp));
  }

  // The lines shown plus the remainder must still equal the headline.
  const shownPp = round(
    [...contributors, ...detractors].reduce((s, h) => s + h.contribution_pp, 0) + remainderPp,
    4,
  );
  const reconciles = Math.abs(shownPp - metrics.attribution.sum_check_pp) < 0.01;

  // --- recommendations -----------------------------------------------------
  const recBudget = budget.recommendations;
  const allRecs = recommendations.recommendations;
  const letterRecs = allRecs.slice(0, recBudget.max_in_letter);
  const deferredRecs = allRecs.slice(recBudget.max_in_letter);

  // --- equity ideas ---------------------------------------------------------
  //
  // WHY THESE ARE A SEPARATE BLOCK AND NOT MORE "PRÓXIMOS PASSOS"
  //
  // The two items in that block are things that are WRONG: cash sitting idle
  // past the policy limit, a bond that matured 244 days ago and is still on the
  // books. They have an owner and a deadline.
  //
  // A share worth considering is a different kind of object. It is an idea for
  // a conversation, it has no deadline, and nothing breaks if the client says
  // no. Numbering the two together under one heading would make "buy PETR4"
  // look as overdue as "the bond has not settled", and would train the client
  // to treat both as noise.
  //
  // WHY THE SAME SCREEN RUNS IN BOTH DIRECTIONS
  //
  // The profile's clause - "ações de empresas consolidadas que historicamente
  // pagam dividendos anuais" - is what the letter cites to justify a purchase.
  // Citing it to buy and never applying it to what the client already holds is
  // the same asymmetry the credit-rating finding calls out. So the block has
  // two halves built from ONE criterion: candidates that pass it, and held
  // positions that fail it.
  //
  // The held side is "revisar", never "vender". The engine measures a dividend
  // history; it does not have a view on whether to sell, and a letter that
  // turned a failed screen into a sell instruction would be inventing advice
  // the evidence does not support.
  // The profile slug comes from the suitability run, which is the module that
  // resolved it from the client document in the first place.
  const profileSlug = suitability.profile_slug ?? 'moderado';
  const screen = policy.profiles[profileSlug]?.equity_screen ?? {};
  const buyIdeas = allRecs
    .filter((r) => r.action === 'evaluate_purchase')
    .map((r) => ({
      ticker: r.ticker,
      dividend_yield: shown(r.evidence?.trailing_dividend_yield, fmt.pct(r.evidence?.trailing_dividend_yield, 1)),
      dividend_events: r.evidence?.dividend_events ?? null,
      volatility: shown(r.evidence?.annualised_volatility, fmt.pct(r.evidence?.annualised_volatility, 1)),
    }));

  const reviewIdeas = (recommendations.held_equity_screen ?? [])
    .filter((h) => h.status === 'fails_profile_screen')
    .sort((a, b) => b.market_value - a.market_value)
    .map((h) => {
      const rec = allRecs.find((r) => r.action === 'review_for_reduction' && r.ticker === h.ticker);
      const m = h.measured ?? {};
      return {
        ticker: h.ticker,
        value_brl: shown(h.market_value, fmt.brl(h.market_value)),
        // The screen's own words for why it failed, not a paraphrase.
        reasons_pt: h.reasons ?? [],
        // The same failure, stated in the fewest words that stay true. The
        // letter has one line per position; the annex prints `reasons_pt` in
        // full. This is BUILT from the measured values rather than trimmed from
        // the sentence above, so it cannot drift away from what was measured.
        reason_short_pt: [
          Number.isFinite(m.dividend_events)
            ? m.dividend_events === 0
              ? 'nenhum pagamento de dividendo em 12 meses'
              : `${m.dividend_events} pagamento${m.dividend_events === 1 ? '' : 's'} em 12 meses, mínimo ${screen.min_dividend_events}`
            : null,
          Number.isFinite(m.trailing_dividend_yield) && m.trailing_dividend_yield < (screen.min_trailing_dividend_yield ?? 0)
            ? `retorno em dividendos de ${fmt.pct(m.trailing_dividend_yield, 1)}`
            : null,
        ]
          .filter(Boolean)
          .join(' · '),
        return_since_purchase: rec
          ? shown(rec.evidence?.return_since_purchase, fmt.pct(rec.evidence?.return_since_purchase, 1))
          : null,
      };
    });

  const failedValue = reviewIdeas.reduce((s, r) => s + (r.value_brl?.value ?? 0), 0);
  const equityTotal = (recommendations.held_equity_screen ?? []).reduce(
    (s, h) => s + (h.market_value ?? 0),
    0,
  );

  const equityIdeas =
    buyIdeas.length + reviewIdeas.length > 0
      ? {
          buy: buyIdeas,
          review: reviewIdeas,
          screen: {
            quote: screen.profile_basis
              ? 'Ações de Empresas Consolidadas com Dividendos'
              : null,
            min_yield: shown(screen.min_trailing_dividend_yield, fmt.pct(screen.min_trailing_dividend_yield, 0)),
            min_events: screen.min_dividend_events ?? null,
            lookback_months: screen.lookback_months ?? null,
            assumption: screen.assumption !== false,
          },
          failed_share: shown(
            equityTotal > 0 ? failedValue / equityTotal : null,
            equityTotal > 0 ? fmt.pct(failedValue / equityTotal, 1) : null,
          ),
          failed_value: shown(failedValue, fmt.brl(failedValue)),
          note_pt:
            'Sugestões para avaliar com seu assessor. Nenhuma é ordem de compra ou venda.',
        }
      : null;

  if (deferredRecs.length > 0 && recBudget.disclose_total_count) {
    omissions.push({
      kind: 'recommendations_deferred',
      count: deferredRecs.length,
      disclosure_pt:
        `Outras ${deferredRecs.length} sugestões foram preparadas e estão à disposição ` +
        'para discussão com seu assessor.',
    });
  }

  // --- benchmarks ----------------------------------------------------------
  const LABELS_PT = { cdi: 'CDI', ipca: 'inflação (IPCA)', ibovespa: 'Ibovespa' };
  const pick = (keys) =>
    Object.fromEntries(
      keys
        .filter((k) => metrics.versus[k])
        .map((k) => {
          const b = metrics.versus[k];
          return [k, {
            ...b,
            label_pt: LABELS_PT[k] ?? k,
            display: fmt.pct(b.value),
            excess_display: fmt.pp(b.excess_pp),
            real_return_display: fmt.pct(b.real_return),
          }];
        }),
    );

  // --- the figures the letter opens with ------------------------------------
  //
  // These were missing from the first version of the plan, and the model filled
  // the hole: it wrote "cobrindo 100% do portfólio" when coverage is 86,94%.
  // A payload that omits a fact the letter must state is a payload that invites
  // an invention.
  const headline = {
    measured_return: shown(metrics.portfolio_return, fmt.pct(metrics.portfolio_return)),
    pnl: shown(metrics.pnl, fmt.brl(metrics.pnl)),
    coverage_of_invested: shown(
      metrics.coverage.share_of_invested,
      fmt.pct(metrics.coverage.share_of_invested),
    ),
    net_worth_return: shown(
      metrics.sensitivity?.net_worth?.return,
      fmt.pct(metrics.sensitivity?.net_worth?.return),
    ),
    idle_cash_drag_pp: shown(
      metrics.sensitivity?.net_worth?.drag_vs_measured_pp,
      fmt.pp(metrics.sensitivity?.net_worth?.drag_vs_measured_pp),
    ),
    // What the funds cost. A letter that reports what a portfolio earned and
    // never what it charged is telling a true story with a piece missing - the
    // return is a forecast that came true or did not, and the administration
    // fee is deducted either way.
    net_worth: shown(portfolio?.totals?.net_worth, fmt.brl(portfolio?.totals?.net_worth)),
    fund_cost_annual: shown(
      metrics.fund_costs?.annual_cost_brl,
      fmt.brl(metrics.fund_costs?.annual_cost_brl),
    ),
    fund_cost_pct: shown(
      metrics.fund_costs?.weighted_average_pct != null
        ? metrics.fund_costs.weighted_average_pct / 100
        : null,
      metrics.fund_costs?.weighted_average_pct != null
        ? `${metrics.fund_costs.weighted_average_pct.toFixed(2).replace('.', ',')}% a.a.`
        : null,
    ),
    cdi_month: shown(metrics.versus?.cdi?.value, fmt.pct(metrics.versus?.cdi?.value)),
    pct_of_cdi: shown(
      metrics.versus?.cdi?.pct_of_cdi,
      metrics.versus?.cdi?.pct_of_cdi != null
        ? `${Math.round(metrics.versus.cdi.pct_of_cdi)}% do CDI`
        : null,
    ),
  };

  return {
    budget: { max_words: budget.max_words },
    letter: {
      // Identity travels with the payload. The v1 wrote "Prezado João" because a
      // few-shot example leaked; the first v2 run wrote "Prezado cliente"
      // because the plan carried no name at all. Both are the same failure:
      // the model was asked for a fact it had not been given.
      client: portfolio?.client ?? null,
      advisor: portfolio?.advisor ?? null,
      period: metrics.reference?.period ?? null,
      headline,
      findings: letterFindings,
      recommendations: letterRecs,
      // Buy candidates and held positions that fail the same screen. See the
      // block above for why they are not more "próximos passos".
      equity_ideas: equityIdeas,
      attribution,
      benchmarks: pick(budget.benchmarks_in_letter),
      // Carried so the plan is complete and auditable, but the composer is told
      // NOT to reproduce them: the renderer prints compliance text verbatim, so
      // it can never be paraphrased by a model.
      disclosures: policy.disclosures.required,
      disclosures_are_rendered_separately: true,
    },
    advisor_annex: {
      findings: [...summarised, ...annexFindings],
      recommendations: deferredRecs,
      benchmarks: pick(budget.benchmarks_in_annex),
      full_attribution: metrics.by_holding.map((h) => ({
        label: h.label,
        contribution_pp: h.contribution_pp,
        return: h.return,
        pnl: h.pnl,
      })),
      // (annex continues below)
      // Two datasets the client letter has no room for and the advisor needs.
      // The cost table is the fee in force ON the reference date, per fund; the
      // benchmark table holds each fund to the indicator it declared to the
      // CVM rather than to a house default.
      fund_costs: metrics.fund_costs ?? null,
      funds_vs_declared_benchmark: metrics.funds_vs_declared_benchmark ?? null,
      data_quality_flags: metrics.data_quality_flags,
    },
    omissions,
    checks: {
      attribution_reconciles: reconciles,
      shown_plus_remainder_pp: shownPp,
      headline_pp: metrics.attribution.sum_check_pp,
    },
    // One flat, display-only object per prompt. Each is written to its own file
    // so the graph reads exactly what that prompt needs, and so "what did the
    // model actually see" is a question answered by opening a small file.
    prompt_payloads: buildPromptPayloads({
      headline,
      attribution,
      benchmarks: pick(budget.benchmarks_in_letter),
      letterRecs,
      omissions,
      portfolio,
      metrics,
      market,
      houseStance: recommendations.house_stance ?? null,
    }),
    selection_rule: 'config/suitability-policy.json -> letter_budget',
  };
}
