/**
 * The advisor annex: everything the two-page letter had to leave out.
 *
 * WHY THIS DOCUMENT EXISTS
 * ------------------------
 * The brief caps the client letter at two pages, and the engine produces far
 * more than two pages of findings: 7 suitability items, 6 buy/review
 * candidates, a 10-line attribution, 16 data-quality flags and a full
 * provenance trail. Something has to be cut.
 *
 * The tempting move is to let the model cut it - hand over everything with
 * "keep it to two pages" in the prompt. That hands the model the single most
 * consequential decision in the whole pipeline: which of the client's problems
 * he never hears about. So config/suitability-policy.json cuts by rule instead,
 * and what it cuts lands HERE rather than in a bin. The letter tells the client
 * "outros 4 pontos de atenção foram identificados e serão tratados por seu
 * assessor"; this is the document that makes that sentence true.
 *
 * WHY IT IS NOT WRITTEN BY A MODEL
 * --------------------------------
 * Not one word of this file comes from an LLM. The letter needs a model because
 * a client is owed prose; an advisor is owed evidence, and evidence is better
 * served by a table. That makes the annex incapable of hallucinating by
 * construction, and it makes the split in the pipeline visible: the model has
 * exactly one job in this project, and this document is what the rest of the
 * system does without it.
 *
 * WHY THE FORENSIC CHART IS HERE AND NOT IN THE LETTER
 * ----------------------------------------------------
 * The Focus history chart carries a marker labelled "carta v1" at Selic 9,00%.
 * It is the proof that the first version was reciting its training data rather
 * than reading the document in front of it. That is a note about our own past
 * error, and the client is not the audience for it. The advisor is.
 */

import { XP_BLACK, XP_YELLOW, INK, MUTED, RULE, NEGATIVE, YELLOW_DARK, markSvg } from './brand.js';

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

// --- formatting ------------------------------------------------------------
//
// Same rule as everywhere else in this project: the engine formats, nothing
// downstream re-derives. Portuguese decimal comma, typographic minus.

const pct = (v, d = 2) =>
  Number.isFinite(v) ? `${(v * 100).toFixed(d).replace('.', ',').replace('-', '−')}%` : '—';

const pp = (v, d = 2) =>
  Number.isFinite(v) ? `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(d).replace('.', ',')} p.p.` : '—';

// toLocaleString emits an ASCII hyphen. Every other negative in this project
// uses the typographic minus, and "R$ -3.023,40" next to "−1,14 p.p." on the
// same row is exactly the kind of small inconsistency a reader notices without
// being able to say why the page looks wrong.
const brl = (v) =>
  Number.isFinite(v)
    ? `R$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace('-', '−')}`
    : '—';

const brDate = (iso) => {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(String(iso))) return esc(iso ?? '—');
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
};

const num = (v, d = 2) => (Number.isFinite(v) ? v.toFixed(d).replace('.', ',') : '—');

// --- Portuguese labels -----------------------------------------------------
//
// The brief requires the code, the prompts and the graph to be in English, and
// the client-facing output to be in Portuguese. That makes the renderer the
// translation boundary: the engine emits `share_of_net_worth`, and the reader
// - a Brazilian advisor - sees "% do patrimônio". Without this map the annex
// printed field names straight out of the JSON, which is how an internal tool
// ends up bilingual by accident.
//
// A key with no entry falls back to its raw name with underscores stripped, so
// a new engine field degrades to something readable instead of vanishing.

const LABEL_PT = {
  share_of_net_worth: '% do patrimônio',
  share_of_invested: '% do investido',
  visible_net_worth_brl: 'Patrimônio visível na XP',
  maturity_date: 'Vencimento',
  statement_date: 'Data do extrato',
  days_since_maturity: 'Dias desde o vencimento',
  contracted_rate: 'Taxa contratada',
  return_since_purchase: 'Retorno desde a compra',
  return_reference_month: 'Retorno no mês de referência',
  average_price: 'Preço médio',
  last_price: 'Último preço',
  investment_date: 'Data da compra',
  successor: 'Novo código',
  successor_name: 'Nova denominação',
  reason: 'Motivo',
  qualified_investor_brl: 'Investidor qualificado a partir de',
  rule: 'Regra',
};

/**
 * Engine sentences that surface in the annex.
 *
 * These are prose, not identifiers - an advisor reads them - so they get
 * translated. Codes like `ticker_superseded_by_corporate_action` deliberately
 * do NOT: they are printed in monospace because they are the string you grep
 * for in the source, and translating them would break that link.
 */
const PHRASE_PT = {
  'maturity_date < statement_date': 'data de vencimento anterior à data do extrato',
  'ticker does not resolve at the market data provider':
    'o código não é reconhecido pelo provedor de cotações',
  'no primary source for a monthly return': 'sem fonte primária para a rentabilidade mensal',
  'Marfrig reorganised with BRF into MBRF':
    'Reorganização societária da Marfrig com a BRF, resultando na MBRF',
  'Arezzo & Co merged with Grupo Soma to form Azzas 2154':
    'Fusão da Arezzo & Co com o Grupo Soma, resultando na Azzas 2154',
  'No CVM name record - current or historical - contains all of: TREND, INVESTBACK.':
    'Nenhum registro de denominação na CVM — atual ou histórico — contém todos os termos: TREND, INVESTBACK.',
  'house policy': 'política da casa',
  arithmetic: 'aritmética',
  'Yahoo Finance': 'Yahoo Finance',
  'CVM / price file': 'CVM / arquivo de preços',
  'CVM Resolution 30 definition of investidor qualificado':
    'definição de investidor qualificado, Resolução CVM 30',
};

/**
 * What each data-quality code means, in one sentence.
 *
 * The flags themselves carry a `detail` written in English by the parser, with
 * the fund name and the dates embedded. Those are raw diagnostics and they are
 * printed VERBATIM - paraphrasing evidence is how evidence stops being
 * evidence. What gets translated is the meaning of the code, so the advisor
 * reads Portuguese for "what is wrong" and the untouched original for "on
 * which position".
 */
export const CODE_PT = {
  source_row_order_inverted:
    'Uma linha do extrato traz o nome depois dos valores; a leitura foi recuperada pela classificação por tipo de token, sem edição manual.',
  stale_quota_date:
    'A cota informada no extrato é de mais de um ano antes da data do documento. A rentabilidade do mês não pode ser derivada dela — foi apurada na CVM.',
  matured_instrument_still_listed:
    'Um título consta na posição com vencimento anterior à data do extrato.',
  ticker_superseded:
    'O código de negociação deixou de existir por evento societário e foi substituído.',
  fund_not_identified:
    'O fundo não pôde ser casado com um registro da CVM, atual ou histórico, com segurança suficiente.',
  price_source_divergence:
    'O preço no arquivo da XP diverge do fechamento apurado no provedor de cotações.',
  holding_return_divergent:
    'A rentabilidade implícita no arquivo de preços da XP diverge da apurada no fechamento de mercado. O extrato permanece como fonte de registro; a divergência é reportada, não arbitrada.',
  fee_version_not_yet_in_force:
    'Uma versão mais recente da taxa foi publicada, mas só entra em vigor depois da data de referência. Foi descartada: usar a taxa mais nova reportaria um custo que ainda não existia no mês relatado.',
  fee_out_of_plausible_range:
    'A taxa publicada não pôde ser lida como um percentual plausível e foi tratada como indisponível, em vez de impressa.',
  fee_not_published:
    'Nenhuma taxa de administração ou de performance em vigor na data de referência foi encontrada para o fundo.',
  no_cash_flow_assumption:
    'O valor inicial dos fundos é derivado como V1/(1+r), o que pressupõe ausência de aportes e resgates no mês. Um fluxo intermediário exigiria retorno ponderado por capital, que os dados disponíveis não sustentam.',
};

const label = (key) => LABEL_PT[key] ?? key.replace(/_/g, ' ');
const phrase = (s) => PHRASE_PT[String(s)] ?? String(s ?? '');

/**
 * Format a value according to what its field name says it is.
 *
 * Keyed off the name rather than the type because 0.19 is a share and 15.62 is
 * a price, and nothing in the number itself distinguishes them.
 */
function valueFor(key, v) {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'number') {
    if (/share|_yield|weight|^return|_return$/.test(key)) return pct(v);
    if (/_brl$|price$/.test(key)) return brl(v);
    if (/^days_/.test(key)) return String(v);
    return num(v);
  }
  if (/date$/.test(key)) return brDate(v);
  return esc(phrase(v));
}

// --- severity vocabulary ---------------------------------------------------

const SEVERITY = {
  action_required: { label: 'Ação necessária', cls: 'sev-high' },
  review: { label: 'Revisar', cls: 'sev-mid' },
  informational: { label: 'Registro', cls: 'sev-low' },
  error: { label: 'Erro', cls: 'sev-high' },
  warning: { label: 'Atenção', cls: 'sev-mid' },
  info: { label: 'Nota', cls: 'sev-low' },
};

const badge = (severity) => {
  const s = SEVERITY[severity] ?? { label: severity ?? '—', cls: 'sev-low' };
  return `<span class="badge ${s.cls}">${esc(s.label)}</span>`;
};

/**
 * Render one finding as a block.
 *
 * `measured` and `threshold` are printed side by side deliberately. A finding
 * that says "concentração acima do limite" without both numbers is an opinion;
 * with both, an advisor can disagree with the threshold instead of with the
 * engine - which is the point of keeping the thresholds in a config file.
 */
function findingBlock(f) {
  const measured = Object.entries(f.measured ?? {})
    .filter(([, v]) => typeof v !== 'object' || v === null)
    .map(([k, v]) => `<dt>${esc(label(k))}</dt><dd>${valueFor(k, v)}</dd>`)
    .join('\n        ');

  const threshold = Object.entries(f.threshold ?? {})
    .filter(([k]) => !['source', 'assumption'].includes(k))
    .map(([k, v]) => `${esc(label(k))}: <b>${valueFor(k, v)}</b>`)
    .join(' &middot; ');

  // Whether a threshold is a house assumption or a rule the client is actually
  // bound by is the difference between "you are over the limit" and "we set a
  // limit and you are over it". It is printed on every finding.
  const provenance = f.threshold?.assumption
    ? `<span class="assumption">parâmetro da casa — <i>${esc(phrase(f.threshold.source))}</i></span>`
    : `<span class="rule">regra externa — <i>${esc(phrase(f.threshold?.source))}</i></span>`;

  const holdings = f.measured?.holdings
    ? `<table class="mini">
        <thead><tr><th>Fundo</th><th>CNPJ</th><th class="r">Peso</th><th>Público-alvo</th></tr></thead>
        <tbody>${f.measured.holdings
          .map(
            (h) => `<tr><td>${esc(h.name)}</td><td class="mono">${esc(h.cnpj)}</td><td class="r">${pct(h.weight)}</td><td>${esc(h.target_investor ?? '—')}</td></tr>`,
          )
          .join('')}</tbody>
      </table>`
    : '';

  const caveats = f.caveats?.length
    ? `<ul class="caveats">${f.caveats.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>`
    : '';

  return `<article class="finding">
      <h3>${badge(f.severity)} ${esc(f.title)}</h3>
      <p class="pos">${esc(f.position?.label ?? '')}${
        Number.isFinite(f.position?.value_brl) ? ` &middot; ${brl(f.position.value_brl)}` : ''
      }${Number.isFinite(f.position?.weight) ? ` &middot; ${pct(f.position.weight)} do investido` : ''}</p>
      <dl>
        ${measured}
      </dl>
      ${holdings}
      <p class="thr">Limite aplicado — ${threshold || '—'} &nbsp; ${provenance}</p>
      ${caveats}
      <p class="act"><b>Encaminhamento:</b> ${esc(f.action ?? '')}</p>
    </article>`;
}

/** Render one deferred recommendation with its full evidence. */
function recommendationBlock(r) {
  const e = r.evidence ?? {};
  const cells = [
    ['Dividend yield 12m', Number.isFinite(e.trailing_dividend_yield) ? pct(e.trailing_dividend_yield) : null],
    ['Eventos de provento', Number.isFinite(e.dividend_events) ? String(e.dividend_events) : null],
    ['Proventos por ação', Number.isFinite(e.dividends_paid_per_share) ? brl(e.dividends_paid_per_share) : null],
    ['Volatilidade anualizada', Number.isFinite(e.annualised_volatility) ? pct(e.annualised_volatility) : null],
    ['Máxima queda no período', Number.isFinite(e.max_drawdown) ? pct(e.max_drawdown) : null],
    ['Fechamento de mercado', Number.isFinite(e.last_close) ? brl(e.last_close) : null],
    ['Retorno no mês', Number.isFinite(e.monthly_return) ? pct(e.monthly_return) : null],
    ['Retorno desde a compra', Number.isFinite(e.return_since_purchase) ? pct(e.return_since_purchase) : null],
    ['Preço médio', Number.isFinite(e.average_price) ? brl(e.average_price) : null],
    ['Peso na carteira', Number.isFinite(e.weight) ? pct(e.weight) : null],
  ].filter(([, v]) => v !== null);

  return `<article class="rec">
      <h3>${esc(r.headline)}${Number.isFinite(r.amount_brl) ? ` <span class="amt">${brl(r.amount_brl)}</span>` : ''}</h3>
      <dl>
        ${cells.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('\n        ')}
      </dl>
      <ul class="why">${(r.rationale_inputs ?? []).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
    </article>`;
}

/**
 * @param {object} params
 * @param {object} params.plan          letter-plan.json
 * @param {object} params.portfolio     portfolio.json
 * @param {object} params.metrics       metrics.json
 * @param {object} params.recommendations recommendations.json
 * @param {object} params.charts        SVG strings keyed by chart name
 * @param {string} [params.provenance]  one line naming when the data was pulled
 */
export function renderAnnexHtml({ plan, portfolio, metrics, recommendations, charts, provenance }) {
  const client = portfolio.client?.name ?? '';
  const account = portfolio.client?.account ?? '';
  const advisor = portfolio.advisor?.name ?? '';
  const advisorCode = portfolio.advisor?.code ?? '';
  const period = metrics.reference?.period?.label_pt ?? metrics.reference?.month ?? '';

  const annex = plan.advisor_annex ?? {};
  const cov = metrics.coverage ?? {};
  const nw = metrics.sensitivity?.net_worth ?? {};
  const stance = recommendations.house_stance ?? {};
  const universe = recommendations.universe_report ?? {};

  // Every finding the engine produced, letter and annex together, ordered by
  // urgency. The letter shows two of these; an advisor working the account
  // needs the whole list in one place.
  const allFindings = [...(plan.letter?.findings ?? []), ...(annex.findings ?? [])];
  const rank = { action_required: 0, review: 1, informational: 2 };
  allFindings.sort((a, b) => (rank[a.severity] ?? 9) - (rank[b.severity] ?? 9));
  const inLetter = new Set((plan.letter?.findings ?? []).map((f) => f));

  // --- reconciliation panel -------------------------------------------------
  //
  // These six numbers are the audit of the letter's headline. If the attribution
  // did not reconcile, or coverage were misstated, it would show here first.
  const panel = [
    { k: 'Rentabilidade apurada', v: pct(metrics.portfolio_return), note: 'da parcela com fonte primária' },
    { k: 'Rentabilidade do patrimônio', v: pct(nw.return), note: 'inclui saldo parado e posições sem apuração' },
    { k: 'Custo do saldo parado', v: pp(nw.drag_vs_measured_pp), note: 'diferença entre as duas linhas acima' },
    { k: 'Cobertura do investido', v: pct(cov.share_of_invested), note: `${cov.measured_positions} de ${cov.total_positions} posições` },
    { k: 'Cobertura do patrimônio', v: pct(cov.share_of_net_worth), note: `sem apuração: ${brl(cov.unmeasured_value)}` },
    {
      k: 'Atribuição fecha',
      v: plan.checks?.attribution_reconciles ? 'sim' : 'NÃO',
      note: `${pp(plan.checks?.shown_plus_remainder_pp)} contra ${pp(plan.checks?.headline_pp)}`,
    },
  ];

  const attributionRows = (annex.full_attribution ?? [])
    .slice()
    .sort((a, b) => b.contribution_pp - a.contribution_pp)
    .map(
      (r) => `<tr>
        <td>${esc(r.label)}</td>
        <td class="r ${r.return < 0 ? 'neg' : ''}">${pct(r.return)}</td>
        <td class="r ${r.contribution_pp < 0 ? 'neg' : ''}">${pp(r.contribution_pp)}</td>
        <td class="r ${r.pnl < 0 ? 'neg' : ''}">${brl(r.pnl)}</td>
      </tr>`,
    )
    .join('\n      ');

  const attributionTotal = (annex.full_attribution ?? []).reduce(
    (acc, r) => ({ pp: acc.pp + r.contribution_pp, pnl: acc.pnl + r.pnl }),
    { pp: 0, pnl: 0 },
  );

  // --- fund benchmark and cost tables --------------------------------------

  const bench = annex.funds_vs_declared_benchmark ?? null;
  const benchRows = (bench?.rows ?? [])
    .map((r) => {
      if (r.status !== 'compared') {
        return `<tr>
        <td>${esc(r.label)}</td>
        <td>${esc(r.anbima_class ?? '—')}</td>
        <td colspan="4" class="muted-cell">${esc(r.reason ?? 'sem comparação')}</td>
      </tr>`;
      }
      return `<tr>
        <td>${esc(r.label)}</td>
        <td>${esc(r.anbima_class ?? '—')}</td>
        <td>${esc(r.declared_benchmark)}</td>
        <td class="r ${r.fund_return < 0 ? 'neg' : ''}">${pct(r.fund_return)}</td>
        <td class="r">${pct(r.benchmark_return)}</td>
        <td class="r ${r.excess_pp < 0 ? 'neg' : ''}"><b>${pp(r.excess_pp)}</b>${
          r.pct_of_benchmark ? `<span class="sub">${num(r.pct_of_benchmark, 0)}% do índice</span>` : ''
        }</td>
      </tr>`;
    })
    .join('\n      ');

  const costs = annex.fund_costs ?? null;
  const costRows = (costs?.lines ?? [])
    .map((l) => {
      const perf = l.performance;
      const perfText =
        perf && perf.rate_pct > 0
          ? `${num(perf.rate_pct)}%${perf.terms ? ` — ${esc(String(perf.terms).slice(0, 90))}` : ''}`
          : perf
            ? 'não cobra'
            : '—';
      return `<tr>
        <td>${esc(l.label)}</td>
        <td class="r">${l.administration_pct != null ? `${num(l.administration_pct)}%` : '—'}</td>
        <td>${brDate(l.administration_in_force_since)}</td>
        <td class="r">${l.annual_cost_brl != null ? brl(l.annual_cost_brl) : '—'}</td>
        <td>${l.administration_pct != null ? perfText : esc(l.reason ?? '—')}</td>
      </tr>`;
    })
    .join('\n      ');

  const scenarioRows = (metrics.sensitivity?.scenarios ?? [])
    .map(
      (s) => `<tr>
        <td>${esc(s.label_pt)}</td>
        <td class="r">${pct(s.unmeasured_return)}</td>
        <td class="r"><b>${pct(s.invested_return)}</b></td>
      </tr>`,
    )
    .join('\n      ');

  // Flags are grouped: eight identical "stale quota" lines is one fact about
  // the custodian's file, not eight problems.
  const grouped = new Map();
  for (const f of annex.data_quality_flags ?? []) {
    if (!grouped.has(f.code)) grouped.set(f.code, { code: f.code, severity: f.severity, origin: f.origin, items: [] });
    grouped.get(f.code).items.push(f.detail);
  }
  const flagRows = [...grouped.values()]
    .map(
      (g) => `<tr>
        <td>${badge(g.severity)}</td>
        <td class="mono">${esc(g.code)}</td>
        <td class="r">${g.items.length}</td>
        <td>${CODE_PT[g.code] ? `<p class="meaning">${esc(CODE_PT[g.code])}</p>` : ''}<details><summary>diagnóstico técnico da origem (${g.items.length})</summary><ul>${g.items.map((d) => `<li>${esc(d)}</li>`).join('')}</ul></details></td>
      </tr>`,
    )
    .join('\n      ');

  const divergenceRows = (universe.price_divergences ?? [])
    .map(
      (d) => `<tr>
        <td class="mono">${esc(d.ticker)}</td>
        <td class="r">${brl(d.xp_price_file)}</td>
        <td class="r">${brl(d.market_close)}</td>
        <td class="r ${Math.abs(d.gap) > 0.2 ? 'neg' : ''}">${pct(d.gap, 1)}</td>
      </tr>`,
    )
    .join('\n      ');

  const forensic = ['consensus-selic', 'consensus-ipca']
    .map((n) => charts?.[n])
    .filter(Boolean)
    .map((svg) => `<figure>${svg}</figure>`)
    .join('\n      ');

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<title>Anexo do assessor — ${esc(client)} — ${esc(period)}</title>
<style>
  @page { size: A4; margin: 13mm 14mm 13mm; }

  :root {
    --ink: ${INK};
    --muted: ${MUTED};
    --rule: ${RULE};
    --black: ${XP_BLACK};
    --yellow: ${XP_YELLOW};
    --yellow-dark: ${YELLOW_DARK};
    --neg: ${NEGATIVE};
  }

  * { box-sizing: border-box; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body {
    font: 9pt/1.45 'Segoe UI', system-ui, -apple-system, Helvetica, Arial, sans-serif;
    color: var(--ink);
    margin: 0;
  }

  .letterhead {
    display: flex; align-items: center; gap: 10px;
    background: var(--black); color: #fff; padding: 9px 12px; margin: 0 0 3px;
  }
  .letterhead .wordmark { font-weight: 600; font-size: 11pt; line-height: 1; }
  .letterhead .tag {
    margin-left: auto; font-weight: 600; font-size: 7.5pt; line-height: 1; letter-spacing: .09em;
    text-transform: uppercase; color: var(--black);
    background: var(--yellow); padding: 3px 7px; border-radius: 2px;
  }
  .rule-yellow { height: 3px; background: var(--yellow); margin-bottom: 12px; }

  .meta { display: flex; justify-content: space-between; gap: 14px;
          font-size: 8pt; color: var(--muted); margin-bottom: 14px; }
  .meta strong { color: var(--ink); font-weight: 600; }

  h2 {
    font-weight: 600; font-size: 10pt; line-height: 1.2; margin: 18px 0 7px;
    padding-bottom: 4px; border-bottom: 2px solid var(--yellow);
    break-after: avoid;
  }
  h2 .n { color: var(--muted); font-weight: 400; margin-right: 6px; }
  h2 + .lede { margin: -3px 0 9px; color: var(--muted); font-size: 8pt; }

  h3 { font-weight: 600; font-size: 9pt; line-height: 1.3; margin: 0 0 4px; }

  /* --- reconciliation panel --- */
  .panel { display: grid; grid-template-columns: repeat(3, 1fr); gap: 7px; margin-bottom: 4px; }
  .panel .cell { border: 1px solid var(--rule); border-left: 3px solid var(--yellow); padding: 6px 8px; }
  .panel .k { font-size: 7.5pt; color: var(--muted); text-transform: uppercase; letter-spacing: .04em; }
  .panel .v { font-weight: 600; font-size: 13pt; line-height: 1.2; margin: 1px 0; }
  .panel .note { font-size: 7.3pt; color: var(--muted); }

  /* --- tables --- */
  table { width: 100%; border-collapse: collapse; font-size: 8.2pt; margin-bottom: 4px; }
  th { text-align: left; font-weight: 600; font-size: 7.5pt; text-transform: uppercase;
       letter-spacing: .04em; color: var(--muted); border-bottom: 1px solid var(--ink);
       padding: 3px 5px; }
  td { padding: 3px 5px; border-bottom: 1px solid var(--rule); vertical-align: top; }
  td.r, th.r { text-align: right; }
  td.neg { color: var(--neg); }
  td.muted-cell { color: var(--muted); font-style: italic; }
  td .sub { display: block; font-weight: 400; font-size: 7.2pt; color: var(--muted); }
  tr.total td { border-top: 1.5px solid var(--ink); border-bottom: none; font-weight: 600; }
  .mono { font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace; font-size: 7.8pt; }
  table.mini { margin: 5px 0 6px; }
  details summary { cursor: pointer; color: var(--muted); font-size: 7.6pt; }
  .meaning { margin: 0 0 3px; }
  details ul { margin: 4px 0 0; padding-left: 15px; }

  /* --- findings --- */
  .finding, .rec { break-inside: avoid; border: 1px solid var(--rule); padding: 8px 10px; margin-bottom: 7px; }
  .finding .pos { margin: 0 0 5px; font-size: 8pt; color: var(--muted); }
  .badge { display: inline-block; font-weight: 600; font-size: 7pt; line-height: 1; text-transform: uppercase;
           letter-spacing: .05em; padding: 3px 6px; border-radius: 2px; vertical-align: 1px; margin-right: 5px; }
  .sev-high { background: var(--neg); color: #fff; }
  .sev-mid  { background: var(--yellow); color: var(--black); }
  .sev-low  { background: #eceef1; color: var(--muted); }

  dl { display: grid; grid-template-columns: max-content 1fr; gap: 1px 10px; margin: 0 0 6px; font-size: 8pt; }
  dt { color: var(--muted); }
  dd { margin: 0; font-weight: 600; }

  .thr { margin: 0 0 4px; font-size: 7.8pt; color: var(--muted); }
  .assumption { color: var(--yellow-dark); font-weight: 600; }
  .rule { color: var(--muted); font-weight: 600; }
  .caveats { margin: 0 0 5px; padding-left: 15px; font-size: 7.8pt; color: var(--muted); }
  .act { margin: 0; font-size: 8.2pt; }
  .rec .amt { color: var(--muted); font-weight: 400; }
  .why { margin: 0; padding-left: 15px; font-size: 8pt; }

  figure { margin: 9px 0; break-inside: avoid; }

  .footer { margin-top: 16px; padding-top: 7px; border-top: 2px solid var(--yellow);
            font-size: 7.2pt; color: var(--muted); }
</style>
</head>
<body>
  <div class="letterhead">
    ${markSvg({ size: 24 })}
    <span class="tag">XP Investimentos &middot; uso interno</span>
  </div>
  <div class="rule-yellow"></div>

  <div class="meta">
    <span>Cliente: <strong>${esc(client)}</strong>${account ? ` &middot; conta ${esc(account)}` : ''}</span>
    <span>Referência: <strong>${esc(period)}</strong> &middot; extrato de ${brDate(metrics.reference?.statement_date)}</span>
    <span>Assessor: <strong>${esc(advisor)}</strong>${advisorCode ? ` &middot; ${esc(advisorCode)}` : ''}</span>
  </div>

  <h2><span class="n">1</span>Painel de apuração</h2>
  <p class="lede">Os seis números que auditam a manchete da carta. Se a atribuição não fechasse, ou a cobertura estivesse mal declarada, apareceria aqui primeiro.</p>
  <div class="panel">
    ${panel
      .map(
        (c) => `<div class="cell"><div class="k">${esc(c.k)}</div><div class="v">${c.v}</div><div class="note">${esc(c.note)}</div></div>`,
      )
      .join('\n    ')}
  </div>
  ${
    // "Custo do saldo parado: +0,80 p.p." is a bare number in the panel above.
    // This chart is the same fact as a picture - the gap between the first two
    // bars IS that cost, and it is the entire argument behind the first
    // recommendation. The chart was being generated every build and rendered
    // nowhere; this is where it belongs.
    charts?.benchmarks ? `<figure>${charts.benchmarks}</figure>` : ''
  }

  ${
    // The 13-position ring. It lives here rather than in the letter: the letter
    // has room for one allocation figure and the before/after pair earns that
    // slot, because it is the one that answers what the proposals would do.
    charts?.positions ? `<figure>${charts.positions}</figure>` : ''
  }

  <h2><span class="n">2</span>Atribuição completa</h2>
  <p class="lede">A carta mostra quatro linhas e uma linha de resto. Estas são as ${(annex.full_attribution ?? []).length} posições apuradas, na íntegra.</p>
  <table>
    <thead><tr><th>Posição</th><th class="r">Retorno no mês</th><th class="r">Contribuição</th><th class="r">Resultado</th></tr></thead>
    <tbody>
      ${attributionRows}
      <tr class="total"><td>Total apurado</td><td class="r">${pct(metrics.portfolio_return)}</td><td class="r">${pp(attributionTotal.pp)}</td><td class="r">${brl(attributionTotal.pnl)}</td></tr>
    </tbody>
  </table>

  <h2><span class="n">3</span>Sensibilidade da cobertura</h2>
  <p class="lede">A parcela apurada foi escolhida pela disponibilidade de fonte primária, não por sorteio — é uma amostra enviesada. Em vez de um número único para a carteira inteira, três cenários explícitos sobre ${brl(cov.unmeasured_value)} sem apuração.</p>
  <table>
    <thead><tr><th>Cenário para a parcela sem apuração</th><th class="r">Retorno suposto</th><th class="r">Retorno do investido</th></tr></thead>
    <tbody>${scenarioRows}</tbody>
  </table>
  ${charts?.allocation ? `<figure>${charts.allocation}</figure>` : ''}

  ${
    bench?.rows?.length
      ? `<h2><span class="n">4</span>Cada fundo contra o benchmark que ele declarou</h2>
  <p class="lede">Comparar tudo ao CDI favorece um fundo de ações e prejudica um fundo de renda fixa. O indicador de cada linha é o que o próprio fundo declarou à CVM no <span class="mono">Indicador_Desempenho</span> — nenhum foi atribuído por inferência. ${bench.summary.beat} de ${bench.summary.compared} superaram o seu. Um mês isolado: não é alfa.</p>
  <table>
    <thead><tr><th>Fundo</th><th>Classe ANBIMA</th><th>Benchmark declarado</th><th class="r">Fundo</th><th class="r">Benchmark</th><th class="r">Excesso</th></tr></thead>
    <tbody>${benchRows}</tbody>
  </table>`
      : ''
  }

  ${
    costs?.lines?.length
      ? `<h2><span class="n">5</span>O que a carteira custa</h2>
  <p class="lede">Taxa de administração <b>em vigor na data de referência</b>, não a mais recente publicada — a distinção não é acadêmica: o Truxt tem uma taxa de 2,00% que só passa a valer em 16/06/2025, e usá-la inflaria o custo declarado ao cliente. Fonte: <span class="mono">cad_fi_hist_taxa_adm.csv</span>, o mesmo arquivo já baixado para resolver nomes históricos. Custo anual apurado sobre ${pct(costs.coverage, 1)} do valor em fundos.</p>
  <table>
    <thead><tr><th>Fundo</th><th class="r">Taxa adm.</th><th>Em vigor desde</th><th class="r">Custo anual</th><th>Taxa de performance</th></tr></thead>
    <tbody>
      ${costRows}
      <tr class="total"><td>Total</td><td class="r">${costs.weighted_average_pct != null ? `${num(costs.weighted_average_pct)}%` : '—'}</td><td></td><td class="r">${brl(costs.annual_cost_brl)}</td><td>${brl(costs.monthly_cost_brl)} por mês</td></tr>
    </tbody>
  </table>
  <p class="lede">A taxa de performance é reportada como taxa e não convertida em reais: ela depende de linha d'água e do calendário de apuração do fundo, que nenhuma base pública carrega. Converter mesmo assim produziria um número com aparência de medido.</p>`
      : ''
  }

  <h2><span class="n">6</span>Pontos de atenção — lista completa</h2>
  <p class="lede">${allFindings.length} itens. A carta ao cliente traz ${plan.letter?.findings?.length ?? 0}; a seleção é feita por regra em config/suitability-policy.json, antes de qualquer modelo ver os dados.</p>
  ${allFindings.map(findingBlock).join('\n  ')}

  <h2><span class="n">7</span>Sugestões preparadas e não enviadas</h2>
  <p class="lede">A carta propõe ${plan.letter?.recommendations?.length ?? 0} itens por limite de espaço. Estas ${(annex.recommendations ?? []).length} foram apuradas com o mesmo critério e ficam à disposição. Universo considerado: ${universe.considered ?? '—'} ativos, ${universe.eligible ?? '—'} aprovados na triagem, ${universe.truncated_by_policy ?? '—'} truncados por política.</p>
  ${(annex.recommendations ?? []).map(recommendationBlock).join('\n  ')}
  ${
    universe.rejected?.length
      ? `<p class="lede">Rejeitados na triagem: ${universe.rejected
          .map((r) => `<b>${esc(r.ticker)}</b> (${r.reasons.map(esc).join('; ')})`)
          .join(' &middot; ')}</p>`
      : ''
  }

  <h2><span class="n">8</span>Divergência entre a base de preços e o fechamento de mercado</h2>
  <p class="lede">O arquivo de preços da XP e o fechamento apurado no provedor não coincidem em ${(universe.price_divergences ?? []).length} dos ${universe.considered ?? '—'} candidatos. A carta mantém o valor do extrato e reporta a diferença; nenhuma recomendação foi dimensionada pelo preço divergente.</p>
  <table>
    <thead><tr><th>Ativo</th><th class="r">Base XP</th><th class="r">Fechamento</th><th class="r">Diferença</th></tr></thead>
    <tbody>${divergenceRows}</tbody>
  </table>

  <h2><span class="n">9</span>Postura de casa e consenso</h2>
  <p class="lede">${
    // Rebuilt here from the structured fields rather than printing
    // stance.rationale, which is engine prose formatted with dot decimals
    // ("Selic de 15.5%") - correct in JSON, wrong on a Brazilian page.
    Number.isFinite(stance.house_value)
      ? `A casa projeta ${esc(stance.indicator ?? '')} de <b>${num(stance.house_value)}%</b> contra mediana de ` +
        `<b>${num(stance.consensus_median)}%</b> entre ${stance.respondents ?? '—'} instituições, ` +
        `no percentil ${num(stance.percentile_in_range, 1)} da faixa de ` +
        `${num(stance.consensus_range?.[0])}% a ${num(stance.consensus_range?.[1])}%. ` +
        `Expectativa de juro alto por mais tempo favorece pós-fixado e indexados à inflação — ` +
        `é essa inclinação, e não uma leitura do modelo, que ordena as sugestões da seção 7.`
      : ''
  }</p>
  ${
    // Where XP sits inside the full spread of forecasts. It was in the client
    // letter until the buy/sell block needed the room; the macro paragraph
    // there already states every figure it plots.
    charts?.consensus ? `<figure>${charts.consensus}</figure>` : ''
  }
  ${forensic}
  <p class="lede">A marca <b style="color:${NEGATIVE}">carta v1</b> é o número que a primeira versão desta carta publicou. Ele não foi inventado: era a mediana do Focus dentro da janela de treinamento do modelo, enquanto o documento da XP no contexto dizia ${num(stance.house_value)}%. É a razão de toda extração de números neste projeto ser determinística.</p>

  <h2><span class="n">10</span>Qualidade dos dados de origem</h2>
  <p class="lede">${(annex.data_quality_flags ?? []).length} ocorrências registradas na leitura do extrato e das fontes, agrupadas por tipo. Nenhuma foi corrigida silenciosamente.</p>
  <table>
    <thead><tr><th>Severidade</th><th>Código</th><th class="r">Nº</th><th>Detalhe</th></tr></thead>
    <tbody>${flagRows}</tbody>
  </table>

  <div class="footer">
    ${provenance ? `${esc(provenance)}<br>` : ''}
    Documento gerado integralmente por código determinístico — nenhum trecho foi redigido por modelo de linguagem.
    Os limites marcados como <span class="assumption">parâmetro da casa</span> são premissas desta implementação, não regras assinadas pelo cliente.
  </div>
</body>
</html>`;
}
