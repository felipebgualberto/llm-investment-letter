/**
 * Suitability engine: deterministic checks of the portfolio against the
 * client's profile and against house policy.
 *
 * WHAT THIS MODULE IS FOR
 * -----------------------
 * The v1 letter's entire advice was "recomendamos que você continue
 * diversificando sua carteira". That sentence is true of every client alive,
 * costs nothing to write, and cannot be acted on. It is what a language model
 * produces when it is asked for a recommendation without being given any facts
 * to reason from.
 *
 * This module produces FINDINGS instead: each one names a position, a number, a
 * threshold, the source of that threshold, and what an advisor should do about
 * it. The language model downstream turns findings into Portuguese prose. It
 * does not decide what the findings are.
 *
 * SEVERITY IS ABOUT THE ADVISOR'S CALENDAR, NOT ABOUT DRAMA
 * ---------------------------------------------------------
 *   action_required  something is wrong today and money is at stake
 *   review           something needs a human decision before it becomes wrong
 *   informational    worth knowing, no action implied
 *
 * NOTHING HERE IS AN ORDER
 * ------------------------
 * Every finding is addressed to the advisor, not to the client, and is phrased
 * as a candidate for review. The product's stated purpose is to let one advisor
 * serve three times as many clients - not to trade on their behalf.
 */

import { round } from '../lib/numbers.js';

/**
 * @param {object} params
 * @param {object} params.portfolio    parsePortfolio output
 * @param {object} params.riskProfile  parseRiskProfile output
 * @param {object} params.funds        measureFunds output
 * @param {object} params.market       buildMarketSnapshot output
 * @param {object} params.metrics      computePerformance output
 * @param {object} params.policy       config/suitability-policy.json
 */
export function assessSuitability({ portfolio, riskProfile, funds, market, metrics, policy }) {
  const findings = [];
  const slug = riskProfile.classification_slug ?? 'moderado';
  const rules = policy.profiles[slug];

  if (!rules) {
    return {
      profile: riskProfile.classification,
      findings: [{
        code: 'no_policy_for_profile',
        severity: 'action_required',
        title: `No policy configured for profile "${riskProfile.classification}"`,
        detail: `config/suitability-policy.json has no entry for "${slug}"; no checks were run.`,
      }],
      parameters_used: [],
    };
  }

  const parametersUsed = [];
  const useParameter = (path, value, meta) => {
    parametersUsed.push({ parameter: path, value, ...meta });
    return value;
  };

  const totals = portfolio.totals;
  const fundByName = new Map((funds?.results ?? []).map((r) => [r.statement_name, r]));

  // -------------------------------------------------------------------------
  // 1. Idle cash
  // -------------------------------------------------------------------------
  {
    const limit = useParameter('idle_cash.max_share_of_net_worth', rules.idle_cash.max_share_of_net_worth, {
      assumption: rules.idle_cash.assumption,
      rationale: rules.idle_cash.rationale,
    });
    const share = totals.available_cash / totals.net_worth;

    if (share > limit) {
      // The annualised CDI comes from the market snapshot, which prefers the
      // rate the BCB publishes directly (SGS 4389) over any derivation of ours.
      // Raising the monthly return to the twelfth power would assume a 240-day
      // year and understate the figure by roughly 0.7 percentage points.
      const cdiBlock = market?.benchmarks?.cdi ?? null;
      const cdiAnnual = cdiBlock?.annualised?.value ?? null;
      const excessCash = totals.available_cash - totals.net_worth * limit;

      findings.push({
        code: 'idle_cash_above_policy',
        severity: 'action_required',
        title: 'Saldo em conta acima do limite de política',
        position: { label: 'Saldo disponível', value_brl: round(totals.available_cash, 2) },
        measured: { share_of_net_worth: round(share, 6) },
        threshold: { share_of_net_worth: limit, source: 'house policy', assumption: true },
        quantified: {
          excess_cash_brl: round(excessCash, 2),
          cdi_annualised: cdiAnnual === null ? null : round(cdiAnnual, 6),
          cdi_annualised_source: cdiBlock?.annualised?.published
            ? `BCB SGS ${cdiBlock.annualised.published.source.series}, as of ${cdiBlock.annualised.published.as_of}`
            : `derived on a ${cdiBlock?.annualised?.basis ?? '252 business day'} basis`,
          // TWO bases, named unambiguously, because they answer different
          // questions and a single ambiguous field let the letter quote a cost
          // 2.07x larger than the action it was proposing.
          //   ...on_excess       what the RECOMMENDED action recovers
          //   ...on_full_balance the cost of holding the whole balance idle
          forgone_yield_12m_on_excess_brl:
            cdiAnnual === null ? null : round(excessCash * cdiAnnual, 2),
          forgone_yield_12m_on_full_balance_brl:
            cdiAnnual === null ? null : round(totals.available_cash * cdiAnnual, 2),
          basis: 'Idle balance at the CDI rate published for the reference date, 252-business-day basis',
        },
        action: 'Alocar o excedente em instrumento compatível com o perfil; ver recomendações.',
      });
    }
  }

  // -------------------------------------------------------------------------
  // 2. Matured instruments still carried as positions
  // -------------------------------------------------------------------------
  for (const holding of portfolio.holdings) {
    if (!holding.maturity_date || holding.maturity_date >= portfolio.statement_date) continue;
    findings.push({
      code: 'matured_instrument_in_position',
      severity: 'action_required',
      title: 'Título vencido ainda consta na posição',
      position: { label: holding.name, value_brl: round(holding.market_value, 2), weight: holding.weight },
      measured: {
        maturity_date: holding.maturity_date,
        statement_date: portfolio.statement_date,
        days_since_maturity: daysBetween(holding.maturity_date, portfolio.statement_date),
        contracted_rate: holding.rate ?? null,
      },
      threshold: { rule: 'maturity_date < statement_date', source: 'arithmetic', assumption: false },
      action:
        'Confirmar a liquidação junto ao emissor e reaplicar os recursos. Enquanto não confirmado, ' +
        'este valor não pode ser considerado remunerado.',
    });
  }

  // -------------------------------------------------------------------------
  // 3. Eligibility: products restricted to qualified investors
  // -------------------------------------------------------------------------
  {
    const threshold = useParameter(
      'eligibility.qualified_investor_threshold_brl',
      rules.eligibility.qualified_investor_threshold_brl,
      { assumption: false, source: rules.eligibility.source },
    );

    const restricted = portfolio.holdings
      .map((h) => ({ holding: h, fund: fundByName.get(h.name) }))
      .filter(({ fund }) => /qualificado|profissional/i.test(fund?.target_investor ?? ''));

    if (restricted.length > 0 && totals.net_worth < threshold) {
      const exposure = restricted.reduce((s, r) => s + r.holding.market_value, 0);
      findings.push({
        code: 'restricted_product_eligibility_review',
        severity: 'review',
        title: 'Produtos destinados a investidor qualificado na carteira',
        position: {
          label: `${restricted.length} fundos`,
          value_brl: round(exposure, 2),
          weight: round(exposure / totals.invested, 6),
        },
        measured: {
          visible_net_worth_brl: round(totals.net_worth, 2),
          holdings: restricted.map(({ holding, fund }) => ({
            name: holding.name,
            cnpj: fund.cnpj,
            weight: holding.weight,
            target_investor: fund.target_investor,
            renamed_to: fund.renamed ? fund.current_name : null,
          })),
        },
        threshold: { qualified_investor_brl: threshold, source: rules.eligibility.source, assumption: false },
        // The policy file's `note` says the same thing as the first caveat, in
        // English, for a developer reading the config. Appending it here put an
        // English sentence into a Portuguese list shown to an advisor, and said
        // it twice. The note stays where it belongs: in the config.
        caveats: [
          'O patrimônio visível na XP é apenas parte dos ativos financeiros do cliente.',
          'Posições podem ter sido adquiridas antes de o produto ser reclassificado.',
        ],
        action: 'Verificar o enquadramento do cliente como investidor qualificado antes de qualquer novo aporte nesses produtos.',
      });
    }
  }

  // -------------------------------------------------------------------------
  // 4. Concentration
  // -------------------------------------------------------------------------
  {
    const limit = useParameter(
      'concentration.max_single_position_share_of_invested',
      rules.concentration.max_single_position_share_of_invested,
      { assumption: true, rationale: rules.concentration.rationale },
    );

    for (const holding of portfolio.holdings) {
      if (holding.weight <= limit) continue;
      findings.push({
        code: 'position_above_concentration_limit',
        severity: 'review',
        title: 'Concentração acima do limite de política',
        position: {
          label: holding.ticker ?? holding.name,
          value_brl: round(holding.market_value, 2),
          weight: holding.weight,
        },
        measured: { share_of_invested: holding.weight },
        threshold: { share_of_invested: limit, source: 'house policy', assumption: true },
        action: 'Avaliar rebalanceamento gradual; o perfil pede diversificação, sem fixar limite numérico.',
      });
    }

    const sleeveLimit = useParameter(
      'concentration.max_single_sleeve_share_of_invested',
      rules.concentration.max_single_sleeve_share_of_invested,
      { assumption: true, rationale: rules.concentration.rationale },
    );
    for (const [sleeve, totalsForSleeve] of Object.entries(portfolio.sleeve_totals ?? {})) {
      if (totalsForSleeve.weight <= sleeveLimit) continue;
      findings.push({
        code: 'sleeve_above_concentration_limit',
        severity: 'review',
        title: 'Classe de ativo acima do limite de política',
        position: { label: sleeve, value_brl: totalsForSleeve.market_value, weight: totalsForSleeve.weight },
        measured: { share_of_invested: totalsForSleeve.weight, positions: totalsForSleeve.count },
        threshold: { share_of_invested: sleeveLimit, source: 'house policy', assumption: true },
        action: 'Avaliar redistribuição entre classes ao alocar novos recursos.',
      });
    }
  }

  // -------------------------------------------------------------------------
  // 5. Positions deeply below cost
  // -------------------------------------------------------------------------
  {
    const limit = useParameter(
      'loss_review.review_below_return_since_purchase',
      rules.loss_review.review_below_return_since_purchase,
      { assumption: true, rationale: rules.loss_review.rationale },
    );

    for (const holding of portfolio.holdings) {
      const since = holding.return_since_purchase ?? holding.return_since_purchase_stated;
      if (!Number.isFinite(since) || since > limit) continue;

      const monthly = metrics?.by_holding?.find((m) => m.label === (holding.ticker ?? holding.name));
      findings.push({
        code: 'position_deeply_below_cost',
        severity: 'review',
        title: 'Posição muito abaixo do preço médio',
        position: {
          label: holding.ticker ?? holding.name,
          value_brl: round(holding.market_value, 2),
          weight: holding.weight,
        },
        measured: {
          return_since_purchase: round(since, 6),
          average_price: holding.average_price ?? null,
          last_price: holding.last_price ?? null,
          investment_date: holding.investment_date ?? null,
          return_reference_month: monthly?.return ?? null,
        },
        threshold: { return_since_purchase: limit, source: 'house policy', assumption: true },
        action:
          'Reavaliar a tese de investimento. Um mês forte isolado não altera a posição acumulada; ' +
          'decidir manutenção ou realização com base na aderência ao perfil.',
      });
    }
  }

  // -------------------------------------------------------------------------
  // 6. Instrument identity: codes that no longer trade
  // -------------------------------------------------------------------------
  for (const row of market?.ticker_validation ?? []) {
    if (row.status !== 'superseded') continue;
    const holding = portfolio.holdings.find((h) => h.ticker === row.ticker);
    findings.push({
      code: 'ticker_superseded_by_corporate_action',
      severity: 'informational',
      title: 'Código de negociação substituído por evento societário',
      position: holding
        ? { label: row.ticker, value_brl: round(holding.market_value, 2), weight: holding.weight }
        : { label: row.ticker },
      measured: { successor: row.successor, successor_name: row.successor_name, reason: row.reason },
      threshold: { rule: 'ticker does not resolve at the market data provider', source: 'Yahoo Finance', assumption: false },
      action: `Atualizar o cadastro da posição para ${row.successor}. Não há impacto econômico; é registro.`,
    });
  }

  // -------------------------------------------------------------------------
  // 7. Measurement gaps that require the advisor, not the client
  // -------------------------------------------------------------------------
  for (const gap of metrics?.unmeasured ?? []) {
    if (gap.matured_on) continue; // already raised as finding 2
    findings.push({
      code: 'position_not_measurable',
      severity: 'informational',
      title: 'Posição sem rentabilidade mensal apurável',
      position: { label: gap.label, value_brl: round(gap.market_value, 2), weight: gap.weight },
      measured: { reason: gap.reason },
      threshold: { rule: 'no primary source for a monthly return', source: 'CVM / price file', assumption: false },
      action: 'Confirmar a identificação do produto para que a apuração passe a ser automática.',
    });
  }

  // -------------------------------------------------------------------------
  // 8. The one hard rule in the profile, and the fact that nothing checks it
  // -------------------------------------------------------------------------
  //
  // The signed profile contains exactly one clause with a verifiable threshold:
  // fixed income rated BB+ or better. src/engine/recommend.js QUOTES that clause
  // to justify a purchase, and until now nothing applied it to what the client
  // already holds. Citing a rule where it helps and never enforcing it is worse
  // than not having the rule.
  //
  // No public dataset carries issuer credit ratings, so the honest finding is
  // NOT "these positions are in breach" - it is "this clause cannot be checked
  // with the sources wired, and here is exactly how much money it governs".
  // Silence would let a reader assume the check ran and passed.
  //
  // Which positions the clause governs is read, not guessed: the "CP" suffix in
  // a Brazilian fund name is the regulated abbreviation for "crédito privado",
  // and the CVM's own ANBIMA classification names it too. A bank CDB is issuer
  // credit by construction.
  {
    const clause = (riskProfile.compatible_products ?? []).find((p) =>
      /BB\+/i.test(`${p.title} ${p.body}`),
    );

    if (clause) {
      const byName = new Map((funds?.results ?? []).map((f) => [f.statement_name, f]));
      const exposed = [];

      for (const h of portfolio.holdings ?? []) {
        const fund = byName.get(h.name);
        const anbima = fund?.anbima_class ?? '';
        const privateCredit =
          /\bCP\b|cr[ée]dito privado/i.test(h.name) || /cr[ée]dito privado/i.test(anbima);
        const bankIssuer = h.sleeve === 'fixed_income';
        if (!privateCredit && !bankIssuer) continue;

        exposed.push({
          label: h.name,
          value_brl: round(h.market_value, 2),
          weight: h.weight,
          basis: bankIssuer
            ? 'título de emissor bancário'
            : /cr[ée]dito privado/i.test(anbima)
              ? `classificação ANBIMA: ${anbima}`
              : 'sufixo "CP" (crédito privado) na denominação do fundo',
        });
      }

      if (exposed.length > 0) {
        const total = exposed.reduce((s, e) => s + e.value_brl, 0);
        const invested = portfolio.totals?.invested ?? 0;
        findings.push({
          code: 'credit_quality_not_verifiable',
          severity: 'review',
          title: 'Cláusula de rating do perfil não verificável com as fontes atuais',
          position: { label: `${exposed.length} posições`, value_brl: round(total, 2) },
          measured: {
            share_of_invested: invested > 0 ? round(total / invested, 6) : null,
            positions_exposed: exposed.length,
            holdings: exposed,
          },
          threshold: {
            rule: 'perfil exige renda fixa com classificação BB+ ou superior',
            source: `Perfil de investimento, "${clause.title}"`,
            assumption: false,
          },
          caveats: [
            'Isto NÃO é um apontamento de desenquadramento: nenhuma posição foi avaliada como abaixo de BB+.',
            'Nenhuma base pública gratuita publica rating de emissor; sem essa fonte, a cláusula não pode ser verificada nem refutada.',
            'A exposição foi identificada pela denominação do produto e pela classificação ANBIMA, não por análise de carteira do fundo.',
          ],
          action:
            'Obter os ratings dos emissores junto à mesa de crédito ou a uma agência e confrontá-los com a cláusula. ' +
            'Enquanto não houver fonte, a carta cita a cláusula apenas para justificar compras novas, nunca para atestar o que já está na carteira.',
        });
      }
    }
  }

  const order = { action_required: 0, review: 1, informational: 2 };
  findings.sort(
    (a, b) =>
      order[a.severity] - order[b.severity] ||
      (b.position?.value_brl ?? 0) - (a.position?.value_brl ?? 0),
  );

  return {
    profile: riskProfile.classification,
    profile_slug: slug,
    policy_version: policy.version,
    findings,
    counts: {
      action_required: findings.filter((f) => f.severity === 'action_required').length,
      review: findings.filter((f) => f.severity === 'review').length,
      informational: findings.filter((f) => f.severity === 'informational').length,
    },
    parameters_used: parametersUsed,
    profile_states_no_quantitative_limits: riskProfile.contains_quantitative_limits === false,
  };
}

function daysBetween(isoA, isoB) {
  return Math.round(
    Math.abs(Date.parse(`${isoB}T00:00:00Z`) - Date.parse(`${isoA}T00:00:00Z`)) / 86_400_000,
  );
}
