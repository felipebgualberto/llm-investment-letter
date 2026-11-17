/**
 * CVM fund identity resolution.
 *
 * THE PRINCIPLE: RESOLVE IDENTITY AS OF THE STATEMENT DATE
 * --------------------------------------------------------
 * A statement is a photograph of a moment. The names it carries were the names
 * in force when it was printed, and funds are renamed, restructured and
 * converted constantly. Searching only today's registry answers the wrong
 * question.
 *
 * The holding "Brave I FIC FIM CP" makes the point. It is absent from the
 * current registry, because:
 *
 *   2020-01-31 -> 2024-05-13   BRAVE I ... MULTIMERCADO CREDITO PRIVADO
 *   2024-05-13 -> 2024-11-05   BRAVE 90 ... MULTIMERCADO CREDITO PRIVADO
 *   2024-11-05 -> present      BRAVE 90 ... EM DIREITOS CREDITORIOS  (now a FIDC)
 *
 * It is 23.24% of the client's portfolio and it was found only by searching the
 * historical name tables. The same principle already governs ticker validation:
 * ARZZ3 was a valid code in April 2025 even though it is dead today.
 *
 * THREE NAME SOURCES ARE SEARCHED
 * -------------------------------
 *   registro_classe.csv            current legal name (post Resolution 175)
 *   cad_fi_hist_denom_social.csv   historical legal names, with validity dates
 *   cad_fi_hist_denom_comerc.csv   historical COMMERCIAL names, with dates
 *
 * The commercial table matters most: statements quote commercial names, and
 * they frequently differ from the legal one. "Brave I" only ever existed there
 * after May 2024.
 */

import { getBuffer } from './http.js';
import { extractMatching } from '../lib/unzip.js';

const REGISTRY_URL = 'https://dados.cvm.gov.br/dados/FI/CAD/DADOS/registro_fundo_classe.zip';
const HISTORY_URL = 'https://dados.cvm.gov.br/dados/FI/CAD/DADOS/cad_fi_hist.zip';

/** At least this many distinctive tokens are required to attempt a match. */
export const MIN_DISTINCTIVE_TOKENS = 2;

/**
 * Words carried by nearly every Brazilian fund name. They describe the legal
 * wrapper, not the product, so they cannot distinguish one fund from another.
 * Covers both the pre- and post-Resolution 175 vocabulary, because the
 * statement predates the reform and the registry follows it.
 */
const BOILERPLATE = new Set([
  'FUNDO', 'FUNDOS', 'INVESTIMENTO', 'INVESTIMENTOS', 'COTAS', 'QUOTAS',
  'FI', 'FIC', 'FIF', 'FIA', 'FIM', 'FIRF', 'CIC', 'FIFE', 'FIDC',
  'DE', 'DO', 'DA', 'DOS', 'DAS', 'EM', 'E', 'A', 'O',
  'MULTIMERCADO', 'MULTIMERCADOS', 'ACOES', 'RENDA', 'FIXA', 'FINANCEIRO',
  'FINANCEIROS', 'CREDITO', 'PRIVADO', 'CP', 'REF', 'DI', 'SIMPLES',
  'CLASSE', 'SUBCLASSE', 'RESPONSABILIDADE', 'LIMITADA', 'RESP', 'LTDA', 'SA',
  'LONGO', 'PRAZO', 'NIVEL',
  'DIREITOS', 'CREDITORIOS',
]);

/**
 * Roman numerals are deliberately NOT boilerplate. In Brazilian fund names they
 * are series identifiers, and dropping them merges genuinely different funds:
 *
 *   35.726.300/0001-37  BRAVE I
 *   36.015.243/0001-40  BRAVE II  HIGH YIELD
 *   41.196.241/0001-35  BRAVE III HIGH GRADE
 *
 * Treating "I" as noise reduces "Brave I FIC FIM CP" to a single token and
 * makes the client's largest fund holding unresolvable, while also creating a
 * three-way collision. Keeping it costs nothing: containment plus minimality
 * still discards "... BDR NIVEL I" style matches, because those carry extra
 * distinctive tokens.
 */

/** Uppercase, strip accents and punctuation, split into tokens. */
function tokenize(name) {
  return String(name)
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/** Tokens that actually identify a product. */
export function distinctiveTokens(name) {
  return [...new Set(tokenize(name).filter((t) => !BOILERPLATE.has(t)))];
}

/** "43.917.493/0001-31" -> "43917493000131" */
export function normalizeCnpj(value) {
  return String(value).replace(/\D/g, '');
}

/** Decode a CVM CSV: ISO-8859-1, semicolon separated, header on line 1. */
function parseCsv(buffer) {
  const text = new TextDecoder('iso-8859-1').decode(buffer);
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  return { header: lines[0].split(';'), rows: lines.slice(1) };
}

/** Column accessor that fails loudly when CVM changes a layout. */
function columns(header, names, file) {
  const index = {};
  for (const name of names) {
    const i = header.indexOf(name);
    if (i === -1) throw new Error(`Column "${name}" missing from ${file}: ${header.join(';')}`);
    index[name] = i;
  }
  return index;
}

/**
 * Build the searchable name index: every name a fund has ever carried, from
 * all three sources, each with its validity window.
 *
 * @returns {Promise<{names: object[], classesByCnpj: Map, retrieved_at: string}>}
 */
export async function fetchNameIndex(options = {}) {
  const [registry, history] = await Promise.all([
    getBuffer(REGISTRY_URL, options),
    getBuffer(HISTORY_URL, options),
  ]);

  const names = [];
  const classesByCnpj = new Map();

  // --- current legal names, plus the attributes the suitability engine needs
  {
    const { content } = extractMatching(registry.buffer, /registro_classe\.csv$/i);
    const { header, rows } = parseCsv(content);
    // Indicador_Desempenho and Classificacao_Anbima are read for one reason:
    // they let each fund be measured against the benchmark IT declared to the
    // regulator, instead of against a house default. The Constellation is an
    // Ibovespa fund and the Riza Lotus is a CDI fund; comparing both to the CDI
    // flatters one and slanders the other.
    const c = columns(
      header,
      [
        'CNPJ_Classe', 'Denominacao_Social', 'Situacao', 'Tipo_Classe', 'Publico_Alvo',
        'Indicador_Desempenho', 'Classificacao_Anbima', 'Classificacao', 'Patrimonio_Liquido',
      ],
      'registro_classe.csv',
    );
    const seen = new Set();
    for (const row of rows) {
      const cells = row.split(';');
      const cnpj = normalizeCnpj(cells[c.CNPJ_Classe] ?? '');
      const name = (cells[c.Denominacao_Social] ?? '').trim();
      if (!cnpj || !name) continue;

      // "Não se aplica" is the registry's way of saying a fund declared no
      // benchmark. It is not a benchmark, and storing it as one would produce
      // "rendeu 6,56% contra Não se aplica".
      const declared = (cells[c.Indicador_Desempenho] ?? '').trim();
      const record = {
        cnpj,
        situation: (cells[c.Situacao] ?? '').trim(),
        class_type: (cells[c.Tipo_Classe] ?? '').trim(),
        target_investor: (cells[c.Publico_Alvo] ?? '').trim(),
        declared_benchmark: declared && !/^n[ãa]o se aplica$/i.test(declared) ? declared : null,
        anbima_class: (cells[c.Classificacao_Anbima] ?? '').trim() || null,
        cvm_class: (cells[c.Classificacao] ?? '').trim() || null,
        fund_net_assets: Number(cells[c.Patrimonio_Liquido]) || null,
        current_name: name,
      };
      if (!classesByCnpj.has(cnpj)) classesByCnpj.set(cnpj, record);

      const key = `${cnpj}|${name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      names.push({ cnpj, name, source: 'current_class', from: null, to: null });
    }
  }

  // --- historical legal and commercial names, with validity windows
  const HISTORY_FILES = [
    { pattern: /cad_fi_hist_denom_social\.csv$/i, nameCol: 'DENOM_SOCIAL', fromCol: 'DT_INI_DENOM_SOCIAL', toCol: 'DT_FIM_DENOM_SOCIAL', source: 'historical_legal' },
    { pattern: /cad_fi_hist_denom_comerc\.csv$/i, nameCol: 'DENOM_COMERC', fromCol: 'DT_INI_DENOM_COMERC', toCol: 'DT_FIM_DENOM_COMERC', source: 'historical_commercial' },
  ];

  for (const spec of HISTORY_FILES) {
    const { content } = extractMatching(history.buffer, spec.pattern);
    const { header, rows } = parseCsv(content);
    const c = columns(header, ['CNPJ_FUNDO', spec.nameCol, spec.fromCol, spec.toCol], String(spec.pattern));
    const seen = new Set();
    for (const row of rows) {
      const cells = row.split(';');
      const cnpj = normalizeCnpj(cells[c.CNPJ_FUNDO] ?? '');
      const name = (cells[c[spec.nameCol]] ?? '').trim();
      if (!cnpj || !name) continue;
      const from = (cells[c[spec.fromCol]] ?? '').trim() || null;
      const to = (cells[c[spec.toCol]] ?? '').trim() || null;
      const key = `${cnpj}|${name}|${from}`;
      if (seen.has(key)) continue;
      seen.add(key);
      names.push({ cnpj, name, source: spec.source, from, to });
    }
  }

  // The history archive is handed back rather than discarded. The fee tables
  // live inside this same zip, so pricing the portfolio's cost costs zero extra
  // requests - see src/data/cvm-fees.js.
  return {
    names,
    classesByCnpj,
    historyBuffer: history.buffer,
    retrieved_at: registry.retrieved_at,
  };
}

/** True when `date` falls inside a name's validity window (open ends allowed). */
function validAt(record, date) {
  if (!date) return true;
  if (record.from && date < record.from) return false;
  if (record.to && date > record.to) return false;
  return true;
}

/**
 * Resolve a statement fund name to a CVM CNPJ.
 *
 * Gates, in order:
 *   1. Distinctiveness - at least two meaningful tokens after boilerplate is
 *      stripped. "Brave I FIC FIM CP" alone would reduce to {BRAVE}; it clears
 *      the gate only because the historical name adds nothing generic and the
 *      candidate set collapses to one CNPJ.
 *   2. Containment + minimality - every distinctive token must be present, and
 *      among survivors the candidate adding the fewest EXTRA tokens wins.
 *   3. Single identity - all surviving names must point at ONE CNPJ. Different
 *      names of the same fund are not a conflict; two different funds are.
 *
 * @param {string} statementName
 * @param {{names: object[], classesByCnpj: Map}} index
 * @param {string} [asOfDate] statement date, used to prefer contemporaneous names
 */
export function resolveFund(statementName, index, asOfDate = null) {
  const wanted = distinctiveTokens(statementName);

  if (wanted.length < MIN_DISTINCTIVE_TOKENS) {
    return {
      status: 'too_generic',
      distinctive: wanted,
      reason:
        `"${statementName}" reduces to ${wanted.length} distinctive token(s) ` +
        `(${wanted.join(', ') || 'none'}) once legal boilerplate is removed.`,
    };
  }

  const survivors = [];
  for (const record of index.names) {
    const candidateTokens = new Set(distinctiveTokens(record.name));
    if (!wanted.every((t) => candidateTokens.has(t))) continue;
    const extras = [...candidateTokens].filter((t) => !wanted.includes(t));
    survivors.push({ ...record, extra_count: extras.length, extra_tokens: extras });
  }

  if (survivors.length === 0) {
    return {
      status: 'not_found',
      distinctive: wanted,
      reason: `No CVM name record - current or historical - contains all of: ${wanted.join(', ')}.`,
    };
  }

  // Minimality first; among equals prefer a name that was actually in force on
  // the statement date, then prefer the commercial name a statement would quote.
  const sourceRank = { historical_commercial: 0, historical_legal: 1, current_class: 2 };
  survivors.sort(
    (a, b) =>
      a.extra_count - b.extra_count ||
      Number(validAt(b, asOfDate)) - Number(validAt(a, asOfDate)) ||
      sourceRank[a.source] - sourceRank[b.source] ||
      a.name.localeCompare(b.name),
  );

  const minimal = survivors.filter((s) => s.extra_count === survivors[0].extra_count);
  const distinctCnpjs = [...new Set(minimal.map((s) => s.cnpj))];

  if (distinctCnpjs.length > 1) {
    return {
      status: 'ambiguous',
      distinctive: wanted,
      candidates: minimal.slice(0, 5).map((s) => ({ cnpj: s.cnpj, name: s.name, source: s.source })),
      reason:
        `${distinctCnpjs.length} different funds match equally well ` +
        `(e.g. "${minimal[0].name}" and "${minimal.find((m) => m.cnpj !== minimal[0].cnpj).name}").`,
    };
  }

  const best = survivors[0];
  const klass = index.classesByCnpj.get(best.cnpj) ?? null;

  return {
    status: 'matched',
    cnpj: best.cnpj,
    matched_name: best.name,
    name_source: best.source,
    name_valid_from: best.from,
    name_valid_to: best.to,
    valid_at_statement: validAt(best, asOfDate),
    current_name: klass?.current_name ?? best.name,
    renamed: Boolean(klass && klass.current_name !== best.name),
    class_type: klass?.class_type ?? null,
    situation: klass?.situation ?? null,
    target_investor: klass?.target_investor ?? null,
    // What the fund told the regulator it is trying to beat, and how ANBIMA
    // classifies it. These let the engine compare each fund to its OWN
    // benchmark instead of holding an equity fund to the CDI.
    declared_benchmark: klass?.declared_benchmark ?? null,
    anbima_class: klass?.anbima_class ?? null,
    cvm_class: klass?.cvm_class ?? null,
    fund_net_assets: klass?.fund_net_assets ?? null,
    extra_tokens: best.extra_tokens,
    distinctive: wanted,
  };
}
