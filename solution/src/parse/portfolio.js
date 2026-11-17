/**
 * Parser for the XP position statement (Input/XP - Albert_s portfolio.txt).
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The v1 workflow fed this raw text straight into an LLM and asked it to both
 * EXTRACT the figures and NARRATE them. Extraction is exactly what an LLM is
 * worst at and, critically, it fails silently: a missing field is replaced by a
 * plausible invention rather than an error. This parser turns the text into a
 * validated JSON contract so that every downstream number is traceable to a
 * line in the source file, and so that a broken statement fails LOUDLY.
 *
 * WHAT THE SOURCE ACTUALLY LOOKS LIKE
 * -----------------------------------
 * The .txt is a PDF text-extraction artefact. Every table cell sits on its own
 * line, and the two PDF columns were flattened into two sequential halves:
 *
 *   HALF A  names, market values, weights, since-inception returns
 *   HALF B  investment dates, average/last prices, quantities, applied amounts
 *
 * The halves are joined BY ORDINAL POSITION within each sleeve, because the
 * text carries no key linking them. That join is then independently verified
 * (see reconcile) - if the arithmetic does not close, we raise a flag instead
 * of trusting the join.
 *
 * KNOWN DEFECTS IN THE SOURCE, HANDLED HERE
 * -----------------------------------------
 *   1. Two decimal conventions in one file -> src/lib/numbers.js
 *   2. The last fund block is INVERTED: value/weight/return come BEFORE the
 *      name (Ibiuna Hedge ST Advisory FIC FIM). Handled by classifying tokens
 *      by type inside each 4-token chunk rather than by fixed offset.
 *   3. The three fund sub-tables lost their category headers in extraction.
 *      Category is recovered by name heuristic and labelled as such, never
 *      presented as if it came from the statement.
 *   4. Stale dates (fund quota 2024-04-04 on a 2025-05-07 statement; a CDB that
 *      matured 2024-09-05). Flagged, never silently corrected.
 */

import {
  parseMoney,
  parsePercent,
  parseBrDate,
  round,
  closeTo,
} from '../lib/numbers.js';

// ---------------------------------------------------------------------------
// Line classification
// ---------------------------------------------------------------------------

const isMoney = (l) => /^R\$\s?[\d.,]+$/.test(l);
const isPercent = (l) => /^-?[\d.,]+%$/.test(l);
const isDate = (l) => /^\d{2}\/\d{2}\/\d{4}/.test(l);
const isInteger = (l) => /^\d+$/.test(l);

const SECTION_STOCKS = 'Ações';
const SECTION_FUNDS = 'Fundos de Investimentos';
const SECTION_FIXED = 'Renda Fixa';

/** Column labels that repeat inside the body and must not be read as data. */
const COLUMN_LABELS = new Set([
  'Posição',
  'Posição a mercado',
  '% Alocação',
  'Rentabilidade',
  'Rentabilidade (%)',
  'Valor aplicado',
  'Valor líquido',
  'Data da cota',
  'Data do investimento',
  'Preço médio',
  'Último preço (R$)',
  'Qtd. total',
  'Taxa a mercado',
  'Data aplicação',
  'Data vencimento',
  'Total investido',
  'Saldo Disponível',
]);

/**
 * Normalise the raw file into an ordered array of meaningful lines.
 * Drops blank lines, form feeds (page breaks) and non-breaking spaces.
 */
function toLines(raw) {
  return raw
    .replace(/\r/g, '')
    .split('\n')
    .map((l) => l.replace(/\f/g, '').replace(/ /g, ' ').trim())
    .filter((l) => l.length > 0);
}

// ---------------------------------------------------------------------------
// Fund category recovery
// ---------------------------------------------------------------------------

/**
 * The fund sub-table headers were lost during PDF extraction, so the category
 * is inferred from the legal name. Order matters: a fund can be both "FIM" and
 * "Long Bias", and the strategy label wins.
 */
function inferFundCategory(name) {
  const n = name.toLowerCase();
  if (/long bias|long biased|\bfia\b/.test(n)) return 'equity';
  if (/firf|ref di|simples|renda fixa/.test(n)) return 'fixed_income';
  if (/hedge|\bfim\b|multimercado/.test(n)) return 'multimarket';
  return 'unclassified';
}

// ---------------------------------------------------------------------------
// HALF A - names, market values, weights, since-inception returns
// ---------------------------------------------------------------------------

/** Split a token run into consecutive chunks of `size`. */
function chunk(tokens, size) {
  const out = [];
  for (let i = 0; i < tokens.length; i += size) out.push(tokens.slice(i, i + size));
  return out;
}

/**
 * Read one holding out of a 4-token chunk of the form
 *   [name, money, weight%, return%]   (normal order)
 *   [money, weight%, return%, name]   (the inverted Ibiuna block)
 *
 * Tokens are classified BY TYPE, not by offset, which makes the reader immune
 * to the ordering defect. The two percentages keep their relative file order;
 * whether that order is correct is decided later by reconcile, which can detect
 * and repair a swap using an independent identity.
 */
function readHolding(tokens4, flags, context) {
  const name = tokens4.find((t) => !isMoney(t) && !isPercent(t));
  const money = tokens4.find(isMoney);
  const percents = tokens4.filter(isPercent);

  if (!name || !money || percents.length !== 2) {
    flags.push({
      code: 'holding_chunk_unreadable',
      severity: 'error',
      detail: `Could not read a holding in ${context}: ${JSON.stringify(tokens4)}`,
    });
    return null;
  }

  if (tokens4.indexOf(name) !== 0) {
    flags.push({
      code: 'source_row_order_inverted',
      severity: 'info',
      detail: `"${name}" appears after its values in the source file; recovered by type-based reading.`,
    });
  }

  return {
    name,
    market_value: parseMoney(money),
    weight_stated: parsePercent(percents[0]),
    return_since_purchase_stated: parsePercent(percents[1]),
  };
}

/** Extract the lines belonging to a section, exclusive of the next one. */
function sectionSlice(lines, startLabel, endLabels) {
  const start = lines.indexOf(startLabel);
  if (start === -1) return null;
  let end = lines.length;
  for (const label of endLabels) {
    const i = lines.findIndex((l, k) => k > start && l.startsWith(label));
    if (i !== -1 && i < end) end = i;
  }
  return { start, end, body: lines.slice(start + 1, end) };
}

function parseHalfA(lines, flags) {
  const result = { client: {}, advisor: {}, totals: {}, sleeve_weights: {}, holdings: [] };

  // --- header -------------------------------------------------------------
  const titleMatch = lines[0]?.match(/^(.+?),\s*este é o seu patrimônio/);
  if (titleMatch) {
    result.client.name = titleMatch[1].trim();
  } else {
    flags.push({
      code: 'client_name_not_found',
      severity: 'error',
      detail: `First line did not match the expected title pattern: "${lines[0]}"`,
    });
  }

  // The first three money lines are, in file order:
  //   net worth, invested amount, available cash.
  // The identity invested + cash === net worth is verified in reconcile.
  const headerMoney = lines.slice(0, 20).filter(isMoney).slice(0, 3).map(parseMoney);
  const [netWorth, invested, cash] = headerMoney;
  result.totals = { net_worth: netWorth, invested, available_cash: cash };

  // --- account / advisor --------------------------------------------------
  const accountLine = lines.find((l) => /^Conta:/.test(l));
  if (accountLine) {
    const m = accountLine.match(/^Conta:\s*(\S+)\s*\|\s*(.+)$/);
    result.client.account = m?.[1] ?? null;
    result.statement_date = parseBrDate(m?.[2] ?? '');
  }
  const advisorCodeIdx = lines.indexOf('Código do Assessor');
  if (advisorCodeIdx !== -1) result.advisor.code = lines[advisorCodeIdx + 1] ?? null;
  const advisorNameIdx = lines.indexOf('Nome do assessor');
  if (advisorNameIdx !== -1) result.advisor.name = lines[advisorNameIdx + 1] ?? null;

  // --- stocks -------------------------------------------------------------
  const stocks = sectionSlice(lines, SECTION_STOCKS, [SECTION_FUNDS]);
  if (stocks) {
    result.sleeve_weights.stocks = parsePercent(stocks.body[0]);
    const tokens = stocks.body.slice(1).filter((l) => !COLUMN_LABELS.has(l));
    for (const c of chunk(tokens, 4)) {
      const h = readHolding(c, flags, 'stocks');
      if (h) result.holdings.push({ sleeve: 'stocks', ticker: h.name, ...h });
    }
  }

  // --- funds --------------------------------------------------------------
  const funds = sectionSlice(lines, SECTION_FUNDS, [SECTION_FIXED]);
  if (funds) {
    result.sleeve_weights.funds = parsePercent(funds.body[0]);
    const tokens = funds.body.slice(1).filter((l) => !COLUMN_LABELS.has(l));
    for (const c of chunk(tokens, 4)) {
      const h = readHolding(c, flags, 'funds');
      if (h) {
        result.holdings.push({
          sleeve: 'funds',
          category: inferFundCategory(h.name),
          category_source: 'name_heuristic',
          ...h,
        });
      }
    }
  }

  // --- fixed income -------------------------------------------------------
  // Layout differs: [name, <3 column labels>, market value, weight, applied].
  const fixed = sectionSlice(lines, SECTION_FIXED, ['Conta:']);
  if (fixed) {
    result.sleeve_weights.fixed_income = parsePercent(fixed.body[0]);
    const rest = fixed.body.slice(1);
    const name = rest.find((l) => !COLUMN_LABELS.has(l) && !isMoney(l) && !isPercent(l));
    const values = rest.filter((l) => isMoney(l) || isPercent(l));
    if (name && values.length >= 3) {
      result.holdings.push({
        sleeve: 'fixed_income',
        name,
        market_value: parseMoney(values[0]),
        weight_stated: parsePercent(values[1]),
        applied_amount: parseMoney(values[2]),
      });
    } else {
      flags.push({
        code: 'fixed_income_unreadable',
        severity: 'error',
        detail: 'Could not read the fixed income block.',
      });
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// HALF B - detail tables
// ---------------------------------------------------------------------------

/**
 * Half B is a sequence of [header block][data rows] groups. Header blocks are
 * identified by a signature label; data rows always start with a date, which is
 * what tells us where a run of rows ends.
 */
function parseHalfB(lines, startIndex, flags) {
  const detail = { stocks: [], funds: [], fixed_income: [] };
  let i = startIndex;

  while (i < lines.length) {
    const line = lines[i];

    if (line === 'Preço médio') {
      i = consumeRows(lines, i, 4, (row) => {
        detail.stocks.push({
          investment_date: parseBrDate(row[0]),
          average_price: parseMoney(row[1]),
          last_price: parseMoney(row[2]),
          quantity: isInteger(row[3]) ? Number(row[3]) : NaN,
        });
      });
      continue;
    }

    if (line === 'Valor líquido') {
      i = consumeRows(lines, i, 4, (row) => {
        detail.funds.push({
          investment_date: parseBrDate(row[0]),
          applied_amount: parseMoney(row[1]),
          net_value: parseMoney(row[2]),
          quota_date: parseBrDate(row[3]),
        });
      });
      continue;
    }

    if (line === 'Taxa a mercado') {
      i = consumeRows(lines, i, 4, (row) => {
        detail.fixed_income.push({
          investment_date: parseBrDate(row[0]),
          rate: row[1],
          start_date: parseBrDate(row[2]),
          maturity_date: parseBrDate(row[3]),
        });
      });
      continue;
    }

    i += 1;
  }

  if (detail.stocks.length === 0) {
    flags.push({
      code: 'detail_tables_missing',
      severity: 'error',
      detail: 'Half B of the statement produced no stock detail rows.',
    });
  }

  return detail;
}

/**
 * Skip to the end of the current header block, then consume fixed-width rows
 * for as long as the next token is a date. Returns the new cursor.
 */
function consumeRows(lines, headerIdx, width, emit) {
  let i = headerIdx;
  while (i < lines.length && COLUMN_LABELS.has(lines[i])) i += 1;

  while (i + width <= lines.length && isDate(lines[i])) {
    const row = lines.slice(i, i + width);
    if (row.some((t) => COLUMN_LABELS.has(t))) break;
    emit(row);
    i += width;
  }
  return i;
}

// ---------------------------------------------------------------------------
// Join + reconciliation
// ---------------------------------------------------------------------------

/** Tolerances are absolute and deliberately tight; they exist for rounding only. */
const TOL = {
  money: 5.0,       // R$ - the statement rounds prices to 2dp, so qty*price drifts
  weight: 0.0001,   // 1 basis point
  rate: 0.0002,     // 2 basis points
};

/**
 * Attach Half B detail to Half A holdings by ordinal position within each
 * sleeve, then verify the join with identities the statement must satisfy.
 */
function joinAndReconcile(halfA, detail, flags) {
  const cursor = { stocks: 0, funds: 0, fixed_income: 0 };

  for (const h of halfA.holdings) {
    const idx = cursor[h.sleeve]++;
    const d = detail[h.sleeve]?.[idx];
    if (!d) {
      flags.push({
        code: 'detail_row_missing',
        severity: 'error',
        detail: `No detail row for ${h.ticker ?? h.name} (${h.sleeve} #${idx}).`,
      });
      continue;
    }
    Object.assign(h, d);
  }

  reconcile(halfA, flags);
  return halfA;
}

function reconcile(p, flags) {
  const { totals } = p;

  // 1. invested + cash === net worth
  if (!closeTo(totals.invested + totals.available_cash, totals.net_worth, 0.01)) {
    flags.push({
      code: 'totals_do_not_add_up',
      severity: 'error',
      detail: `invested (${totals.invested}) + cash (${totals.available_cash}) != net worth (${totals.net_worth}).`,
    });
  }

  // 2. sum of holdings === invested
  const sumHoldings = p.holdings.reduce((s, h) => s + (h.market_value || 0), 0);
  if (!closeTo(sumHoldings, totals.invested, 0.01)) {
    flags.push({
      code: 'holdings_sum_mismatch',
      severity: 'error',
      detail: `Holdings sum to ${round(sumHoldings)} but invested total is ${totals.invested}.`,
    });
  }

  for (const h of p.holdings) {
    const label = h.ticker ?? h.name;

    // 3. weight === market value / invested. This identity is also how we
    //    detect (and repair) a weight/return column swap in the source.
    const computedWeight = h.market_value / totals.invested;
    if (!closeTo(computedWeight, h.weight_stated, TOL.weight)) {
      if (closeTo(computedWeight, h.return_since_purchase_stated, TOL.weight)) {
        flags.push({
          code: 'weight_return_columns_swapped',
          severity: 'warning',
          detail: `${label}: weight and return columns were swapped in the source; corrected.`,
        });
        const tmp = h.weight_stated;
        h.weight_stated = h.return_since_purchase_stated;
        h.return_since_purchase_stated = tmp;
      } else {
        flags.push({
          code: 'weight_mismatch',
          severity: 'warning',
          detail: `${label}: stated weight ${h.weight_stated} vs computed ${round(computedWeight, 6)}.`,
        });
      }
    }
    h.weight = round(computedWeight, 6);

    // 4. stocks: quantity * last price === market value
    if (h.sleeve === 'stocks' && Number.isFinite(h.quantity)) {
      const computedValue = h.quantity * h.last_price;
      if (!closeTo(computedValue, h.market_value, TOL.money)) {
        flags.push({
          code: 'position_value_mismatch',
          severity: 'warning',
          detail: `${label}: ${h.quantity} x ${h.last_price} = ${round(computedValue)} vs stated ${h.market_value}.`,
        });
      }
      // 5. stocks: stated return === last price / average price - 1
      const computedReturn = h.last_price / h.average_price - 1;
      if (!closeTo(computedReturn, h.return_since_purchase_stated, TOL.rate)) {
        flags.push({
          code: 'return_definition_mismatch',
          severity: 'warning',
          detail: `${label}: computed since-purchase return ${round(computedReturn, 4)} vs stated ${h.return_since_purchase_stated}.`,
        });
      }
      h.return_since_purchase = round(computedReturn, 6);
    }

    // 6. funds: stated return === market value / applied amount - 1.
    //    This is the check that validates the ordinal join between the halves.
    if (h.sleeve === 'funds' && Number.isFinite(h.applied_amount)) {
      const computedReturn = h.market_value / h.applied_amount - 1;
      if (!closeTo(computedReturn, h.return_since_purchase_stated, TOL.rate)) {
        flags.push({
          code: 'fund_join_unverified',
          severity: 'error',
          detail: `${label}: applied ${h.applied_amount} implies ${round(computedReturn, 4)} but the statement says ${h.return_since_purchase_stated}. The Half A / Half B join may be wrong.`,
        });
      } else {
        h.return_since_purchase = round(computedReturn, 6);
      }
    }
  }

  // 7. staleness checks against the statement date
  const stmt = p.statement_date;
  if (stmt) {
    for (const h of p.holdings) {
      if (h.quota_date && h.quota_date < stmt) {
        const days = daysBetween(h.quota_date, stmt);
        if (days > 45) {
          flags.push({
            code: 'stale_quota_date',
            severity: 'warning',
            detail: `${h.name}: quota dated ${h.quota_date}, ${days} days before the statement date ${stmt}. Monthly performance cannot be derived from this figure.`,
          });
        }
      }
      if (h.maturity_date && h.maturity_date < stmt) {
        flags.push({
          code: 'matured_instrument_still_listed',
          severity: 'warning',
          detail: `${h.name}: matured on ${h.maturity_date}, before the statement date ${stmt}.`,
        });
      }
    }
  }

  // 8. idle cash is an opportunity, not an error - surfaced for the engine
  if (totals.available_cash > 0 && totals.net_worth > 0) {
    p.cash_share_of_net_worth = round(totals.available_cash / totals.net_worth, 6);
  }
}

function daysBetween(isoA, isoB) {
  const a = new Date(`${isoA}T00:00:00Z`).getTime();
  const b = new Date(`${isoB}T00:00:00Z`).getTime();
  return Math.round(Math.abs(b - a) / 86_400_000);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * @param {string} raw full contents of the statement .txt
 * @returns {object} the portfolio contract consumed by the rest of the pipeline
 */
export function parsePortfolio(raw) {
  const flags = [];
  const lines = toLines(raw);

  const halfA = parseHalfA(lines, flags);

  // Half B begins right after the advisor name, which closes Half A.
  const advisorNameIdx = lines.indexOf('Nome do assessor');
  const halfBStart = advisorNameIdx === -1 ? lines.length : advisorNameIdx + 2;
  const detail = parseHalfB(lines, halfBStart, flags);

  const portfolio = joinAndReconcile(halfA, detail, flags);

  portfolio.sleeve_totals = {};
  for (const sleeve of ['stocks', 'funds', 'fixed_income']) {
    const items = portfolio.holdings.filter((h) => h.sleeve === sleeve);
    portfolio.sleeve_totals[sleeve] = {
      market_value: round(items.reduce((s, h) => s + h.market_value, 0)),
      weight: round(items.reduce((s, h) => s + (h.weight || 0), 0), 6),
      count: items.length,
    };
  }

  portfolio.data_quality_flags = flags;
  portfolio.source = 'XP position statement (text extraction)';
  return portfolio;
}
