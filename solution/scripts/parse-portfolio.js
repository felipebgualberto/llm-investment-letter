import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePortfolio } from '../src/parse/portfolio.js';
import { assertNoErrors } from '../src/lib/guard.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const input = process.argv[2] ?? resolve(root, '../Input/XP - Albert_s portfolio.txt');
const outPath = resolve(root, 'out/portfolio.json');

const raw = readFileSync(input, 'utf8');
const portfolio = parsePortfolio(raw);

assertNoErrors('parse-portfolio', portfolio.data_quality_flags);

mkdirSync(resolve(root, 'out'), { recursive: true });
writeFileSync(outPath, JSON.stringify(portfolio, null, 2), 'utf8');
console.log(`wrote ${outPath}`);
