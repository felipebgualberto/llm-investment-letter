/**
 * The gate that makes "fails loudly" true.
 *
 * Every parser in this pipeline promises, in its own docblock, that a broken
 * statement fails loudly rather than silently producing a plausible wrong
 * number. That promise was unenforced: nothing in the pipeline ever inspected a
 * `severity: 'error'` flag, nothing printed one, and every script exited 0.
 *
 * A demonstration of what that cost: rename one sleeve header in the statement
 * and the parser raises 24 error flags, the engine then reports a fabricated
 * +3.30% return on 19.3% coverage, and every script exits 0 with a metrics file
 * whose own flag list reads clean. A fabricated 3.30% sitting beside the v1's
 * hallucinated 3.5% is the single worst thing a reviewer could find in this
 * repository - and it would have been produced by the layer that exists
 * specifically to prevent it.
 *
 * So: errors stop the run. `--allow-errors` exists for deliberate inspection of
 * a broken input, and it announces itself.
 */

/**
 * Print every flag, then abort if any is an error.
 *
 * @param {string} stage        human-readable stage name, used in the message
 * @param {Array<object>} flags flags carrying { code, severity, detail }
 * @param {object} [options]
 * @param {boolean} [options.allowErrors] continue despite errors
 * @param {(code: number) => never} [options.exit] injected for testing
 */
export function assertNoErrors(stage, flags = [], options = {}) {
  const { allowErrors = process.argv.includes('--allow-errors'), exit = process.exit } = options;

  const errors = flags.filter((f) => f.severity === 'error');
  const warnings = flags.filter((f) => f.severity === 'warning');

  for (const f of errors) console.error(`  [error]   ${f.code}: ${f.detail}`);
  for (const f of warnings) console.error(`  [warning] ${f.code}: ${f.detail}`);

  if (errors.length === 0) return { errors: 0, warnings: warnings.length };

  if (allowErrors) {
    console.error(
      `\n${stage}: continuing past ${errors.length} error(s) because --allow-errors was passed. ` +
        'The output of this run is NOT fit to send to a client.\n',
    );
    return { errors: errors.length, warnings: warnings.length, overridden: true };
  }

  console.error(
    `\n${stage}: ${errors.length} error-level flag(s). Refusing to produce output that a ` +
      'client letter would be built from. Fix the input, or pass --allow-errors to inspect.\n',
  );
  return exit(1);
}
