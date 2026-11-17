/**
 * SVG charts, written by hand and without a dependency.
 *
 * WHY NO CHART LIBRARY
 * --------------------
 * Every figure plotted here has already been computed, checked and reconciled
 * upstream. A charting library would add a build step, a runtime, and a second
 * place where a number could be transformed - resampled, smoothed, rounded to
 * fit an axis - without anything noticing. These functions take numbers and
 * place them; they never compute a value the engine did not already publish.
 *
 * The output is inline SVG so it embeds directly in the letter's HTML and
 * survives the print-to-PDF step at full resolution.
 *
 * DESIGN RULES
 * ------------
 * One accent colour, one negative colour, everything else grey. Values are
 * printed next to the marks rather than left to an axis, because a client
 * reads a letter once and should never have to measure a bar against a ruler.
 * No gridlines competing with the data. No legend where a direct label fits.
 */

/**
 * Palette, validated rather than chosen by eye — and now in the house colours.
 *
 * The first version used a green/red pair for gains and losses: the obvious
 * choice, and wrong. Simulated under protanopia the two colours land 4.6 ΔE
 * apart, so a red-green colourblind reader - roughly one man in twelve - could
 * not tell the best position in the portfolio from the worst. In a chart whose
 * whole point is one bar pointing left and another pointing right, that is not
 * a styling detail.
 *
 * Adopting XP's black and yellow was a second chance to get it wrong, because
 * yellow is a light colour and light colours vanish on white paper. The rule
 * that came out of measuring it: black carries gains, a deep red carries
 * losses (ΔE 25.0 apart at worst, under protanopia), and yellow is reserved
 * for the house's own marks - filled and outlined on white, or free-standing
 * on the black letterhead.
 *
 * Every number above is printed by `npm run palette`. Sign is still carried
 * twice regardless - by the direction of the bar and by the signed label - so
 * colour is never the only encoding.
 */
import {
  INK,
  MUTED,
  RULE,
  PAPER,
  POSITIVE,
  NEGATIVE,
  ACCENT,
  HIGHLIGHT,
  CAT,
  YELLOW_DARK,
  SLEEVE,
} from './brand.js';

/** Escape text for safe inclusion in SVG. */
const esc = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const fmtPp = (v) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(2).replace('.', ',')} p.p.`;
const fmtPct = (v, d = 2) => `${(v * 100).toFixed(d).replace('.', ',')}%`;
const fmtBrl = (v) =>
  `R$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Shared <svg> wrapper with a title and subtitle. */
function frame({ width, height, title, subtitle, body }) {
  // `height: auto` on the element itself is not optional. An inline SVG with
  // width="100%" and no height does not reliably take its height from the
  // viewBox: the default height attribute is 100%, which resolves against a
  // container that may itself be auto-sized, and the chart stretches to fill
  // the page. Setting the aspect ratio explicitly makes it behave identically
  // in the browser and in the print-to-PDF pass.
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" height="auto" preserveAspectRatio="xMinYMin meet" style="display:block;width:100%;height:auto;max-width:${width}px" role="img" aria-label="${esc(title)}">
  <style>
    .t  { font: 600 13px system-ui, -apple-system, 'Segoe UI', sans-serif; fill: ${INK}; }
    .st { font: 400 10.5px system-ui, -apple-system, 'Segoe UI', sans-serif; fill: ${MUTED}; }
    .l  { font: 400 11px system-ui, -apple-system, 'Segoe UI', sans-serif; fill: ${INK}; }
    .v  { font: 600 11px system-ui, -apple-system, 'Segoe UI', sans-serif; }
    .ax { font: 400 9.5px system-ui, -apple-system, 'Segoe UI', sans-serif; fill: ${MUTED}; }
  </style>
  <text class="t" x="0" y="14">${esc(title)}</text>
  ${subtitle ? `<text class="st" x="0" y="30">${esc(subtitle)}</text>` : ''}
  ${body}
</svg>`;
}

/**
 * Performance attribution: how much each position moved the portfolio, in
 * percentage points of the measured base.
 *
 * A diverging bar chart rather than a pie: the question a client asks is "what
 * moved my money", and only a signed scale answers it. The bars sum to the
 * headline return, and the remainder row is what keeps that true.
 */
export function attributionChart(plan, { width = 620, bySleeve = null } = {}) {
  const a = plan.letter.attribution;

  // GROUPED BY CLASS, and this was a real reporting defect before it was a
  // design choice.
  //
  // Selecting the top two contributors and top two detractors by size gave
  // HAPV3, LREN3 and MRFG3 - all three of them equities. Equities are 22% of
  // the measured portfolio and swing hardest, so ranking by magnitude picks
  // them every time. The funds, 78% of the measured portfolio and +1,89 of the
  // +2,62 p.p. the client actually earned, were collapsed into an unnamed
  // "demais posições" bar.
  //
  // The client's largest sleeve cannot be the anonymous one. So the rows are
  // now the CLASSES, each followed by the positions inside it that moved most.
  //
  // The count per class is FIXED, and that uniformity is the whole point. The
  // first attempt kept the letter's global top contributors and detractors and
  // merely added class headers above them - which reproduced the same bias in a
  // new shape: four equity rows against one fund row, because the ranking that
  // chose them still ran across the whole portfolio. Taking the same number
  // from each class is what makes the comparison fair: two names for the 78%
  // and two for the 22%.
  const NAMES_PER_SLEEVE = 2;
  const rows = [];
  if (bySleeve?.length) {
    for (const s of [...bySleeve].sort((x, y) => y.contribution_pp - x.contribution_pp)) {
      rows.push({
        label: SLEEVE[s.sleeve]?.label_pt ?? s.sleeve,
        pp: s.contribution_pp,
        head: true,
        note: `${s.count} ${s.count === 1 ? 'posição' : 'posições'} · ${fmtPct(s.return)}`,
      });
      // Ranked by absolute contribution, so the class's biggest loser can be
      // named as readily as its biggest winner.
      for (const m of (a.sleeve_movers?.[s.sleeve] ?? []).slice(0, NAMES_PER_SLEEVE)) {
        rows.push({ label: m.label, pp: m.contribution_pp, child: true });
      }
    }
  } else {
    rows.push(
      ...a.contributors.map((c) => ({ label: c.label, pp: c.contribution_pp })),
      ...a.detractors.map((c) => ({ label: c.label, pp: c.contribution_pp })),
    );
    if (a.remainder) {
      rows.push({ label: a.remainder.label_pt, pp: a.remainder.contribution_pp, muted: true });
    }
  }

  const top = 46;
  const rowH = 24;
  const height = top + rows.length * rowH + 32;
  const labelW = 200;
  const plotW = width - labelW - 92;
  const span = Math.max(...rows.map((r) => Math.abs(r.pp)), 0.1);
  const zero = labelW + plotW / 2;
  const scale = (plotW / 2) / span;

  const bars = rows.map((r, i) => {
    const y = top + i * rowH;
    const w = Math.abs(r.pp) * scale;
    const x = r.pp >= 0 ? zero : zero - w;
    const fill = r.muted ? MUTED : r.pp >= 0 ? POSITIVE : NEGATIVE;
    const valueX = r.pp >= 0 ? zero + w + 8 : zero - w - 8;
    const anchor = r.pp >= 0 ? 'start' : 'end';
    // A class row is bold and full height; a position inside it is indented and
    // drawn thinner, so the hierarchy is legible without a second colour.
    const barH = r.head ? 14 : 9;
    const barY = y + (r.head ? 3 : 5);
    const indent = r.child ? 12 : 0;
    return `<text class="l" x="${indent}" y="${y + 13}"${r.head ? ' font-weight="600"' : ` fill="${MUTED}"`}>${esc(r.label.length > 28 ? r.label.slice(0, 27) + "…" : r.label)}</text>${
      r.note ? `\n  <text class="ax" x="${labelW - 8}" y="${y + 13}" text-anchor="end">${esc(r.note)}</text>` : ''
    }
  <rect x="${x.toFixed(1)}" y="${barY}" width="${Math.max(w, 1).toFixed(1)}" height="${barH}" rx="2" fill="${fill}" opacity="${r.head ? 0.95 : 0.5}"/>
  <text class="v" x="${valueX.toFixed(1)}" y="${y + 13}" text-anchor="${anchor}" fill="${fill}"${r.head ? '' : ' font-weight="400"'}>${fmtPp(r.pp)}</text>`;
  }).join('\n  ');

  const totalY = top + rows.length * rowH + 6;
  return frame({
    width, height,
    title: 'O que moveu a sua carteira',
    subtitle: bySleeve?.length
      // 'apurada' is doing real work: the fixed-income sleeve has no measurable
      // monthly return, so it has no row. Saying 'cada classe' would promise a
      // completeness the chart does not have.
      ? 'Contribuição de cada classe apurada, e a posição que mais pesou dentro dela'
      : 'Contribuição de cada posição para o resultado do mês, em pontos percentuais',
    body: `<line x1="${zero}" y1="${top - 4}" x2="${zero}" y2="${top + rows.length * rowH - 6}" stroke="${RULE}" stroke-width="1"/>
  ${bars}
  <line x1="0" y1="${totalY}" x2="${width}" y2="${totalY}" stroke="${RULE}"/>
  <text class="l" x="0" y="${totalY + 18}" font-weight="600">Total</text>
  <text class="v" x="${width}" y="${totalY + 18}" text-anchor="end" fill="${INK}">${fmtPp(a.total_pp)}</text>`,
  });
}

/**
 * The portfolio against the references that matter, plus the drag from balances
 * that are not working.
 *
 * The net-worth bar is the honest one: it is what the client's money actually
 * did, and the gap to the measured bar is the cost of the idle cash - the same
 * number the first recommendation is built on.
 */
export function benchmarkChart(metrics, { width = 620 } = {}) {
  // `fill` paints the bar, `ink` prints its value. They differ for the one
  // yellow bar: the fill is the house colour, the label is the darker amber,
  // because yellow text on white is 1.56:1 and simply does not read.
  const bars = [
    { label: 'Carteira (parcela medida)', value: metrics.portfolio_return, fill: ACCENT, ink: ACCENT },
    {
      label: 'Seu patrimônio',
      value: metrics.sensitivity?.net_worth?.return,
      fill: HIGHLIGHT,
      stroke: YELLOW_DARK,
      ink: YELLOW_DARK,
    },
    { label: 'CDI', value: metrics.versus.cdi?.value, fill: MUTED, ink: MUTED },
    { label: 'Inflação (IPCA)', value: metrics.versus.ipca?.value, fill: MUTED, ink: MUTED },
  ].filter((b) => Number.isFinite(b.value));

  const top = 48;
  const rowH = 34;
  const height = top + bars.length * rowH + 14;
  const labelW = 200;
  const plotW = width - labelW - 78;
  const max = Math.max(...bars.map((b) => b.value));
  const scale = plotW / (max || 1);

  const body = bars.map((b, i) => {
    const y = top + i * rowH;
    const w = Math.max(b.value * scale, 2);
    return `<text class="l" x="0" y="${y + 15}">${esc(b.label)}</text>
  <rect x="${labelW}" y="${y + 3}" width="${w.toFixed(1)}" height="17" rx="2" fill="${b.fill}" opacity="0.9"${b.stroke ? ` stroke="${b.stroke}" stroke-width="1"` : ''}/>
  <text class="v" x="${(labelW + w + 8).toFixed(1)}" y="${y + 16}" fill="${b.ink}">${fmtPct(b.value)}</text>`;
  }).join('\n  ');

  const drag = metrics.sensitivity?.net_worth?.drag_vs_measured_pp;
  const note = Number.isFinite(drag)
    ? `A diferença de ${drag.toFixed(2).replace('.', ',')} p.p. entre as duas primeiras barras é o custo do saldo parado.`
    : '';

  return frame({
    width, height,
    title: 'Como o mês se compara',
    subtitle: note,
    body,
  });
}

/**
 * The Focus consensus for one indicator, plotted over time, with the house view
 * and - when supplied - the figure the v1 letter published.
 *
 * This chart is the argument of the whole project in one picture. The v1 wrote
 * "a Selic deve se estabilizar em 9%". The Focus median for Selic 2025 WAS
 * 9,00% in May 2024. The model was not inventing; it was reciting the consensus
 * of its training window while a February 2025 document in its context said
 * 15,50%. Deterministic extraction is not a stylistic preference.
 */
export function consensusHistoryChart(history, { houseValue, houseLabel, markValue, markLabel, title, width = 620, height = 260 } = {}) {
  const pts = history.points;
  const left = 46;
  const right = 168;
  const top = 52;
  const bottom = 30;
  const plotW = width - left - right;
  const plotH = height - top - bottom;

  const values = [
    ...pts.map((p) => p.median),
    ...(Number.isFinite(houseValue) ? [houseValue] : []),
    ...(Number.isFinite(markValue) ? [markValue] : []),
  ];
  const min = Math.floor(Math.min(...values) - 1);
  const max = Math.ceil(Math.max(...values) + 1);
  const x = (i) => left + (i / Math.max(pts.length - 1, 1)) * plotW;
  const y = (v) => top + plotH - ((v - min) / (max - min)) * plotH;

  const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.median).toFixed(1)}`).join(' ');
  const band = [
    ...pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.max).toFixed(1)}`),
    ...pts.slice().reverse().map((p, i) => `L${x(pts.length - 1 - i).toFixed(1)},${y(p.min).toFixed(1)}`),
    'Z',
  ].join(' ');

  const ticks = [min, (min + max) / 2, max].map(
    (v) => `<line x1="${left}" y1="${y(v).toFixed(1)}" x2="${left + plotW}" y2="${y(v).toFixed(1)}" stroke="${RULE}"/>
  <text class="ax" x="${left - 6}" y="${(y(v) + 3).toFixed(1)}" text-anchor="end">${v.toFixed(0)}%</text>`,
  ).join('\n  ');

  const monthsPt = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  const dateLabels = [0, Math.floor(pts.length / 2), pts.length - 1].map((i) => {
    const [yy, mm] = pts[i].date.split('-');
    return `<text class="ax" x="${x(i).toFixed(1)}" y="${top + plotH + 16}" text-anchor="middle">${monthsPt[Number(mm) - 1]}/${yy.slice(2)}</text>`;
  }).join('\n  ');

  // The v1's figure, marked where the consensus actually passed through it.
  let mark = '';
  if (Number.isFinite(markValue)) {
    let best = 0;
    for (let i = 1; i < pts.length; i += 1) {
      if (Math.abs(pts[i].median - markValue) < Math.abs(pts[best].median - markValue)) best = i;
    }
    mark = `<circle cx="${x(best).toFixed(1)}" cy="${y(markValue).toFixed(1)}" r="4.5" fill="none" stroke="${NEGATIVE}" stroke-width="2"/>
  <line x1="${x(best).toFixed(1)}" y1="${y(markValue).toFixed(1)}" x2="${left + plotW + 10}" y2="${y(markValue).toFixed(1)}" stroke="${NEGATIVE}" stroke-dasharray="2 3"/>
  <text class="ax" x="${left + plotW + 14}" y="${(y(markValue) - 2).toFixed(1)}" fill="${NEGATIVE}" font-weight="600">${esc(markLabel ?? '')}</text>
  <text class="ax" x="${left + plotW + 14}" y="${(y(markValue) + 10).toFixed(1)}" fill="${NEGATIVE}">${markValue.toFixed(2).replace('.', ',')}% em ${(() => { const [yy, mm] = pts[best].date.split('-'); return `${monthsPt[Number(mm) - 1]}/${yy.slice(2)}`; })()}</text>`;
  }

  const lastIdx = pts.length - 1;

  // The right-hand gutter holds up to three two-line labels - the house view,
  // the consensus and the v1 marker - each anchored to its own value. When two
  // of those values are close, so are their labels: for Selic 2025 the house
  // sits at 15,50% and the consensus at 15,00%, four pixels apart, and the two
  // captions printed straight through each other.
  //
  // Rather than move a label to wherever there is room - which would break the
  // link between a caption and the line it names - the house label is nudged up
  // only as far as needed to clear the consensus one, and only ever upward, so
  // it stays on the correct side of the line it belongs to.
  const MIN_GAP = 19;
  const consensusY = y(pts[lastIdx].median);
  let houseLabelY = Number.isFinite(houseValue) ? y(houseValue) : null;
  if (houseLabelY !== null && Math.abs(houseLabelY - consensusY) < MIN_GAP) {
    houseLabelY = consensusY - MIN_GAP;
  }

  let house = '';
  if (Number.isFinite(houseValue)) {
    house = `<line x1="${left}" y1="${y(houseValue).toFixed(1)}" x2="${left + plotW + 10}" y2="${y(houseValue).toFixed(1)}" stroke="${YELLOW_DARK}" stroke-width="1.5"/>
  <text class="ax" x="${left + plotW + 14}" y="${(houseLabelY - 2).toFixed(1)}" fill="${YELLOW_DARK}" font-weight="600">${esc(houseLabel ?? 'XP')}</text>
  <text class="ax" x="${left + plotW + 14}" y="${(houseLabelY + 10).toFixed(1)}" fill="${YELLOW_DARK}">${houseValue.toFixed(2).replace('.', ',')}%</text>`;
  }
  return frame({
    width, height,
    // "para a Selic" is right and "para a IPCA" is not: the indicator's gender
    // varies and the chart does not know it. The dash sidesteps the article
    // entirely and stays correct for whatever indicator is passed in.
    title: title ?? `Consenso de mercado — ${history.indicator} ${history.reference_year}`,
    subtitle: `Mediana do Boletim Focus, ${history.observations} pesquisas. Faixa sombreada: mínimo e máximo das projeções.`,
    body: `${ticks}
  <path d="${band}" fill="${ACCENT}" opacity="0.08"/>
  <path d="${line}" fill="none" stroke="${ACCENT}" stroke-width="2"/>
  <circle cx="${x(lastIdx).toFixed(1)}" cy="${y(pts[lastIdx].median).toFixed(1)}" r="3.5" fill="${ACCENT}"/>
  <text class="ax" x="${left + plotW + 14}" y="${(y(pts[lastIdx].median) + 3).toFixed(1)}" fill="${ACCENT}" font-weight="600">consenso ${pts[lastIdx].median.toFixed(2).replace('.', ',')}%</text>
  ${house}
  ${mark}
  ${dateLabels}`,
  });
}

/**
 * Where the money actually is: one stacked bar over the whole net worth.
 *
 * WHY A BAR AND NOT A PIE
 * -----------------------
 * The obvious form for a part-of-whole is a pie, and it is the wrong one here.
 * The reader's job is to COMPARE the three parts - is the idle slice big or
 * small next to the working one? - and length is far easier to compare than
 * angle. A single stacked bar also lets every segment carry its own reais and
 * percentage inline, which a pie cannot without leader lines.
 *
 * It also keeps one visual language: every chart in this letter is a horizontal
 * bar, so nothing has to be re-learned mid-page.
 *
 * The chart exists to make one fact unmissable before the proposals paragraph:
 * a fifth of the client's money is sitting still.
 */
export function allocationChart(metrics, portfolio, { width = 620 } = {}) {
  const netWorth = portfolio.totals.net_worth;
  const measured = metrics.coverage.measured_value;
  const unmeasured = metrics.coverage.unmeasured_value;
  const cash = portfolio.totals.available_cash;

  // `ink` is the colour of the percentage printed INSIDE the segment. It is
  // decided per segment rather than fixed to white, because the middle segment
  // is XP yellow and white on yellow is 1.2:1 - the label would simply not be
  // there. Dark text on the light fill, light text on the dark ones.
  const segments = [
    { label: 'Investido e apurado', value: measured, fill: CAT[0], ink: PAPER },
    { label: 'Investido sem apuração', value: unmeasured, fill: CAT[1], ink: INK },
    { label: 'Saldo em conta, sem aplicação', value: cash, fill: CAT[2], ink: PAPER },
  ];

  const top = 52;
  const barH = 34;
  const gap = 2; // surface gap between segments, so fills never touch
  const plotW = width;
  const height = top + barH + 26 + segments.length * 19;

  let x = 0;
  const bars = segments.map((s, i) => {
    const w = (s.value / netWorth) * plotW - (i < segments.length - 1 ? gap : 0);
    const rect = `<rect x="${x.toFixed(1)}" y="${top}" width="${Math.max(w, 1).toFixed(1)}" height="${barH}" fill="${s.fill}" ${i === 0 ? 'rx="3"' : i === segments.length - 1 ? 'rx="3"' : ''}/>`;
    // Percentage inside the segment when it is wide enough to hold the text.
    const pctLabel = w > 46
      ? `<text class="v" x="${(x + w / 2).toFixed(1)}" y="${top + barH / 2 + 4}" text-anchor="middle" fill="${s.ink}">${fmtPct(s.value / netWorth, 1)}</text>`
      : '';
    x += w + gap;
    return rect + pctLabel;
  }).join('\n  ');

  // A legend is required for three series; each entry also carries its value,
  // so identity never rests on colour alone.
  const legend = segments.map((s, i) => {
    const y = top + barH + 24 + i * 19;
    return `<rect x="0" y="${y - 8}" width="9" height="9" rx="2" fill="${s.fill}"/>
  <text class="l" x="15" y="${y}">${esc(s.label)}</text>
  <text class="v" x="${width}" y="${y}" text-anchor="end" fill="${INK}">${fmtBrl(s.value)}</text>`;
  }).join('\n  ');

  return frame({
    width, height,
    title: 'Onde está o seu patrimônio',
    subtitle: `Total de ${fmtBrl(netWorth)} na data do extrato`,
    body: `${bars}\n  ${legend}`,
  });
}

/**
 * XP's projection against the full range of market forecasts.
 *
 * The macro paragraph claims XP sits in the 89th percentile of 140 institutions.
 * A time series would show how the consensus MOVED; this shows what the
 * paragraph actually asserts - where the house stands inside the spread, today.
 * One row per indicator, the span from lowest to highest forecast, a tick at the
 * median, and XP marked on it.
 *
 * The forensic time-series version lives in consensusHistoryChart and belongs in
 * the presentation, not in a client letter: a marker labelled "carta v1" is a
 * note about our own past error, and the client is not the audience for it.
 */
export function consensusRangeChart(comparisons, { width = 620 } = {}) {
  const rows = comparisons.filter(
    (c) => Number.isFinite(c.consensus_min) && Number.isFinite(c.consensus_max) && c.consensus_max > c.consensus_min,
  );
  if (rows.length === 0) return null;

  const top = 46;
  const rowH = 34;
  const height = top + rows.length * rowH + 10;
  const labelW = 74;
  const plotW = width - labelW - 96;

  const body = rows.map((c, i) => {
    const y = top + i * rowH;
    const span = c.consensus_max - c.consensus_min;
    const at = (v) => labelW + ((v - c.consensus_min) / span) * plotW;
    const num = (v) => `${v.toFixed(2).replace('.', ',')}%`;

    return `<text class="l" x="0" y="${y + 10}" font-weight="600">${esc(c.indicator === 'PIB Total' ? 'PIB' : c.indicator)}</text>
  <line x1="${labelW}" y1="${y + 6}" x2="${labelW + plotW}" y2="${y + 6}" stroke="${RULE}" stroke-width="6" stroke-linecap="round"/>
  <line x1="${at(c.consensus_median).toFixed(1)}" y1="${y - 1}" x2="${at(c.consensus_median).toFixed(1)}" y2="${y + 13}" stroke="${MUTED}" stroke-width="2"/>
  <circle cx="${at(c.house_value).toFixed(1)}" cy="${(y + 6).toFixed(1)}" r="6" fill="${HIGHLIGHT}" stroke="${YELLOW_DARK}" stroke-width="1.5"/>
  <text class="ax" x="${labelW}" y="${y + 26}">${num(c.consensus_min)}</text>
  <text class="ax" x="${at(c.consensus_median).toFixed(1)}" y="${y + 26}" text-anchor="middle" fill="${MUTED}">mediana ${num(c.consensus_median)}</text>
  <text class="ax" x="${labelW + plotW}" y="${y + 26}" text-anchor="end">${num(c.consensus_max)}</text>
  <text class="v" x="${width}" y="${y + 10}" text-anchor="end" fill="${YELLOW_DARK}">XP ${num(c.house_value)}</text>`;
  }).join('\n  ');

  const respondents = rows[0].respondents;
  return frame({
    width, height,
    title: 'A projeção da XP diante do mercado',
    subtitle: respondents
      ? `Faixa completa das projeções de ${respondents} instituições no Boletim Focus, com a mediana marcada`
      : 'Faixa das projeções de mercado, com a mediana marcada',
    body,
  });
}

/**
 * Every position the client holds, as a two-ring composition chart.
 *
 * WHY A RING HERE, HAVING ARGUED AGAINST ONE ABOVE
 * ------------------------------------------------
 * `allocationChart` deliberately is not a pie, and the reasoning still stands:
 * when the question is "compare these three magnitudes", length beats angle.
 *
 * This chart asks a different question. "How is my money spread out" is a
 * question about COMPOSITION - one whole, divided - and that is the one shape a
 * ring genuinely reads better than a bar chart, because the whole is drawn as a
 * whole. Thirteen bars would answer "which is biggest" precisely and leave the
 * client counting rows to see that two funds are more than half of everything.
 *
 * The chart is not asked to be readable to the decimal, and it does not try:
 * exact figures live in the legend beside it, ordered identically. The ring
 * carries the impression, the legend carries the numbers, and neither is doing
 * the other's job.
 *
 * WHY TWO RINGS
 * -------------
 * The inner ring is the asset class, the outer ring the individual positions
 * inside it. Nesting ties a position to its class by geometry rather than by
 * colour, which is what lets the whole figure run on three greys and a yellow
 * instead of thirteen hues nobody could tell apart.
 *
 * DENOMINATOR
 * -----------
 * Net worth, not invested. The statement's own weights are shares of the
 * invested total, which silently drops the 19,3% sitting in cash - and a
 * composition chart that omits a fifth of the money is not a composition chart.
 * The slices sum to the net worth printed in the middle, exactly.
 */
/**
 * Group a portfolio into classes and the positions inside them, largest first.
 *
 * Shared by the single ring and the before/after pair so the two can never
 * disagree about what a class contains or which colour it wears.
 */
function sleeveGroups(portfolio, { cashOverride = null, extra = [] } = {}) {
  const bySleeve = new Map();
  for (const h of portfolio.holdings ?? []) {
    if (!bySleeve.has(h.sleeve)) bySleeve.set(h.sleeve, []);
    bySleeve.get(h.sleeve).push({ label: h.ticker || h.name, value: h.market_value });
  }

  const groups = [...bySleeve.entries()].map(([sleeve, items]) => ({
    key: sleeve,
    label: SLEEVE[sleeve]?.label_pt ?? sleeve,
    fill: SLEEVE[sleeve]?.fill ?? MUTED,
    stroke: SLEEVE[sleeve]?.stroke ?? null,
    items: items.sort((a, b) => b.value - a.value),
    value: items.reduce((s, i) => s + i.value, 0),
  }));

  // A proposed allocation arrives as its own group rather than being folded
  // into the class it joins: merging it would show "renda fixa 19,8%" and hide
  // that half of it is a step the client has not taken yet.
  for (const e of extra) {
    groups.push({
      key: `proposed:${e.label_pt}`,
      label: e.label_pt,
      fill: SLEEVE[e.sleeve]?.fill ?? MUTED,
      stroke: SLEEVE[e.sleeve]?.stroke ?? null,
      proposed: true,
      items: [{ label: e.label_pt, value: e.value }],
      value: e.value,
    });
  }

  // Cash is a position like any other here. Leaving it out would make the ring
  // agree with the statement's weights and disagree with the client's money.
  const cash = cashOverride ?? portfolio.totals?.available_cash;
  if (Number.isFinite(cash) && cash > 0) {
    groups.push({
      key: 'cash',
      label: SLEEVE.cash.label_pt,
      fill: SLEEVE.cash.fill,
      stroke: SLEEVE.cash.stroke,
      // Labelled with the class name so the legend does not print
      // "Saldo em conta / Saldo em conta" on two lines.
      items: [{ label: SLEEVE.cash.label_pt, value: cash }],
      value: cash,
    });
  }
  groups.sort((a, b) => b.value - a.value);
  return groups;
}

/**
 * Draw one two-ring donut: inner ring the class, outer ring each position.
 *
 * Returns the paths only, so a caller can place two of them side by side.
 */
function donut(groups, total, { cx, cy, rOut, holeText = null }) {
  const rings = { innerFrom: rOut * 0.63, innerTo: rOut * 0.77, outerFrom: rOut * 0.82, outerTo: rOut };
  const GAP = 0.028;
  const TAU = Math.PI * 2;

  const point = (r, a) => [(cx + r * Math.sin(a)).toFixed(2), (cy - r * Math.cos(a)).toFixed(2)];
  const arc = (rIn, rO, a0, a1) => {
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const [xa, ya] = point(rO, a0);
    const [xb, yb] = point(rO, a1);
    const [xc, yc] = point(rIn, a1);
    const [xd, yd] = point(rIn, a0);
    return `M${xa},${ya} A${rO},${rO} 0 ${large} 1 ${xb},${yb} L${xc},${yc} A${rIn},${rIn} 0 ${large} 0 ${xd},${yd} Z`;
  };

  const out = [];
  let angle = 0;
  for (const g of groups) {
    const span = (g.value / total) * TAU;
    // A proposed slice is drawn hollow - outline only - so the eye reads it as
    // "not yet true". Relying on a colour alone would make it look like just
    // another holding.
    const paint = g.proposed
      ? ` fill="none" stroke="${g.stroke ?? INK}" stroke-width="1.4" stroke-dasharray="2.5 1.8"`
      : ` fill="${g.fill}"${g.stroke ? ` stroke="${g.stroke}" stroke-width="1"` : ''}`;

    out.push(`<path d="${arc(rings.innerFrom, rings.innerTo, angle + GAP / 2, angle + span - GAP / 2)}"${paint}/>`);

    let sub = angle;
    for (const item of g.items) {
      const subSpan = (item.value / total) * TAU;
      // A 0,08% position spans less than the gap itself. Clamping keeps it a
      // visible hairline rather than letting the arc invert and paint backwards.
      const a0 = sub + GAP / 2;
      const a1 = Math.max(sub + subSpan - GAP / 2, a0 + 0.004);
      out.push(`<path d="${arc(rings.outerFrom, rings.outerTo, a0, a1)}"${paint}/>`);
      sub += subSpan;
    }
    angle += span;
  }

  if (holeText) {
    out.push(
      `<text x="${cx}" y="${cy + 3}" text-anchor="middle" font-size="9" font-weight="600" fill="${INK}">${esc(holeText)}</text>`,
    );
  }
  return out.join('\n  ');
}

export function positionsChart(portfolio, { width = 620, concentration = null } = {}) {
  const netWorth = portfolio.totals?.net_worth;
  if (!Number.isFinite(netWorth) || netWorth <= 0) return null;

  const groups = sleeveGroups(portfolio);

  // --- geometry -------------------------------------------------------------
  const cx = 96;
  const top = 46;
  const rOut = 86;
  const cy = top + rOut + 2;
  // The hole has to fit "R$ 386.858,82" without touching the inner ring, so its
  // radius is set by the widest string it will hold rather than by proportion.
  // The hole has to hold the net-worth figure at 10.5px - roughly 85px wide -
  // without the ring cutting through it, so its radius is set by the widest
  // string it carries and never by proportion. An earlier pass shrank the ring
  // to save page height and left the text at full size; the total printed
  // straight across the slices.
  const rings = { innerFrom: 55, innerTo: 67, outerFrom: 71, outerTo: rOut };
  // A real white gap, wide enough to see in print, separates neighbouring
  // slices. The first draft used alternating opacity instead, which put a
  // 62%-opacity black next to the funds grey and made two different classes
  // look like the same one. A gap separates without inventing a colour.
  const GAP = 0.024;
  const TAU = Math.PI * 2;

  // 0 rad is twelve o'clock and angles run clockwise, which is how a reader
  // scans a composition chart and how the legend below is ordered.
  const point = (r, a) => [
    (cx + r * Math.sin(a)).toFixed(2),
    (cy - r * Math.cos(a)).toFixed(2),
  ];

  const arc = (rIn, rO, a0, a1) => {
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const [xa, ya] = point(rO, a0);
    const [xb, yb] = point(rO, a1);
    const [xc, yc] = point(rIn, a1);
    const [xd, yd] = point(rIn, a0);
    return `M${xa},${ya} A${rO},${rO} 0 ${large} 1 ${xb},${yb} L${xc},${yc} A${rIn},${rIn} 0 ${large} 0 ${xd},${yd} Z`;
  };

  const slices = [];
  let angle = 0;
  for (const g of groups) {
    const span = (g.value / netWorth) * TAU;
    const outline = g.stroke ? ` stroke="${g.stroke}" stroke-width="1"` : '';
    slices.push(
      `<path d="${arc(rings.innerFrom, rings.innerTo, angle + GAP / 2, angle + span - GAP / 2)}" fill="${g.fill}"${outline}/>`,
    );

    let sub = angle;
    for (const item of g.items) {
      const subSpan = (item.value / netWorth) * TAU;
      // A 0,08% position spans less than the gap itself. Clamping keeps it as a
      // visible hairline rather than letting the arc invert and paint backwards
      // across the whole ring.
      const a0 = sub + GAP / 2;
      const a1 = Math.max(sub + subSpan - GAP / 2, a0 + 0.004);
      slices.push(
        `<path d="${arc(rings.outerFrom, rings.outerTo, a0, a1)}" fill="${g.fill}"${outline}/>`,
      );
      sub += subSpan;
    }
    angle += span;
  }

  // --- legend ---------------------------------------------------------------
  //
  // TWO COLUMNS, and the reason is the page budget rather than taste. As a
  // single column this legend ran fifteen rows and made the chart 306px tall -
  // the tallest object in a two-page letter, and enough to push the figure above
  // it onto the next page and leave a third of page one empty.
  //
  // Splitting it also drops the reais column from the individual positions: the
  // class subtotals keep theirs, the positions keep name and share. A client
  // reading a ring is asking "how am I spread out", and the exact reais of every
  // line are in the advisor annex for whoever wants them.
  const lineH = 13.2;
  const colW = 205;
  const cols = [
    { x: 200, right: 200 + colW - 5 },
    { x: 200 + colW + 8, right: 200 + colW + 8 + colW - 5 },
  ];

  // Lay the rows out first, then deal them into columns. Building the SVG and
  // choosing the break at the same time makes the break impossible to move.
  const rows = [];
  for (const g of groups) {
    rows.push({ kind: 'group', g });
    const repeatsHeader = g.items.length === 1 && g.items[0].label === g.label;
    if (!repeatsHeader) {
      // When a class holds exactly one position, its figures ARE the class's
      // figures. Repeating them below looks like two holdings of R$ 40.478,75
      // rather than one, so the name alone identifies it.
      const echoesFigures = g.items.length === 1;
      for (const item of g.items) rows.push({ kind: 'item', item, echoesFigures });
    }
    rows.push({ kind: 'gap' });
  }
  if (rows[rows.length - 1]?.kind === 'gap') rows.pop();

  // Break between columns only at a class boundary, so a class header never
  // ends up at the foot of one column with its positions at the head of the
  // next.
  const half = Math.ceil(rows.length / 2);
  let cut = rows.length;
  for (let i = half; i < rows.length; i += 1) {
    if (rows[i].kind === 'group') { cut = i; break; }
  }
  if (cut === rows.length) {
    for (let i = half; i >= 0; i -= 1) {
      if (rows[i].kind === 'group') { cut = i; break; }
    }
  }

  const legend = [];
  let tallest = top + 8;
  for (const [ci, col] of cols.entries()) {
    const slice = ci === 0 ? rows.slice(0, cut) : rows.slice(cut);
    let ly = top + 8;
    for (const row of slice) {
      if (row.kind === 'gap') { ly += 4; continue; }
      if (row.kind === 'group') {
        const { g } = row;
        legend.push(
          `<rect x="${col.x}" y="${(ly - 7.5).toFixed(1)}" width="9" height="9" rx="2" fill="${g.fill}"${g.stroke ? ` stroke="${g.stroke}"` : ''}/>
  <text class="lg b" x="${col.x + 15}" y="${ly.toFixed(1)}">${esc(g.label)}</text>
  <text class="lg b" x="${col.right}" y="${ly.toFixed(1)}" text-anchor="end">${fmtPct(g.value / netWorth, 1)}</text>
  <text class="lg m" x="${col.x + 15}" y="${(ly + 10.5).toFixed(1)}">${fmtBrl(g.value)}</text>`,
        );
        ly += lineH + 10.5;
      } else {
        const name = String(row.item.label);
        const share = row.echoesFigures
          ? ''
          : `\n  <text class="lg m" x="${col.right}" y="${ly.toFixed(1)}" text-anchor="end">${fmtPct(row.item.value / netWorth, 1)}</text>`;
        legend.push(
          `<text class="lg m" x="${col.x + 15}" y="${ly.toFixed(1)}">${esc(name.length > 27 ? `${name.slice(0, 26)}…` : name)}</text>${share}`,
        );
        ly += lineH;
      }
    }
    if (ly > tallest) tallest = ly;
  }
  const ly = tallest;


  // The sentence the picture is already making, said out loud. A ring shows
  // that two slices are large; it does not tell the reader how much that
  // matters. The effective count does, in one number.
  let note = '';
  let noteHeight = 0;
  if (concentration && Number.isFinite(concentration.effective_positions)) {
    const eff = concentration.effective_positions.toFixed(1).replace('.', ',');
    const text =
      `${concentration.positions_held} posições, mas a concentração equivale a ${eff} de tamanho igual` +
      (concentration.positions_to_half
        ? ` — ${concentration.positions_to_half} delas somam metade do patrimônio.`
        : '.');
    noteHeight = 20;
    const noteY = Math.max(cy + rOut + 6, ly + 4) + 12;
    note = `<line x1="0" y1="${noteY - 12}" x2="${width}" y2="${noteY - 12}" stroke="${RULE}"/>
  <text class="st" x="0" y="${noteY + 2}">${esc(text)}</text>`;
  }

  // Rounded: the legend accumulates fractional row heights, and a viewBox of
  // "620 279.8000000000001" is the kind of detail that makes a reader wonder
  // what else was left unrounded.
  const height = Math.ceil(Math.max(cy + rOut + 6, ly + 4) + noteHeight);

  return frame({
    width,
    height,
    title: 'Como a sua carteira está distribuída hoje',
    subtitle:
      'Anel interno: classe de ativo. Anel externo: cada posição. Percentuais sobre o patrimônio total, a partir do topo, em sentido horário.',
    body: `<style>
    .lg { font: 400 9.6px system-ui, -apple-system, 'Segoe UI', sans-serif; }
    .lg.b { font-weight: 600; fill: ${INK}; }
    .lg.m { fill: ${MUTED}; }
  </style>
  ${slices.join('\n  ')}
  ${legend.join('\n  ')}
  <text x="${cx}" y="${cy - 1}" text-anchor="middle" font-size="10.5" font-weight="600" fill="${INK}">${fmtBrl(netWorth)}</text>
  <text class="ax" x="${cx}" y="${cy + 12}" text-anchor="middle">patrimônio total</text>
  ${note}`,
  });
}

/**
 * The portfolio today, beside the portfolio as the proposals would leave it.
 *
 * WHY BOTH RINGS AND NOT ONE ARROW
 * --------------------------------
 * A recommendation written as prose asks the client to hold two pictures in his
 * head and subtract them. Drawing both removes the arithmetic: the cash slice
 * visibly shrinks and a new, hollow slice appears where the money went. The
 * question a client actually asks about a proposal - "what would my portfolio
 * look like?" - is a question about a shape, and a shape is what this answers.
 *
 * WHAT THE RIGHT-HAND RING IS AND IS NOT
 * --------------------------------------
 * It is the SAME MONEY on the SAME DATE, rearranged. No return is projected
 * onto the new position and no market movement is applied to the old ones, so
 * both rings total the identical net worth - src/engine/proposed-allocation.js
 * asserts that rather than assuming it, and refuses to produce a drawable
 * result if the two sides ever fail to reconcile.
 *
 * The proposed slice is drawn as a dashed outline rather than a filled wedge.
 * Colour alone would make a step nobody has taken yet look exactly like a
 * holding the client already owns.
 */
export function allocationShiftChart(portfolio, proposed, { width = 620 } = {}) {
  if (!proposed?.drawable) return null;
  const total = proposed.net_worth;
  if (!Number.isFinite(total) || total <= 0) return null;

  const extra = proposed.after.filter((s) => s.proposed).map((s) => ({
    sleeve: s.sleeve,
    label_pt: s.label_pt,
    value: s.value,
  }));
  const cashAfter = proposed.after.find((s) => s.sleeve === 'cash')?.value ?? 0;

  const before = sleeveGroups(portfolio);
  const after = sleeveGroups(portfolio, { cashOverride: cashAfter, extra });

  const top = 48;
  const rOut = 58;
  const cy = top + rOut + 12;
  const rings = [
    { cx: 78, groups: before, caption: 'Hoje' },
    { cx: 236, groups: after, caption: 'Se as propostas forem seguidas' },
  ];

  const bodies = rings
    .map(
      (r) => `${donut(r.groups, total, { cx: r.cx, cy, rOut })}
  <text class="ax" x="${r.cx}" y="${cy + rOut + 15}" text-anchor="middle" font-weight="600" fill="${INK}">${esc(r.caption)}</text>`,
    )
    .join('\n  ');

  // The arrow between the rings is the only decoration on this chart, and it
  // earns its place: without it two circles side by side read as a comparison
  // of two clients rather than two moments of one.
  const midX = (rings[0].cx + rings[1].cx) / 2;
  const arrow = `<path d="M${midX - 9},${cy} L${midX + 7},${cy}" stroke="${MUTED}" stroke-width="1.4"/>
  <path d="M${midX + 3},${cy - 4} L${midX + 8},${cy} L${midX + 3},${cy + 4}" fill="none" stroke="${MUTED}" stroke-width="1.4"/>`;

  // --- legend: one row per class, before and after side by side --------------
  //
  // Only the classes, not every position: the story here is what MOVES, and
  // eleven unchanged positions would bury the two rows that do.
  const shareOf = (groups, key) => {
    const g = groups.find((x) => x.key === key);
    return g ? g.value / total : null;
  };
  const keys = [...new Set([...after.map((g) => g.key), ...before.map((g) => g.key)])];
  const rows = keys
    .map((key) => {
      const g = after.find((x) => x.key === key) ?? before.find((x) => x.key === key);
      return { key, g, from: shareOf(before, key), to: shareOf(after, key) };
    })
    .sort((a, b) => (b.to ?? 0) - (a.to ?? 0));

  const legendX = 330;
  const lineH = 15;
  const legend = rows
    .map((r, i) => {
      const y = top + 6 + i * lineH;
      const moved = r.from !== null && r.to !== null && Math.abs(r.from - r.to) > 1e-9;
      const isNew = r.from === null;
      const swatch = r.g.proposed
        ? `<rect x="${legendX}" y="${y - 7.5}" width="9" height="9" rx="2" fill="none" stroke="${r.g.stroke ?? INK}" stroke-width="1.2" stroke-dasharray="2 1.5"/>`
        : `<rect x="${legendX}" y="${y - 7.5}" width="9" height="9" rx="2" fill="${r.g.fill}"${r.g.stroke ? ` stroke="${r.g.stroke}"` : ''}/>`;
      // An unchanged class prints one figure, not "54,6% → 54,6%". Repeating a
      // number to fill a column trains the reader to skip the column.
      const value = isNew
        ? `<tspan fill="${MUTED}">nova</tspan> ${fmtPct(r.to, 1)}`
        : moved
          ? `<tspan fill="${MUTED}">${fmtPct(r.from, 1)} →</tspan> ${fmtPct(r.to, 1)}`
          : fmtPct(r.to, 1);
      return `${swatch}
  <text class="lg${moved || isNew ? ' b' : ' m'}" x="${legendX + 15}" y="${y}">${esc(r.g.label)}</text>
  <text class="lg${moved || isNew ? ' b' : ' m'}" x="${width}" y="${y}" text-anchor="end">${value}</text>`;
    })
    .join('\n  ');

  const height = Math.ceil(Math.max(cy + rOut + 22, top + 6 + rows.length * lineH + 16)) + 20;
  const noteY = height - 6;

  return frame({
    width,
    height,
    title: 'Como a sua carteira ficaria com as propostas',
    subtitle:
      'O mesmo patrimônio na mesma data, apenas rearranjado. Nenhuma rentabilidade é projetada.',
    body: `<style>
    .lg { font: 400 9.6px system-ui, -apple-system, 'Segoe UI', sans-serif; }
    .lg.b { font-weight: 600; fill: ${INK}; }
    .lg.m { fill: ${MUTED}; }
  </style>
  ${bodies}
  ${arrow}
  ${legend}
  <line x1="0" y1="${noteY - 13}" x2="${width}" y2="${noteY - 13}" stroke="${RULE}"/>
  <text class="st" x="0" y="${noteY}">O saldo em conta cai de ${fmtPct(proposed.cash_share.before, 1)} para ${fmtPct(proposed.cash_share.after, 1)} do patrimônio — exatamente o limite da política da casa.</text>`,
  });
}
