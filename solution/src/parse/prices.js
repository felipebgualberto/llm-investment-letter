/**
 * Parser for the price file supplied with the challenge
 * (Input/profitability_calc_wip.csv).
 *
 * The v1 workflow never opened this file. It is the only input carrying BOTH a
 * current and a prior-month price, which makes it the single source from which
 * a monthly equity return can be derived at all. Everything the v1 letter said
 * about performance was therefore unsourced by construction.
 *
 * The file has a second, unadvertised use. It lists twelve tickers while the
 * client holds four, so the remaining eight are an implicit recommendation
 * universe - the names XP is willing to price for this client. The engine uses
 * them as buy candidates rather than inventing names of its own.
 */

import { parseAmbiguousNumber, round } from '../lib/numbers.js';

/**
 * Minimal RFC 4180 reader: quoted fields, escaped quotes, CRLF or LF.
 * Written out rather than regex-split because a price file with a quoted
 * company name would silently shift every column.
 */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  // Strip a UTF-8 BOM, which Excel writes and which would otherwise become
  // part of the first header name.
  const input = text.replace(/^﻿/, '');

  for (let i = 0; i < input.length; i += 1) {
    const c = input[i];

    if (quoted) {
      if (c === '"') {
        if (input[i + 1] === '"') { field += '"'; i += 1; }
        else quoted = false;
      } else field += c;
      continue;
    }

    if (c === '"') { quoted = true; continue; }
    if (c === ',') { row.push(field); field = ''; continue; }
    if (c === '\r') continue;
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += c;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }

  return rows.filter((r) => r.some((cell) => cell.trim().length > 0));
}

/**
 * @param {string} raw contents of the price CSV
 * @returns {{prices: Map<string, object>, rows: object[], data_quality_flags: object[]}}
 */
export function parsePrices(raw) {
  const flags = [];
  const rows = parseCsv(raw);

  if (rows.length < 2) {
    throw new Error('Price file has no data rows.');
  }

  const header = rows[0].map((h) => h.trim().toLowerCase());
  const iClass = header.indexOf('asset class');
  const iAsset = header.indexOf('asset');
  const iCurrent = header.indexOf('current price');
  const iPrior = header.indexOf('last month price');

  for (const [label, index] of [
    ['Asset class', iClass], ['Asset', iAsset],
    ['Current price', iCurrent], ['Last month price', iPrior],
  ]) {
    if (index === -1) {
      throw new Error(`Price file is missing the "${label}" column. Header: ${rows[0].join(',')}`);
    }
  }

  const prices = new Map();
  const parsed = [];

  for (const cells of rows.slice(1)) {
    const ticker = (cells[iAsset] ?? '').trim().toUpperCase();
    if (!ticker) continue;

    const current = parseAmbiguousNumber(cells[iCurrent]);
    const prior = parseAmbiguousNumber(cells[iPrior]);

    if (!Number.isFinite(current) || !Number.isFinite(prior)) {
      flags.push({
        code: 'price_unreadable',
        severity: 'error',
        detail: `${ticker}: could not read prices (current="${cells[iCurrent]}", prior="${cells[iPrior]}").`,
      });
      continue;
    }
    if (current <= 0 || prior <= 0) {
      flags.push({
        code: 'price_not_positive',
        severity: 'error',
        detail: `${ticker}: non-positive price (current=${current}, prior=${prior}).`,
      });
      continue;
    }

    const record = {
      ticker,
      asset_class: (cells[iClass] ?? '').trim(),
      current_price: current,
      prior_price: prior,
      monthly_return: round(current / prior - 1, 8),
    };

    if (prices.has(ticker)) {
      flags.push({
        code: 'duplicate_ticker',
        severity: 'warning',
        detail: `${ticker} appears more than once; the first occurrence is used.`,
      });
      continue;
    }

    prices.set(ticker, record);
    parsed.push(record);
  }

  if (prices.size === 0) {
    throw new Error('Price file produced no usable rows.');
  }

  return { prices, rows: parsed, data_quality_flags: flags };
}

/**
 * Tickers priced in the file but not held by the client. These are the
 * candidates the recommendation engine is allowed to propose - a closed
 * universe chosen by XP, not names invented by a language model.
 */
export function candidateUniverse(priceRows, heldTickers) {
  const held = new Set(heldTickers.map((t) => t.toUpperCase()));
  return priceRows.filter((r) => !held.has(r.ticker));
}
