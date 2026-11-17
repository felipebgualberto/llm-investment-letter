/**
 * Assertions about the generated Rivet project file.
 *
 * WHY THE MODEL IS TESTED
 * -----------------------
 * The case supplied an OpenAI key and the v1 workflow ran on gpt-4o-mini. Keeping
 * the v2 on the SAME model is the whole basis of the comparison: if the v2
 * letter is better, the improvement came from the architecture and not from a
 * bigger model. Quietly running on a stronger model would make every claim in
 * the report unfalsifiable.
 *
 * The risk is real and undramatic. Rivet is a GUI: open the project, touch a
 * chat node, save, and whatever model the app has selected is written into the
 * file. Nobody would notice - the graph still runs, the letter still appears,
 * and the comparison is silently void. So the file is checked.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const PROJECT = resolve(root, 'letter_workflow_v2.rivet-project');

const EXPECTED_MODEL = 'gpt-4o-mini';

const project = existsSync(PROJECT) ? readFileSync(PROJECT, 'utf8') : null;

test('the graph file exists where the report says it does', () => {
  assert.ok(project, `expected the Rivet project at ${PROJECT}`);
});

test('every chat node runs on gpt-4o-mini', () => {
  // The project is YAML, so the model lines read `model: gpt-4o-mini`. Matching
  // on JSON quoting instead is how an earlier check reported "no model set at
  // all" against a file where every node had one.
  const models = [...project.matchAll(/^\s*model:\s*(.+)$/gm)].map((m) => m[1].trim());
  assert.ok(models.length > 0, 'no model line found - has the file format changed?');
  for (const m of models) {
    assert.equal(m, EXPECTED_MODEL, `a chat node runs on "${m}" instead of ${EXPECTED_MODEL}`);
  }
});

test('every chat node has a model, none left to the app default', () => {
  // A chat node with no `model` inherits whatever Rivet's global setting is,
  // which is exactly how a run ends up on a model nobody chose.
  const chatNodes = [...project.matchAll(/\[n\d+-chat\]:chat "([^"]+)"/g)].map((m) => m[1]);
  const models = [...project.matchAll(/^\s*model:\s*(.+)$/gm)];
  assert.ok(chatNodes.length > 0, 'the graph should contain chat nodes');
  assert.equal(
    models.length,
    chatNodes.length,
    `${chatNodes.length} chat nodes but ${models.length} model lines: ${chatNodes.join(', ')}`,
  );
});

test('no chat node takes its model from a wire', () => {
  // `useModelInput: true` would let the model be set at run time, which is the
  // same loss of control by a different route.
  const uses = [...project.matchAll(/^\s*useModelInput:\s*(\w+)/gm)].map((m) => m[1]);
  assert.ok(uses.length > 0);
  for (const u of uses) assert.equal(u, 'false');
});

test('no Anthropic or non-OpenAI model is referenced anywhere in the project', () => {
  // Belt and braces: catches a plugin node type as well as a model string.
  assert.ok(
    !/claude|anthropic|sonnet|opus|haiku|gemini|llama|mistral/i.test(project),
    'the project references a non-OpenAI model',
  );
});

test('the graph and the engine agree on the composer payload', () => {
  // The prompt reads keys out of the plan. When a key is renamed in
  // letter-plan.js and not in the prompt, the model is asked for a field that
  // does not exist and quietly writes around it - which is how one run lost
  // every number in the letter.
  const plan = JSON.parse(readFileSync(resolve(root, 'solution/out/letter-plan.json'), 'utf8'));
  const composer = plan.prompt_payloads?.composer ?? {};
  for (const key of ['cliente', 'assessor', 'periodo']) {
    assert.ok(key in composer, `the composer payload lost "${key}"`);
  }
  // `ressalvas` was removed when the renderer took over the omission notices.
  // If it comes back, the letter says everything twice.
  assert.ok(!('ressalvas' in composer));
});

test('the graph carries the paragraph-4 instruction the renderer depends on', () => {
  // The "Próximos passos" block is printed from the plan, so paragraph 4 must
  // be a lead-in. If the prompt drifts back to asking for the figures, the
  // renderer suppresses the block and the letter loses its structure.
  assert.match(project, /ONE OR TWO SENTENCES ONLY/);
  assert.match(project, /Próximos passos/);
});
