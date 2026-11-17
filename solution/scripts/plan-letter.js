import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { planLetter } from '../src/engine/letter-plan.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => JSON.parse(readFileSync(resolve(root, 'out', f), 'utf8'));

const plan = planLetter({
  metrics: read('metrics.json'),
  suitability: read('suitability.json'),
  recommendations: read('recommendations.json'),
  portfolio: read('portfolio.json'),
  market: read('market.json'),
  policy: JSON.parse(readFileSync(resolve(root, 'config/suitability-policy.json'), 'utf8')),
});

writeFileSync(resolve(root, 'out/letter-plan.json'), JSON.stringify(plan, null, 2), 'utf8');

// One file per prompt. The Rivet graph reads these directly, so each node sees
// only what its own instructions name.
for (const [name, payload] of Object.entries(plan.prompt_payloads)) {
  const path = resolve(root, 'out', 'prompt-' + name + '.json');
  writeFileSync(path, JSON.stringify(payload, null, 2), 'utf8');
  console.log('  prompt-' + name + '.json  ' + JSON.stringify(payload).length + ' chars');
}

const L = plan.letter, A = plan.advisor_annex;
console.log(`CARTA AO CLIENTE (orcamento ${plan.budget.max_words} palavras)`);
console.log(`  achados        : ${L.findings.length}  ${L.findings.map((f) => f.code).join(', ')}`);
console.log(`  recomendacoes  : ${L.recommendations.length}  ${L.recommendations.map((r) => r.id).join(', ')}`);
console.log(`  atribuicao     : ${L.attribution.contributors.length} contrib + ${L.attribution.detractors.length} detrator + ${L.attribution.remainder ? L.attribution.remainder.count + ' demais' : 'sem linha residual'}`);
console.log(`  benchmarks     : ${Object.keys(L.benchmarks).join(', ')}`);
console.log(`  disclosures    : ${L.disclosures.length} obrigatorias`);
console.log(`\nANEXO DO ASSESSOR`);
console.log(`  achados        : ${A.findings.length}`);
console.log(`  recomendacoes  : ${A.recommendations.length}`);
console.log(`  flags de dados : ${A.data_quality_flags.length}`);
console.log(`\nOMISSOES DECLARADAS (${plan.omissions.length})`);
for (const o of plan.omissions) console.log(`  ${o.kind} (${o.count})${o.disclosure_pt ? '\n      "' + o.disclosure_pt + '"' : '  [operacional, nao vai para o cliente]'}`);
console.log(`\nCHECAGEM: linhas mostradas + residual = ${plan.checks.shown_plus_remainder_pp} p.p. vs manchete ${plan.checks.headline_pp} p.p. -> ${plan.checks.attribution_reconciles ? 'FECHA' : 'NAO FECHA'}`);
