/**
 * The advisor console: one HTML file, opened by double-click.
 *
 * WHY THIS EXISTS
 * ---------------
 * Everything else in this repository assumes someone types `npm run build`.
 * That is fine for me and useless for Antonio Bicudo, who has 300 clients, no
 * terminal, and no reason to learn one. The pipeline can be perfect and still
 * not be a product if the only way to reach its output is a command line.
 *
 * So the build ends by writing this page. It opens from the file system with no
 * server, no install and no dependency, and it is where an advisor actually
 * works: a queue ordered by how much money is waiting on a decision, the
 * evidence behind each item, the letter and the annex one click away, and a
 * decision to record against each item.
 *
 * WHAT IS REAL AND WHAT IS A DEMONSTRATION
 * ----------------------------------------
 * The queue, the ordering, the figures and the documents are real - all of it
 * is the engine's own output, rendered. The decisions are stored in the
 * browser's localStorage, which is per-machine and per-browser: it is enough to
 * show the workflow and it is NOT an audit trail. The honest artefact is the
 * export button, which hands back a JSON record that a CRM could ingest. The
 * page says so on its face rather than implying a persistence it does not have.
 *
 * WHY THE ORDERING IS THE POINT
 * -----------------------------
 * A list of 300 clients sorted by name is a list. Sorted by money waiting on a
 * decision, it is a work queue - and that ordering is the difference between an
 * advisor reading 300 letters and an advisor acting on the six accounts that
 * need him this week. The sort key is computed here, deterministically, and the
 * page shows its definition next to the number so nobody has to guess what
 * "money at stake" was taken to mean.
 */

import { XP_BLACK, XP_YELLOW, INK, MUTED, RULE, NEGATIVE, YELLOW_DARK, markSvg } from './brand.js';

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/**
 * JSON safe to embed inside a <script> element.
 *
 * `JSON.stringify` escapes for JavaScript, not for HTML, and the page is HTML
 * first: a client named `</script><script>...` closes the block early and the
 * rest of the name executes. The values here come from a parsed statement file,
 * which is exactly the kind of input a renderer must not trust - the escaping
 * below is what makes it safe to put a name the engine read from a document
 * into a script the browser will run.
 *
 * U+2028 and U+2029 are legal in JSON strings and were line terminators in
 * JavaScript before ES2019, so old engines see them as a broken statement.
 */
const jsonForScript = (value) =>
  JSON.stringify(value ?? null)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');

const brl = (v) =>
  Number.isFinite(v)
    ? `R$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace('-', '−')}`
    : '—';

const brl0 = (v) =>
  Number.isFinite(v)
    ? `R$ ${Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 0 }).replace('-', '−')}`
    : '—';

const pct = (v, d = 2) =>
  Number.isFinite(v) ? `${(v * 100).toFixed(d).replace('.', ',').replace('-', '−')}%` : '—';

const num = (v, d = 2) =>
  Number.isFinite(v) ? v.toFixed(d).replace('.', ',').replace('-', '−') : '—';

const brDate = (iso) => {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(String(iso))) return '—';
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
};

/**
 * Queue vocabulary.
 *
 * Findings keep the engine's own severities. Recommendations get their own two
 * labels rather than borrowing "ação necessária": a share worth considering is
 * not the same kind of object as a bond that matured 244 days ago and is still
 * on the books, and badging both in red trains the reader to ignore red.
 */
const SEVERITY = {
  action_required: { label: 'Ação necessária', cls: 'sev-high', rank: 0 },
  review: { label: 'Revisar', cls: 'sev-mid', rank: 1 },
  proposal: { label: 'Proposta', cls: 'sev-prop', rank: 1.5 },
  informational: { label: 'Registro', cls: 'sev-low', rank: 2 },
  suggestion: { label: 'Sugestão', cls: 'sev-low', rank: 2.5 },
};

/** Instrument classes reach the renderer as engine keys. */
const INSTRUMENT_PT = {
  renda_fixa_pos_fixada: 'Renda fixa pós-fixada',
  renda_fixa: 'Renda fixa',
  acoes: 'Ações',
};

/**
 * Which positions a finding actually touches.
 *
 * A finding usually names one position. The qualified-investor one names three,
 * in `measured.holdings`, and summing its headline value alongside the separate
 * concentration finding on one of those same three funds would count Brave
 * twice. Resolving to positions first, and only then summing, is what keeps the
 * queue's headline number from being inflated by overlapping findings.
 */
function positionsOf(finding) {
  if (Array.isArray(finding.measured?.holdings)) {
    return finding.measured.holdings.map((h) => h.name);
  }
  return finding.position?.label ? [finding.position.label] : [];
}

/**
 * Money waiting on a decision, per severity, with no double counting.
 *
 * Returns the union of the positions touched, valued once each.
 */
function moneyAtStake(findings, portfolio) {
  const valueOf = new Map();
  for (const h of portfolio.holdings ?? []) {
    valueOf.set(h.name, h.market_value);
    if (h.ticker) valueOf.set(h.ticker, h.market_value);
  }
  // The idle balance is not a holding, but it is the single largest item in the
  // queue, so it has to be valued like one.
  valueOf.set('Saldo disponível', portfolio.totals?.available_cash);

  const seen = new Map(); // position -> best (lowest) severity rank seen
  for (const f of findings) {
    const rank = SEVERITY[f.severity]?.rank ?? 9;
    for (const p of positionsOf(f)) {
      if (!seen.has(p) || rank < seen.get(p)) seen.set(p, rank);
    }
  }

  const totals = { action_required: 0, review: 0, touched: 0, positions: seen.size };
  for (const [position, rank] of seen) {
    const value = valueOf.get(position);
    if (!Number.isFinite(value)) continue;
    totals.touched += value;
    if (rank === 0) totals.action_required += value;
    else if (rank === 1) totals.review += value;
  }
  return totals;
}

/**
 * The queue: findings, each carrying the recommendations that exist to fix it.
 *
 * The first version listed findings and recommendations as siblings, and the
 * result showed "Título vencido ainda consta na posição — R$ 40.478,75"
 * immediately above "Pendência: confirmar liquidação — R$ 40.478,75". Two rows,
 * one problem, and the same money read twice by anyone scanning the column.
 *
 * `addresses_finding` now comes out of the engine, so the fix nests under the
 * problem it fixes. Both stay separately decidable, because accepting that a
 * bond matured is not the same act as approving what to do about it - an
 * advisor can agree with the finding and defer the remedy.
 *
 * A buy candidate addresses no finding and stands on its own: nothing in the
 * portfolio is wrong without it.
 */
function workItems(plan) {
  const inLetterFindings = new Set(plan.letter?.findings ?? []);
  const inLetterRecs = new Set(plan.letter?.recommendations ?? []);

  const key = (code, position) => `${code}::${position ?? ''}`;
  const byFinding = new Map();

  const items = [];
  for (const f of [...(plan.letter?.findings ?? []), ...(plan.advisor_annex?.findings ?? [])]) {
    const item = {
      id: `finding:${f.code}:${f.position?.label ?? ''}`,
      kind: 'finding',
      severity: f.severity,
      title: f.title,
      position: f.position?.label ?? '',
      value: f.position?.value_brl ?? null,
      action: f.action ?? '',
      detail: f.caveats ?? [],
      in_letter: inLetterFindings.has(f),
      follow_ups: [],
    };
    byFinding.set(key(f.code, f.position?.label), item);
    items.push(item);
  }

  for (const r of [...(plan.letter?.recommendations ?? []), ...(plan.advisor_annex?.recommendations ?? [])]) {
    const inLetter = inLetterRecs.has(r);
    const item = {
      id: `rec:${r.id}`,
      kind: 'recommendation',
      severity: inLetter ? 'proposal' : 'suggestion',
      title: r.headline,
      position: r.ticker ?? INSTRUMENT_PT[r.instrument_class] ?? r.instrument_class ?? '',
      value: r.amount_brl ?? null,
      action: '',
      detail: r.rationale_inputs ?? [],
      in_letter: inLetter,
      follow_ups: [],
    };

    const a = r.addresses_finding;
    const parent = a ? byFinding.get(key(a.code, a.position)) : null;
    if (parent) parent.follow_ups.push(item);
    else items.push(item);
  }

  items.sort((a, b) => {
    const s = (SEVERITY[a.severity]?.rank ?? 9) - (SEVERITY[b.severity]?.rank ?? 9);
    if (s !== 0) return s;
    return (b.value ?? 0) - (a.value ?? 0);
  });
  return items;
}

/** Every decidable row, parents and nested fixes alike. */
function flatten(items) {
  return items.flatMap((i) => [i, ...i.follow_ups]);
}

/**
 * @param {object} params
 * @param {Array}  params.clients  one entry per account; see build-console.js
 * @param {object} params.advisor  { name, code }
 * @param {string} params.generatedAt ISO timestamp stamped by the build
 */
export function renderConsoleHtml({ clients, advisor, generatedAt, dataRetrieved }) {
  const rows = clients
    .map(
      (c, i) => `<tr data-client="${i}"${i === 0 ? ' class="on"' : ''}>
        <td><b>${esc(c.name)}</b><span class="sub">conta ${esc(c.account)}</span></td>
        <td class="r">${brl0(c.net_worth)}</td>
        <td class="r ${c.month_return < 0 ? 'neg' : ''}">${pct(c.month_return)}</td>
        <td class="r"><b>${brl0(c.stake.action_required)}</b><span class="sub">${brl0(c.stake.review)} em revisão</span></td>
        <td class="r">${c.open_items}</td>
        <td><span class="pill" data-status="${esc(c.id)}">pendente</span></td>
      </tr>`,
    )
    .join('\n      ');

  const panels = clients
    .map((c, i) => {
      const card = (it, nested) => {
        const s = SEVERITY[it.severity] ?? SEVERITY.informational;
        const where = it.in_letter ? '<b>consta na carta</b>' : 'retido para o assessor';
        return `<article class="item${nested ? ' nested' : ''}" data-item="${esc(it.id)}">
          <div class="head">
            <span class="badge ${s.cls}">${esc(s.label)}</span>
            <span class="title">${esc(it.title)}</span>
            <span class="amount">${it.value !== null ? brl(it.value) : ''}</span>
          </div>
          <div class="meta">${it.position ? `${esc(it.position)} &middot; ` : ''}${where}</div>
          ${it.action ? `<p class="action">${esc(it.action)}</p>` : ''}
          ${it.detail.length ? `<ul class="detail">${it.detail.map((d) => `<li>${esc(d)}</li>`).join('')}</ul>` : ''}
          <div class="decide">
            <button data-d="aprovado">Aprovar</button>
            <button data-d="adiado">Adiar</button>
            <button data-d="recusado">Recusar</button>
            <span class="state"></span>
          </div>
        </article>`;
      };

      const items = c.items
        .map(
          (it) =>
            card(it, false) +
            (it.follow_ups.length
              ? `<div class="followups"><span class="fu-label">Encaminhamento proposto</span>${it.follow_ups
                  .map((f) => card(f, true))
                  .join('')}</div>`
              : ''),
        )
        .join('\n        ');

      // Facts an advisor is asked about on a call and should not have to open a
      // PDF to find. Each cell is dropped rather than shown empty: a strip of
      // dashes reads as a broken page, not as missing data.
      const stats = [
        { k: 'Rentabilidade apurada', v: pct(c.measured_return), s: c.pnl != null ? brl(c.pnl) : null },
        { k: 'Cobertura da apuração', v: pct(c.coverage), s: 'do valor investido' },
        {
          k: 'Custo anual dos fundos',
          v: c.fund_cost != null ? brl(c.fund_cost) : null,
          s: c.fund_cost_pct != null ? `${num(c.fund_cost_pct)}% a.a. · taxa de administração` : null,
        },
        {
          k: 'Concentração efetiva',
          v: c.concentration ? num(c.concentration.effective_positions, 1) : null,
          s: c.concentration
            ? `posições equivalentes, de ${c.concentration.positions_held} mantidas`
            : null,
        },
      ].filter((x) => x.v && x.v !== '—');

      const statStrip = stats.length
        ? `<div class="stats">${stats
            .map(
              (x) =>
                `<div class="s"><div class="k">${esc(x.k)}</div><div class="v">${esc(x.v)}</div>${
                  x.s ? `<div class="sub">${esc(x.s)}</div>` : ''
                }</div>`,
            )
            .join('')}</div>`
        : '';

      return `<section class="panel" data-panel="${i}"${i === 0 ? '' : ' hidden'}>
        ${statStrip}
        <div class="docs">
          <a class="doc primary" href="letter.pdf" target="_blank">
            <span class="k">Carta do cliente</span><span class="v">PDF · 2 páginas</span>
          </a>
          <a class="doc" href="letter.html" target="_blank">
            <span class="k">Carta</span><span class="v">HTML</span>
          </a>
          <a class="doc" href="annex.pdf" target="_blank">
            <span class="k">Anexo do assessor</span><span class="v">PDF · uso interno</span>
          </a>
          <a class="doc" href="annex.html" target="_blank">
            <span class="k">Anexo</span><span class="v">HTML</span>
          </a>
        </div>

        <div class="split">
          <div>
            <h2>Fila de trabalho <span class="n">${c.items.length} achados &middot; ${c.open_items} decisões</span></h2>
            <p class="lede">Ordenada por urgência e depois por valor. Um problema com prazo vem antes de uma oportunidade do mesmo tamanho.</p>
            ${items}
          </div>
          <aside>
            <h2>A carteira hoje</h2>
            ${c.charts.positions ?? ''}
            <h2>O mês</h2>
            ${c.charts.attribution ?? ''}
          </aside>
        </div>
      </section>`;
    })
    .join('\n      ');

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Console do assessor — ${esc(advisor.name)}</title>
<style>
  :root {
    --ink: ${INK}; --muted: ${MUTED}; --rule: ${RULE};
    --black: ${XP_BLACK}; --yellow: ${XP_YELLOW}; --yellow-dark: ${YELLOW_DARK};
    --neg: ${NEGATIVE}; --panel: #f7f7f5;
  }
  * { box-sizing: border-box; }
  body {
    font: 14px/1.5 'Segoe UI', system-ui, -apple-system, Helvetica, Arial, sans-serif;
    color: var(--ink); margin: 0; background: #fff;
  }
  .wrap { max-width: 1180px; margin: 0 auto; padding: 0 20px 48px; }

  .letterhead {
    display: flex; align-items: center; gap: 11px;
    background: var(--black); color: #fff; padding: 12px 20px;
  }
  .letterhead .wordmark { font-weight: 600; font-size: 15px; }
  .letterhead .who { margin-left: auto; font-size: 12px; color: var(--yellow); }
  .rule-yellow { height: 3px; background: var(--yellow); }

  .stamp {
    display: flex; gap: 20px; flex-wrap: wrap;
    font-size: 12px; color: var(--muted); padding: 10px 0 16px;
  }
  .stamp b { color: var(--ink); font-weight: 600; }

  h1 { font-size: 19px; margin: 6px 0 2px; }
  h2 { font-size: 14px; margin: 20px 0 4px; padding-bottom: 4px; border-bottom: 2px solid var(--yellow); }
  h2 .n { font-weight: 400; color: var(--muted); font-size: 12px; margin-left: 6px; }
  .lede { font-size: 12px; color: var(--muted); margin: 0 0 10px; }

  table { width: 100%; border-collapse: collapse; }
  th {
    text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: .05em;
    color: var(--muted); border-bottom: 1px solid var(--ink); padding: 5px 8px; font-weight: 600;
  }
  td { padding: 9px 8px; border-bottom: 1px solid var(--rule); vertical-align: top; }
  td.r, th.r { text-align: right; }
  td.neg { color: var(--neg); }
  tr[data-client] { cursor: pointer; }
  tr[data-client]:hover { background: var(--panel); }
  tr.on { background: #fffbe8; box-shadow: inset 3px 0 0 var(--yellow); }
  .sub { display: block; font-size: 11px; color: var(--muted); font-weight: 400; }

  .pill {
    display: inline-block; font-size: 11px; padding: 2px 8px; border-radius: 10px;
    background: #eceef1; color: var(--muted);
  }
  .pill.done { background: var(--yellow); color: var(--black); font-weight: 600; }

  .docs { display: flex; gap: 8px; flex-wrap: wrap; margin: 18px 0 4px; }
  .doc {
    display: flex; flex-direction: column; gap: 1px; text-decoration: none;
    border: 1px solid var(--rule); border-left: 3px solid var(--muted);
    padding: 8px 14px; color: var(--ink); min-width: 150px;
  }
  .doc:hover { background: var(--panel); }
  .doc.primary { border-left-color: var(--yellow); }
  .doc .k { font-weight: 600; font-size: 13px; }
  .doc .v { font-size: 11px; color: var(--muted); }

  .split { display: grid; grid-template-columns: 1fr 380px; gap: 26px; align-items: start; }
  @media (max-width: 940px) { .split { grid-template-columns: 1fr; } }
  aside svg { max-width: 100%; }

  .item { border: 1px solid var(--rule); padding: 10px 12px; margin-bottom: 8px; }
  .item.decided { opacity: .55; }
  .item .head { display: flex; align-items: baseline; gap: 8px; }
  .item .title { font-weight: 600; }
  .item .amount { margin-left: auto; font-weight: 600; white-space: nowrap; }
  .item .meta { font-size: 11.5px; color: var(--muted); margin: 3px 0 5px; }
  .item .action { margin: 0 0 6px; font-size: 13px; }
  .item .detail { margin: 0 0 6px; padding-left: 16px; font-size: 12px; color: var(--muted); }

  .badge {
    font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: .05em;
    padding: 3px 6px; border-radius: 2px;
  }
  .sev-high { background: var(--neg); color: #fff; }
  .sev-mid { background: var(--yellow); color: var(--black); }
  .sev-low { background: #eceef1; color: var(--muted); }
  .sev-prop { background: var(--black); color: var(--yellow); }

  .followups { margin: -4px 0 12px 26px; padding-left: 12px; border-left: 2px solid var(--rule); }
  .fu-label { display: block; font-size: 10.5px; text-transform: uppercase; letter-spacing: .05em;
              color: var(--muted); font-weight: 600; margin: 6px 0 4px; }
  .item.nested { background: #fcfcfb; }

  .decide { display: flex; gap: 6px; align-items: center; }
  .decide button {
    font: inherit; font-size: 12px; padding: 4px 12px; cursor: pointer;
    border: 1px solid var(--rule); background: #fff; border-radius: 3px;
  }
  .decide button:hover { border-color: var(--ink); }
  .decide button.on { background: var(--black); color: #fff; border-color: var(--black); }
  .decide .state { font-size: 11.5px; color: var(--muted); margin-left: 4px; }

  /* Facts an advisor gets asked about on a call, above the fold. */
  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
           gap: 1px; background: var(--rule); border: 1px solid var(--rule); margin-bottom: 16px; }
  .stats .s { background: #fff; padding: 10px 13px; }
  .stats .k { font-size: 10.5px; text-transform: uppercase; letter-spacing: .05em;
              color: var(--muted); font-weight: 600; }
  .stats .v { font-size: 21px; font-weight: 600; line-height: 1.25; }
  .stats .sub { font-size: 11.5px; color: var(--muted); }
  .stats .s:first-child { box-shadow: inset 3px 0 0 var(--yellow); }

  .bar {
    display: flex; gap: 10px; align-items: center; flex-wrap: wrap;
    margin: 22px 0 0; padding: 12px 14px; background: var(--panel); border-top: 2px solid var(--yellow);
  }
  .bar button {
    font: inherit; font-weight: 600; font-size: 13px; padding: 7px 16px; cursor: pointer;
    border: 0; background: var(--black); color: var(--yellow); border-radius: 3px;
  }
  .bar button.ghost { background: transparent; color: var(--ink); border: 1px solid var(--rule); }
  .bar .count { font-size: 12px; color: var(--muted); }

  footer { margin-top: 26px; padding-top: 12px; border-top: 1px solid var(--rule);
           font-size: 11.5px; color: var(--muted); }
  footer b { color: var(--ink); }
</style>
</head>
<body>
  <div class="letterhead">
    ${markSvg({ size: 26 })}
    <span class="who">Console do assessor · ${esc(advisor.name)} · ${esc(advisor.code)}</span>
  </div>
  <div class="rule-yellow"></div>

  <div class="wrap">
    <div class="stamp">
      <span>Gerado em <b>${esc(generatedAt)}</b></span>
      <span>Mês de referência <b>${esc(clients[0]?.period ?? '—')}</b></span>
      <span>Dados de mercado de <b>${brDate(dataRetrieved)}</b></span>
      <span id="storage-note"></span>
    </div>

    <h1>Sua fila</h1>
    <p class="lede">
      Ordenada pelo <b>patrimônio parado em itens que exigem ação</b> — a soma dos valores das
      posições citadas em achados de urgência máxima, contada uma vez por posição mesmo quando dois
      achados tocam a mesma. Não é uma medida de risco de perda; é quanto dinheiro está esperando uma
      decisão sua.
    </p>

    <table>
      <thead>
        <tr>
          <th>Cliente</th>
          <th class="r">Patrimônio</th>
          <th class="r">Mês</th>
          <th class="r">Aguardando decisão</th>
          <th class="r">Decisões</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody id="queue">
      ${rows}
      </tbody>
    </table>

    ${panels}

    <div class="bar">
      <button id="export">Exportar decisões (JSON)</button>
      <button class="ghost" id="reset">Limpar decisões</button>
      <span class="count" id="count"></span>
    </div>

    <footer>
      <b>O que é real aqui:</b> a fila, a ordenação, todos os números e os dois documentos são saída
      do motor determinístico — nada nesta página foi escrito por um modelo de linguagem.
      <b>O que é demonstração:</b> as decisões ficam no <code>localStorage</code> deste navegador,
      que é por máquina e não é trilha de auditoria. O artefato honesto é o botão de exportar, que
      devolve um registro JSON pronto para ser ingerido por um CRM. Numa implantação real este
      arquivo seria uma página servida, com autenticação e persistência do lado do servidor.
    </footer>
  </div>

<script>
(function () {
  'use strict';

  // localStorage throws outright in some configurations rather than returning
  // null, so every access is guarded and the page degrades to working-but-
  // forgetful instead of blank.
  var KEY = 'xp-console-decisions-v1';
  var store = { ok: true, data: {} };
  try {
    var raw = window.localStorage.getItem(KEY);
    store.data = raw ? JSON.parse(raw) : {};
  } catch (e) {
    store.ok = false;
  }

  function save() {
    if (!store.ok) return;
    try { window.localStorage.setItem(KEY, JSON.stringify(store.data)); } catch (e) { store.ok = false; }
  }

  var note = document.getElementById('storage-note');
  if (!store.ok && note) {
    note.innerHTML = '<b>Decisões não serão lembradas neste navegador</b>';
  }

  function paint(item) {
    var id = item.getAttribute('data-item');
    var rec = store.data[id];
    var buttons = item.querySelectorAll('.decide button');
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].classList.toggle('on', !!rec && buttons[i].getAttribute('data-d') === rec.decision);
    }
    item.classList.toggle('decided', !!rec);
    var state = item.querySelector('.state');
    state.textContent = rec ? rec.decision + ' · ' + new Date(rec.at).toLocaleString('pt-BR') : '';
  }

  var items = document.querySelectorAll('.item');
  for (var i = 0; i < items.length; i++) {
    (function (item) {
      item.addEventListener('click', function (ev) {
        var button = ev.target.closest('.decide button');
        if (!button) return;
        var id = item.getAttribute('data-item');
        var decision = button.getAttribute('data-d');
        if (store.data[id] && store.data[id].decision === decision) delete store.data[id];
        else store.data[id] = { decision: decision, at: new Date().toISOString() };
        save();
        paint(item);
        count();
      });
      paint(item);
    })(items[i]);
  }

  function count() {
    var total = items.length;
    var done = Object.keys(store.data).length;
    document.getElementById('count').textContent = done + ' de ' + total + ' itens decididos';
    var pill = document.querySelector('.pill');
    if (pill) {
      pill.textContent = done === 0 ? 'pendente' : done >= total ? 'concluído' : done + '/' + total;
      pill.classList.toggle('done', done >= total);
    }
  }
  count();

  document.getElementById('reset').addEventListener('click', function () {
    store.data = {};
    save();
    for (var i = 0; i < items.length; i++) paint(items[i]);
    count();
  });

  document.getElementById('export').addEventListener('click', function () {
    var decisions = [];
    for (var i = 0; i < items.length; i++) {
      var id = items[i].getAttribute('data-item');
      var rec = store.data[id];
      decisions.push({
        item_id: id,
        title: items[i].querySelector('.title').textContent,
        decision: rec ? rec.decision : 'pendente',
        decided_at: rec ? rec.at : null
      });
    }
    var payload = {
      schema: 'xp.advisor.decisions/1',
      exported_at: new Date().toISOString(),
      advisor: ${jsonForScript(advisor)},
      client: ${jsonForScript(clients.map((c) => ({ name: c.name, account: c.account })))},
      reference_month: ${jsonForScript(clients[0]?.month ?? null)},
      decisions: decisions
    };
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'decisoes-' + (payload.reference_month || 'export') + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  });

  // Selecting a client swaps the panel below. With one account it is a no-op;
  // the wiring is here because the shape of the page is "a queue of clients",
  // not "one client with a table above it".
  var queue = document.getElementById('queue');
  queue.addEventListener('click', function (ev) {
    var row = ev.target.closest('tr[data-client]');
    if (!row) return;
    var n = row.getAttribute('data-client');
    var rows = queue.querySelectorAll('tr[data-client]');
    for (var i = 0; i < rows.length; i++) rows[i].classList.toggle('on', rows[i] === row);
    var panels = document.querySelectorAll('.panel');
    for (var j = 0; j < panels.length; j++) {
      panels[j].hidden = panels[j].getAttribute('data-panel') !== n;
    }
  });
})();
</script>
</body>
</html>`;
}

export { moneyAtStake, workItems, flatten };
