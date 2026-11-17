/**
 * Number parsing for XP statements.
 *
 * The source statement mixes two decimal conventions in the same file:
 *   - US style  : "R$27,812.04" and "8.91%"      (comma = thousands, dot = decimal)
 *   - BR style  : "R$ 30.000,00" and "-41,7%"    (dot = thousands, comma = decimal)
 *
 * We therefore cannot hardcode a locale. The disambiguation rule below is
 * purely structural and holds for both conventions:
 *
 *   The LAST separator in the string is a THOUSANDS separator if and only if
 *   it is followed by exactly three digits. Otherwise it is the decimal mark.
 *
 * Worked examples:
 *   "27,812.04"  -> last sep '.' + 2 digits -> decimal -> 27812.04
 *   "30.000,00"  -> last sep ',' + 2 digits -> decimal -> 30000.00
 *   "1.000"      -> last sep '.' + 3 digits -> thousands -> 1000
 *   "1,000"      -> last sep ',' + 3 digits -> thousands -> 1000
 *   "-41,7"      -> last sep ',' + 1 digit  -> decimal -> -41.7
 */

const SEPARATORS = /[.,]/g;

/**
 * Parse a locale-ambiguous numeric string into a Number.
 * @param {string} raw
 * @returns {number} NaN when the input holds no digits.
 */
export function parseAmbiguousNumber(raw) {
  if (raw === null || raw === undefined) return NaN;

  // Keep only sign, digits and separators. Drops "R$", "%", spaces, NBSP.
  const cleaned = String(raw).replace(/[^\d.,-]/g, '');
  if (!/\d/.test(cleaned)) return NaN;

  const negative = cleaned.startsWith('-');
  const body = cleaned.replace(/-/g, '');

  const positions = [];
  let m;
  SEPARATORS.lastIndex = 0;
  while ((m = SEPARATORS.exec(body)) !== null) positions.push(m.index);

  let normalized;
  if (positions.length === 0) {
    normalized = body;
  } else {
    const last = positions[positions.length - 1];
    const tail = body.slice(last + 1);
    const isThousands = /^\d{3}$/.test(tail);

    if (isThousands) {
      normalized = body.replace(SEPARATORS, '');
    } else {
      const intPart = body.slice(0, last).replace(SEPARATORS, '');
      normalized = `${intPart}.${tail}`;
    }
  }

  const value = Number(normalized);
  if (!Number.isFinite(value)) return NaN;
  return negative ? -value : value;
}

/** Parse a "R$ 1.234,56" / "R$1,234.56" money string. */
export function parseMoney(raw) {
  return parseAmbiguousNumber(raw);
}

/**
 * Parse a percentage string into a DECIMAL FRACTION.
 * "8.91%" -> 0.0891 ;  "-41,7%" -> -0.417
 * Storing fractions (not 0-100 numbers) removes a whole class of unit bugs
 * downstream: every rate in the pipeline is a fraction, without exception.
 */
export function parsePercent(raw) {
  const n = parseAmbiguousNumber(raw);
  if (Number.isNaN(n)) return NaN;
  // -41.7 / 100 === -0.41700000000000004 in IEEE-754. Rounding at 12 decimals
  // removes the representation noise while preserving every digit a
  // statement could realistically carry.
  return round(n / 100, 12);
}

/** Parse "dd/mm/yyyy" into an ISO "yyyy-mm-dd" string. Returns null if unparseable. */
export function parseBrDate(raw) {
  const m = String(raw ?? '').match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  return `${yyyy}-${mm}-${dd}`;
}

/** Round to `places` decimals without float drift artifacts in output JSON. */
export function round(value, places = 2) {
  if (!Number.isFinite(value)) return value;
  const f = 10 ** places;
  return Math.round((value + Number.EPSILON) * f) / f;
}

/** True when |a - b| <= tolerance. Used by the reconciliation checks. */
export function closeTo(a, b, tolerance) {
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tolerance;
}
