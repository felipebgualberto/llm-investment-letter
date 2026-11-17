/**
 * Extract XP's own logo from the PDFs XP supplied with this case.
 *
 * WHY EXTRACT RATHER THAN DOWNLOAD
 * --------------------------------
 * The letter needed the real brand mark and there were three ways to get one:
 * draw a lookalike, pull a file off the internet, or take the one that was
 * already in the case materials. The third is the only one with clean
 * provenance. `Input/XP - Albert_s risk profile.pdf` is a document XP produced
 * and handed over for this exercise, and its header carries the XP Inc. logo as
 * an embedded image. Nothing is fetched, nothing is guessed, and the asset in
 * this repository can be traced back to a file in the brief.
 *
 * WHAT IT PRODUCES
 * ----------------
 * assets/xp-logo.png - the mark, cropped to its ink bounds, with the black
 * background keyed out to transparency so it sits on the letterhead band or on
 * white without a visible box around it.
 *
 * HOW THE KEYING WORKS
 * --------------------
 * The source is white lettering plus a bright gradient on PURE black, which is
 * the easy case. Alpha is the brightest channel and the colour is that pixel
 * un-premultiplied against it:
 *
 *     a = max(r,g,b)          black -> 0, white -> 255
 *     rgb = rgb / a * 255     restores the gradient's hue at partial alpha
 *
 * A simple "make black transparent" threshold would instead punch holes in the
 * dark end of the gradient.
 *
 * Run: npm run brand-mark
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync, deflateSync } from 'node:zlib';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = resolve(root, '../Input/XP - Albert_s risk profile.pdf');
const OUT = resolve(root, 'assets/xp-logo.png');

// A second variant, on the black band it was designed for.
//
// The transparent version is white artwork, so it is invisible on a white page
// and only works inside the HTML letterhead, which paints its own black band.
// Word has no equivalent that renders identically everywhere, so the band is
// baked into the image for the .docx reports.
const OUT_ON_BLACK = resolve(root, 'assets/xp-logo-on-black.png');
const BAND_PAD_X = 34;
const BAND_PAD_Y = 22;

// The image object holding the header logo, and its published dimensions. Both
// are asserted against the file rather than trusted, so a different edition of
// the PDF fails loudly instead of writing out a wrong crop.
const OBJECT = 6;
const EXPECT = { width: 563, height: 222 };

// --- read the image object out of the PDF ----------------------------------

const raw = readFileSync(SOURCE);
const s = raw.toString('latin1');

const start = s.search(new RegExp(`(?:^|[^0-9])${OBJECT}\\s+0\\s+obj`));
if (start < 0) throw new Error(`Object ${OBJECT} not found in ${SOURCE}`);

const streamAt = s.indexOf('stream', start);
const header = s.slice(start, streamAt);
const field = (k) => header.match(new RegExp(`/${k}\\s*/?([A-Za-z0-9.+-]+)`))?.[1] ?? null;

if (!/\/Subtype\s*\/Image/.test(header)) throw new Error(`Object ${OBJECT} is not an image.`);
const width = Number(field('Width'));
const height = Number(field('Height'));
if (width !== EXPECT.width || height !== EXPECT.height) {
  throw new Error(
    `Expected the ${EXPECT.width}x${EXPECT.height} header logo, found ${width}x${height}. ` +
      'The source PDF has changed; re-identify the object before trusting the output.',
  );
}
if (field('Filter') !== 'FlateDecode') throw new Error(`Unexpected filter ${field('Filter')}.`);

let p = streamAt + 'stream'.length;
if (s[p] === '\r') p += 1;
if (s[p] === '\n') p += 1;
const rgb = inflateSync(raw.subarray(p, p + Number(field('Length'))));
if (rgb.length !== width * height * 3) {
  throw new Error(`Expected ${width * height * 3} bytes of RGB, got ${rgb.length}.`);
}

// --- crop to the ink -------------------------------------------------------

const INK = 40; // anything brighter than this on any channel is artwork
let x0 = width;
let y0 = height;
let x1 = 0;
let y1 = 0;
for (let y = 0; y < height; y += 1) {
  for (let x = 0; x < width; x += 1) {
    const o = (y * width + x) * 3;
    if (rgb[o] > INK || rgb[o + 1] > INK || rgb[o + 2] > INK) {
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
}
if (x1 < x0 || y1 < y0) throw new Error('No artwork found in the image.');

const cw = x1 - x0 + 1;
const ch = y1 - y0 + 1;
const rgba = Buffer.alloc(cw * ch * 4);
for (let y = 0; y < ch; y += 1) {
  for (let x = 0; x < cw; x += 1) {
    const src = ((y + y0) * width + (x + x0)) * 3;
    const dst = (y * cw + x) * 4;
    const r = rgb[src];
    const g = rgb[src + 1];
    const b = rgb[src + 2];
    const a = Math.max(r, g, b);
    rgba[dst] = a === 0 ? 0 : Math.min(255, Math.round((r / a) * 255));
    rgba[dst + 1] = a === 0 ? 0 : Math.min(255, Math.round((g / a) * 255));
    rgba[dst + 2] = a === 0 ? 0 : Math.min(255, Math.round((b / a) * 255));
    rgba[dst + 3] = a;
  }
}

// --- write the PNG ---------------------------------------------------------

const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
const crc32 = (buf) => {
  let c = -1;
  for (let i = 0; i < buf.length; i += 1) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};
const chunk = (type, body) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(body.length);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), body]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};

function png(path, w, h, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const stride = w * 4;
  const rows = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y += 1) {
    rows[y * (stride + 1)] = 0; // filter: none
    rgba.copy(rows, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(rows, { level: 9 })),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  );
}

png(OUT, cw, ch, rgba);

// The banded variant: the same crop, composited onto the black it was drawn
// for, with breathing room around it.
const bw = cw + BAND_PAD_X * 2;
const bh = ch + BAND_PAD_Y * 2;
const band = Buffer.alloc(bw * bh * 4);
for (let i = 0; i < bw * bh; i += 1) band[i * 4 + 3] = 255; // opaque black
for (let y = 0; y < ch; y += 1) {
  for (let x = 0; x < cw; x += 1) {
    const src = ((y + y0) * width + (x + x0)) * 3;
    const dst = ((y + BAND_PAD_Y) * bw + (x + BAND_PAD_X)) * 4;
    // Straight from the PDF, which is already white-on-black: no keying and no
    // un-premultiply, so the gradient is exactly the artwork XP shipped.
    band[dst] = rgb[src];
    band[dst + 1] = rgb[src + 1];
    band[dst + 2] = rgb[src + 2];
    band[dst + 3] = 255;
  }
}
png(OUT_ON_BLACK, bw, bh, band);

console.log(`source : ${SOURCE.split(/[\\/]/).pop()}  (object ${OBJECT}, ${width}x${height})`);
console.log(`cropped: ${cw}x${ch} from (${x0},${y0})`);
console.log(`wrote  : ${OUT}`);
console.log(`wrote  : ${OUT_ON_BLACK}  (${bw}x${bh}, para .docx)`);
