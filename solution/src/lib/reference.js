/**
 * Where the reference month comes from.
 *
 * The reference date was repeated as `?? '2025-04-30'` in four scripts, which
 * makes it look like a magic constant someone picked. It is not: it is derived
 * from the statement, and the derivation is the answer to the first question a
 * reviewer will ask.
 *
 * THE RULE
 * --------
 * A statement dated 2025-05-07 reports on the month that closed before it, so
 * the reference month is April 2025 and the reference date is its last calendar
 * day. "Last month" is a property of the document, never of the wall clock -
 * this pipeline must produce identical output whether it runs today or in a
 * year, which is also why nothing anywhere calls Date.now() for this.
 *
 * THE AMBIGUITY, STATED OUT LOUD
 * ------------------------------
 * The supplied statement is internally inconsistent about its own date:
 *
 *   header      2025-05-07   -> reference month April 2025
 *   fund quotas 2024-04-04   -> would imply March 2024
 *   CDB matured 2024-09-05   -> already past on either reading
 *
 * We take the header, because it is the document's own statement of when it was
 * issued and it is the only date that covers every sleeve. The consequence of
 * the other reading is material and is disclosed rather than hidden: under a
 * March-2024 reference the priority-1 recommendation changes and R$40,478.75 of
 * the story moves, because the CDB would not yet have matured.
 */

import { endOfMonth, startOfMonth, addMonths } from './dates.js';

/**
 * Reference date for a statement.
 *
 * @param {object} portfolio  parsePortfolio output
 * @param {object} [options]
 * @param {string} [options.override] explicit ISO date, wins over derivation
 * @returns {{date: string, month: string, derived_from: string, rule: string}}
 */
export function deriveReferenceDate(portfolio, options = {}) {
  if (options.override) {
    return {
      date: options.override,
      month: options.override.slice(0, 7),
      derived_from: 'command line',
      rule: 'explicit override',
    };
  }

  const statementDate = portfolio?.statement_date;
  if (!statementDate) {
    throw new Error(
      'The statement carries no readable date and no reference date was supplied. ' +
        'Refusing to guess which month this letter reports on.',
    );
  }

  const date = endOfMonth(addMonths(startOfMonth(statementDate), -1));
  return {
    date,
    month: date.slice(0, 7),
    derived_from: `statement date ${statementDate}`,
    rule: 'last calendar day of the month preceding the statement date',
  };
}

/** Read an explicit ISO date from argv, if one was passed. */
export function referenceOverrideFromArgv(argv = process.argv) {
  return argv.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a)) ?? null;
}
