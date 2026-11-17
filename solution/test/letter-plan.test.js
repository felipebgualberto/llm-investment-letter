import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { planLetter } from '../src/engine/letter-plan.js';
import { parsePortfolio } from '../src/parse/portfolio.js';
import { deriveReferenceDate } from '../src/lib/reference.js';
import { assertNoErrors } from '../src/lib/guard.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => JSON.parse(readFileSync(resolve(root, 'out', f), 'utf8'));
const policy = JSON.parse(readFileSync(resolve(root, 'config/suitability-policy.json'), 'utf8'));

const plan = planLetter({
  metrics: read('metrics.json'),
  suitability: read('suitability.json'),
  recommendations: read('recommendations.json'),
  portfolio: read('portfolio.json'),
  policy,
});

test('the letter carries only what the budget allows', () => {
  assert.equal(plan.letter.recommendations.length, policy.letter_budget.recommendations.max_in_letter);
  assert.ok(plan.letter.attribution.contributors.length <= policy.letter_budget.attribution.max_contributors);
  for (const f of plan.letter.findings) assert.equal(f.severity, 'action_required');
});

test('the shown lines plus the remainder still equal the headline return', () => {
  // A client who adds up the column must land on the total. Hiding rows without
  // a reconciling line makes the letter's own arithmetic fail.
  assert.equal(plan.checks.attribution_reconciles, true);
  assert.ok(Math.abs(plan.checks.shown_plus_remainder_pp - plan.checks.headline_pp) < 0.01);
  assert.ok(plan.letter.attribution.remainder.count > 0);
});

test('what was cut is counted and disclosed, never silently dropped', () => {
  assert.ok(plan.omissions.length > 0);
  const summarised = plan.omissions.find((o) => o.kind === 'findings_summarised');
  assert.ok(summarised.disclosure_pt.includes(String(summarised.count)));
  const deferred = plan.omissions.find((o) => o.kind === 'recommendations_deferred');
  assert.ok(deferred.disclosure_pt.length > 20);
});

test('operational items go to the advisor, not to the client', () => {
  // "Update the ticker after a corporate action" is work for the person running
  // the account. Sending it to the client is noise, and the split is what lets
  // one advisor cover three times as many accounts.
  const annexCodes = plan.advisor_annex.findings.map((f) => f.code);
  assert.ok(annexCodes.includes('ticker_superseded_by_corporate_action'));
  const letterCodes = plan.letter.findings.map((f) => f.code);
  assert.ok(!letterCodes.includes('ticker_superseded_by_corporate_action'));
});

test('mandatory disclosures reach the letter as data, not as prompt instructions', () => {
  assert.equal(plan.letter.disclosures.length, policy.disclosures.required.length);
  for (const d of plan.letter.disclosures) {
    assert.ok(d.id && d.text_pt, 'each disclosure needs an id and Portuguese text');
  }
});

test('selection happens in config, and the plan says where', () => {
  assert.match(plan.selection_rule, /suitability-policy\.json/);
});

// --- reference date --------------------------------------------------------

test('the reference month is derived from the statement, not from the clock', () => {
  const portfolio = parsePortfolio(
    readFileSync(resolve(root, '../Input/XP - Albert_s portfolio.txt'), 'utf8'),
  );
  const ref = deriveReferenceDate(portfolio);
  assert.equal(ref.date, '2025-04-30');
  assert.equal(ref.month, '2025-04');
  assert.match(ref.derived_from, /2025-05-07/);
});

test('a statement with no date refuses to guess a month', () => {
  assert.throws(() => deriveReferenceDate({ statement_date: null }), /Refusing to guess/);
});

test('an explicit override wins and records that it did', () => {
  const ref = deriveReferenceDate({ statement_date: '2025-05-07' }, { override: '2024-03-31' });
  assert.equal(ref.date, '2024-03-31');
  assert.equal(ref.derived_from, 'command line');
});

// --- the guard -------------------------------------------------------------

test('error-level flags abort the run', () => {
  let code = null;
  assertNoErrors('test', [{ code: 'x', severity: 'error', detail: 'broken' }], {
    allowErrors: false,
    exit: (c) => { code = c; },
  });
  assert.equal(code, 1, 'an error flag must exit non-zero');
});

test('warnings alone never abort', () => {
  let called = false;
  const out = assertNoErrors('test', [{ code: 'w', severity: 'warning', detail: 'note' }], {
    allowErrors: false,
    exit: () => { called = true; },
  });
  assert.equal(called, false);
  assert.equal(out.warnings, 1);
});

test('--allow-errors continues but marks the output unfit', () => {
  let called = false;
  const out = assertNoErrors('test', [{ code: 'x', severity: 'error', detail: 'broken' }], {
    allowErrors: true,
    exit: () => { called = true; },
  });
  assert.equal(called, false);
  assert.equal(out.overridden, true);
});

test('every figure the letter prints travels with its Portuguese display string', () => {
  // The first real run produced "o CDI teve uma rentabilidade que resultou em
  // um excesso" — word salad, because the payload gave 0.0105588 and every
  // prompt forbids arithmetic. Converting a fraction to "1,06%" IS arithmetic.
  // The engine formats; the model places.
  for (const [key, figure] of Object.entries(plan.letter.headline)) {
    assert.ok(figure, `${key} must be present`);
    assert.ok(Number.isFinite(figure.value), `${key}.value must be a number`);
    // The rule is that no display may use a DOT as its decimal mark - not that
    // every display must have decimals. "248% do CDI" is deliberately whole:
    // a client reading "% of CDI" is not served by two decimal places.
    //
    // So the check strips the two places a dot is legitimate - the "p.p." unit
    // and thousands groups, which are a dot followed by exactly three digits -
    // and then asserts nothing dot-shaped survives.
    const withoutLegitimateDots = figure.display
      .replace(/p\.p\./g, '')
      .replace(/\.(\d{3})(?!\d)/g, '$1');
    assert.ok(
      !/\d\.\d/.test(withoutLegitimateDots),
      `${key}.display uses a dot as a decimal mark: ${figure.display}`,
    );
  }
  for (const b of Object.values(plan.letter.benchmarks)) {
    assert.ok(b.label_pt && b.display && b.excess_display);
  }
  for (const c of [...plan.letter.attribution.contributors, ...plan.letter.attribution.detractors]) {
    assert.match(c.display, /p\.p\.$/);
    assert.match(c.return_display, /%$/);
  }
});

test('coverage is in the payload, so it cannot be invented', () => {
  // The first run wrote "cobrindo 100% do portfólio" against a real 86,94%,
  // because the plan carried no coverage field at all.
  assert.equal(plan.letter.headline.coverage_of_invested.display, '86,94%');
  assert.ok(plan.letter.headline.coverage_of_invested.value < 0.9);
});

test('the client and advisor identities travel with the payload', () => {
  // "Prezado João" (v1, leaked few-shot) and "Prezado cliente" (first v2 run,
  // missing field) are the same failure: a fact the model was asked for but
  // never given.
  assert.equal(plan.letter.client.name, 'Albert da Silva');
  assert.equal(plan.letter.advisor.name, 'Antonio Bicudo');
  assert.equal(plan.letter.period.label_pt, 'abril de 2025');
});

test('disclosures are marked as rendered elsewhere, so the model does not restate them', () => {
  assert.equal(plan.letter.disclosures_are_rendered_separately, true);
});

test('one minus sign is used across every formatted figure', () => {
  const negatives = plan.letter.attribution.detractors;
  for (const d of negatives) {
    assert.ok(d.display.startsWith('−'), `expected a typographic minus: ${d.display}`);
    assert.ok(d.return_display.startsWith('−'), `expected a typographic minus: ${d.return_display}`);
  }
});

// --- chart placement -------------------------------------------------------

test('the greeting is not counted when placing charts', () => {
  // A letter opens "Prezado Albert da Silva," as its own block. Counting it as
  // paragraph 1 pushed every chart one paragraph early - the attribution chart
  // landed before the performance text instead of after it.
  const placement = policy.letter_budget.chart_placement.after_paragraph;
  assert.ok(placement['2'], 'the map must address body paragraphs');
  assert.equal(placement['2'], 'attribution');
  // Paragraph 3 no longer carries a chart: the consensus range moved to the
  // annex when the buy/sell block entered the letter, and the macro paragraph
  // already states every figure it plotted.
  assert.ok(!('3' in placement), 'paragraph 3 should carry no chart');
  // Paragraph 4 is the proposals lead-in, so its chart is the before/after
  // pair - the one that answers what the proposals would actually do.
  assert.equal(placement['4'], 'allocation-shift');
  assert.equal(
    policy.letter_budget.proposals_after_paragraph,
    4,
    'the proposals block and its chart must sit at the same paragraph',
  );
});

test('every placed chart name is one the build actually produces', () => {
  // A typo here fails silently: the chart is simply absent from the letter.
  //
  // The list of what exists is read from disk rather than written out here. A
  // hardcoded copy is a second place to update, and the first time it went
  // stale it failed for a chart that was perfectly fine.
  const produced = readdirSync(resolve(root, 'out/charts'))
    .filter((f) => f.endsWith('.svg'))
    .map((f) => f.replace(/\.svg$/, ''));
  assert.ok(produced.length > 0, 'run scripts/build-charts.js before the tests');

  const placement = policy.letter_budget.chart_placement;
  for (const name of [...Object.values(placement.after_paragraph), ...placement.annex_only]) {
    assert.ok(produced.includes(name), `no chart is generated under the name "${name}"`);
  }
});

test('a chart is placed in exactly one document', () => {
  // The coverage bar moved from the letter to the annex when the positions ring
  // took its slot. Listing it in both would have printed it twice and made the
  // two documents argue with each other about which chart carried which point.
  const placement = policy.letter_budget.chart_placement;
  const inLetter = new Set(Object.values(placement.after_paragraph));
  for (const name of placement.annex_only) {
    assert.ok(!inLetter.has(name), `"${name}" is placed in both the letter and the annex`);
  }
});
