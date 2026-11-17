/**
 * The "after" portfolio, and the attribution chart's fairness rule.
 *
 * Both exist because of the same failure mode: a number that looks like a
 * measurement while actually being a choice. The projected allocation must be
 * the same money rearranged and nothing more; the attribution chart must not
 * let one sleeve's volatility decide which sleeve gets named.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { proposedAllocation } from '../src/engine/proposed-allocation.js';
import { attributionChart, allocationShiftChart } from '../src/render/charts.js';
import { renderLetterHtml, draftFromPlan } from '../src/render/letter.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => JSON.parse(readFileSync(resolve(root, 'out', f), 'utf8'));

const portfolio = read('portfolio.json');
const plan = read('letter-plan.json');
const metrics = read('metrics.json');
const proposed = proposedAllocation(portfolio, plan.letter.recommendations);

// --- the after portfolio ---------------------------------------------------

test('both sides hold exactly the same money', () => {
  // The "after" ring is a reallocation, not a forecast. If the totals differed,
  // the picture would be claiming the proposal creates or destroys value.
  assert.ok(proposed, 'the fixture must produce a projection');
  assert.equal(proposed.drawable, true);
  assert.equal(proposed.checks.totals_match, true);
  assert.ok(Math.abs(proposed.checks.before_total - proposed.checks.after_total) < 0.01);
  assert.ok(Math.abs(proposed.checks.before_total - portfolio.totals.net_worth) < 0.01);
});

test('only reallocating proposals move money', () => {
  // "Confirm the settlement of a matured bond" does not change the allocation:
  // it turns a position the custodian still lists into cash, and what happens
  // to that cash is a decision nobody has taken. Drawing it as reinvested would
  // invent a second recommendation and attribute it to the client.
  const settle = plan.letter.recommendations.find((r) => r.action === 'confirm_settlement');
  assert.ok(settle, 'the fixture should contain a settlement item');
  assert.ok(!proposed.moves.some((m) => m.id === settle.id));

  const allocate = plan.letter.recommendations.filter((r) => r.action === 'evaluate_allocation');
  assert.equal(proposed.moves.length, allocate.length);
  const moved = allocate.reduce((s, r) => s + r.amount_brl, 0);
  assert.ok(Math.abs(proposed.moved_brl - moved) < 0.01);
});

test('the cash slice lands exactly on the policy limit', () => {
  // Not a coincidence worth admiring - it is where the proposed amount came
  // from. Asserting it keeps the chart honest against the engine that sized it.
  const policy = JSON.parse(readFileSync(resolve(root, 'config/suitability-policy.json'), 'utf8'));
  const limit = policy.profiles.moderado.idle_cash.max_share_of_net_worth;
  assert.ok(
    Math.abs(proposed.cash_share.after - limit) < 1e-6,
    `cash lands at ${proposed.cash_share.after}, policy limit is ${limit}`,
  );
  assert.ok(proposed.cash_share.before > proposed.cash_share.after);
});

test('the proposed money is its own slice, not folded into the class it joins', () => {
  // Merging it would print "renda fixa 19,8%" and hide that half of that is a
  // step the client has not taken yet.
  const proposedSlices = proposed.after.filter((s) => s.proposed);
  assert.equal(proposedSlices.length, 1);
  assert.ok(proposedSlices[0].label_pt);

  const fixedBefore = proposed.before.find((s) => s.sleeve === 'fixed_income').value;
  const fixedAfter = proposed.after.find((s) => s.sleeve === 'fixed_income' && !s.proposed).value;
  assert.equal(fixedAfter, fixedBefore, 'the existing class must be left untouched');
});

test('nothing but cash and the new slice changes', () => {
  for (const b of proposed.before) {
    if (b.sleeve === 'cash') continue;
    const a = proposed.after.find((x) => x.sleeve === b.sleeve && !x.proposed);
    assert.equal(a.value, b.value, `${b.sleeve} must not move`);
  }
});

test('a proposal larger than the balance refuses to draw', () => {
  const out = proposedAllocation(portfolio, [
    {
      id: 'x',
      action: 'evaluate_allocation',
      instrument_class: 'renda_fixa_pos_fixada',
      amount_brl: portfolio.totals.available_cash * 2,
    },
  ]);
  assert.equal(out.drawable, false);
  assert.ok(out.reason);
});

test('no reallocating proposal means no chart at all', () => {
  const out = proposedAllocation(portfolio, [
    { id: 'y', action: 'confirm_settlement', amount_brl: 1000 },
  ]);
  assert.equal(out, null);
  assert.equal(allocationShiftChart(portfolio, out), null);
});

test('the chart marks the proposed slice as not-yet-true', () => {
  // A dashed outline rather than a filled wedge: colour alone would make a step
  // nobody has taken look exactly like a holding already owned.
  const svg = allocationShiftChart(portfolio, proposed);
  assert.ok(svg);
  assert.match(svg, /stroke-dasharray/);
  assert.match(svg, /Hoje/);
  assert.match(svg, /Se as propostas forem seguidas/);
  assert.match(svg, /Nenhuma rentabilidade é projetada/);
});

// --- attribution fairness --------------------------------------------------

test('every measured class is named in the attribution chart', () => {
  // The defect this replaced: three equity rows and an anonymous "demais
  // posições" bar holding 78% of the portfolio.
  const svg = attributionChart(plan, { bySleeve: metrics.by_sleeve });
  assert.ok(!svg.includes('demais posições'), 'no sleeve may be anonymous');
  for (const s of metrics.by_sleeve) {
    const label = { stocks: 'Ações', funds: 'Fundos', fixed_income: 'Renda fixa' }[s.sleeve];
    assert.ok(svg.includes(label), `the chart omits the ${s.sleeve} class`);
  }
});

test('each class gets the same number of named positions', () => {
  // Ranking across the whole portfolio always picks equities: they are the
  // smallest sleeve and the most volatile. A fixed count per class is what
  // makes the comparison fair.
  const svg = attributionChart(plan, { bySleeve: metrics.by_sleeve });
  const counts = {};
  for (const s of metrics.by_sleeve) {
    counts[s.sleeve] = (plan.letter.attribution.sleeve_movers[s.sleeve] ?? [])
      .slice(0, 2)
      .filter((m) => svg.includes(m.label.slice(0, 20))).length;
  }
  const values = Object.values(counts);
  assert.ok(values.length >= 2, 'the fixture needs at least two sleeves');
  assert.equal(new Set(values).size, 1, `unequal naming per class: ${JSON.stringify(counts)}`);
});

test('the sleeve movers are ranked by absolute contribution', () => {
  // So a class's biggest loss can be named as readily as its biggest gain.
  for (const list of Object.values(plan.letter.attribution.sleeve_movers)) {
    for (let i = 1; i < list.length; i += 1) {
      assert.ok(
        Math.abs(list[i - 1].contribution_pp) >= Math.abs(list[i].contribution_pp),
        'movers must be sorted by absolute contribution',
      );
    }
  }
});

test('every measured holding is assigned to a sleeve', () => {
  const map = plan.letter.attribution.sleeve_of;
  for (const h of metrics.by_holding) {
    assert.equal(map[h.label], h.sleeve, `${h.label} lost its sleeve`);
  }
});

// --- buy and sell ideas ----------------------------------------------------

test('the letter names actual buy candidates, not just operational items', () => {
  const ideas = plan.letter.equity_ideas;
  assert.ok(ideas, 'the plan must carry equity ideas');
  assert.ok(ideas.buy.length > 0, 'there should be buy candidates');
  for (const b of ideas.buy) {
    assert.ok(b.ticker, 'a candidate needs a ticker');
    assert.ok(b.dividend_yield?.display, `${b.ticker} needs its measured yield`);
    assert.ok(Number.isFinite(b.dividend_events), `${b.ticker} needs its payment count`);
  }
});

test('every buy candidate actually passes the screen it is offered under', () => {
  // A letter that cites the profile clause to justify a purchase and then names
  // a share failing that clause would be worse than naming nothing.
  const policy = JSON.parse(readFileSync(resolve(root, 'config/suitability-policy.json'), 'utf8'));
  const screen = policy.profiles.moderado.equity_screen;
  for (const b of plan.letter.equity_ideas.buy) {
    assert.ok(
      b.dividend_yield.value >= screen.min_trailing_dividend_yield,
      `${b.ticker} yields ${b.dividend_yield.value}, below the ${screen.min_trailing_dividend_yield} minimum`,
    );
    assert.ok(
      b.dividend_events >= screen.min_dividend_events,
      `${b.ticker} paid ${b.dividend_events} times, below the ${screen.min_dividend_events} minimum`,
    );
  }
});

test('the same screen is applied to what the client already holds', () => {
  // Quoting the clause only where it supports buying is the asymmetry this
  // block exists to remove.
  const recommendations = JSON.parse(readFileSync(resolve(root, 'out/recommendations.json'), 'utf8'));
  const failing = recommendations.held_equity_screen.filter((h) => h.status === 'fails_profile_screen');
  assert.equal(plan.letter.equity_ideas.review.length, failing.length);
  for (const f of failing) {
    assert.ok(
      plan.letter.equity_ideas.review.some((r) => r.ticker === f.ticker),
      `${f.ticker} fails the screen but is not surfaced for review`,
    );
  }
});

test('a held position is offered for review, never for sale', () => {
  // The engine measured a dividend history. It has no view on whether to sell,
  // and turning a failed screen into a sell instruction would invent advice the
  // evidence does not support.
  const html = renderLetterHtml({
    letterText: draftFromPlan(plan, portfolio, metrics),
    plan, portfolio, metrics, charts: {}, provenance: 'teste',
    placeCharts: {}, proposalsParagraph: 4,
  });
  const block = html.slice(html.indexOf('class="ideas"'), html.indexOf('</section>', html.indexOf('class="ideas"')));
  assert.match(block, /Para revisar/);
  assert.match(block, /Nenhuma é ordem de compra ou venda/);

  // The disclaimer contains the word "venda" - it is the sentence that makes
  // the point. Checking for the bare word flagged it, so what is tested is an
  // INSTRUCTION to sell: a heading or an imperative, not any mention of a sale.
  const withoutDisclaimer = block.replace(/Nenhuma é ordem de compra ou venda\.?/g, '');
  assert.ok(
    !/\b(vender|venda|reduzir|zerar|liquidar)\s+(a\s+)?(posição|ação|papel)/i.test(withoutDisclaimer),
    'the letter must not instruct a sale',
  );
  assert.ok(
    !/>\s*(Vender|Venda|Reduzir)\b/i.test(withoutDisclaimer),
    'no heading or label may read as a sell instruction',
  );
});

test('the review reason is built from the measurement, not trimmed from prose', () => {
  // The short form has to stay true to the same numbers the long form cites, so
  // it is composed from `measured` rather than cut down from the sentence.
  const recommendations = JSON.parse(readFileSync(resolve(root, 'out/recommendations.json'), 'utf8'));
  for (const r of plan.letter.equity_ideas.review) {
    assert.ok(r.reason_short_pt, `${r.ticker} needs a short reason`);
    const held = recommendations.held_equity_screen.find((h) => h.ticker === r.ticker);
    const events = held.measured.dividend_events;
    if (events === 0) assert.match(r.reason_short_pt, /nenhum pagamento/);
    else assert.ok(r.reason_short_pt.includes(String(events)));
    assert.ok(r.reasons_pt.length > 0, 'the full reason must survive for the annex');
  }
});

test('no contested price is printed beside a buy idea', () => {
  // The XP price file and the market close disagree on these very tickers by up
  // to 56%. Printing one of them would be picking a side of that disagreement
  // without saying so.
  const html = renderLetterHtml({
    letterText: draftFromPlan(plan, portfolio, metrics),
    plan, portfolio, metrics, charts: {}, provenance: 'teste',
    placeCharts: {}, proposalsParagraph: 4,
  });
  const block = html.slice(html.indexOf('class="ideas"'), html.indexOf('</section>', html.indexOf('class="ideas"')));
  const recommendations = JSON.parse(readFileSync(resolve(root, 'out/recommendations.json'), 'utf8'));
  for (const c of recommendations.recommendations.filter((r) => r.action === 'evaluate_purchase')) {
    const close = c.evidence.last_close.toFixed(2).replace('.', ',');
    assert.ok(!block.includes(close), `${c.ticker}'s contested price reached the letter`);
  }
});

test('the share of the equity sleeve that fails is stated, not implied', () => {
  const ideas = plan.letter.equity_ideas;
  assert.ok(ideas.failed_share?.display);
  assert.ok(ideas.failed_value?.display);
  const recommendations = JSON.parse(readFileSync(resolve(root, 'out/recommendations.json'), 'utf8'));
  const total = recommendations.held_equity_screen.reduce((s, h) => s + h.market_value, 0);
  const failed = recommendations.held_equity_screen
    .filter((h) => h.status === 'fails_profile_screen')
    .reduce((s, h) => s + h.market_value, 0);
  assert.ok(Math.abs(ideas.failed_share.value - failed / total) < 1e-6);
  assert.ok(Math.abs(ideas.failed_value.value - failed) < 0.01);
});
