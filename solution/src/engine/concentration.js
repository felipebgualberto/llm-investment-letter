/**
 * How concentrated the portfolio actually is, in one number.
 *
 * THE PROBLEM WITH COUNTING POSITIONS
 * -----------------------------------
 * Albert holds thirteen things. That sounds diversified and is not: two funds
 * are 43,6% of his net worth and the smallest position is 0,08%. "Thirteen
 * positions" and "six positions" describe this portfolio equally badly, because
 * a count treats R$ 96.178 and R$ 305 as the same object.
 *
 * THE MEASURE
 * -----------
 * The Herfindahl-Hirschman index - the sum of squared weights - and its
 * reciprocal, the EFFECTIVE NUMBER OF POSITIONS. A portfolio of N equal
 * positions has an effective number of exactly N; any inequality pushes it
 * down. It answers the question a count cannot: "how many positions does this
 * portfolio behave as if it had?"
 *
 * It is a standard measure - antitrust regulators use the same index on market
 * share - and it is arithmetic on weights the statement already states, so
 * there is nothing to estimate and nothing to assume.
 *
 * WHY THE DENOMINATOR IS NET WORTH
 * --------------------------------
 * Measuring over the invested total would treat the idle 19,3% as if it did not
 * exist and report a MORE concentrated portfolio than the client has. Cash is a
 * position for this purpose: it is where a fifth of the money is.
 *
 * WHAT IT IS NOT
 * --------------
 * Not a risk measure. Two uncorrelated funds diversify and two funds holding the
 * same twenty stocks do not, and this index cannot tell them apart - it sees
 * weights, never holdings. The annex says so next to the number, because an
 * effective count of 6,4 that a reader takes as "adequately diversified" would
 * be worse than not reporting it.
 */

/**
 * @param {Array<{label: string, value: number}>} positions  value in reais
 * @returns {object|null}
 */
export function concentration(positions) {
  const priced = positions.filter((p) => Number.isFinite(p.value) && p.value > 0);
  const total = priced.reduce((s, p) => s + p.value, 0);
  if (total <= 0 || priced.length === 0) return null;

  const weights = priced
    .map((p) => ({ label: p.label, weight: p.value / total, value: p.value }))
    .sort((a, b) => b.weight - a.weight);

  // HHI on fractions, so it runs 0..1 rather than the 0..10000 convention.
  const hhi = weights.reduce((s, w) => s + w.weight * w.weight, 0);
  const effective = 1 / hhi;

  // How few positions it takes to reach half the money. A blunter statement of
  // the same fact, and the one that survives being read out loud.
  let running = 0;
  let toHalf = 0;
  for (const w of weights) {
    running += w.weight;
    toHalf += 1;
    if (running >= 0.5) break;
  }

  const top2 = weights.slice(0, 2).reduce((s, w) => s + w.weight, 0);

  return {
    positions_held: weights.length,
    effective_positions: Math.round(effective * 100) / 100,
    hhi: Math.round(hhi * 1e6) / 1e6,
    largest: { label: weights[0].label, weight: Math.round(weights[0].weight * 1e6) / 1e6 },
    top_two_share: Math.round(top2 * 1e6) / 1e6,
    positions_to_half: toHalf,
    basis:
      'Índice de Herfindahl sobre os pesos no patrimônio total, incluindo o saldo em conta. ' +
      'O número efetivo é o recíproco do índice: quantas posições de tamanho igual produziriam ' +
      'a mesma concentração.',
    caveat:
      'Mede concentração de tamanho, não de risco. Dois fundos que carregam as mesmas ações ' +
      'aparecem aqui como duas posições distintas.',
  };
}

/**
 * Build the position list the index runs on: every holding plus the idle cash.
 */
export function positionsForConcentration(portfolio) {
  const list = (portfolio.holdings ?? []).map((h) => ({
    label: h.ticker || h.name,
    value: h.market_value,
  }));
  const cash = portfolio.totals?.available_cash;
  if (Number.isFinite(cash) && cash > 0) list.push({ label: 'Saldo em conta', value: cash });
  return list;
}
