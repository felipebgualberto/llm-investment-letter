import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseRiskProfile } from '../src/parse/risk-profile.js';
import { assessSuitability } from '../src/engine/suitability.js';
import { screenCandidates, deriveRateStance } from '../src/engine/recommend.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const policy = JSON.parse(readFileSync(resolve(root, 'config/suitability-policy.json'), 'utf8'));
const riskProfile = parseRiskProfile(
  readFileSync(resolve(root, '../Input/XP - Albert_s risk profile.txt'), 'utf8'),
);

// --- risk profile ----------------------------------------------------------

test('the profile classification is extracted, not assumed', () => {
  assert.equal(riskProfile.classification, 'Moderado');
  assert.equal(riskProfile.classification_slug, 'moderado');
  assert.equal(riskProfile.client, 'Albert');
});

test('both compatible product families are recovered with their text', () => {
  assert.equal(riskProfile.compatible_products.length, 2);
  assert.match(riskProfile.compatible_products[0].title, /Dividendos/i);
  assert.match(riskProfile.compatible_products[1].title, /BB\+/);
  assert.match(riskProfile.compatible_products[0].body, /historicamente pagam dividendos/i);
});

test('the profile is recorded as carrying no quantitative limits', () => {
  // This is what forces every threshold to be declared as a house assumption.
  assert.equal(riskProfile.contains_quantitative_limits, false);
});

// --- suitability -----------------------------------------------------------

const basePortfolio = {
  statement_date: '2025-05-07',
  client: { name: 'Albert da Silva' },
  totals: { net_worth: 386858.82, invested: 312186.20, available_cash: 74672.62 },
  sleeve_totals: { funds: { market_value: 211395.66, weight: 0.677145, count: 7 } },
  holdings: [
    { name: 'Fundo Restrito', sleeve: 'funds', market_value: 72567.43, weight: 0.2324 },
    { name: 'CDB Vencido', sleeve: 'fixed_income', market_value: 40478.75, weight: 0.1297,
      maturity_date: '2024-09-05', rate: 'IPC-A +5,45%' },
    { ticker: 'HAPV3', sleeve: 'stocks', market_value: 6143.14, weight: 0.0197,
      return_since_purchase: -0.7458, average_price: 15.62, last_price: 3.97, investment_date: '2022-11-02' },
  ],
};

const baseFunds = {
  results: [{ statement_name: 'Fundo Restrito', cnpj: '35726300000137', target_investor: 'Qualificado', renamed: true, current_name: 'BRAVE 90' }],
};

const baseMarket = {
  benchmarks: {
    cdi: {
      value: 0.0105593,
      business_days: 20,
      annualised: {
        value: 0.1415,
        basis: '252 business days',
        published: { value: 0.1415, as_of: '2025-04-30', source: { series: 4389 } },
        derived: 0.1415,
        cross_check: { gap: 0, status: 'consistent' },
      },
    },
  },
  ticker_validation: [],
  house_view_vs_consensus: [],
};

const baseMetrics = { by_holding: [{ label: 'HAPV3', return: 0.7644 }], unmeasured: [] };

const assess = (overrides = {}) =>
  assessSuitability({
    portfolio: basePortfolio, riskProfile, funds: baseFunds,
    market: baseMarket, metrics: baseMetrics, policy, ...overrides,
  });

test('idle cash above policy is quantified in reais, not just flagged', () => {
  const f = assess().findings.find((x) => x.code === 'idle_cash_above_policy');
  assert.ok(f);
  assert.equal(f.severity, 'action_required');
  assert.equal(f.position.value_brl, 74672.62);
  // The annualised CDI must be the published 252-day figure (14.15%), never
  // (1 + monthly)^12, which assumes a 240-day year and gives 13.43%.
  assert.equal(f.quantified.cdi_annualised, 0.1415);
  assert.match(f.quantified.cdi_annualised_source, /SGS 4389/);

  // Two bases, named. A single ambiguous field let the letter quote the cost of
  // the whole idle balance next to a recommendation that deploys only the
  // excess - a figure 2.07x larger than the action it justified.
  const excess = 74672.62 - 386858.82 * 0.10;
  assert.ok(Math.abs(f.quantified.excess_cash_brl - excess) < 0.02);
  assert.ok(Math.abs(f.quantified.forgone_yield_12m_on_excess_brl - excess * 0.1415) < 0.02);
  assert.ok(Math.abs(f.quantified.forgone_yield_12m_on_full_balance_brl - 74672.62 * 0.1415) < 0.02);
  assert.ok(
    f.quantified.forgone_yield_12m_on_excess_brl < f.quantified.forgone_yield_12m_on_full_balance_brl,
    'the excess figure must be the smaller of the two',
  );
  assert.equal(f.threshold.assumption, true, 'the 10% limit is a house choice and must say so');
});

test('a matured instrument is raised as action required, never accrued', () => {
  const f = assess().findings.find((x) => x.code === 'matured_instrument_in_position');
  assert.ok(f);
  assert.equal(f.severity, 'action_required');
  assert.equal(f.measured.days_since_maturity, 244);
  assert.equal(f.threshold.assumption, false, 'a date comparison is arithmetic, not policy');
});

test('qualified-investor exposure is a review with caveats, never an accusation', () => {
  const f = assess().findings.find((x) => x.code === 'restricted_product_eligibility_review');
  assert.ok(f);
  assert.equal(f.severity, 'review', 'must not be stated as a breach');
  assert.equal(f.threshold.qualified_investor_brl, 1000000);
  assert.equal(f.threshold.assumption, false, 'the R$1M threshold is CVM, not house policy');
  assert.ok(f.caveats.length >= 2);
  assert.ok(f.caveats.some((c) => /parte dos ativos/i.test(c)));
  assert.ok(f.caveats.some((c) => /antes de o produto ser reclassificado/i.test(c)));
  // The caveats are read by an advisor, in Portuguese. A third one used to be
  // appended straight from the policy file's `note` - developer commentary, in
  // English, saying the same thing as the first. Every caveat must be prose
  // meant for the reader, so none of them may be the raw config note.
  for (const c of f.caveats) {
    assert.ok(
      !/Visible net worth|never an assertion/i.test(c),
      `a caveat leaked English config commentary: ${c}`,
    );
  }
});

test('a client above the threshold triggers no eligibility finding', () => {
  const rich = {
    ...basePortfolio,
    totals: { ...basePortfolio.totals, net_worth: 2_000_000 },
  };
  const findings = assess({ portfolio: rich }).findings;
  assert.equal(findings.filter((f) => f.code === 'restricted_product_eligibility_review').length, 0);
});

test('a deeply underwater position is a review, and carries its strong month', () => {
  const f = assess().findings.find((x) => x.code === 'position_deeply_below_cost');
  assert.ok(f);
  assert.equal(f.severity, 'review');
  assert.equal(f.measured.return_since_purchase, -0.7458);
  assert.equal(f.measured.return_reference_month, 0.7644);
});

test('every finding cites whether its threshold is an assumption', () => {
  for (const f of assess().findings) {
    assert.ok(
      typeof f.threshold?.assumption === 'boolean',
      `${f.code} must declare whether its threshold is a house assumption`,
    );
  }
});

test('findings are ordered by urgency, then by money at stake', () => {
  const severities = assess().findings.map((f) => f.severity);
  const rank = { action_required: 0, review: 1, informational: 2 };
  for (let i = 1; i < severities.length; i += 1) {
    assert.ok(rank[severities[i]] >= rank[severities[i - 1]]);
  }
});

test('an unknown profile disables every check rather than guessing one', () => {
  const unknown = { ...riskProfile, classification_slug: 'arrojado', classification: 'Arrojado' };
  const out = assessSuitability({
    portfolio: basePortfolio, riskProfile: unknown, funds: baseFunds,
    market: baseMarket, metrics: baseMetrics, policy,
  });
  assert.equal(out.findings.length, 1);
  assert.equal(out.findings[0].code, 'no_policy_for_profile');
});

// --- house stance ----------------------------------------------------------

test('the rate tilt is derived from the parsed table and the Focus consensus', () => {
  const stance = deriveRateStance({
    house_view_vs_consensus: [{
      indicator: 'Selic', house_value: 15.5, consensus_median: 15.0, gap_vs_median: 0.5,
      consensus_min: 13.5, consensus_max: 15.75, percentile_in_range: 88.9,
      respondents: 140, survey_date: '2025-04-30',
    }],
  });
  assert.equal(stance.stance, 'above_consensus');
  assert.equal(stance.tilt, 'favour_post_fixed_income');
  assert.match(stance.rationale, /140 institui/);
});

test('no Selic comparison means no tilt, not a default one', () => {
  assert.equal(deriveRateStance({ house_view_vs_consensus: [] }), null);
  assert.equal(deriveRateStance({}), null);
});

// --- candidate screen ------------------------------------------------------

const rules = policy.profiles.moderado;

test('a non-payer is rejected with the measured reason', () => {
  const screened = screenCandidates(
    [{ ticker: 'WEGE3', current_price: 42.6, monthly_return: 0.034 }],
    [{ ticker: 'WEGE3', status: 'ok', name: 'WEG', last_close: 42.0, last_close_date: '2025-04-30',
       trailing_dividend_yield: 0.0176, dividend_events: 4, dividends_paid_per_share: 0.74,
       annualised_volatility: 0.30, max_drawdown: -0.2, window: { months: 12 }, source: {} }],
    rules,
  );
  assert.equal(screened[0].status, 'rejected');
  // Brazilian notation: these strings go straight into the client letter.
  assert.match(screened[0].rejection_reasons[0], /1,76%/);
});

test('a ticker with no fundamentals is not_screened, never silently dropped', () => {
  const screened = screenCandidates(
    [{ ticker: 'XXXX9', current_price: 10, monthly_return: 0 }],
    [{ ticker: 'XXXX9', status: 'symbol_not_found', detail: 'not found' }],
    rules,
  );
  assert.equal(screened[0].status, 'not_screened');
});

test('the price file is reconciled against the market, never blended with it', () => {
  const screened = screenCandidates(
    [{ ticker: 'PETR4', current_price: 37.12, monthly_return: 0.06 }],
    [{ ticker: 'PETR4', status: 'ok', name: 'Petrobras', last_close: 29.99, last_close_date: '2025-04-30',
       trailing_dividend_yield: 0.2511, dividend_events: 6, dividends_paid_per_share: 7.53,
       annualised_volatility: 0.2597, max_drawdown: -0.3, window: { months: 12 }, source: {} }],
    rules,
  );
  const rec = screened[0].price_reconciliation;
  assert.equal(rec.status, 'divergent');
  assert.ok(Math.abs(rec.gap - 0.237746) < 1e-4);
  // The yield must be the market-on-market figure, not recomputed on the file price.
  assert.equal(screened[0].measured.trailing_dividend_yield, 0.2511);
});
