/**
 * What the portfolio would look like if the proposals were followed.
 *
 * WHY THIS IS AN ENGINE MODULE AND NOT A CHART
 * --------------------------------------------
 * "Before and after" is a picture, but the AFTER is a claim about the client's
 * money, and a claim has to be computed, reconciled and testable like every
 * other number in this project. The chart draws what this file returns; it does
 * not model anything itself.
 *
 * WHICH RECOMMENDATIONS MOVE MONEY
 * --------------------------------
 * Only the ones that actually reallocate. The engine produces two kinds:
 *
 *   evaluate_allocation   moves an amount into a named instrument class
 *   confirm_settlement    asks the desk to confirm a bond already matured
 *
 * The second one does NOT change the allocation. It converts a position the
 * custodian still lists into cash that has, in reality, probably already been
 * paid - and what happens to that cash afterwards is a decision nobody has
 * taken yet. Drawing it as if it had been reinvested would be inventing a
 * second recommendation and attributing it to the client.
 *
 * So the "after" ring shows exactly one change: R$ 35.986,74 of idle cash into
 * post-fixed income. That single move is also the one with a verifiable
 * endpoint - it takes the cash balance from 19,30% to exactly the 10% house
 * limit, which is where the amount came from in the first place.
 *
 * WHAT IT DOES NOT CLAIM
 * ----------------------
 * No return is projected onto the new position, and no market movement is
 * applied to the old ones. The "after" is the SAME MONEY arranged differently
 * on the same date - a reallocation, not a forecast. Both rings therefore total
 * the identical net worth, which the reconciliation below asserts rather than
 * assumes.
 */

import { round } from '../lib/numbers.js';

/** Recommendation actions that actually move money between classes. */
const REALLOCATING = new Set(['evaluate_allocation']);

/**
 * Where a proposed amount lands, as a sleeve key the ring already knows how to
 * colour. An instrument class with no entry here is not drawn: a slice labelled
 * with a raw engine key would be worse than no slice.
 */
const CLASS_TO_SLEEVE = {
  renda_fixa_pos_fixada: { sleeve: 'fixed_income', label_pt: 'Renda fixa pós-fixada' },
  renda_fixa: { sleeve: 'fixed_income', label_pt: 'Renda fixa' },
  acoes: { sleeve: 'stocks', label_pt: 'Ações' },
};

/**
 * @param {object} portfolio  portfolio.json
 * @param {object[]} recommendations  the ones shown in the letter
 * @returns {object|null} null when nothing in the letter reallocates
 */
export function proposedAllocation(portfolio, recommendations) {
  const netWorth = portfolio.totals?.net_worth;
  const cash = portfolio.totals?.available_cash;
  if (!Number.isFinite(netWorth) || netWorth <= 0 || !Number.isFinite(cash)) return null;

  const moves = (recommendations ?? []).filter(
    (r) =>
      REALLOCATING.has(r.action) &&
      Number.isFinite(r.amount_brl) &&
      r.amount_brl > 0 &&
      CLASS_TO_SLEEVE[r.instrument_class],
  );
  if (moves.length === 0) return null;

  const fromCash = moves.reduce((s, r) => s + r.amount_brl, 0);
  if (fromCash > cash) {
    // The engine sizes proposals against the available balance, so this cannot
    // happen today. If a future rule ever proposes more than the client has,
    // refusing to draw is better than drawing a negative slice.
    return {
      drawable: false,
      reason:
        `As propostas somam ${fromCash} contra um saldo disponível de ${cash}. ` +
        'A projeção não é desenhada.',
    };
  }

  // --- before ---------------------------------------------------------------
  const bySleeve = new Map();
  for (const h of portfolio.holdings ?? []) {
    bySleeve.set(h.sleeve, (bySleeve.get(h.sleeve) ?? 0) + h.market_value);
  }

  const before = [...bySleeve.entries()].map(([sleeve, value]) => ({ sleeve, value }));
  before.push({ sleeve: 'cash', value: cash });

  // --- after ----------------------------------------------------------------
  //
  // The proposed money is kept as its OWN segment rather than folded into the
  // sleeve it joins. Merging it would show "renda fixa 19,8%" and hide the fact
  // that half of that is a step the client has not taken yet.
  const after = before.map((s) =>
    s.sleeve === 'cash' ? { ...s, value: round(s.value - fromCash, 2) } : { ...s },
  );
  for (const move of moves) {
    const target = CLASS_TO_SLEEVE[move.instrument_class];
    const existing = after.find((s) => s.proposed && s.label_pt === target.label_pt);
    if (existing) existing.value = round(existing.value + move.amount_brl, 2);
    else {
      after.push({
        sleeve: target.sleeve,
        label_pt: target.label_pt,
        value: round(move.amount_brl, 2),
        proposed: true,
      });
    }
  }

  // --- reconciliation -------------------------------------------------------
  //
  // The same money, arranged differently. If the two rings did not total the
  // identical net worth, the picture would be claiming the proposal creates or
  // destroys value.
  const sum = (rows) => rows.reduce((s, r) => s + r.value, 0);
  const beforeTotal = round(sum(before), 2);
  const afterTotal = round(sum(after), 2);
  const balances = Math.abs(beforeTotal - afterTotal) < 0.01;

  const cashBefore = cash / netWorth;
  const cashAfter = (cash - fromCash) / netWorth;

  return {
    drawable: balances,
    before,
    after,
    net_worth: round(netWorth, 2),
    moved_brl: round(fromCash, 2),
    moves: moves.map((m) => ({
      id: m.id,
      amount_brl: round(m.amount_brl, 2),
      to: CLASS_TO_SLEEVE[m.instrument_class].label_pt,
    })),
    cash_share: { before: round(cashBefore, 6), after: round(cashAfter, 6) },
    checks: {
      totals_match: balances,
      before_total: beforeTotal,
      after_total: afterTotal,
      net_worth: round(netWorth, 2),
    },
    basis:
      'Mesma data, mesmo patrimônio, apenas rearranjado. Nenhuma rentabilidade é projetada sobre ' +
      'a posição nova e nenhum movimento de mercado é aplicado às existentes. Apenas propostas de ' +
      'alocação entram; confirmações de liquidação não movem dinheiro entre classes.',
  };
}
