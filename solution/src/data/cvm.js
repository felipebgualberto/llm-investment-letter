/**
 * CVM connector: statement fund names in, measured monthly returns out.
 *
 * Orchestrates the two halves of the problem:
 *   cvm-registry.js  who is this fund, as of the statement date
 *   cvm-quotas.js    what did it return in the reference month
 *
 * Coverage is always reported explicitly. A fund that cannot be resolved is a
 * named gap with a reason, never an assumed zero and never a guess: reporting a
 * real return for the wrong fund would be a worse failure than reporting none.
 */

import { resolveFund, fetchNameIndex, distinctiveTokens, normalizeCnpj } from './cvm-registry.js';
import { monthlyReturns } from './cvm-quotas.js';
import { feesAsOf, annualCost } from './cvm-fees.js';
import { round } from '../lib/numbers.js';

export { distinctiveTokens, normalizeCnpj, resolveFund, fetchNameIndex };

/**
 * Manual overrides let an advisor close a gap the matcher refused to guess at.
 * In a real XP deployment this file would be unnecessary - the CNPJ travels
 * with the position in the custody system, and the whole name-matching problem
 * disappears. It exists here because the challenge statement carries only
 * commercial names.
 *
 * @param {object[]} overrides [{ statement_name, cnpj, note }]
 */
export function applyOverrides(matches, overrides = []) {
  if (overrides.length === 0) return matches;
  const byName = new Map(overrides.map((o) => [o.statement_name, o]));
  return matches.map((m) => {
    const override = byName.get(m.statement_name);
    if (!override) return m;
    return {
      ...m,
      status: 'matched',
      cnpj: normalizeCnpj(override.cnpj),
      match_source: 'manual_override',
      override_note: override.note ?? null,
    };
  });
}

/**
 * @param {Array<{name: string, weight: number, market_value: number}>} holdings
 * @param {string} referenceDate
 * @param {object} [options]
 * @param {string} [options.statementDate] date the statement was issued; names
 *   are resolved as of this date rather than as of today
 * @param {object[]} [options.overrides]
 */
export async function measureFunds(holdings, referenceDate, options = {}) {
  const { statementDate = null, overrides = [] } = options;

  const index = await fetchNameIndex(options);

  let matches = holdings.map((h) => {
    const resolved = resolveFund(h.name, index, statementDate);
    return {
      statement_name: h.name,
      weight: h.weight,
      market_value: h.market_value,
      match_source: 'cvm_registry',
      ...resolved,
    };
  });

  matches = applyOverrides(matches, overrides);

  const measured = await monthlyReturns(
    matches.filter((m) => m.status === 'matched'),
    referenceDate,
    options,
  );

  const byName = new Map(measured.map((m) => [m.statement_name, m]));
  const results = matches.map((m) => byName.get(m.statement_name) ?? m);

  const measuredWeight = results
    .filter((r) => r.status === 'measured')
    .reduce((s, r) => s + (r.weight ?? 0), 0);
  const totalWeight = results.reduce((s, r) => s + (r.weight ?? 0), 0);

  // What the sleeve COSTS, priced from the same archive already in memory.
  // The reference date is passed, not today: fees are versioned, and one of
  // these funds has a rate that only takes effect after the statement date.
  const { fees, flags: feeFlags } = feesAsOf(
    index.historyBuffer,
    results.map((r) => r.cnpj).filter(Boolean),
    referenceDate,
  );
  for (const r of results) {
    const fee = r.cnpj ? fees.get(r.cnpj) : null;
    if (fee) r.fees = fee;
  }
  const cost = annualCost(results, fees);

  return {
    results,
    cost,
    coverage: {
      measured_count: results.filter((r) => r.status === 'measured').length,
      total_count: results.length,
      measured_weight: round(measuredWeight, 6),
      total_weight: round(totalWeight, 6),
      share_of_sleeve: totalWeight > 0 ? round(measuredWeight / totalWeight, 6) : 0,
    },
    data_quality_flags: feeFlags,
    resolved_as_of: statementDate,
    registry_retrieved_at: index.retrieved_at,
  };
}
