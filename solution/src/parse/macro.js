/**
 * Parser for XP's monthly macro research report ("XP - Macro analysis.txt").
 *
 * WHY WE PARSE THIS INSTEAD OF ASKING AN LLM FOR THE NUMBERS
 * ----------------------------------------------------------
 * This is the single document the v1 workflow contradicted. Its letter claimed
 * a Selic settling at 9%, a BRL at 4.70 and 2025 inflation at 4.0%, while the
 * report in front of it projects 15.50%, 6.20 and 6.1%. Those figures are not
 * in the source file at all - the model answered from pre-training memory and
 * discarded the document.
 *
 * The fix is not a better prompt. It is to stop asking a language model for a
 * number that a table already contains. The "Projeções XP" table is extracted
 * deterministically here; the LLM is later given only the narrative prose to
 * summarise, and is never the origin of a figure.
 *
 * TABLE LAYOUT IN THE EXTRACTED TEXT
 * ----------------------------------
 * The PDF table is flattened one cell per line:
 *
 *     Projeções XP
 *     2018 ... 2023                       <- six historical year headers
 *     Crescimento do PIB (var. real %)
 *     1,8 ... 3,2                         <- six values
 *     2024 (P) 2025 (P) 2026 (P)          <- projection header, stranded mid-table
 *     3,6  2,0  1,0                       <- three values
 *     Taxa de desemprego (...)
 *     12,1 ... 7,8                        <- nine values, uninterrupted
 *
 * Only the first data row is split by that stranded header. Reading "the next
 * nine numeric lines, skipping any non-numeric line" handles both shapes with
 * one rule. The whole table is repeated later in the document; we take the
 * first occurrence and verify the second agrees when present.
 */

import { parseAmbiguousNumber, parseBrDate, round } from '../lib/numbers.js';

const TABLE_ANCHOR = 'Projeções XP';

/** Years covered by the projection table, in column order. */
const TABLE_YEARS = [2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026];

/**
 * Row labels we extract, mapped to the canonical indicator names used
 * everywhere downstream (and matching the Focus indicator vocabulary where a
 * comparison is meaningful).
 */
const TRACKED_ROWS = [
  { match: /^Crescimento do PIB/i, indicator: 'PIB Total', unit: 'percent_year' },
  { match: /^IPCA \(var\. 12m/i, indicator: 'IPCA', unit: 'percent_year' },
  { match: /^SELIC \(% a\.a/i, indicator: 'Selic', unit: 'percent_year' },
  { match: /^Taxa de Câmbio/i, indicator: 'Câmbio', unit: 'brl_per_usd' },
  { match: /^Dívida bruta/i, indicator: 'Dívida bruta (DBGG)', unit: 'percent_gdp' },
  { match: /^Taxa de desemprego/i, indicator: 'Desemprego', unit: 'percent' },
];

/** A line that is a bare number in BR notation, possibly negative. */
const NUMERIC_LINE = /^-?\d{1,3}(?:\.\d{3})*(?:,\d+)?$|^-?\d+(?:,\d+)?$/;

function toLines(raw) {
  return raw
    .replace(/\r/g, '')
    .split('\n')
    .map((l) => l.replace(/\f/g, '').replace(/ /g, ' ').trim())
    .filter((l) => l.length > 0);
}

/**
 * Read `count` numeric values starting at `from`, skipping non-numeric lines
 * (the stranded projection header). Stops early if it meets another row label,
 * which prevents a malformed table from silently borrowing the next row's data.
 */
function readValues(lines, from, count, flags, label) {
  const values = [];
  let i = from;
  let skipped = 0;

  while (i < lines.length && values.length < count) {
    const line = lines[i];

    if (NUMERIC_LINE.test(line)) {
      values.push(parseAmbiguousNumber(line));
      i += 1;
      continue;
    }

    // Another tracked row label means this row ended short.
    if (TRACKED_ROWS.some((r) => r.match.test(line))) break;

    skipped += 1;
    if (skipped > 3) break; // a long non-numeric run means we left the table
    i += 1;
  }

  if (values.length !== count) {
    flags.push({
      code: 'macro_row_incomplete',
      severity: 'error',
      detail: `"${label}": expected ${count} values, read ${values.length}.`,
    });
    return null;
  }
  return { values, next: i };
}

/** Extract one projections table starting at `anchorIdx`. */
function readTable(lines, anchorIdx, flags) {
  const table = {};
  for (const row of TRACKED_ROWS) {
    const labelIdx = lines.findIndex((l, k) => k > anchorIdx && row.match.test(l));
    if (labelIdx === -1) {
      flags.push({
        code: 'macro_row_missing',
        severity: 'warning',
        detail: `Row "${row.indicator}" not found in the projections table.`,
      });
      continue;
    }
    const read = readValues(lines, labelIdx + 1, TABLE_YEARS.length, flags, row.indicator);
    if (!read) continue;

    table[row.indicator] = {
      indicator: row.indicator,
      unit: row.unit,
      by_year: Object.fromEntries(TABLE_YEARS.map((y, i) => [y, read.values[i]])),
      source_line: labelIdx + 1,
    };
  }
  return table;
}

/**
 * @param {string} raw full contents of the macro report .txt
 * @returns {object} the house-view contract consumed by the market layer
 */
export function parseMacro(raw) {
  const flags = [];
  const lines = toLines(raw);

  // --- report identity ----------------------------------------------------
  const reportDate = parseBrDateLong(lines[0]);
  if (!reportDate) {
    flags.push({
      code: 'macro_report_date_not_found',
      severity: 'warning',
      detail: `Could not read a publication date from the first line: "${lines[0]}"`,
    });
  }
  const title = lines.find((l) => /^Brasil Macro Mensal/i.test(l)) ?? null;
  const subtitle = title ? lines[lines.indexOf(title) + 1] ?? null : null;

  // --- projections table --------------------------------------------------
  const anchors = lines
    .map((l, i) => (l === TABLE_ANCHOR ? i : -1))
    .filter((i) => i !== -1);

  if (anchors.length === 0) {
    flags.push({
      code: 'macro_table_missing',
      severity: 'error',
      detail: `Anchor "${TABLE_ANCHOR}" not found; no house view could be extracted.`,
    });
    return { report_date: reportDate, title, subtitle, house_view: {}, data_quality_flags: flags };
  }

  const table = readTable(lines, anchors[0], flags);

  // The report reprints the table later. When it does, disagreement between
  // the two copies means our column mapping is wrong, so we check rather than
  // assume.
  if (anchors.length > 1) {
    const second = readTable(lines, anchors[1], []);
    for (const [indicator, row] of Object.entries(table)) {
      const other = second[indicator];
      if (!other) continue;
      for (const year of TABLE_YEARS) {
        if (row.by_year[year] !== other.by_year[year]) {
          flags.push({
            code: 'macro_table_copies_disagree',
            severity: 'error',
            detail:
              `${indicator} ${year}: first copy says ${row.by_year[year]}, ` +
              `second says ${other.by_year[year]}. Column alignment is unreliable.`,
          });
        }
      }
    }
  }

  return {
    report_date: reportDate,
    title,
    subtitle,
    house_view: table,
    projection_years: TABLE_YEARS,
    data_quality_flags: flags,
    source: 'XP Macro Research monthly report (text extraction)',
  };
}

/**
 * House view for one indicator and year, in the shape the market layer expects.
 * Returns null when the report does not carry that projection, so the caller
 * can omit the comparison instead of inventing one.
 */
export function houseValue(macro, indicator, year) {
  const row = macro.house_view?.[indicator];
  const value = row?.by_year?.[year];
  return Number.isFinite(value) ? round(value, 4) : null;
}

const MONTHS_PT = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

/** "6 de fevereiro de 2025" -> "2025-02-06". */
function parseBrDateLong(line) {
  const iso = parseBrDate(line ?? '');
  if (iso) return iso;

  const m = String(line ?? '')
    .toLowerCase()
    .match(/(\d{1,2})\s+de\s+([a-zç]+)\s+de\s+(\d{4})/);
  if (!m) return null;

  const monthIdx = MONTHS_PT.indexOf(m[2]);
  if (monthIdx === -1) return null;
  return `${m[3]}-${String(monthIdx + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}
