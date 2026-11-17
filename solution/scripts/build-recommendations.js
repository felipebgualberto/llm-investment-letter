import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deriveReferenceDate, referenceOverrideFromArgv } from '../src/lib/reference.js';
import { parsePortfolio } from '../src/parse/portfolio.js';
import { parsePrices, candidateUniverse } from '../src/parse/prices.js';
import { parseRiskProfile } from '../src/parse/risk-profile.js';
import { fetchFundamentalsBatch } from '../src/data/fundamentals.js';
import { assessSuitability } from '../src/engine/suitability.js';
import { buildRecommendations, screenHeldEquities } from '../src/engine/recommend.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const inputs = resolve(root, '../Input');
const referenceOverride = referenceOverrideFromArgv();
const refresh = process.argv.includes('--refresh');

const portfolio = parsePortfolio(readFileSync(resolve(inputs, 'XP - Albert_s portfolio.txt'), 'utf8'));

// Reference month comes from the statement, not the wall clock. See src/lib/reference.js.
const reference = deriveReferenceDate(portfolio, { override: referenceOverride });
const referenceDate = reference.date;
const riskProfile = parseRiskProfile(readFileSync(resolve(inputs, 'XP - Albert_s risk profile.txt'), 'utf8'));
const { prices, rows } = parsePrices(readFileSync(resolve(inputs, 'profitability_calc_wip.csv'), 'utf8'));
const policy = JSON.parse(readFileSync(resolve(root, 'config/suitability-policy.json'), 'utf8'));
const funds = JSON.parse(readFileSync(resolve(root, 'out/funds.json'), 'utf8'));
const market = JSON.parse(readFileSync(resolve(root, 'out/market.json'), 'utf8'));
const metrics = JSON.parse(readFileSync(resolve(root, 'out/metrics.json'), 'utf8'));

const suitability = assessSuitability({ portfolio, riskProfile, funds, market, metrics, policy });

const held = portfolio.holdings.filter((h) => h.sleeve === 'stocks').map((h) => h.ticker);
const universe = candidateUniverse(rows, held);
console.log(`screening ${universe.length} candidates: ${universe.map((u) => u.ticker).join(', ')}\n`);
// Screen the HELD equities against the same profile rule, resolving dead codes
// through their successors so a corporate action does not hide a position.
const successors = new Map((market.ticker_validation ?? []).map((t) => [t.ticker, t]));
const heldPositions = portfolio.holdings
  .filter((h) => h.sleeve === 'stocks')
  .map((h) => ({ ticker: h.ticker, market_value: h.market_value, weight: h.weight }));
const heldSymbols = heldPositions.map((h) => {
  const s = successors.get(h.ticker);
  return s?.status === 'superseded' ? s.successor : h.ticker;
});

const fundamentals = await fetchFundamentalsBatch(
  [...new Set([...universe.map((u) => u.ticker), ...heldSymbols])],
  referenceDate,
  { refresh },
);

const heldScreen = screenHeldEquities(heldPositions, fundamentals, policy.profiles[riskProfile.classification_slug], successors);

const recs = buildRecommendations({
  portfolio, suitability, universe, fundamentals, market, policy,
  profileSlug: riskProfile.classification_slug,
});

writeFileSync(resolve(root, 'out/suitability.json'), JSON.stringify(suitability, null, 2), 'utf8');
writeFileSync(resolve(root, 'out/recommendations.json'), JSON.stringify({ ...recs, held_equity_screen: heldScreen }, null, 2), 'utf8');
writeFileSync(resolve(root, 'out/risk-profile.json'), JSON.stringify(riskProfile, null, 2), 'utf8');

const pct = (v, d = 2) => (v === null || v === undefined ? 'n/d' : (v * 100).toFixed(d) + '%');
const brl = (v) => (v === null || v === undefined ? 'n/d' : 'R$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

console.log(`PERFIL: ${suitability.profile}  |  politica v${suitability.policy_version}`);
console.log(`ACHADOS: ${suitability.counts.action_required} acao requerida | ${suitability.counts.review} revisao | ${suitability.counts.informational} informativo\n`);
for (const f of suitability.findings) {
  console.log(`  [${f.severity}] ${f.title}`);
  console.log(`      ${f.position?.label ?? ''} ${f.position?.value_brl ? brl(f.position.value_brl) : ''} ${f.position?.weight ? '(' + pct(f.position.weight) + ')' : ''}`);
  console.log(`      -> ${f.action}`);
}

console.log(`\nVISAO DA CASA: ${recs.house_stance ? recs.house_stance.stance + ' -> ' + recs.house_stance.tilt : 'n/d'}`);
console.log(`\nUNIVERSO: ${recs.universe_report.considered} considerados | ${recs.universe_report.eligible} elegiveis | ${recs.universe_report.shown} apresentados | ${recs.universe_report.truncated_by_policy} truncados`);
for (const r of recs.universe_report.rejected) console.log(`  rejeitado ${r.ticker}: ${r.reasons.join('; ')}`);
for (const r of recs.universe_report.not_screened) console.log(`  nao avaliado ${r.ticker}: ${r.reason}`);

console.log(`\nRECOMENDACOES (${recs.recommendations.length}):`);
for (const r of recs.recommendations) {
  console.log(`\n  #${r.priority} [${r.action}] ${r.headline}${r.amount_brl ? '  ' + brl(r.amount_brl) : ''}`);
  for (const line of r.rationale_inputs) console.log(`      . ${line}`);
}

const failing = heldScreen.filter((h) => h.status === 'fails_profile_screen');
const failingValue = failing.reduce((sum, h) => sum + h.market_value, 0);
const sleeveValue = heldPositions.reduce((sum, h) => sum + h.market_value, 0);
console.log('\nPENEIRA DE PERFIL APLICADA AO QUE ELE JA TEM:');
for (const h of heldScreen) {
  const tag = h.status === 'meets_profile_screen' ? 'ATENDE' : h.status === 'not_screened' ? 'S/DADO' : 'FALHA ';
  console.log('  ' + tag + '  ' + h.ticker.padEnd(7) + (h.via_successor ? '(via ' + h.via_successor + ') ' : '') + brl(h.market_value).padStart(14) + '  ' + pct(h.weight).padStart(7));
  for (const r of h.reasons ?? []) console.log('          ' + r);
}
console.log('  => ' + brl(failingValue) + ', ' + pct(failingValue / sleeveValue) + ' do bolso de acoes, em nomes que nao passam no criterio que a carta cita para justificar compras.');
