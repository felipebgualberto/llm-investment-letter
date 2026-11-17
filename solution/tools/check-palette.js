/**
 * Palette check: contrast and colour-vision-deficiency separation.
 *
 * WHY THIS IS A SCRIPT AND NOT A JUDGEMENT
 * ----------------------------------------
 * The first palette in this project was a green/red pair for gains and losses.
 * It is the obvious choice and it is wrong: simulated under protanopia the two
 * colours land 4.6 ΔE apart, which is close enough that a red-green colourblind
 * reader - roughly one man in twelve - cannot tell the best position in the
 * portfolio from the worst. Nobody catches that by looking at the chart, because
 * the person looking is usually not the person affected.
 *
 * So the palette is checked by running this file, and the numbers it prints are
 * the ones quoted in the report. Adding XP's house yellow made the check
 * mandatory rather than nice to have: yellow is a light colour, and light
 * colours on white fail contrast even when they look confident on screen.
 *
 * WHAT IT MEASURES
 * ----------------
 * 1. Contrast ratio (WCAG 2.1) of every ink colour against its background.
 * 2. CIEDE2000 separation between every pair of data colours, under normal
 *    vision and under simulated protanopia, deuteranopia and tritanopia.
 *
 * THRESHOLDS
 *   contrast >= 3.0   for a filled shape carrying meaning (WCAG 1.4.11)
 *   contrast >= 4.5   for text
 *   ΔE2000  >= 10     for two data colours that must be told apart, under
 *                     EVERY simulation, not just under normal vision
 *
 * CVD simulation uses the Machado, Oliveira & Fernandes (2009) severity-1.0
 * matrices applied in linear RGB - the same model used by browser devtools.
 *
 * Run: npm run palette
 */

import { PALETTE_UNDER_TEST } from '../src/render/brand.js';

// --- colour space ----------------------------------------------------------

const hexToRgb = (hex) => {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
  ];
};

const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toSrgb = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);

/** WCAG relative luminance. */
function luminance(hex) {
  const [r, g, b] = hexToRgb(hex).map(toLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// --- CVD simulation --------------------------------------------------------

const CVD = {
  protanopia: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deuteranopia: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.011820, 0.042940, 0.968881],
  ],
  tritanopia: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.303900],
  ],
};

const clamp = (v) => Math.min(1, Math.max(0, v));

function simulate(hex, kind) {
  if (!kind) return hex;
  const m = CVD[kind];
  const lin = hexToRgb(hex).map(toLinear);
  const out = m.map((row) => clamp(row[0] * lin[0] + row[1] * lin[1] + row[2] * lin[2]));
  const bytes = out.map((c) => Math.round(clamp(toSrgb(c)) * 255));
  return `#${bytes.map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

// --- CIELAB and CIEDE2000 --------------------------------------------------

function toLab(hex) {
  const [r, g, b] = hexToRgb(hex).map(toLinear);
  // sRGB -> XYZ (D65)
  const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
  const y = 0.2126729 * r + 0.7151522 * g + 0.0721750 * b;
  const z = (0.0193339 * r + 0.1191920 * g + 0.9503041 * b) / 1.08883;
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (841 / 108) * t + 4 / 29);
  const [fx, fy, fz] = [f(x), f(y), f(z)];
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** CIEDE2000. Perceptual distance; ~2.3 is a just-noticeable difference. */
function deltaE(hexA, hexB) {
  const [L1, a1, b1] = toLab(hexA);
  const [L2, a2, b2] = toLab(hexB);
  const rad = Math.PI / 180;
  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const Cbar = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cbar ** 7 / (Cbar ** 7 + 25 ** 7)));
  const ap1 = (1 + G) * a1;
  const ap2 = (1 + G) * a2;
  const Cp1 = Math.hypot(ap1, b1);
  const Cp2 = Math.hypot(ap2, b2);
  const hp = (b, ap) => {
    if (b === 0 && ap === 0) return 0;
    const h = Math.atan2(b, ap) / rad;
    return h >= 0 ? h : h + 360;
  };
  const hp1 = hp(b1, ap1);
  const hp2 = hp(b2, ap2);

  const dL = L2 - L1;
  const dC = Cp2 - Cp1;
  let dh = 0;
  if (Cp1 * Cp2 !== 0) {
    dh = hp2 - hp1;
    if (dh > 180) dh -= 360;
    else if (dh < -180) dh += 360;
  }
  const dH = 2 * Math.sqrt(Cp1 * Cp2) * Math.sin((dh * rad) / 2);

  const Lbar = (L1 + L2) / 2;
  const Cpbar = (Cp1 + Cp2) / 2;
  let hbar = hp1 + hp2;
  if (Cp1 * Cp2 !== 0) {
    if (Math.abs(hp1 - hp2) > 180) hbar += hp1 + hp2 < 360 ? 360 : -360;
    hbar /= 2;
  }

  const T =
    1 -
    0.17 * Math.cos((hbar - 30) * rad) +
    0.24 * Math.cos(2 * hbar * rad) +
    0.32 * Math.cos((3 * hbar + 6) * rad) -
    0.20 * Math.cos((4 * hbar - 63) * rad);

  const Sl = 1 + (0.015 * (Lbar - 50) ** 2) / Math.sqrt(20 + (Lbar - 50) ** 2);
  const Sc = 1 + 0.045 * Cpbar;
  const Sh = 1 + 0.015 * Cpbar * T;
  const Rt =
    -2 *
    Math.sqrt(Cpbar ** 7 / (Cpbar ** 7 + 25 ** 7)) *
    Math.sin(60 * Math.exp(-(((hbar - 275) / 25) ** 2)) * rad);

  return Math.sqrt(
    (dL / Sl) ** 2 + (dC / Sc) ** 2 + (dH / Sh) ** 2 + Rt * (dC / Sc) * (dH / Sh),
  );
}

// --- the check ------------------------------------------------------------

const CONTRAST_SHAPE = 3.0;
const CONTRAST_TEXT = 4.5;
const SEPARATION = 10;

const pad = (s, n) => String(s).padEnd(n);
let failures = 0;
const fail = (line) => { failures += 1; console.log(`  FAIL  ${line}`); };
const pass = (line) => console.log(`  ok    ${line}`);

console.log('\ncontrast against background');
console.log('  ' + pad('colour', 26) + pad('on', 12) + pad('ratio', 9) + 'needs');
for (const c of PALETTE_UNDER_TEST.contrast) {
  const ratio = contrast(c.hex, c.on);

  // A fill may sit below 3:1 when an adjacent boundary carries the contrast
  // instead - WCAG 1.4.11 says so explicitly, and it is the only way a light
  // brand colour can ever be used on white. The concession is not free: the
  // outline is then the thing under test, and it has to pass on its own.
  if (c.role === 'fill') {
    const outlineRatio = contrast(c.outline, c.on);
    const line =
      pad(`${c.name} ${c.hex}`, 26) +
      pad(c.on, 12) +
      pad(ratio.toFixed(2), 9) +
      `fill is exempt; its outline ${c.outline} scores ${outlineRatio.toFixed(2)}, needs ${CONTRAST_SHAPE}`;
    if (outlineRatio + 1e-9 < CONTRAST_SHAPE) fail(line);
    else pass(line);
    continue;
  }

  const needs = c.role === 'text' ? CONTRAST_TEXT : CONTRAST_SHAPE;
  const line =
    pad(`${c.name} ${c.hex}`, 26) + pad(c.on, 12) + pad(ratio.toFixed(2), 9) + `${needs} (${c.role})`;
  if (ratio + 1e-9 < needs) fail(line);
  else pass(line);
}

console.log('\nseparation between data colours (CIEDE2000, worst case over all vision types)');
for (const group of PALETTE_UNDER_TEST.groups) {
  console.log(`\n  ${group.name} — ${group.note}`);
  const names = Object.keys(group.colours);
  for (let i = 0; i < names.length; i += 1) {
    for (let j = i + 1; j < names.length; j += 1) {
      const [a, b] = [group.colours[names[i]], group.colours[names[j]]];
      const scores = [null, 'protanopia', 'deuteranopia', 'tritanopia'].map((kind) => ({
        kind: kind ?? 'normal',
        dE: deltaE(simulate(a, kind), simulate(b, kind)),
      }));
      const worst = scores.reduce((m, s) => (s.dE < m.dE ? s : m));
      const line =
        pad(`${names[i]} ↔ ${names[j]}`, 30) +
        pad(`ΔE ${worst.dE.toFixed(1)}`, 12) +
        `worst under ${worst.kind}` +
        `   [${scores.map((s) => `${s.kind.slice(0, 4)} ${s.dE.toFixed(1)}`).join('  ')}]`;
      if (worst.dE < SEPARATION) fail(line);
      else pass(line);
    }
  }
}

console.log(
  failures === 0
    ? '\nPALETTE OK — every pair separable under all three simulated deficiencies.\n'
    : `\n${failures} FAILURE(S). The palette is not safe to ship.\n`,
);
process.exit(failures === 0 ? 0 : 1);
