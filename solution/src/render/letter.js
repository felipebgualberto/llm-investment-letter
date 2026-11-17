/**
 * The letter, as a print-ready HTML document.
 *
 * WHY HTML AND NOT DOCX
 * ---------------------
 * The deliverable is a two-page letter that has to look finished. HTML plus a
 * headless browser gives real typography, real page breaks and vector charts,
 * with no dependency and no binary format to hand-assemble. Edge ships with
 * Windows and Chrome is everywhere, so `--headless --print-to-pdf` needs
 * nothing installed.
 *
 * WHAT THIS MODULE MAY AND MAY NOT DO
 * -----------------------------------
 * It lays out text and figures that already exist. It does not compute, choose
 * what to include, or reword anything: the selection was made by
 * src/engine/letter-plan.js and the prose by the Rivet graph. The one editorial
 * rule enforced here is that the disclosure block is printed in full, and the
 * renderer throws if a required disclosure is missing rather than quietly
 * shipping a letter without it.
 *
 * PAGE BUDGET
 * -----------
 * A4 with 18mm margins, 10.5pt body. The plan caps the payload at 800 words,
 * and the two charts occupy roughly a third of a page between them. The output
 * carries a page-count check so a letter that grows past two pages is caught
 * by the build rather than by the client.
 */

import { XP_BLACK, XP_YELLOW, INK, MUTED, RULE, YELLOW_DARK, markSvg } from './brand.js';

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

/**
 * Split the letter into greeting, body paragraphs and sign-off.
 *
 * The three are separated because the renderer owns two of them. The signature
 * block is printed deterministically - with the advisor code, which the model
 * does not reliably reproduce - so a sign-off inside the prose would appear
 * twice. And chart placement counts BODY paragraphs: the config says "after the
 * second paragraph" meaning the second paragraph of the letter's argument, not
 * the second block of text, which would be off by one because of the greeting.
 */
function splitLetter(text) {
  const blocks = String(text)
    .split(/\n{2,}|\r\n\r\n/)
    .map((p) => p.replace(/\s*\n\s*/g, ' ').trim())
    .filter(Boolean);

  let greeting = null;
  if (blocks.length > 0 && /^(prezad|car[oa]|olá|ol[aá])/i.test(blocks[0]) && blocks[0].length < 90) {
    greeting = blocks.shift();
  }

  // Drop everything from the closing salutation onward: the renderer signs.
  const closingAt = blocks.findIndex((p) => /^(atenciosamente|cordialmente|abraços|respeitosamente)/i.test(p));
  const body = closingAt === -1 ? blocks : blocks.slice(0, closingAt);

  return { greeting, body };
}

/**
 * The four numbers a client looks for before reading a word.
 *
 * WHY A PANEL AND NOT A SENTENCE
 * ------------------------------
 * Every figure here was already in the letter, buried in the second paragraph.
 * A client opening a monthly statement wants to know how the month went before
 * deciding whether to read the argument, and making them parse prose to find
 * "+2,62%" is a small act of rudeness repeated twelve times a year.
 *
 * WHY THE RENDERER BUILDS IT, NOT THE MODEL
 * -----------------------------------------
 * The panel is the most numerically dense part of the page, and it is assembled
 * entirely from `plan.letter.headline` - already formatted, already reconciled.
 * The model never sees it and cannot alter it. That is the project's thesis in
 * miniature: the numbers that matter most are the ones a language model is
 * furthest from.
 *
 * A cell whose figure is missing is dropped rather than printed as "—": four
 * confident numbers read better than three numbers and an apology.
 */
function summaryPanel(headline, period) {
  const cells = [
    {
      k: `Rentabilidade · ${period}`,
      v: headline.measured_return?.display,
      sub: headline.pnl?.display,
    },
    {
      k: 'CDI no mês',
      v: headline.cdi_month?.display,
      sub: headline.pct_of_cdi?.display,
    },
    {
      k: 'Patrimônio',
      v: headline.net_worth?.display,
      sub: headline.net_worth_return?.display
        ? `${headline.net_worth_return.display} no mês`
        : null,
    },
    {
      k: 'Custo dos fundos',
      v: headline.fund_cost_annual?.display,
      sub: headline.fund_cost_pct?.display
        ? `${headline.fund_cost_pct.display} · taxa de administração`
        : null,
    },
  ].filter((c) => c.v);

  if (cells.length === 0) return '';

  return `<div class="panel">
    ${cells
      .map(
        (c) => `<div class="cell">
      <div class="k">${esc(c.k)}</div>
      <div class="v">${esc(c.v)}</div>
      ${c.sub ? `<div class="s">${esc(c.sub)}</div>` : ''}
    </div>`,
      )
      .join('\n    ')}
  </div>`;
}

/**
 * The proposals, as a numbered block rather than a paragraph.
 *
 * WHY THIS STOPPED BEING PROSE
 * ----------------------------
 * Paragraph four used to carry every proposal, every amount and every
 * justification as running text. It was the densest paragraph in the letter and
 * the one the model got wrong most often - run five wrote "juros altos
 * prejudicam a renda fixa" two paragraphs before proposing to buy post-fixed
 * income, because it was left to infer a conclusion the engine had already
 * derived.
 *
 * The actions are the part of a letter a client actually has to act on, and
 * they are entirely made of figures the plan already formatted: an amount, a
 * date, a rate. So the composer now writes one short sentence leading into this
 * block, and the block itself is printed from `plan.letter.recommendations`.
 * Nothing here can be rephrased, reordered or quietly dropped.
 *
 * Two rationale lines per item, not four: the block has to stay scannable, and
 * the macro justification is already the whole of paragraph three.
 */
function proposalsBlock(recommendations, netWorth, findings) {
  const items = recommendations ?? [];
  if (items.length === 0) return '';

  // A recommendation records WHICH finding it closes, by code and position.
  // Printing the position alone gives "Resolve: Saldo disponível", which names
  // the thing rather than the problem; the finding's own title says what is
  // actually wrong with it.
  const findingTitle = (ref) => {
    if (!ref) return null;
    const hit = (findings ?? []).find(
      (f) => f.code === ref.code && (!ref.position || f.position?.label === ref.position),
    );
    return hit?.title ?? ref.position ?? null;
  };

  const brl = (v) =>
    `R$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  // "Proposta:" and "Pendência:" are different kinds of object - one is an
  // opportunity, the other is something already wrong - so the prefix the
  // engine wrote becomes a tag instead of being flattened into the title.
  const split = (headline) => {
    const m = String(headline).match(/^([^:]{3,14}):\s*(.+)$/);
    // Splitting "Proposta: alocar o saldo…" leaves the title starting on a
    // lower-case letter, which reads as a fragment once it stands alone.
    const cap = (t) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : t);
    return m ? { tag: m[1], title: cap(m[2]) } : { tag: null, title: headline };
  };

  const INSTRUMENT_PT = {
    renda_fixa_pos_fixada: 'Renda fixa pós-fixada',
    renda_fixa: 'Renda fixa',
    acoes: 'Ações',
  };

  const rows = items
    .map((r, i) => {
      const { tag, title } = split(r.headline);
      // One line, not two. The block sits inside a two-page budget and the
      // second line was always the least load-bearing of the pair.
      const why = (r.rationale_inputs ?? []).slice(0, 1);

      // A share-of-net-worth bar. "R$ 35.986,74" means nothing on its own to a
      // client who does not hold his own balance in his head; "9,3% do seu
      // patrimônio" is the same fact in the unit he actually reasons in, and
      // the bar makes the two proposals comparable at a glance.
      let scale = '';
      if (Number.isFinite(r.amount_brl) && Number.isFinite(netWorth) && netWorth > 0) {
        const share = r.amount_brl / netWorth;
        const pct = `${(share * 100).toFixed(1).replace('.', ',')}%`;
        scale = `<div class="scale">
            <span class="track"><span class="fill" style="width:${Math.min(share * 100, 100).toFixed(1)}%"></span></span>
            <span class="pctlabel">${pct} do patrimônio</span>
          </div>`;
      }

      // Naming the finding the action closes is what turns a suggestion into a
      // consequence: the client can see that every step exists because
      // something specific was measured, not because a letter needed content.
      const resolvedTitle = findingTitle(r.addresses_finding);
      const resolves = resolvedTitle
        ? `<div class="resolves">Resolve: ${esc(resolvedTitle)}</div>`
        : '';

      const kind = INSTRUMENT_PT[r.instrument_class] ?? null;

      return `<li>
        <div class="row">
          <span class="n">${i + 1}</span>
          <span class="what">${tag ? `<span class="tag">${esc(tag)}</span>` : ''}${esc(title)}${
            kind ? `<span class="kind">${esc(kind)}</span>` : ''
          }</span>
          <span class="amt">${Number.isFinite(r.amount_brl) ? brl(r.amount_brl) : ''}</span>
        </div>
        ${scale}
        ${why.length ? `<ul class="why">${why.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
        ${resolves}
      </li>`;
    })
    .join('\n      ');

  const needsConfirmation = items.some((r) => r.requires_advisor_confirmation);

  return `<section class="proposals">
    <h2>Próximos passos</h2>
    <ol>
      ${rows}
    </ol>
    ${
      needsConfirmation
        ? '<p class="confirm">Nenhum destes passos é executado sem a sua confirmação com o assessor.</p>'
        : ''
    }
  </section>`;
}

/**
 * Buy candidates and held positions that fail the same test.
 *
 * WHY THIS IS NOT MORE "PRÓXIMOS PASSOS"
 * --------------------------------------
 * The items in that block are things that are WRONG - cash idle past the policy
 * limit, a bond that matured 244 days ago and is still on the books. They have
 * an owner and a deadline. A share worth considering is a different kind of
 * object: an idea for a conversation, with no deadline, and nothing breaks if
 * the client says no. Numbering them together would make "avaliar PETR4" look
 * as overdue as "the bond has not settled".
 *
 * WHY ONE CRITERION RUNS IN BOTH DIRECTIONS
 * -----------------------------------------
 * The profile clause the letter cites to justify a purchase is the same clause
 * that two held positions fail. Quoting it only where it supports buying, and
 * never applying it to what the client already owns, is exactly the asymmetry
 * the credit-rating finding calls out elsewhere in this project. So the block
 * has two halves and one rule.
 *
 * WHY THE RIGHT-HAND SIDE SAYS "REVISAR" AND NEVER "VENDER"
 * --------------------------------------------------------
 * The engine measured a dividend history. It has no view on whether to sell,
 * and turning a failed screen into a sell instruction would be inventing advice
 * the evidence does not support. The screen's own words are printed as the
 * reason, not a paraphrase of them.
 *
 * WHY NO PRICES
 * -------------
 * The XP price file and the market close disagree on these very tickers by up
 * to 56% - PETR4 by 23,8%. The annex reports every divergence. Printing a
 * contested price beside a buy idea in a client letter would be choosing a side
 * of that disagreement without saying so, and the case for each candidate rests
 * on its dividend record, not on today's quote.
 */
function equityIdeasBlock(ideas) {
  if (!ideas) return '';
  const { buy = [], review = [] } = ideas;
  if (buy.length === 0 && review.length === 0) return '';

  const buyRows = buy
    .map(
      (b) => `<tr>
        <td class="tk">${esc(b.ticker)}</td>
        <td class="r">${esc(b.dividend_yield?.display ?? '—')}</td>
        <td class="r">${b.dividend_events ?? '—'}</td>
        <td class="r">${esc(b.volatility?.display ?? '—')}</td>
      </tr>`,
    )
    .join('');

  const reviewRows = review
    .map(
      (r) => `<tr>
        <td class="tk">${esc(r.ticker)}</td>
        <td class="why">${esc(r.reason_short_pt || (r.reasons_pt ?? []).join('; '))}${
          r.return_since_purchase ? ` · ${esc(r.return_since_purchase.display)} desde a compra` : ''
        }</td>
        <td class="r">${esc(r.value_brl?.display ?? '')}</td>
      </tr>`,
    )
    .join('');

  const criterion =
    ideas.screen?.min_events && ideas.screen?.min_yield?.display
      ? `Critério do seu perfil: pelo menos ${ideas.screen.min_events} pagamentos de dividendo em ` +
        `${ideas.screen.lookback_months ?? 12} meses e retorno em dividendos de ${ideas.screen.min_yield.display} ao ano.`
      : '';

  return `<section class="ideas">
    <h2>Ideias para conversarmos</h2>
    <p class="lede">${esc(ideas.note_pt ?? '')} ${esc(criterion)}</p>

    ${
      buy.length
        ? `<div class="half">
      <h3>Para avaliar a compra</h3>
      <table>
        <thead><tr><th>Ativo</th><th class="r">Dividendos 12m</th><th class="r">Pagamentos</th><th class="r">Volatilidade</th></tr></thead>
        <tbody>${buyRows}</tbody>
      </table>
    </div>`
        : ''
    }

    ${
      review.length
        ? `<div class="half">
      <h3>Para revisar <span class="q">o mesmo critério, aplicado ao que já está na carteira</span></h3>
      <table>
        <thead><tr><th>Ativo</th><th>Por quê</th><th class="r">Valor hoje</th></tr></thead>
        <tbody>${reviewRows}</tbody>
      </table>
      ${
        ideas.failed_share?.display
          ? `<p class="foot">${esc(ideas.failed_share.display)} do que você tem em ações (${esc(
              ideas.failed_value?.display ?? '',
            )}) não passa no critério que justifica as compras acima.</p>`
          : ''
      }
    </div>`
        : ''
    }
  </section>`;
}

/**
 * What the two-page budget cut, stated to the client.
 *
 * WHY THE RENDERER PRINTS THIS AND NOT THE MODEL
 * ----------------------------------------------
 * The plan already computes these sentences - `omissions[].disclosure_pt` - and
 * they were being handed to the composer to work into the prose. It worked
 * exactly as well as asking a writer to remember a footnote: the run kept the
 * one about deferred proposals, paraphrased it into "vale também revisar outras
 * propostas", and dropped the one about the five other findings entirely.
 *
 * So the client was never told that five findings existed. The whole point of
 * cutting by rule instead of by model is that the reader learns what was cut;
 * a disclosure that survives only if the model feels like including it is not a
 * disclosure. It is printed here, from the plan, where nothing can drop it.
 *
 * Entries with no `disclosure_pt` are operational - a ticker to update in the
 * back office - and are deliberately not shown to the client.
 */
function omissionsBlock(omissions) {
  const lines = (omissions ?? []).map((o) => o.disclosure_pt).filter(Boolean);
  if (lines.length === 0) return '';
  return `<p class="omissions">${lines.map(esc).join(' ')}</p>`;
}

/**
 * @param {object} params
 * @param {string} params.letterText  prose produced by the Rivet graph
 * @param {object} params.plan        letter-plan.json
 * @param {object} params.portfolio   portfolio.json, for the header block
 * @param {object} params.metrics     metrics.json, for the reference period
 * @param {object} params.charts      { attribution, benchmarks } SVG strings
 * @param {string} [params.provenance] one line naming when the data was pulled
 */
export function renderLetterHtml({ letterText, plan, portfolio, metrics, charts, provenance, placeCharts, proposalsParagraph }) {
  const disclosures = plan.letter.disclosures ?? [];
  if (disclosures.length === 0) {
    throw new Error(
      'The letter plan carries no disclosures. Refusing to render a client letter ' +
        'without its compliance block.',
    );
  }

  const client = portfolio.client?.name ?? '';
  const advisor = portfolio.advisor?.name ?? '';
  const advisorCode = portfolio.advisor?.code ?? '';
  const account = portfolio.client?.account ?? '';
  const period = metrics.reference?.period?.label_pt ?? metrics.reference?.month ?? '';

  // A letter carries a date. This one is the statement date, written long, and
  // NOT prefixed with a city: the statement names no place, XP's head office is
  // not necessarily the advisor's, and inventing "São Paulo," to make the page
  // look more like a letter would be inventing a fact to improve a layout.
  const MONTHS_PT = [
    'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
    'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
  ];
  const iso = portfolio.statement_date ?? null;
  const statementDate = /^\d{4}-\d{2}-\d{2}/.test(String(iso ?? ''))
    ? (() => {
        const [y, m, d] = String(iso).slice(0, 10).split('-');
        return `${Number(d)} de ${MONTHS_PT[Number(m) - 1]} de ${y}`;
      })()
    : null;

  // Charts sit next to the sentences they explain, not in a block at the end.
  //
  // Placement is by paragraph index and comes from config, because the composer
  // writes a fixed five-paragraph structure. Anything the map cannot place is
  // appended rather than dropped - a chart silently vanishing because a run
  // produced four paragraphs instead of five would be a bad way to lose a
  // figure.
  const { greeting, body: paras } = splitLetter(letterText);
  const placement = placeCharts ?? {};
  const placed = new Set();

  // The block and the prose must not both carry the proposals.
  //
  // The composer used to write every amount into paragraph four; it is now
  // asked for a one-sentence lead-in, because the block below prints those
  // figures from the plan. Prose produced BEFORE that prompt change still
  // carries them, and printing both would say everything twice and push the
  // letter to three pages.
  //
  // So the renderer checks rather than assumes: if the prose already contains
  // an amount the block would print, the block is suppressed and the build says
  // why. Detection is on the formatted amount, which is the one string that
  // cannot appear by coincidence.
  const proposals = plan.letter.recommendations ?? [];
  const amounts = proposals
    .map((r) => r.amount_brl)
    .filter(Number.isFinite)
    .map((v) => Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  const proseCarriesAmounts = amounts.some((a) => letterText.includes(a));

  const proposalsHtml = proseCarriesAmounts ? '' : proposalsBlock(proposals, portfolio.totals?.net_worth, plan.letter.findings);
  const ideasHtml = equityIdeasBlock(plan.letter.equity_ideas);
  if (proseCarriesAmounts && proposals.length > 0) {
    console.warn(
      '  warning: the prose already states the proposal amounts, so the "Próximos passos" block\n' +
        '           was suppressed to avoid printing them twice. This prose predates the current\n' +
        '           composer prompt — re-run the Rivet graph to get the short lead-in and the block.',
    );
  }

  const body = paras
    .map((p, i) => {
      const html = [`<p>${esc(p)}</p>`];
      // The proposals block sits where the proposals paragraph used to be, so
      // the lead-in sentence still runs straight into the actions it announces.
      if (proposalsParagraph && i + 1 === proposalsParagraph) { html.push(proposalsHtml); html.push(ideasHtml); }
      const chartName = placement[String(i + 1)];
      const svg = chartName ? charts?.[chartName] : null;
      if (svg) {
        placed.add(chartName);
        html.push(`<figure>${svg}</figure>`);
      }
      return html.join('\n      ');
    })
    .join('\n      ');

  const orphans = Object.entries(charts ?? {})
    .filter(([name, svg]) => svg && !placed.has(name) && Object.values(placement).includes(name))
    .map(([, svg]) => `<figure>${svg}</figure>`)
    .join('\n      ');

  const disclosureItems = disclosures
    .map((d) => `<li>${esc(d.text_pt)}</li>`)
    .join('\n          ');

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<title>Relatório mensal — ${esc(client)} — ${esc(period)}</title>
<style>
  /* House identity.
     The letterhead is a black band because that is the only background where
     XP's yellow is legible: 13.43:1 on black against 1.56:1 on white. Every
     colour below comes from src/render/brand.js, which tools/check-palette.js
     measures - the letter and the charts cannot drift apart, because they read
     the same tokens. */
  @page {
    size: A4;
    margin: 14mm 16mm 14mm;
  }

  :root {
    --ink: ${INK};
    --muted: ${MUTED};
    --rule: ${RULE};
    --black: ${XP_BLACK};
    --yellow: ${XP_YELLOW};
    --yellow-dark: ${YELLOW_DARK};
  }

  * { box-sizing: border-box; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }

  /* Sans throughout, matching the charts. The previous draft set the prose in
     Georgia and the charts in a UI sans, so the two halves of the same page
     disagreed with each other. */
  body {
    font: 10pt/1.55 'Segoe UI', system-ui, -apple-system, Helvetica, Arial, sans-serif;
    color: var(--ink);
    margin: 0;
  }

  /* --- letterhead --------------------------------------------------------- */

  .letterhead {
    display: flex;
    align-items: center;
    gap: 11px;
    background: var(--black);
    color: #fff;
    padding: 10px 13px;
    margin: 0 0 3px;
  }
  .letterhead .wordmark {
    font-weight: 600; font-size: 11.5pt; line-height: 1;
    letter-spacing: .015em;
  }
  .letterhead .period {
    margin-left: auto;
    font-weight: 400; font-size: 8.5pt; line-height: 1;
    color: var(--yellow);
    letter-spacing: .04em;
    text-transform: uppercase;
  }
  .rule-yellow { height: 3px; background: var(--yellow); margin-bottom: 15px; }

  .meta {
    display: flex;
    justify-content: space-between;
    gap: 16px;
    font-weight: 400; font-size: 8.5pt; line-height: 1.45;
    color: var(--muted);
    margin-bottom: 12px;
  }
  .meta strong { color: var(--ink); font-weight: 600; }
  .meta .date { white-space: nowrap; }

  /* --- summary panel ------------------------------------------------------ */

  .panel {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 1px;
    background: var(--rule);
    border: 1px solid var(--rule);
    margin-bottom: 15px;
    break-inside: avoid;
  }
  .panel .cell { background: #fff; padding: 5px 9px; }
  .panel .k {
    font-size: 6.9pt; text-transform: uppercase; letter-spacing: .05em;
    color: var(--muted); font-weight: 600;
  }
  .panel .v { font-size: 13pt; font-weight: 600; line-height: 1.25; margin-top: 1px; }
  .panel .s { font-size: 7.2pt; color: var(--muted); }
  /* The first cell is the headline number; the yellow edge says so without
     making it a different size from the other three. */
  .panel .cell:first-child { box-shadow: inset 3px 0 0 var(--yellow); }

  /* --- body --------------------------------------------------------------- */

  p { margin: 0 0 8px; text-align: justify; hyphens: auto; }
  .greeting { text-align: left; margin-bottom: 12px; }

  figure { margin: 6px 0; break-inside: avoid; }

  /* --- signature ---------------------------------------------------------- */

  /* --- próximos passos ---------------------------------------------------- */

  .proposals {
    margin: 12px 0;
    padding: 9px 12px 10px;
    border: 1px solid var(--rule);
    border-left: 3px solid var(--yellow);
  }
  .proposals h2 {
    font-weight: 600; font-size: 8pt; line-height: 1;
    text-transform: uppercase;
    letter-spacing: .07em;
    margin: 0 0 7px;
    color: var(--ink);
  }
  .proposals ol { margin: 0; padding: 0; list-style: none; counter-reset: none; }
  .proposals li { margin-bottom: 5px; break-inside: avoid; }
  .proposals li:last-child { margin-bottom: 0; }
  .proposals .row { display: flex; align-items: baseline; gap: 7px; }
  .proposals .n {
    flex: 0 0 auto; width: 15px; height: 15px; border-radius: 50%;
    background: var(--black); color: #fff;
    font-weight: 600; font-size: 8pt; line-height: 15px; text-align: center;
  }
  .proposals .what { flex: 1 1 auto; font-weight: 600; }
  .proposals .tag {
    display: inline-block; font-weight: 600; font-size: 6.8pt; line-height: 1; text-transform: uppercase;
    letter-spacing: .05em; color: var(--muted);
    border: 1px solid var(--rule); border-radius: 2px;
    padding: 2px 4px; margin-right: 5px; vertical-align: 1px;
  }
  .proposals .amt { flex: 0 0 auto; font-weight: 600; white-space: nowrap; }
  .proposals .kind {
    display: block; font-size: 7.6pt; font-weight: 400; color: var(--muted); margin-top: 1px;
  }
  .proposals .scale { display: flex; align-items: center; gap: 7px; margin: 4px 0 3px 22px; }
  .proposals .track {
    flex: 0 0 132px; height: 5px; border-radius: 3px; background: var(--rule); overflow: hidden;
  }
  .proposals .fill { display: block; height: 100%; background: var(--yellow); }
  .proposals .pctlabel { font-size: 7.8pt; color: var(--muted); }
  .proposals ul.why {
    margin: 2px 0 0 22px; padding-left: 13px; font-size: 8.4pt; color: var(--muted); text-align: left;
  }
  .proposals ul.why li { margin-bottom: 1px; }
  .proposals .resolves {
    margin: 3px 0 0 22px; font-size: 7.8pt; color: var(--yellow-dark); font-weight: 600;
  }
  .proposals .confirm {
    margin: 8px 0 0; padding-top: 6px; border-top: 1px solid var(--rule);
    font-size: 8pt; color: var(--muted); text-align: left;
  }

  /* --- ideias para conversarmos ------------------------------------------- */

  .ideas {
    margin: 10px 0 0;
    padding: 9px 12px 10px;
    border: 1px solid var(--rule);
  }
  .ideas h2 {
    font-weight: 600; font-size: 8pt; line-height: 1;
    text-transform: uppercase; letter-spacing: .07em;
    margin: 0 0 4px; color: var(--ink);
  }
  .ideas h3 {
    font-weight: 600; font-size: 8.2pt; line-height: 1.2;
    margin: 8px 0 3px; color: var(--ink);
  }
  .ideas h3 .q { font-weight: 400; font-size: 7.6pt; color: var(--muted); }
  .ideas .lede { margin: 0 0 2px; font-size: 7.8pt; color: var(--muted); text-align: left; }
  .ideas table { width: 100%; border-collapse: collapse; font-size: 8.2pt; }
  .ideas th {
    text-align: left; font-weight: 600; font-size: 7pt; text-transform: uppercase;
    letter-spacing: .04em; color: var(--muted);
    border-bottom: 1px solid var(--rule); padding: 2px 4px;
  }
  .ideas td { padding: 2px 4px; border-bottom: 1px solid var(--rule); }
  .ideas tr, .ideas .half { break-inside: avoid; }
  .ideas tr:last-child td { border-bottom: none; }
  .ideas td.r, .ideas th.r { text-align: right; }
  .ideas td.tk { font-weight: 600; white-space: nowrap; }
  .ideas td.why { color: var(--muted); font-size: 7.8pt; }
  .ideas .foot { margin: 4px 0 0; font-size: 7.8pt; color: var(--yellow-dark); font-weight: 600; text-align: left; }

  /* Set apart from the argument: this is the letter accounting for itself,
     not another point being made. */
  .omissions {
    margin: 12px 0 0;
    padding: 7px 10px;
    background: #f7f7f5;
    border-left: 3px solid var(--yellow);
    font-size: 8.6pt;
    color: var(--muted);
    text-align: left;
    break-inside: avoid;
  }

  .signoff {
    margin-top: 16px;
    padding-left: 11px;
    border-left: 3px solid var(--yellow);
    break-inside: avoid;
  }
  .signoff .name { font-weight: 600; }
  .signoff .role { font-weight: 400; font-size: 8.5pt; line-height: 1.4; color: var(--muted); }

  /* --- compliance --------------------------------------------------------- */

  .disclosures {
    margin-top: 16px;
    padding: 9px 11px;
    background: #f7f7f5;
    border-top: 2px solid var(--yellow);
    font-weight: 400; font-size: 7pt; line-height: 1.32;
    color: var(--muted);
    /* Breakable. A block of legal text continuing overleaf is ordinary; a block
       that refuses to split gets pushed whole and costs a page. Individual
       items stay atomic so no single disclosure is cut in half. */
  }
  .disclosures h2 {
    font-weight: 600; font-size: 7.6pt; line-height: 1;
    text-transform: uppercase;
    letter-spacing: .07em;
    margin: 0 0 4px;
    color: var(--ink);
  }
  /* Two columns. Six compliance bullets set in one narrow column ran nearly a
     third of the second page, and the page budget is the brief's one hard
     requirement. Splitting them costs no information and buys back the room the
     summary panel and the concentration note needed. */
  .disclosures ul {
    margin: 0;
    padding-left: 13px;
    columns: 3;
    column-gap: 14px;
  }
  .disclosures li { margin-bottom: 2px; break-inside: avoid; }

  .provenance {
    margin-top: 6px;
    padding-top: 5px;
    border-top: 1px solid var(--rule);
    font-size: 7pt;
  }
</style>
</head>
<body>
  <div class="letterhead">
    ${markSvg({ size: 26 })}
    <span class="period">Relatório mensal &middot; ${esc(period)}</span>
  </div>
  <div class="rule-yellow"></div>

  <div class="meta">
    <span><strong>${esc(client)}</strong>${account ? ` &middot; conta ${esc(account)}` : ''}</span>
    <span>Assessor: <strong>${esc(advisor)}</strong>${advisorCode ? ` &middot; ${esc(advisorCode)}` : ''}</span>
    ${statementDate ? `<span class="date">${esc(statementDate)}</span>` : ''}
  </div>

  ${summaryPanel(plan.letter.headline ?? {}, period)}

  <main>
      ${greeting ? `<p class="greeting">${esc(greeting)}</p>` : ''}
      ${body}

      ${orphans}
  </main>

  ${omissionsBlock(plan.omissions)}

  <div class="signoff">
    <div class="name">${esc(advisor)}</div>
    <div class="role">Assessor de investimentos${advisorCode ? ` &middot; ${esc(advisorCode)}` : ''} &middot; XP Investimentos</div>
  </div>

  <section class="disclosures">
    <h2>Informações importantes</h2>
    <ul>
          ${disclosureItems}
    </ul>
    ${provenance ? `<div class="provenance">${esc(provenance)}</div>` : ''}
  </section>
</body>
</html>`;
}

/**
 * A deterministic letter assembled from the plan alone.
 *
 * The layout, the charts and the PDF step must be verifiable without an API
 * key: a rendering bug should be findable by running the build, not by spending
 * a model call. This is NOT the deliverable letter - it is scaffolding, and it
 * says so on its face so it can never be mistaken for the real thing.
 */
export function draftFromPlan(plan, portfolio, metrics) {
  const pct = (v, d = 2) => `${(v * 100).toFixed(d).replace('.', ',')}%`;
  const brl = (v) => `R$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const a = plan.letter.attribution;
  const best = a.contributors[0];
  const worst = a.detractors[0];

  const lines = [
    `Prezado ${portfolio.client?.name ?? ''},`,
    `[RASCUNHO DETERMINÍSTICO — gerado sem modelo de linguagem, apenas para conferir ` +
      `diagramação, gráficos e paginação. A carta final é produzida pelo grafo Rivet.]`,
    `No mês de referência, a parcela da sua carteira que pudemos medir com dados de fonte ` +
      `primária — ${pct(metrics.coverage.share_of_invested)} do valor investido — apresentou ` +
      `variação de ${pct(metrics.portfolio_return)}. No mesmo período, o CDI variou ` +
      `${pct(metrics.versus.cdi.value)} e a inflação medida pelo IPCA, ${pct(metrics.versus.ipca.value)}.`,
    best && worst
      ? `A maior contribuição individual veio de ${best.label}, e ` +
        `${a.detractor_count === 1 ? 'a única posição que fechou o mês em queda foi' : 'a maior detração veio de'} ` +
        `${worst.label}.`
      : '',
    // Paragraph 4 is a lead-in and nothing else. The proposals themselves are
    // printed by proposalsBlock() from the plan, and the omission notices by
    // omissionsBlock() - neither belongs in the prose any more, in the draft or
    // in a real run. Keeping the draft in the same shape as the composer's
    // output is the whole point of it: pagination proved here has to be the
    // pagination that ships.
    `Diante desse cenário, proponho os passos abaixo.`,
    `Permaneço à disposição para conversarmos sobre qualquer um destes pontos.`,
  ].filter(Boolean);

  return lines.join('\n\n');
}
