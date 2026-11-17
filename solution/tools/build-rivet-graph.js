/**
 * Generates the Rivet project for the v2 workflow.
 *
 * WHY THIS IS GENERATED AND NOT DRAWN BY HAND
 * -------------------------------------------
 * A .rivet-project is YAML with node ids, port ids and connection strings that
 * must agree exactly. Hand-editing it is how you produce a file that fails to
 * open. Building it through @ironclad/rivet-core and calling serializeProject
 * makes the result correct by construction, keeps the prompts under version
 * control as readable source, and means the graph can be regenerated after any
 * prompt change instead of being dragged around a canvas.
 *
 * This is a DEV TOOL. It is the only thing in the repository with a dependency,
 * and nothing in the pipeline imports it. Run it only to rebuild the graph:
 *
 *   npm install --no-save @ironclad/rivet-core
 *   node tools/build-rivet-graph.js
 *
 * WHAT THE GRAPH DOES, AND WHAT IT DELIBERATELY DOES NOT
 * ------------------------------------------------------
 * It owns the language layer and nothing else: three anchored summarisers, a
 * composer, a numeric validator and a repair loop. Every figure it can print
 * was already computed and selected by the Node engine, and arrives through
 * out/letter-plan.json. The graph cannot compute, choose what to cut, or reach
 * a data source.
 *
 * The model is gpt-4o-mini - the SAME model the v1 used. If the v2 letter is
 * better, the improvement came from the architecture, not from a bigger model.
 */

import { writeFileSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { globalRivetNodeRegistry, serializeProject } from '@ironclad/rivet-core';

const HERE = dirname(fileURLToPath(import.meta.url));
const SOLUTION = resolve(HERE, '..');
const CHALLENGE = resolve(SOLUTION, '..');
const OUT_FILE = resolve(CHALLENGE, 'letter_workflow_v2.rivet-project');

// Absolute so the graph runs regardless of Rivet's working directory. A comment
// node in the canvas repeats this, because it is the first thing to change if
// the project moves machines.
const P = (rel) => resolve(SOLUTION, rel).replace(/\//g, '\\');

let nodeSeq = 0;
const nodes = [];
const byTitle = new Map();

/** Create a node with a deterministic id, so regenerating produces a stable diff. */
function node(type, title, data, x, y, width = 330) {
  const n = globalRivetNodeRegistry.createDynamic(type);
  n.id = `n${String(++nodeSeq).padStart(3, '0')}-${type}`;
  n.title = title;
  n.data = { ...n.data, ...data };
  n.visualData = { x, y, width, zIndex: nodeSeq };
  n.outgoingConnections = [];
  nodes.push(n);
  byTitle.set(title, n);
  return n;
}

const connections = [];
/** Wire an output port to an input port. */
function wire(fromTitle, outputId, toTitle, inputId) {
  const from = byTitle.get(fromTitle);
  const to = byTitle.get(toTitle);
  if (!from) throw new Error(`No node titled "${fromTitle}"`);
  if (!to) throw new Error(`No node titled "${toTitle}"`);
  connections.push({
    outputNodeId: from.id, outputId,
    inputNodeId: to.id, inputId,
  });
}

const CHAT = {
  model: 'gpt-4o-mini',
  // Low but not zero: the letter should read as prose, not as a template, and
  // every FIGURE is fixed upstream so temperature cannot move a number.
  temperature: 0.3,
  maxTokens: 1600,
  cache: false,
};

// ---------------------------------------------------------------------------
// Column 0 - orientation
// ---------------------------------------------------------------------------

node('comment', 'READ ME FIRST', {
  text:
    'XP MONTHLY LETTER - v2\n\n' +
    'This graph owns the LANGUAGE layer only.\n' +
    'Every number it can print was computed and selected\n' +
    'by the Node engine and arrives via out/letter-plan.json.\n\n' +
    'Run `npm run build` in solution/ before running this graph.\n\n' +
    'The six Text nodes below hold ABSOLUTE paths.\n' +
    'Update them if you move this project.',
}, -420, 40, 380);

// ---------------------------------------------------------------------------
// Column 1 + 2 - load the payload
// ---------------------------------------------------------------------------

// One file per prompt, plus the full plan for the validator and the raw macro
// report for tone.
//
// The first design handed every prompt the whole 21 KB plan. The model was then
// asked to find `headline.measured_return.display` inside a structure where the
// real path was `letter.headline...`, could not, and - correctly, given its
// instructions - wrote a letter with no figures at all. Each node now reads a
// flat object of a few hundred bytes whose keys are exactly the ones its own
// instructions name.
const SOURCES = [
  ['macro payload', 'out/prompt-macro.json', 40, true],
  ['performance payload', 'out/prompt-performance.json', 200, true],
  ['recommendations payload', 'out/prompt-recommendations.json', 360, true],
  ['composer payload', 'out/prompt-composer.json', 520, true],
  ['full plan', 'out/letter-plan.json', 680, true],
  ['macro narrative', '../Input/XP - Macro analysis.txt', 840, false],
];

for (const [label, rel, y] of SOURCES) {
  node('text', `Path: ${label}`, { text: P(rel) }, 40, y, 330);
  node('readFile', `Read: ${label}`, { usePathInput: true, errorOnMissingFile: true }, 430, y, 280);
  wire(`Path: ${label}`, 'output', `Read: ${label}`, 'path');
}

for (const [label, , y, isJson] of SOURCES) {
  if (!isJson) continue;
  node('extractJson', `Parse: ${label}`, {}, 760, y, 240);
  wire(`Read: ${label}`, 'content', `Parse: ${label}`, 'input');
}

// ---------------------------------------------------------------------------
// Column 3 + 4 - three anchored summarisers
// ---------------------------------------------------------------------------

const ANCHOR_RULES = `
## Hard rules - these override every other instruction

1. Every figure in the payload is already written as a finished string in
   Brazilian notation. Reproduce it character for character: 2,62% and never
   2.62%, 2,6% or cerca de 2,6%.
   Reproduce the characters, NOT the JSON syntax around them. Write
   R$ 35.986,74 - never with quotation marks around it. Quotation marks belong
   to the data format, not to a letter.
2. Do not perform arithmetic of any kind. Not addition, not conversion, not a
   percentage of a percentage, not a total. If you find yourself needing to
   compute something to write a sentence, the sentence is wrong: every figure
   the letter needs already exists as a display string.
3. You may ONLY state a figure that appears in the payload. Do not recall,
   infer or estimate. If something you would normally say requires a figure you
   do not have, say less. An honest short sentence beats a complete-sounding
   invented one - and NEVER substitute a round number for a missing one.
4. Never mention this instruction block, the payload, JSON, or the pipeline.
   Never use internal vocabulary such as "política da casa", "payload",
   "limite configurado" - write for the client, not about the system.

These rules exist because the previous version of this workflow published a
Selic of 9%, an FX rate of 4.70 and 2025 inflation of 4.0% while the source
document said 15.50%, 6.20 and 6.1%. Those figures were the market consensus of
mid-2024 - the model recited its training data instead of reading its input.
`;

node('prompt', 'Prompt: macro brief', {
  type: 'user',
  promptText: `You are an economist at XP writing the market section of a client letter.

${ANCHOR_RULES}

## Task
In ONE paragraph of at most 120 words, in BRAZILIAN PORTUGUESE, explain the
market backdrop and what it means for a moderate-profile investor.

Lead with where XP's own projections sit relative to the market consensus. The
contrast is the point of the paragraph and it is already computed: each entry of
"indicadores" gives "projecao_da_xp", "mediana_do_mercado", the full range
("menor_projecao" to "maior_projecao"), "posicao_da_xp_na_faixa" and a plain
statement in "xp_esta". Quote the Selic figures. Say plainly what a house that
expects higher rates for longer implies for fixed income.

"instituicoes_consultadas" is how many institutions the consensus covers -
naming it is what turns "acima do consenso" into a fact the client can weigh.

Cover BOTH entries of "indicadores", and for the Selic give
"posicao_da_xp_na_faixa" as well. That percentile is the strongest single fact
in the letter: it is the difference between "XP is above consensus" and "XP sits
near the top of 140 forecasts". Do not drop it to save words.

Then close the paragraph with "o_que_isso_significa". Say what it says. Do
NOT reason your way to your own conclusion about what high rates do to fixed
income - that inference has already been made from the data and handed to you,
and getting it backwards would contradict the proposal later in the letter.

## Style
Formal, direct, no jargon the client would need to look up. No bullet points.
Never address the client by name here; the composer does that.

## Payload - the only figures you may use
### XP house view versus the market consensus
{{consensus_block}}

### Narrative context from the XP report (for TONE and THEMES only - you may not
### take a number from this text, only from the block above)
{{macro_narrative}}`,
}, 1090, 40, 380);

node('prompt', 'Prompt: performance', {
  type: 'user',
  promptText: `You are a portfolio analyst writing the performance section of a client letter.

${ANCHOR_RULES}

## Task
In at most 110 words, in BRAZILIAN PORTUGUESE, explain how the portfolio did.

The payload is a flat object. Every value is already a finished string. Use the
keys named below exactly; each one appears at the top level.

You must cover, in this order:
1. "rentabilidade_medida" AND "cobertura_da_carteira" in the SAME sentence.
   Never present the return as the whole portfolio's. Inventing or rounding the
   coverage is the single worst error you can make here.
2. "maior_contribuicao" and "maior_detracao", each by "ativo" with its
   "contribuicao". "quantas_posicoes_cairam" tells you how many positions lost
   money: if it is 1, write it in the singular.
3. Each entry of "comparacoes": name the "referencia", give its
   "variacao_no_mes" and its "diferenca_para_a_carteira".
4. One sentence on "rentabilidade_do_patrimonio" - the return on the client's
   whole net worth, lower than the measured figure - and on
   "custo_do_saldo_parado", which is the gap between the two and the cost of
   balances that are not invested. State it plainly; it is why the first
   proposal exists.

Every one of those keys has a value. If a sentence of yours would contain no
figure, you have skipped a key - go back and use it.

## Style
Plain, calm, factual. A month is a month - no triumph, no alarm. Do not
extrapolate a month into a trend or a forecast.

## Payload
{{performance_block}}`,
}, 1090, 300, 380);

node('prompt', 'Prompt: recommendations', {
  type: 'user',
  promptText: `You are a financial advisor writing the recommendations section of a client letter.

${ANCHOR_RULES}

## Task
In at most 140 words, in BRAZILIAN PORTUGUESE, present the proposals below.

The payload has "propostas", each with "titulo", "valor", "motivos" and
sometimes "vencimento". For each proposal, in this order: what is proposed, the
"valor" exactly as written, and the reason - taken from "motivos", which already
carries the figures. Never justify a proposal by how an asset moved last month.

State every "valor". A proposal without its amount is not actionable, and the
amounts are already formatted for you - reproduce them without quotation marks.

## Non-negotiable framing
These are PROPOSALS for the client to discuss with their advisor. They are not
orders and not executed trades. Write "sugerimos avaliar", "propomos", "vale
revisar" - never "compre", "venda", "recomendamos que você compre".

If the payload says other proposals were prepared but not included, say so in one
short clause. Do not enumerate them.

## Payload
{{recommendations_block}}`,
}, 1090, 560, 380);

// Chats
node('chat', 'Chat: macro brief', CHAT, 1520, 40, 260);
node('chat', 'Chat: performance', CHAT, 1520, 300, 260);
node('chat', 'Chat: recommendations', CHAT, 1520, 560, 260);

wire('Prompt: macro brief', 'output', 'Chat: macro brief', 'prompt');
wire('Prompt: performance', 'output', 'Chat: performance', 'prompt');
wire('Prompt: recommendations', 'output', 'Chat: recommendations', 'prompt');

// Each summariser reads only its own payload.
wire('Parse: macro payload', 'output', 'Prompt: macro brief', 'consensus_block');
wire('Read: macro narrative', 'content', 'Prompt: macro brief', 'macro_narrative');
wire('Parse: performance payload', 'output', 'Prompt: performance', 'performance_block');
wire('Parse: recommendations payload', 'output', 'Prompt: recommendations', 'recommendations_block');

// ---------------------------------------------------------------------------
// Column 5 - compose
// ---------------------------------------------------------------------------

node('prompt', 'Prompt: compose the letter', {
  type: 'user',
  promptText: `You are Antonio Bicudo, an XP investment advisor, writing the monthly letter.

${ANCHOR_RULES}

## Task
Assemble the three sections below into ONE letter in BRAZILIAN PORTUGUESE.

## Hard constraints
- At most 800 words. The letter must fit two A4 pages.
- Letter format: greeting, body in flowing paragraphs, sign-off. No headings, no
  bullet lists, no tables.
- Open with "Prezado " followed by the payload's "cliente". Never write "Prezado
  cliente" and never take a name from these instructions.
- Do NOT write any compliance or disclaimer text. None. The renderer prints it
  verbatim below your letter, and a second copy in the body is a defect. There
  are no disclosures in your payload for exactly this reason.
- Do NOT mention how many findings or proposals were left out of this letter,
  and do not gesture at them ("outras sugestões foram preparadas"). The renderer
  prints those notices from the plan, with the exact counts. Asking for them
  here produced a run that paraphrased one and silently dropped the other.
- Close with "Atenciosamente," and the payload's "assessor" on the next line.
  Nothing after that - no title, no code, no postscript.

## Shape of the letter
Five paragraphs, in this order. THE WORD LIMITS ARE HARD - the page is shared
with a summary panel, two charts and two printed blocks, and the letter is
capped at two pages by the brief. A paragraph that runs long costs a chart.

1. One or two sentences of opening. Greet the client, name the reference month,
   say what the letter covers. No figures here. AT MOST 35 WORDS.
2. How the portfolio did. AT MOST 70 WORDS. A panel above your letter already
   prints the return, the CDI, the net worth and the cost, and a chart below it
   breaks the result down by asset class. Your job is what those cannot say:
   what the month meant. Do not walk through every figure again.
3. What the market backdrop means for it. AT MOST 70 WORDS.
4. ONE OR TWO SENTENCES ONLY, leading into the proposals. Say that concrete
   steps follow and what connects them to the paragraph above. Do NOT list the
   proposals, do NOT give any amount, date, rate or count, and do NOT name the
   instruments. A numbered "Próximos passos" block is printed immediately after
   this paragraph, straight from the plan, carrying every figure. Repeating them
   here says everything twice and puts the numbers back in your hands, which is
   what this pipeline exists to avoid. "Diante desse cenário, proponho os passos
   abaixo." is a complete and correct paragraph 4.
5. A short close: you are available to talk any of it through.

## Style
An experienced advisor writing to a client he knows: warm, direct, unhurried.

Write PROSE, not a readout. The figures arrive as a list of facts; your job is
the connective tissue between them. "A rentabilidade do patrimônio foi de 1,82%,
resultando em um custo do saldo parado de +0,80 p.p." is a database talking.
"Sobre o patrimônio total, o retorno foi de 1,82% - a diferença de 0,80 ponto
percentual é o que custa manter parte do saldo sem aplicação" is an advisor
talking. Same figures, unchanged.

Never name a payload key in the prose. The client should not be able to tell
what the fields were called.

Never promise a return. Never use "garantido", "certamente" or "com certeza".

## Sections, already written
### Market
{{macro_text}}

### Performance
{{performance_text}}

### Proposals
{{recommendations_text}}

## Payload - names, disclosures and omissions
{{letter_payload}}`,
}, 1860, 300, 400);

node('chat', 'Chat: compose', { ...CHAT, maxTokens: 2048 }, 2320, 300, 260);

wire('Chat: macro brief', 'response', 'Prompt: compose the letter', 'macro_text');
wire('Chat: performance', 'response', 'Prompt: compose the letter', 'performance_text');
wire('Chat: recommendations', 'response', 'Prompt: compose the letter', 'recommendations_text');
wire('Parse: composer payload', 'output', 'Prompt: compose the letter', 'letter_payload');
wire('Prompt: compose the letter', 'output', 'Chat: compose', 'prompt');

// ---------------------------------------------------------------------------
// Column 6 - the validator
// ---------------------------------------------------------------------------

/**
 * The validator is NOT written here. It is the source of
 * src/validate/letter-numbers.js, inlined verbatim into the Code node.
 *
 * One implementation, unit-tested in test/letter-numbers.test.js, running in
 * both places. A validator that exists only inside a YAML blob is a validator
 * nothing can exercise - and this one is the load-bearing claim of the whole
 * design, so it is the last thing that should be untested.
 */
const VALIDATOR_SOURCE = readFileSync(resolve(SOLUTION, 'src/validate/letter-numbers.js'), 'utf8')
  // The Code node is not a module: strip the export keywords, keep the bodies.
  .replace(/^export /gm, '');

const VALIDATOR = `${VALIDATOR_SOURCE}

// --- Rivet Code node entry point -------------------------------------------
const result = validateLetterNumbers(
  String(inputs.letter.value ?? ''),
  inputs.payload.value ?? {},
);

return {
  needs_repair: { type: 'boolean', value: result.needs_repair },
  violations: { type: 'string', value: result.violations },
  report: { type: 'string', value: result.report },
};
`;

node('code', 'Validate every number', {
  code: VALIDATOR,
  inputNames: ['letter', 'payload'],
  outputNames: ['needs_repair', 'violations', 'report'],
  allowFetch: false,
  allowRequire: false,
  allowProcess: false,
  allowConsole: false,
}, 2660, 300, 400);

wire('Chat: compose', 'response', 'Validate every number', 'letter');
wire('Parse: full plan', 'output', 'Validate every number', 'payload');

// ---------------------------------------------------------------------------
// Column 7 - repair, only when needed
// ---------------------------------------------------------------------------

node('if', 'Only if unsourced numbers', {}, 3110, 180, 260);
wire('Validate every number', 'needs_repair', 'Only if unsourced numbers', 'if');
wire('Chat: compose', 'response', 'Only if unsourced numbers', 'value');

node('prompt', 'Prompt: repair', {
  type: 'user',
  promptText: `The letter below contains figures that do not appear in the data it was
built from. Every one of them must go.

## Offending figures
{{violations}}

## What to do
Rewrite the letter in BRAZILIAN PORTUGUESE, removing or replacing each figure
listed above. Where a number was carrying the meaning of a sentence, rewrite the
sentence to say the same thing qualitatively rather than substituting a different
number. Do not introduce any new figure.

Change nothing else: keep the structure, the tone, the greeting, the sign-off and
the disclosure block exactly as they are.

## The letter
{{draft}}`,
}, 3420, 180, 380);

node('chat', 'Chat: repair', { ...CHAT, maxTokens: 2048 }, 3860, 180, 260);

wire('Only if unsourced numbers', 'output', 'Prompt: repair', 'draft');
wire('Validate every number', 'violations', 'Prompt: repair', 'violations');
wire('Prompt: repair', 'output', 'Chat: repair', 'prompt');

// The repair branch is control-flow excluded when the letter validates, so the
// coalesce falls through to the original draft and no second model call is made.
node('coalesce', 'Final letter', {}, 4180, 300, 260);
wire('Chat: repair', 'response', 'Final letter', 'input1');
wire('Chat: compose', 'response', 'Final letter', 'input2');

// ---------------------------------------------------------------------------
// Column 8 - outputs
// ---------------------------------------------------------------------------

node('graphOutput', 'Output: letter', { id: 'letter', dataType: 'string' }, 4500, 240, 260);
node('graphOutput', 'Output: validation report', { id: 'validation_report', dataType: 'string' }, 4500, 420, 260);

wire('Final letter', 'output', 'Output: letter', 'value');
wire('Validate every number', 'report', 'Output: validation report', 'value');

// ---------------------------------------------------------------------------
// Serialise
// ---------------------------------------------------------------------------

// Rivet stores connections on the source node.
for (const c of connections) {
  const from = nodes.find((n) => n.id === c.outputNodeId);
  from.outgoingConnections.push(c);
}

const graphId = 'monthly-letter-v2';
const project = {
  metadata: {
    id: 'xp-monthly-advisor-v2',
    title: 'XP Monthly Advisor v2',
    description:
      'Language layer for the monthly client letter. Numbers are computed and selected by ' +
      'the Node engine in solution/; this graph writes prose and refuses figures it was not given.',
  },
  graphs: {
    [graphId]: {
      metadata: {
        id: graphId,
        name: 'monthly_letter',
        description: 'Anchored summarisers -> composer -> numeric validator -> conditional repair.',
      },
      nodes,
      connections,
    },
  },
  plugins: [],
};

writeFileSync(OUT_FILE, serializeProject(project), 'utf8');
console.log(`wrote ${OUT_FILE}`);
console.log(`  ${nodes.length} nodes, ${connections.length} connections`);
