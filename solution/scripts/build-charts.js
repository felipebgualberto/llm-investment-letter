import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { proposedAllocation } from '../src/engine/proposed-allocation.js';
import { attributionChart, benchmarkChart, consensusHistoryChart, allocationChart, consensusRangeChart, positionsChart, allocationShiftChart } from '../src/render/charts.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => JSON.parse(readFileSync(resolve(root, 'out', f), 'utf8'));
const plan = read('letter-plan.json');
const metrics = read('metrics.json');
const market = read('market.json');
const macro = read('macro.json');

mkdirSync(resolve(root, 'out/charts'), { recursive: true });
const write = (name, svg) => {
  writeFileSync(resolve(root, 'out/charts', `${name}.svg`), svg, 'utf8');
  console.log(`  ${name}.svg  ${(svg.length / 1024).toFixed(1)} KB`);
};

console.log('charts:');
write('attribution', attributionChart(plan, { bySleeve: metrics.by_sleeve }));
write('benchmarks', benchmarkChart(metrics));
write('allocation', allocationChart(metrics, read('portfolio.json')));

// Every position the client holds, for the letter. Returns null if the
// portfolio carries no net worth to divide, in which case the letter simply
// renders without it rather than with an empty circle.
const positions = positionsChart(read('portfolio.json'), { concentration: metrics.concentration });

// The before/after pair: what the proposals would actually do to the shape of
// the portfolio. Null when nothing in the letter reallocates.
const proposed = proposedAllocation(read('portfolio.json'), plan.letter.recommendations);
const shift = allocationShiftChart(read('portfolio.json'), proposed);
if (shift) write('allocation-shift', shift);
else console.log('  (no reallocating proposal - allocation-shift not drawn)');
if (positions) write('positions', positions);
const range = consensusRangeChart(market.house_view_vs_consensus ?? []);
if (range) write('consensus', range);

// The forensic chart: the consensus the v1 recited, against the document it ignored.
const V1_PUBLISHED = { Selic: 9.0, IPCA: 4.0 };
for (const indicator of ['Selic', 'IPCA']) {
  const history = market.consensus_history?.[indicator];
  if (!history) continue;
  write(
    `consensus-${indicator.toLowerCase()}`,
    consensusHistoryChart(history, {
      houseValue: macro.house_view?.[indicator]?.by_year?.[history.reference_year],
      houseLabel: `XP (fev/${String(macro.report_date).slice(2, 4)})`,
      markValue: V1_PUBLISHED[indicator],
      markLabel: 'carta v1',
    }),
  );
}
