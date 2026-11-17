/**
 * Parser for the client's risk profile statement
 * (Input/XP - Albert_s risk profile.txt).
 *
 * WHAT THIS DOCUMENT DOES AND DOES NOT CONTAIN
 * --------------------------------------------
 * It states a CLASSIFICATION ("Moderado") and describes, in prose, which
 * product families are compatible:
 *
 *   a. shares of consolidated, dividend-paying companies
 *   b. fixed income rated BB+ or better
 *
 * It contains NO quantitative limits - no maximum position size, no minimum
 * cash, no cap on any asset class. Every numeric threshold used by the
 * suitability engine is therefore an explicit assumption of this
 * implementation, declared in config/suitability-policy.json rather than
 * buried in code, and reported alongside any finding it produces.
 *
 * That separation matters for defensibility: an advisor reading a finding can
 * see which part came from the client's own signed profile (the classification
 * and the product families) and which part came from a house parameter that
 * could reasonably be set differently.
 */

const CLASSIFICATION_LINE = /Classifica[çc][ãa]o do Perfil de Investimento:\s*(.+)/i;
const CLIENT_LINE = /Perfil de Risco do Cliente:\s*(.+)/i;

/** Section headings in the document, in order. */
const SECTIONS = [
  { key: 'description', match: /^\d+\.\s*Descri[çc][ãa]o do Perfil/i },
  { key: 'compatible_products', match: /^\d+\.\s*Produtos Financeiros Compat[íi]veis/i },
  { key: 'strategies', match: /^\d+\.\s*Estrat[ée]gias Recomendadas/i },
];

/** Lettered sub-items inside "Produtos Financeiros Compatíveis". */
const PRODUCT_ITEM = /^([a-z])\.\s*(.+?):\s*$/i;

function toLines(raw) {
  return raw
    .replace(/\r/g, '')
    .split('\n')
    .map((l) => l.replace(/\f/g, '').trim())
    .filter((l) => l.length > 0);
}

/**
 * Reflow the hard-wrapped PDF text back into sentences, so a quoted excerpt in
 * a finding does not carry mid-sentence line breaks.
 */
function joinParagraph(lines) {
  return lines.join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * @param {string} raw
 * @returns {object} the risk profile contract
 */
export function parseRiskProfile(raw) {
  const flags = [];
  const lines = toLines(raw);

  const client = lines.map((l) => l.match(CLIENT_LINE)).find(Boolean)?.[1]?.trim() ?? null;
  const classification = lines.map((l) => l.match(CLASSIFICATION_LINE)).find(Boolean)?.[1]?.trim() ?? null;

  if (!classification) {
    flags.push({
      code: 'risk_classification_not_found',
      severity: 'error',
      detail:
        'No "Classificação do Perfil de Investimento" line was found. Without a ' +
        'classification the suitability engine has no policy to apply.',
    });
  }

  // --- split into the numbered sections ------------------------------------
  const boundaries = [];
  lines.forEach((line, i) => {
    const section = SECTIONS.find((s) => s.match.test(line));
    if (section) boundaries.push({ key: section.key, index: i, heading: line });
  });

  const sections = {};
  boundaries.forEach((b, i) => {
    const end = boundaries[i + 1]?.index ?? lines.length;
    sections[b.key] = { heading: b.heading, lines: lines.slice(b.index + 1, end) };
  });

  for (const s of SECTIONS) {
    if (!sections[s.key]) {
      flags.push({
        code: 'risk_section_missing',
        severity: 'warning',
        detail: `Section "${s.key}" was not found in the risk profile document.`,
      });
    }
  }

  // --- compatible product families -----------------------------------------
  const compatibleProducts = [];
  const productLines = sections.compatible_products?.lines ?? [];
  let current = null;
  for (const line of productLines) {
    const item = line.match(PRODUCT_ITEM);
    if (item) {
      if (current) compatibleProducts.push(current);
      current = { key: item[1].toLowerCase(), title: item[2].trim(), body: [] };
      continue;
    }
    if (current) current.body.push(line);
  }
  if (current) compatibleProducts.push(current);

  for (const p of compatibleProducts) p.body = joinParagraph(p.body);

  if (compatibleProducts.length === 0) {
    flags.push({
      code: 'no_compatible_products_listed',
      severity: 'warning',
      detail: 'The profile lists no compatible product families; product screening is disabled.',
    });
  }

  return {
    client,
    classification,
    classification_slug: classification ? slugify(classification) : null,
    description: joinParagraph(sections.description?.lines ?? []),
    compatible_products: compatibleProducts,
    strategies: joinParagraph(sections.strategies?.lines ?? []),
    // Recorded so downstream findings can state plainly that any number they
    // use came from house policy and not from the client's signed document.
    contains_quantitative_limits: false,
    source: 'XP client risk profile statement (text extraction)',
    data_quality_flags: flags,
  };
}

function slugify(value) {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}
