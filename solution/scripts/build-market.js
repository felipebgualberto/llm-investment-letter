import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deriveReferenceDate, referenceOverrideFromArgv } from '../src/lib/reference.js';
import { parseMacro } from '../src/parse/macro.js';
import { parsePortfolio } from '../src/parse/portfolio.js';
import { buildMarketSnapshot } from '../src/data/market.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const inputs = resolve(root, '../Input');

const referenceOverride = referenceOverrideFromArgv();
const refresh = process.argv.includes('--refresh');

const macro = parseMacro(readFileSync(resolve(inputs, 'XP - Macro analysis.txt'), 'utf8'));
const portfolio = parsePortfolio(readFileSync(resolve(inputs, 'XP - Albert_s portfolio.txt'), 'utf8'));

// Reference month comes from the statement, not the wall clock. See src/lib/reference.js.
const reference = deriveReferenceDate(portfolio, { override: referenceOverride });
const referenceDate = reference.date;
const tickers = portfolio.holdings.filter((h) => h.sleeve === 'stocks').map((h) => h.ticker);

const snapshot = await buildMarketSnapshot({ referenceDate, macro, tickers, refresh });

mkdirSync(resolve(root, 'out'), { recursive: true });
writeFileSync(resolve(root, 'out/macro.json'), JSON.stringify(macro, null, 2), 'utf8');
writeFileSync(resolve(root, 'out/market.json'), JSON.stringify(snapshot, null, 2), 'utf8');
console.log(`reference month ${snapshot.reference_month} | warnings: ${snapshot.warnings.length}`);
