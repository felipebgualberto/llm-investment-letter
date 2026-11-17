import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deriveReferenceDate, referenceOverrideFromArgv } from '../src/lib/reference.js';
import { parsePortfolio } from '../src/parse/portfolio.js';
import { measureFunds } from '../src/data/cvm.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const referenceOverride = referenceOverrideFromArgv();
const refresh = process.argv.includes('--refresh');

const portfolio = parsePortfolio(
  readFileSync(resolve(root, '../Input/XP - Albert_s portfolio.txt'), 'utf8'),
);

// Reference month comes from the statement, not the wall clock. See src/lib/reference.js.
const reference = deriveReferenceDate(portfolio, { override: referenceOverride });
const referenceDate = reference.date;
const funds = portfolio.holdings.filter((h) => h.sleeve === 'funds');

console.log(`resolving ${funds.length} funds as of the statement date ${portfolio.statement_date}...\n`);
const out = await measureFunds(funds, referenceDate, {
  statementDate: portfolio.statement_date,
  refresh,
});
writeFileSync(resolve(root, 'out/funds.json'), JSON.stringify(out, null, 2), 'utf8');

for (const r of out.results) {
  const w = ((r.weight ?? 0) * 100).toFixed(2) + '%';
  const label = r.statement_name.slice(0, 43).padEnd(43);
  if (r.status === 'measured') {
    console.log(`  OK        ${label} ${w.padStart(7)} ${(r.value * 100).toFixed(3).padStart(8)}%  [${r.dataset}]`);
    console.log(`            cnpj ${r.cnpj} | ${r.shareholders} cotistas | nome via ${r.name_source}`);
    if (r.renamed) console.log(`            RENOMEADO -> hoje se chama "${r.current_name}"`);
    if (r.target_investor) console.log(`            publico-alvo declarado: ${r.target_investor}`);
    if (r.cross_check?.status) console.log(`            cross-check da cota: ${r.cross_check.status}`);
  } else {
    console.log(`  ${r.status.toUpperCase().padEnd(9)} ${label} ${w.padStart(7)}`);
    console.log(`            ${r.reason}`);
  }
}
const c = out.coverage;
console.log(
  `\ncoverage: ${c.measured_count}/${c.total_count} fundos | ` +
  `${(c.measured_weight * 100).toFixed(2)}% do investido | ` +
  `${(c.share_of_sleeve * 100).toFixed(1)}% do bolso de fundos`,
);
