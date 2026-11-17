/**
 * The positions ring and the advisor console.
 *
 * Both are places where a presentation bug is also a correctness bug: a ring
 * whose slices do not sum to the whole is a lie about the portfolio, and a
 * queue that counts the same money under two headings tells an advisor to worry
 * about twice what is actually at stake.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { positionsChart } from '../src/render/charts.js';
import { renderConsoleHtml, moneyAtStake, workItems, flatten } from '../src/render/console.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => JSON.parse(readFileSync(resolve(root, 'out', f), 'utf8'));

const plan = read('letter-plan.json');
const portfolio = read('portfolio.json');
const metrics = read('metrics.json');

// --- the ring --------------------------------------------------------------

test('the ring divides the whole net worth, cash included', () => {
  // A composition chart drawn over the invested total silently omits the 19,3%
  // sitting in the account - a fifth of the client's money, missing from a
  // picture whose entire claim is "this is everything you have".
  const held = portfolio.holdings.reduce((s, h) => s + h.market_value, 0);
  const total = held + portfolio.totals.available_cash;
  assert.ok(
    Math.abs(total - portfolio.totals.net_worth) < 0.01,
    `slices sum to ${total}, net worth is ${portfolio.totals.net_worth}`,
  );
});

test('every position the client owns appears in the ring', () => {
  // The legend moved to two columns to save page height, so long fund names are
  // truncated to fit a column. What must never happen is a position going
  // MISSING - so the check is that every name is present up to its truncation
  // point, and that any truncation is marked with an ellipsis rather than
  // clipped silently.
  const svg = positionsChart(portfolio);
  assert.ok(svg, 'the chart must render for this portfolio');
  const LIMIT = 27;
  for (const h of portfolio.holdings) {
    const name = h.ticker || h.name;
    const shown = name.length > LIMIT ? `${name.slice(0, LIMIT - 1)}…` : name;
    assert.ok(svg.includes(shown), `the ring legend omits ${name} (looked for "${shown}")`);
    if (name.length > LIMIT) {
      assert.ok(shown.endsWith('…'), 'a truncated name must say it was truncated');
    }
  }
  assert.ok(svg.includes('Saldo em conta'), 'cash must be a slice like any other');
});

test('a position too small to draw still gets a visible arc', () => {
  // Trend Investback is 0,08% of net worth - an arc narrower than the white gap
  // between slices. Without clamping, the arc angle goes negative and the path
  // sweeps backwards across the whole ring.
  const svg = positionsChart(portfolio);
  const paths = svg.match(/<path d="M[^"]+"/g) ?? [];
  // Four classes plus thirteen positions, each drawn once.
  assert.ok(paths.length >= portfolio.holdings.length + 4, `only ${paths.length} arcs drawn`);
  assert.ok(!/NaN|Infinity/.test(svg), 'an arc produced a non-finite coordinate');
});

test('the ring refuses to draw a portfolio with no net worth', () => {
  // Dividing by zero would give every slice the same angle and produce a
  // confident-looking circle describing nothing.
  assert.equal(positionsChart({ totals: { net_worth: 0 }, holdings: [] }), null);
  assert.equal(positionsChart({ totals: {}, holdings: [] }), null);
});

// --- money at stake --------------------------------------------------------

test('overlapping findings never count the same position twice', () => {
  // Brave I appears in the concentration finding AND inside the three funds of
  // the qualified-investor finding. Adding the two headline values counts it
  // twice; resolving to positions first does not.
  const findings = [...plan.letter.findings, ...plan.advisor_annex.findings];
  const stake = moneyAtStake(findings, portfolio);

  const naive = findings.reduce((s, f) => s + (f.position?.value_brl ?? 0), 0);
  assert.ok(
    stake.touched < naive,
    `dedup did nothing: touched ${stake.touched} vs naive ${naive}`,
  );
  assert.ok(
    stake.touched <= portfolio.totals.net_worth + 0.01,
    'money at stake cannot exceed the whole portfolio',
  );
});

test('the queue headline counts only what actually requires action', () => {
  const findings = [...plan.letter.findings, ...plan.advisor_annex.findings];
  const stake = moneyAtStake(findings, portfolio);
  // Idle cash and the matured CDB - the two action_required findings.
  const expected = portfolio.totals.available_cash + 40478.75;
  assert.ok(Math.abs(stake.action_required - expected) < 0.01, `got ${stake.action_required}`);
  assert.ok(stake.review > 0, 'the review tier must be reported separately, not merged');
});

// --- the queue -------------------------------------------------------------

test('a recommendation that fixes a finding nests under it', () => {
  // Listed as siblings, "Título vencido ainda consta na posição — R$ 40.478,75"
  // sat directly above "Pendência: confirmar liquidação — R$ 40.478,75": one
  // problem, two rows, the same money read twice.
  const items = workItems(plan);
  const matured = items.find((i) => i.id.startsWith('finding:matured_instrument_in_position'));
  assert.ok(matured, 'the matured-bond finding must be in the queue');
  assert.equal(matured.follow_ups.length, 1);
  assert.match(matured.follow_ups[0].id, /^rec:settle-/);

  const topLevelIds = items.map((i) => i.id);
  assert.ok(
    !topLevelIds.includes(matured.follow_ups[0].id),
    'the fix must not also appear as its own queue row',
  );
});

test('every recommendation either fixes a named finding or stands alone', () => {
  // `addresses_finding` is emitted by the engine, so a link is data rather than
  // a guess made by matching amounts in the renderer.
  const recs = [...plan.letter.recommendations, ...plan.advisor_annex.recommendations];
  for (const r of recs) {
    assert.ok('addresses_finding' in r, `${r.id} does not declare what it addresses`);
    if (r.addresses_finding) assert.ok(r.addresses_finding.code, `${r.id} has an unnamed finding link`);
  }
  const buys = recs.filter((r) => r.id.startsWith('buy-'));
  assert.ok(buys.length > 0);
  for (const b of buys) {
    assert.equal(b.addresses_finding, null, 'a buy candidate repairs nothing and must say so');
  }
});

test('a buy candidate is never badged as urgent as a matured bond', () => {
  // Priority <= 2 used to map to "ação necessária", which put "Candidato para
  // análise: PETR4" in the same red as a bond that matured 244 days ago. Badging
  // everything red teaches the reader to ignore red.
  const items = flatten(workItems(plan));
  const petr = items.find((i) => i.id === 'rec:buy-petr4');
  assert.ok(petr);
  assert.notEqual(petr.severity, 'action_required');
  for (const i of items) {
    if (i.kind === 'recommendation') {
      assert.ok(['proposal', 'suggestion'].includes(i.severity), `${i.id} is ${i.severity}`);
    }
  }
});

test('nothing in the queue is lost between the two shapes', () => {
  const items = workItems(plan);
  const all = flatten(items);
  const expected =
    plan.letter.findings.length +
    plan.advisor_annex.findings.length +
    plan.letter.recommendations.length +
    plan.advisor_annex.recommendations.length;
  assert.equal(all.length, expected, 'nesting must reorganise items, never drop them');
  assert.equal(new Set(all.map((i) => i.id)).size, all.length, 'queue ids must be unique');
});

// --- the page --------------------------------------------------------------

const html = renderConsoleHtml({
  clients: [
    {
      id: '792854',
      name: portfolio.client.name,
      account: portfolio.client.account,
      net_worth: portfolio.totals.net_worth,
      month_return: metrics.portfolio_return,
      period: 'abril de 2025',
      month: '2025-04',
      stake: moneyAtStake([...plan.letter.findings, ...plan.advisor_annex.findings], portfolio),
      open_items: flatten(workItems(plan)).length,
      items: workItems(plan),
      charts: { positions: positionsChart(portfolio), attribution: null },
    },
  ],
  advisor: { name: portfolio.advisor.name, code: portfolio.advisor.code },
  generatedAt: '01/01/2025, 00:00:00',
  dataRetrieved: '2025-05-07',
});

test('the console reaches both documents without a terminal', () => {
  for (const href of ['letter.pdf', 'letter.html', 'annex.pdf', 'annex.html']) {
    assert.ok(html.includes(`href="${href}"`), `no link to ${href}`);
  }
});

test('the console is honest about what it does not persist', () => {
  // The decisions live in localStorage. Implying an audit trail it does not
  // have would be the one dishonest thing on an otherwise evidence-backed page.
  assert.match(html, /localStorage/);
  assert.match(html, /não é trilha de auditoria/);
  assert.match(html, /nada nesta página foi escrito por um modelo de linguagem/);
});

test('the console defines its own sort key on the page', () => {
  // "Money at stake" means nothing until it says which money. The definition is
  // printed next to the number so nobody has to guess.
  assert.match(html, /contada uma vez por posição/);
});

test('every queue row carries a decision control', () => {
  const rows = html.match(/data-item="/g) ?? [];
  assert.equal(rows.length, flatten(workItems(plan)).length);
  for (const d of ['aprovado', 'adiado', 'recusado']) {
    assert.ok(html.includes(`data-d="${d}"`), `no ${d} control`);
  }
});

test('client-supplied text cannot inject markup into the page', () => {
  const hostile = JSON.parse(JSON.stringify(portfolio));
  hostile.client.name = '<script>alert(1)</script>';
  const out = renderConsoleHtml({
    clients: [
      {
        id: 'x', name: hostile.client.name, account: '1', net_worth: 1, month_return: 0,
        period: 'p', month: '2025-04',
        stake: { action_required: 0, review: 0, touched: 0, positions: 0 },
        open_items: 0, items: [], charts: {},
      },
    ],
    advisor: { name: 'a', code: 'b' },
    generatedAt: 'x',
    dataRetrieved: '2025-05-07',
  });
  assert.ok(!out.includes('<script>alert(1)</script>'), 'a name was interpolated unescaped');
  assert.ok(out.includes('&lt;script&gt;'), 'the name should appear escaped');
});
