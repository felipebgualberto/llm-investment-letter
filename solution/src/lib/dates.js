/**
 * Date helpers.
 *
 * Every date in this pipeline is an ISO "yyyy-mm-dd" string handled in UTC.
 * We never construct a Date from a local-time string, because "2025-04-30"
 * parsed in a UTC-3 timezone silently becomes 2025-04-29T21:00 local and can
 * shift a month boundary. Month boundaries decide which return we report, so
 * an off-by-one here is a wrong number in a client letter.
 */

const MS_PER_DAY = 86_400_000;

/** "2025-04-30" -> epoch milliseconds at UTC midnight. */
export function toUtcMs(iso) {
  return Date.parse(`${iso}T00:00:00Z`);
}

/** epoch milliseconds -> "yyyy-mm-dd". */
export function fromUtcMs(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

/** "2025-04-30" -> "30/04/2025", the format the BCB SGS API expects. */
export function toBrDate(iso) {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

/** "2025-04-30" -> epoch SECONDS, the format the Yahoo chart API expects. */
export function toEpochSeconds(iso) {
  return Math.floor(toUtcMs(iso) / 1000);
}

export function addDays(iso, days) {
  return fromUtcMs(toUtcMs(iso) + days * MS_PER_DAY);
}

export function daysBetween(isoA, isoB) {
  return Math.round(Math.abs(toUtcMs(isoB) - toUtcMs(isoA)) / MS_PER_DAY);
}

/** First calendar day of the month containing `iso`. */
export function startOfMonth(iso) {
  return `${iso.slice(0, 7)}-01`;
}

/** Last calendar day of the month containing `iso`. */
export function endOfMonth(iso) {
  const [y, m] = iso.split('-').map(Number);
  const firstOfNext = Date.UTC(m === 12 ? y + 1 : y, m === 12 ? 0 : m, 1);
  return fromUtcMs(firstOfNext - MS_PER_DAY);
}

/** Same day-of-month one month earlier, clamped to the shorter month. */
export function addMonths(iso, months) {
  const [y, m, d] = iso.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = Number(endOfMonth(fromUtcMs(target.getTime())).slice(8));
  return `${fromUtcMs(target.getTime()).slice(0, 8)}${String(Math.min(d, lastDay)).padStart(2, '0')}`;
}

/** "2025-04" -> { start: "2025-04-01", end: "2025-04-30", label: "abril de 2025" } */
export function monthWindow(iso) {
  const start = startOfMonth(iso);
  const end = endOfMonth(iso);
  return { start, end, label: monthLabelPt(iso) };
}

const MONTHS_PT = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

/** "2025-04-30" -> "abril de 2025". Used only for client-facing text. */
export function monthLabelPt(iso) {
  const [y, m] = iso.split('-').map(Number);
  return `${MONTHS_PT[m - 1]} de ${y}`;
}
