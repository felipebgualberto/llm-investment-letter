/**
 * Tests for the presentation layer: house identity, palette safety, and the
 * advisor annex.
 *
 * These matter more than they look. The letter is the deliverable a client
 * reads once, and every defect found in this layer so far has been invisible in
 * code review and obvious on the page: a chart stretching down the whole sheet,
 * a signature printed twice, a green/red pair a colourblind reader cannot
 * separate, English field names in a Portuguese document. None of those are
 * caught by testing the numbers.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { renderAnnexHtml, CODE_PT } from '../src/render/annex.js';
import { renderLetterHtml, draftFromPlan } from '../src/render/letter.js';
import { XP_YELLOW, YELLOW_DARK, markSvg, HAS_BRAND_ASSET } from '../src/render/brand.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => JSON.parse(readFileSync(resolve(root, 'out', f), 'utf8'));

const plan = read('letter-plan.json');
const portfolio = read('portfolio.json');
const metrics = read('metrics.json');
const recommendations = read('recommendations.json');
const policy = JSON.parse(readFileSync(resolve(root, 'config/suitability-policy.json'), 'utf8'));

const chart = (name) => {
  const p = resolve(root, 'out/charts', `${name}.svg`);
  return existsSync(p) ? readFileSync(p, 'utf8') : null;
};

// --- palette ---------------------------------------------------------------

test('the palette passes its own checker', () => {
  // Run as a subprocess so the test asserts exactly what `npm run palette`
  // asserts. A palette change that breaks contrast or CVD separation fails the
  // build here rather than shipping to a reader who cannot tell two bars apart.
  execFileSync(process.execPath, [resolve(root, 'tools/check-palette.js')], { stdio: 'pipe' });
});

test('pure XP yellow never carries text or a hairline', () => {
  // 1.56:1 against white. It is a fill colour and nothing else; anything thin
  // and yellow uses the darker amber. This is the rule the checker exempts the
  // fill under, so it has to be true in the output, not just in the comment.
  for (const name of ['attribution', 'benchmarks', 'allocation', 'consensus', 'consensus-selic']) {
    const svg = chart(name);
    if (!svg) continue;
    const yellowText = new RegExp(`<text[^>]*fill="${XP_YELLOW}"`, 'i');
    assert.ok(!yellowText.test(svg), `${name}.svg sets text in pure yellow`);
    const yellowStroke = new RegExp(`stroke="${XP_YELLOW}"`, 'i');
    assert.ok(!yellowStroke.test(svg), `${name}.svg strokes a line in pure yellow`);
  }
});

test('every yellow fill on white carries a darker outline', () => {
  const svg = chart('consensus');
  if (!svg) return;
  const marker = svg.match(new RegExp(`<circle[^>]*fill="${XP_YELLOW}"[^>]*>`, 'i'));
  assert.ok(marker, 'the consensus chart should mark the house view with a yellow dot');
  assert.match(marker[0], new RegExp(`stroke="${YELLOW_DARK}"`, 'i'));
});

test('every chart the build produces is placed in some document', () => {
  // `benchmarks.svg` was generated on every run and rendered nowhere: the one
  // chart that shows the idle-cash drag as a picture, silently orphaned. A
  // chart nobody sees is dead weight in the build and a missing argument in the
  // document that needed it.
  const dir = resolve(root, 'out/charts');
  const docs = ['letter.html', 'annex.html', 'console.html']
    .map((f) => resolve(root, 'out', f))
    .filter((p) => existsSync(p))
    .map((p) => readFileSync(p, 'utf8'));
  assert.ok(docs.length > 0, 'the build must have produced the documents');

  for (const file of readdirSync(dir).filter((f) => f.endsWith('.svg'))) {
    const svg = readFileSync(resolve(dir, file), 'utf8');
    const title = svg.match(/<text class="t"[^>]*>([^<]*)</)?.[1];
    assert.ok(title, `${file} has no title to identify it by`);
    assert.ok(
      docs.some((d) => d.includes(title)),
      `${file} ("${title}") is generated but appears in no document`,
    );
  }
});

test('the mark loads nothing from outside the document', () => {
  // The real invariant, which survived the mark changing from a drawn SVG to
  // XP's own logo: the letter must render identically after being emailed as a
  // single file. A relative src would resolve during the print pass and break
  // the moment the HTML moved, so the asset is inlined as a data URI.
  const mark = markSvg({ size: 20 });

  // `xmlns="http://www.w3.org/2000/svg"` is a namespace identifier, never
  // fetched, so it is stripped before looking for a real external reference.
  const withoutNamespace = mark.replace(/xmlns(:\w+)?="[^"]*"/g, '');
  assert.ok(
    !/https?:\/\/|url\(|xlink:href|src="(?!data:)/.test(withoutNamespace),
    'the mark must not reference anything the renderer would have to fetch',
  );
  assert.match(mark, /alt="XP"|aria-label="XP"/, 'the mark needs an accessible label');

  if (HAS_BRAND_ASSET) {
    assert.match(mark, /^<img src="data:image\/png;base64,/);
  } else {
    // The fallback is deliberately a plain placeholder rather than a near-miss
    // of the real brand mark.
    assert.match(mark, /<svg/);
  }
});

test('the brand asset came from the case materials, not from the internet', () => {
  // The extractor asserts the source PDF and the object it reads; if either
  // changes it throws rather than writing out a wrong crop. This checks the
  // tool still points at a file in the brief.
  const tool = readFileSync(resolve(root, 'tools/extract-brand-mark.js'), 'utf8');
  assert.match(tool, /Input\/XP - Albert_s risk profile\.pdf/);
  assert.ok(!/https?:\/\/(?!\S*w3\.org)/.test(tool), 'the extractor must not fetch anything');
});

// --- letter ----------------------------------------------------------------

const letterHtml = renderLetterHtml({
  letterText: draftFromPlan(plan, portfolio, metrics),
  plan,
  portfolio,
  metrics,
  charts: { attribution: chart('attribution'), allocation: chart('allocation'), consensus: chart('consensus') },
  provenance: 'teste',
  placeCharts: policy.letter_budget.chart_placement.after_paragraph,
});

test('the letter carries the house letterhead', () => {
  assert.match(letterHtml, /class="letterhead"/);
  assert.ok(letterHtml.includes(XP_YELLOW), 'the yellow rule and accents come from the brand tokens');
  assert.match(letterHtml, /XP Investimentos/);
});

// --- próximos passos -------------------------------------------------------

test('the proposals are printed from the plan, with their real amounts', () => {
  // The actions are the part a client has to act on, and they are made entirely
  // of figures the plan already formatted. Paragraph four is now a lead-in.
  const html = renderLetterHtml({
    letterText: draftFromPlan(plan, portfolio, metrics),
    plan, portfolio, metrics, charts: {}, provenance: 'teste',
    placeCharts: {}, proposalsParagraph: policy.letter_budget.proposals_after_paragraph,
  });
  assert.match(html, /class="proposals"/);
  assert.match(html, /Próximos passos/);
  for (const r of plan.letter.recommendations) {
    const amount = Number(r.amount_brl).toLocaleString('pt-BR', {
      minimumFractionDigits: 2, maximumFractionDigits: 2,
    });
    assert.ok(html.includes(amount), `the block omits ${r.headline} (${amount})`);
  }
});

test('the block is suppressed when the prose already carries the amounts', () => {
  // Prose written before the prompt change still states every figure. Printing
  // both says everything twice and pushes the letter to three pages, so the
  // renderer checks instead of assuming.
  const amount = Number(plan.letter.recommendations[0].amount_brl).toLocaleString('pt-BR', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
  const oldStyle = `Prezado Albert da Silva,\n\nAbertura.\n\nDesempenho.\n\nMacro.\n\nProponho alocar R$ ${amount} em renda fixa.\n\nFecho.`;
  const html = renderLetterHtml({
    letterText: oldStyle,
    plan, portfolio, metrics, charts: {}, provenance: 'teste',
    placeCharts: {}, proposalsParagraph: 4,
  });
  assert.ok(!html.includes('class="proposals"'), 'the block must not duplicate the prose');
});

test('the deterministic draft has the same shape the composer is asked for', () => {
  // The draft exists so pagination can be proved without spending a model call.
  // That only holds if it matches the real output: a draft that still wrote the
  // proposals as prose would prove the wrong layout.
  const draft = draftFromPlan(plan, portfolio, metrics);
  for (const r of plan.letter.recommendations) {
    const amount = Number(r.amount_brl).toLocaleString('pt-BR', {
      minimumFractionDigits: 2, maximumFractionDigits: 2,
    });
    assert.ok(!draft.includes(amount), 'the draft must leave the amounts to the block');
  }
  for (const o of plan.omissions.filter((x) => x.disclosure_pt)) {
    assert.ok(!draft.includes(o.disclosure_pt), 'the draft must leave omissions to the renderer');
  }
});

test('what the letter left out is printed by the renderer, not left to the model', () => {
  // The composer was asked to work these notices into the prose. It kept one,
  // paraphrased into a vague "outras propostas", and dropped the other - so the
  // client was never told that five further findings existed. Cutting by rule
  // is only honest if the reader learns what was cut.
  const expected = plan.omissions.filter((o) => o.disclosure_pt);
  assert.ok(expected.length > 0, 'the fixture must have something to disclose');
  for (const o of expected) {
    assert.ok(letterHtml.includes(o.disclosure_pt), `the letter omits: "${o.disclosure_pt}"`);
    assert.ok(o.disclosure_pt.includes(String(o.count)), 'the notice must carry the real count');
  }
});

test('the composer is not handed the omission notices at all', () => {
  // Belt and braces: if the payload carries them again, a future run can
  // duplicate what the renderer already prints.
  const composer = plan.prompt_payloads?.composer ?? {};
  assert.ok(!('ressalvas' in composer), 'omission notices must not reach the model');
  assert.match(composer.aviso, /não os reproduza|nao os reproduza/i);
});

test('operational omissions stay out of the client letter', () => {
  // "findings_to_annex" has no disclosure_pt: updating a ticker after a merger
  // is back-office work, and telling the client about it is noise.
  const operational = plan.omissions.filter((o) => !o.disclosure_pt);
  assert.ok(operational.length > 0, 'the fixture should have an operational omission');
  for (const o of operational) {
    assert.ok(!letterHtml.includes(`${o.count} ${o.kind}`));
  }
});

test('the letter never restates the sign-off the renderer prints', () => {
  // The signature block is deterministic because it carries the advisor code,
  // which the model does not reliably reproduce. A closing salutation inside
  // the prose would therefore appear twice - it did, in an early run.
  const signoffs = letterHtml.match(/Assessor de investimentos/g) ?? [];
  assert.equal(signoffs.length, 1);
});

// --- annex -----------------------------------------------------------------

const annexHtml = renderAnnexHtml({
  plan,
  portfolio,
  metrics,
  recommendations,
  charts: { 'consensus-selic': chart('consensus-selic'), 'consensus-ipca': chart('consensus-ipca') },
  provenance: 'teste',
});

test('the annex is marked internal so it cannot be mistaken for the letter', () => {
  assert.match(annexHtml, /Uso interno/i);
  assert.match(annexHtml, /nenhum trecho foi redigido por modelo de linguagem/i);
});

test('the annex carries every finding, not just the ones the letter shows', () => {
  const total = plan.letter.findings.length + plan.advisor_annex.findings.length;
  assert.ok(total > plan.letter.findings.length, 'the fixture must actually have deferred findings');
  for (const f of [...plan.letter.findings, ...plan.advisor_annex.findings]) {
    assert.ok(annexHtml.includes(f.title), `the annex omits "${f.title}"`);
  }
});

test('the annex carries the deferred recommendations the letter promised', () => {
  // The letter says "outras N sugestões foram preparadas". This is the document
  // that has to contain them, or that sentence is false.
  const deferred = plan.omissions.find((o) => o.kind === 'recommendations_deferred');
  assert.equal(plan.advisor_annex.recommendations.length, deferred.count);
  for (const r of plan.advisor_annex.recommendations) {
    assert.ok(annexHtml.includes(r.headline), `the annex omits "${r.headline}"`);
  }
});

test('the full attribution reaches the annex, all ten lines', () => {
  for (const row of plan.advisor_annex.full_attribution) {
    assert.ok(annexHtml.includes(row.label), `the annex omits the ${row.label} line`);
  }
});

test('the forensic consensus chart is in the annex and not in the letter', () => {
  // A marker labelled "carta v1" is a note about our own past error. The
  // advisor is the audience for it; the client is not.
  assert.ok(annexHtml.includes('carta v1'), 'the annex should carry the v1 marker');
  assert.ok(!letterHtml.includes('carta v1'), 'the client letter must not carry it');
  assert.ok(policy.letter_budget.chart_placement.annex_only.length > 0);
});

test('the annex prints Portuguese labels, never raw engine field names', () => {
  // The engine speaks English by requirement; the renderer is the translation
  // boundary. Before it existed, the annex printed "share of net worth" and
  // "maturity date" to a Brazilian advisor.
  const rawKeys = [...annexHtml.matchAll(/<dt>([^<]*)<\/dt>/g)].map((m) => m[1]);
  assert.ok(rawKeys.length > 0, 'the fixture must produce some labelled fields');
  for (const k of rawKeys) {
    assert.ok(!/_/.test(k), `an untranslated field name reached the page: ${k}`);
    assert.ok(
      !/^(share|return|last|average|maturity|statement|days|visible)\b/i.test(k),
      `an English field name reached the page: ${k}`,
    );
  }
});

test('one minus sign across the whole annex, including reais', () => {
  // toLocaleString emits an ASCII hyphen, so "R$ -3.023,40" sat next to
  // "−1,14 p.p." on the same table row.
  const asciiMoney = annexHtml.match(/R\$ -[\d.]/g) ?? [];
  assert.equal(asciiMoney.length, 0, `found ASCII hyphens in currency: ${asciiMoney.join(', ')}`);
});

test('the annex states which limits are house assumptions', () => {
  // The difference between "you are over the limit" and "we chose a limit and
  // you are over it". Every finding has to say which one it is.
  assert.match(annexHtml, /parâmetro da casa/);
  assert.match(annexHtml, /regra externa/);
});

test('every data-quality code the engine emits has a Portuguese explanation', () => {
  // Two codes shipped without one and rendered as a bare disclosure toggle with
  // no sentence above it - the row said a problem existed and not what it was.
  // A new flag code now fails here instead of appearing blank on the page.
  const emitted = new Set(plan.advisor_annex.data_quality_flags.map((f) => f.code));
  assert.ok(emitted.size > 0);
  for (const code of emitted) {
    assert.ok(CODE_PT[code], `no Portuguese explanation for the flag code "${code}"`);
  }
});

test('data-quality diagnostics are explained in Portuguese but quoted verbatim', () => {
  // The raw detail carries the fund name and the dates. Paraphrasing evidence
  // is how evidence stops being evidence, so the original English diagnostic
  // stays, under a Portuguese explanation of what the code means.
  assert.match(annexHtml, /A cota informada no extrato/);
  const stale = plan.advisor_annex.data_quality_flags.find((f) => f.code === 'stale_quota_date');
  assert.ok(annexHtml.includes(stale.detail), 'the raw diagnostic must be quoted, not rewritten');
});

test('the report stays inside the two pages the brief asks for', () => {
  // Caught on the morning of the deadline: the report had grown to 6.541 words,
  // roughly fifteen pages, because it was extended a section at a time and
  // never measured. The letter had a page counter from the day it first ran
  // long; the report did not, and that asymmetry is how a hard requirement gets
  // missed. Now both are counted from the printed PDF.
  execFileSync(
    process.execPath,
    [resolve(root, 'tools/check-report-pages.js'), resolve(root, '../docs/RELATORIO.md'), '2'],
    { stdio: 'pipe' },
  );
});

test('the long technical write-up is not mistaken for the report', () => {
  // The depth did not get deleted, it got renamed. The dossier has to say on
  // its own first screen that it is not the deliverable, or a reviewer opening
  // it first will think the two-page limit was ignored.
  const dossier = readFileSync(resolve(root, '../docs/DOSSIE-TECNICO.md'), 'utf8');
  assert.match(dossier.slice(0, 600), /não é o relatório pedido/i);
  // The pointer must name the report; whether it points at the .md source or
  // the .docx deliverable is a packaging choice, not the invariant.
  assert.match(dossier.slice(0, 600), /RELATORIO\.(md|docx)/);
});
