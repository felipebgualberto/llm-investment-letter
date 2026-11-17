/**
 * XP house identity: colour tokens and the letterhead mark.
 *
 * WHY THE BRAND LIVES IN ONE FILE
 * -------------------------------
 * The letter, the charts and the advisor annex are three renderers that must
 * look like one document. Keeping the tokens here means a colour is defined
 * once and checked once - tools/check-palette.js imports this file, so the
 * palette that ships is literally the palette that was tested.
 *
 * ABOUT THE MARK
 * --------------
 * The letterhead carries XP's real logo, extracted by tools/extract-brand-mark.js
 * from the header of a PDF XP supplied with this case. It is not downloaded and
 * not redrawn from memory: the asset traces back to a file in the brief. A drawn
 * placeholder stands in when that asset is missing, and it looks like a
 * placeholder rather than a near-miss of the real thing.
 *
 * ABOUT THE YELLOW
 * ----------------
 * XP's yellow is a light colour: measured against white it lands at 1.56:1,
 * far below the 3:1 that WCAG asks for a shape carrying meaning. That is not a
 * reason to avoid it - it is a reason to use it where it works. On black it
 * reaches 13.43:1, which is why the letterhead is a black band. On white it is
 * only ever used as a large filled area with a dark outline and a direct label,
 * never as thin text or a hairline. tools/check-palette.js enforces exactly
 * that split.
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// --- identity --------------------------------------------------------------

export const XP_BLACK = '#000000';
export const XP_YELLOW = '#FFC709';

// --- document ink ----------------------------------------------------------

export const INK = '#111111';
export const MUTED = '#6b7280';
export const RULE = '#e5e7eb';
export const PAPER = '#ffffff';

// --- data colours ----------------------------------------------------------
//
// Chosen by tools/check-palette.js, not by eye. See PALETTE_UNDER_TEST below
// for the measured numbers.

export const POSITIVE = '#111111';
export const NEGATIVE = '#c4262e';
export const HIGHLIGHT = XP_YELLOW;
export const ACCENT = '#111111';

/** Categorical, for the allocation segments. Every segment is directly labelled. */
export const CAT = ['#111111', XP_YELLOW, '#8a8f98'];

/**
 * The four asset classes, for the positions ring.
 *
 * Three steps of grey plus the house yellow, rather than four hues. Four
 * distinguishable hues do not exist inside a black-and-yellow identity without
 * inventing brand colours, and the obvious fourth - red - is already spoken for:
 * it means "loss" everywhere else in this document, and reusing it for a
 * category would make a red slice look like a losing one.
 *
 * Since lightness carries the whole distinction, the ring survives every colour
 * deficiency by construction. Cash gets the yellow deliberately: it is the one
 * slice the letter wants the reader to notice, and the paragraph beside it
 * proposes doing something about it.
 */
export const SLEEVE = {
  stocks: { label_pt: 'Ações', fill: '#111111' },
  funds: { label_pt: 'Fundos', fill: '#4d5259' },
  fixed_income: { label_pt: 'Renda fixa', fill: '#8a8f98' },
  cash: { label_pt: 'Saldo em conta', fill: XP_YELLOW, stroke: '#8a6a00' },
};

/**
 * Yellow that survives white paper.
 *
 * Pure XP yellow is 1.56:1 against white - fine as a large fill with an
 * outline, unreadable as a line or a word. Everything yellow that has to be
 * THIN uses this darker amber instead, which scores 5.07:1 and still reads as
 * the same family. One brand colour, two jobs, decided by measurement.
 */
export const YELLOW_DARK = '#8a6a00';

// --- the mark --------------------------------------------------------------

/**
 * The letterhead mark: XP's own logo, taken from XP's own document.
 *
 * WHERE IT COMES FROM
 * -------------------
 * `assets/xp-logo.png` is extracted by tools/extract-brand-mark.js from the
 * header of `Input/XP - Albert_s risk profile.pdf` - a file XP produced and
 * supplied with this case. Nothing is downloaded and nothing is redrawn from
 * memory, so the asset in this repository traces back to a document in the
 * brief. It is the XP Inc. wordmark; the operating entity is named in the
 * letter's own text rather than in the mark.
 *
 * The extractor keys the black background out to transparency, so the white
 * lettering sits directly on the letterhead band with no visible box.
 *
 * WHY IT IS INLINED AS A DATA URI
 * -------------------------------
 * The letter is printed by a headless browser and is meant to survive being
 * emailed as a single file. A relative <img src> would resolve during the print
 * pass and break the moment the HTML moved; embedding it keeps every output
 * self-contained, which is the same reason the charts are inline SVG.
 *
 * WHEN THE ASSET IS ABSENT
 * ------------------------
 * The drawn placeholder below takes over. A build on a checkout without the
 * Input folder still produces a complete letter, and the fallback is visibly a
 * placeholder rather than a near-miss of a real brand mark.
 */
const LOGO_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '../../assets/xp-logo.png');

const LOGO_DATA_URI = (() => {
  try {
    return `data:image/png;base64,${readFileSync(LOGO_PATH).toString('base64')}`;
  } catch {
    return null;
  }
})();

/** True when the real brand asset is available. */
export const HAS_BRAND_ASSET = LOGO_DATA_URI !== null;

/**
 * @param {object} [opts]
 * @param {number} [opts.size]  height in CSS pixels; the logo keeps its ratio
 */
export function markSvg({ size = 34 } = {}) {
  if (LOGO_DATA_URI) {
    // 480x100 in the source, so the width follows from the requested height.
    return `<img src="${LOGO_DATA_URI}" alt="XP" style="display:block;height:${size}px;width:auto">`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="${size}" height="${size}" role="img" aria-label="XP" style="display:block">
  <rect width="48" height="48" rx="6" fill="${XP_BLACK}"/>
  <text x="24" y="32" text-anchor="middle" font-family="system-ui, -apple-system, 'Segoe UI', Arial, sans-serif" font-size="21" font-weight="700" letter-spacing="-0.5" fill="${XP_YELLOW}">XP</text>
</svg>`;
}

// --- what the checker tests ------------------------------------------------

export const PALETTE_UNDER_TEST = {
  contrast: [
    { name: 'ink', hex: INK, on: PAPER, role: 'text' },
    { name: 'muted', hex: MUTED, on: PAPER, role: 'text' },
    { name: 'yellow', hex: XP_YELLOW, on: XP_BLACK, role: 'text' },
    { name: 'yellow', hex: XP_YELLOW, on: PAPER, role: 'fill', outline: YELLOW_DARK },
    { name: 'positive', hex: POSITIVE, on: PAPER, role: 'text' },
    { name: 'negative', hex: NEGATIVE, on: PAPER, role: 'text' },
    { name: 'cat[2] grey', hex: CAT[2], on: PAPER, role: 'shape' },
    { name: 'sleeve funds', hex: SLEEVE.funds.fill, on: PAPER, role: 'shape' },
    { name: 'sleeve fixed', hex: SLEEVE.fixed_income.fill, on: PAPER, role: 'shape' },
  ],
  groups: [
    {
      name: 'diverging',
      note: 'gains vs losses; sign is also carried by bar direction and a signed label',
      colours: { positive: POSITIVE, negative: NEGATIVE },
    },
    {
      name: 'categorical',
      note: 'allocation segments, each directly labelled with its own value',
      colours: { invested: CAT[0], unmeasured: CAT[1], cash: CAT[2] },
    },
    {
      name: 'series markers',
      note: 'consensus line, house view and the v1 figure on the same axes',
      colours: { series: MUTED, house: HIGHLIGHT, mark: NEGATIVE },
    },
    {
      name: 'asset classes',
      note: 'the four rings of the positions chart; adjacent slices also carry a white gap and a legend entry',
      colours: Object.fromEntries(Object.entries(SLEEVE).map(([k, v]) => [k, v.fill])),
    },
  ],
};
