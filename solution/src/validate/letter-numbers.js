/**
 * Numeric validator for the generated letter.
 *
 * WHAT IT IS FOR
 * --------------
 * Every prompt in this pipeline forbids the model from inventing a figure. This
 * module is what makes that a property of the system rather than a hope about
 * the wording. It extracts every number the letter prints and checks each one
 * against an allow-list built from the payload the model was actually given.
 *
 * WHY IT LIVES HERE AND NOT ONLY IN THE GRAPH
 * -------------------------------------------
 * The Rivet Code node runs this exact source, inlined by tools/build-rivet-graph.js.
 * Keeping the function in the repository means it is unit-tested, reviewable and
 * versioned, instead of being a blob of JavaScript trapped inside a YAML file
 * where nothing can exercise it.
 *
 * MEASURED COVERAGE, AND ITS CEILING
 * ----------------------------------
 * Run against the v1 letter with the v2 payload, it rejects three of the seven
 * invented figures: 17,4%, 19,32% and R$4,70. It does NOT reject "Selic de 9%",
 * "IPCA de 4,0%", "PIB de 2%" or "retorno de 3,5%" - and the reason is worth
 * stating precisely rather than hiding, because it will be asked.
 *
 * Those four coincide with figures that genuinely exist in this portfolio:
 *
 *   "9%"   vs LREN3 weighing 8,9977% of the measured base
 *   "4,0%" vs Truxt weighing 4,0111%
 *   "3,5%" vs ARZZ3 weighing 3,4991%
 *   "2%"   vs the policy's 2% minimum dividend yield
 *
 * Value matching cannot separate a hallucinated rate from a real weight that
 * rounds to the same number. Tightening the tolerance does not help: 8,9977
 * rounds to 9,00 at two decimals too. This is a ceiling of the method, not a
 * bug in the implementation.
 *
 * SO THE VALIDATOR IS A BACKSTOP, NOT THE DEFENCE
 * -----------------------------------------------
 * The defence is upstream, and it is why the v2 does not produce those figures
 * in the first place:
 *
 *   1. The v1 prompt contained NO figures at all - the model had nothing to
 *      read, so it recited its training data. The v2 composer receives the
 *      correct numbers, already computed, already labelled.
 *   2. Sections arrive PRE-WRITTEN and pre-labelled. The composer never holds a
 *      bag of loose numbers it could attach to the wrong sentence.
 *   3. Every prompt forbids arithmetic outright.
 *
 * This node catches what those three miss: a figure that exists nowhere in the
 * payload. Claiming more than that would be the same overconfidence the whole
 * rewrite exists to remove.
 *
 * WHAT IT DELIBERATELY ALLOWS
 * ---------------------------
 * Calendar years and bare small integers: a letter says "em abril de 2025" and
 * "as duas propostas" structurally, not as data. Figures inside strings the
 * ENGINE wrote are as authoritative as numeric fields, because the engine
 * composed them - but only when they carry a decimal mark or a percent sign, so
 * that "6 dividendos" cannot license "6%".
 */

/** Absolute tolerance when matching a printed figure to an allowed one. */
export const TOLERANCE = 0.006;

/**
 * Parse a number written in either Brazilian or US convention.
 * The last separator is a thousands mark only when followed by exactly three
 * digits; otherwise it is the decimal point.
 */
export function parseLocaleNumber(raw) {
  const cleaned = String(raw).replace(/[^\d.,-]/g, '');
  if (!/\d/.test(cleaned)) return Number.NaN;

  const separators = [];
  for (let i = 0; i < cleaned.length; i += 1) {
    if (cleaned[i] === '.' || cleaned[i] === ',') separators.push(i);
  }
  if (separators.length === 0) return Number(cleaned);

  const last = separators[separators.length - 1];
  const tail = cleaned.slice(last + 1);
  if (/^\d{3}$/.test(tail)) return Number(cleaned.replace(/[.,]/g, ''));
  return Number(`${cleaned.slice(0, last).replace(/[.,]/g, '')}.${tail}`);
}

/**
 * Every figure the payload authorises, in every form a letter might print it.
 * A fraction is also allowed as its percentage, because 0.02621 and 2.62 are
 * the same fact.
 */
export function buildAllowList(payload) {
  // Two lists, because not every number in the payload can authorise every
  // kind of claim.
  //
  //   all          every figure, in every display form
  //   percentSafe  the subset that may authorise a PERCENTAGE
  //
  // The distinction exists because the payload is full of structural counts -
  // contributor_count, max_words, the number of findings - and they are stored
  // as bare integers. A rate never is: every real percentage in this pipeline
  // is stored as a FRACTION and becomes a percentage only when multiplied by
  // 100, or is written into a sentence by the engine itself.
  //
  // Without the split, `contributor_count: 9` silently authorised the v1
  // letter's "Selic de 9%", and two findings authorised "2%". The validator
  // was certifying the exact figures it was built to catch.
  const all = new Set();
  const percentSafe = new Set();

  // Only display forms a letter would legitimately print. Rounding to a whole
  // number is NOT one of them: LREN3's 8.91% weight would round to 9 and
  // authorise "9%" all over again.
  const forms = (n) => {
    const v = Math.abs(n);
    return [Number(v.toFixed(4)), Number(v.toFixed(2)), Number(v.toFixed(1))];
  };

  const add = (n, { percentSafe: safe }) => {
    if (!Number.isFinite(n)) return;
    for (const f of forms(n)) {
      all.add(f);
      if (safe) percentSafe.add(f);
    }
  };

  const walk = (value) => {
    if (value === null || value === undefined) return;
    if (typeof value === 'number') {
      // A raw integer is a count until proven otherwise; a raw decimal is a
      // measured quantity and may back a percentage.
      add(value, { percentSafe: !Number.isInteger(value) });
      // The same value read as a fraction: this is how every rate in the
      // pipeline is stored, so the scaled form is always percent-safe.
      add(value * 100, { percentSafe: true });
      return;
    }
    if (Array.isArray(value)) { value.forEach(walk); return; }
    if (typeof value === 'object') { Object.values(value).forEach(walk); return; }
    if (typeof value === 'string') {
      // Figures the ENGINE wrote into a sentence are as authoritative as a
      // numeric field, and it writes percentages there in display form.
      //
      // Dates are stripped first. "2025-04-30" tokenises into 2025, -04 and
      // -30, and that stray 4 was enough to authorise the v1 letter's
      // "inflação de 4,0%". A date is a timestamp, never a rate.
      const withoutDates = value
        .replace(/\d{4}-\d{2}-\d{2}(?:T[\d:.]+Z?)?/g, ' ')
        .replace(/\d{2}\/\d{2}\/\d{4}/g, ' ');

      // Only tokens carrying a decimal mark or an explicit percent sign count
      // as figures. A bare integer inside a sentence is a count ("6 dividendos",
      // "244 dias") and must not be able to back a percentage.
      for (const m of withoutDates.matchAll(/(-?\d[\d.,]*)\s*(%)?/g)) {
        const token = m[1];
        const explicitPercent = Boolean(m[2]);
        const hasDecimal = /[.,]\d{1,2}(?!\d)/.test(token);
        if (!explicitPercent && !hasDecimal) continue;
        add(parseLocaleNumber(token), { percentSafe: true });
      }
    }
  };

  walk(payload);
  return { all, percentSafe };
}

/**
 * Numbers a letter uses structurally rather than as data: a calendar year, a
 * day of the month, a count of items.
 *
 * The distinction is carried by NOTATION, not by size. "duas propostas" and "em
 * abril de 2025" are structure; "9%" and "R$ 4,70" are claims about the world
 * and must come from the payload.
 *
 * An earlier version allowed every integer from 0 to 31 unconditionally, and it
 * let the v1 letter's "Selic de 9%" and "inflação de 4,0%" through untouched -
 * two of the four figures that motivated this whole rewrite. A validator that
 * misses the case it was built for is worse than none, because it certifies.
 */
function isStructural(item) {
  if (item.is_percent || item.is_money) return false;
  if (!Number.isInteger(item.value)) return false;
  if (item.value >= 2015 && item.value <= 2035) return true;   // calendar year
  return item.value <= 31;                                      // day, or a count
}

/** Every numeric token the letter prints, with its notation preserved. */
export function extractPrintedNumbers(letter) {
  const printed = [];
  const pattern = /(R\$\s*)?(-?\d[\d.]*(?:,\d+)?)\s*(%|p\.p\.|pontos? percentuais?|ponto percentual)?/gi;
  let match;
  while ((match = pattern.exec(String(letter))) !== null) {
    const value = parseLocaleNumber(match[2]);
    if (!Number.isFinite(value)) continue;
    printed.push({
      text: match[0].trim(),
      value: Math.abs(value),
      is_money: Boolean(match[1]),
      is_percent: Boolean(match[3]),
    });
  }
  return printed;
}

/**
 * @param {string} letter  the generated letter
 * @param {object} payload the data the model was given
 * @returns {{needs_repair: boolean, violations: string, report: string,
 *            printed_count: number, allowed_count: number, unsourced: object[]}}
 */
export function validateLetterNumbers(letter, payload) {
  const { all, percentSafe } = buildAllowList(payload);
  const allList = [...all];
  const percentList = [...percentSafe];
  const printed = extractPrintedNumbers(letter);

  const unsourced = [];
  const seen = new Set();
  for (const item of printed) {
    if (isStructural(item)) continue;
    // A percentage may only be backed by a figure that could be a rate.
    const list = item.is_percent ? percentList : allList;
    if (list.some((a) => Math.abs(a - item.value) <= TOLERANCE)) continue;
    if (seen.has(item.text)) continue;
    seen.add(item.text);
    unsourced.push(item);
  }

  return {
    needs_repair: unsourced.length > 0,
    unsourced,
    printed_count: printed.length,
    allowed_count: allList.length,
    violations: unsourced.length
      ? unsourced.map((v) => `- "${v.text}" does not appear in the data you were given.`).join('\n')
      : 'none',
    report:
      `Numbers printed: ${printed.length} | allow-list size: ${allList.length} | ` +
      `unsourced: ${unsourced.length}` +
      (unsourced.length ? `\n  ${unsourced.map((v) => v.text).join('\n  ')}` : ''),
  };
}
