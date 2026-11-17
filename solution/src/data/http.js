/**
 * Cached HTTP client for the external market-data providers.
 *
 * WHY A CACHE IS A CORRECTNESS FEATURE, NOT A PERFORMANCE ONE
 * -----------------------------------------------------------
 * A client letter is a document an advisor has to defend in a meeting weeks
 * after it was sent. If re-running the pipeline hits the live API again, the
 * same reference month can produce slightly different numbers - series get
 * revised (the IBGE revises IPCA, the BCB revises series retroactively), a
 * provider returns a different adjusted close after a corporate action, or an
 * endpoint is simply down. The letter would then be unreproducible, and an
 * unreproducible number is an indefensible number.
 *
 * So every response is written to disk keyed by its exact URL. A second run
 * reads the cached payload and produces a byte-identical result. Refreshing is
 * an explicit act (--refresh), never a side effect.
 *
 * The cached envelope also records WHEN the data was retrieved, which is what
 * lets the letter print an honest "dados de mercado obtidos em <date>" line.
 *
 * FAILURE POLICY
 * --------------
 * A failed request throws. It never returns null, [] or 0. A silent zero in a
 * financial pipeline becomes a plausible wrong number in a client letter, which
 * is precisely the failure mode of the v1 workflow.
 */

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const CACHE_DIR = resolve(ROOT, 'out/cache');

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_RETRIES = 3;

/** Deterministic filename for a URL, so the cache is inspectable by hand. */
function cachePath(url) {
  const hash = createHash('sha256').update(url).digest('hex').slice(0, 16);
  const slug = url
    .replace(/^https?:\/\//, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .slice(0, 60);
  return resolve(CACHE_DIR, `${slug}-${hash}.json`);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Fetch a URL as JSON, through the disk cache.
 *
 * @param {string} url
 * @param {object} [options]
 * @param {boolean} [options.refresh]  bypass the cache and overwrite it
 * @param {object}  [options.headers]
 * @param {number}  [options.retries]
 * @returns {Promise<{data: any, retrieved_at: string, from_cache: boolean, url: string}>}
 */
export async function getJson(url, options = {}) {
  const {
    refresh = false,
    headers = {},
    retries = DEFAULT_RETRIES,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    // Status codes whose BODY is still meaningful. Yahoo answers an unknown
    // symbol with 404 plus a JSON payload naming the error, which is exactly
    // what the ticker validator needs to read.
    acceptStatuses = [],
  } = options;

  const file = cachePath(url);

  if (!refresh && existsSync(file)) {
    const envelope = JSON.parse(readFileSync(file, 'utf8'));
    return { ...envelope, from_cache: true };
  }

  let lastError;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          // Yahoo rejects requests without a browser-like agent.
          'User-Agent': 'Mozilla/5.0 (compatible; xp-monthly-advisor/2.0)',
          Accept: 'application/json',
          ...headers,
        },
      });

      if (!response.ok && !acceptStatuses.includes(response.status)) {
        const error = new Error(`HTTP ${response.status} ${response.statusText} for ${url}`);
        // 4xx will not fix itself on retry; fail fast instead of backing off.
        error.retryable = response.status >= 500;
        throw error;
      }

      const text = await response.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(`Response was not valid JSON for ${url}: ${text.slice(0, 200)}`);
      }

      const envelope = { url, status: response.status, retrieved_at: new Date().toISOString(), data };

      // Only successful responses are cached. An accepted 404 - the "this
      // symbol does not exist" answer the ticker validator reads - is returned
      // but NOT written to disk: a provider outage that briefly 404s would
      // otherwise be frozen into the cache and every later run would keep
      // reporting a live ticker as dead, with no way to notice.
      if (response.ok) {
        mkdirSync(CACHE_DIR, { recursive: true });
        writeFileSync(file, JSON.stringify(envelope, null, 2), 'utf8');
      }
      return { ...envelope, from_cache: false, cached: response.ok };
    } catch (error) {
      lastError = error;
      if (error.retryable === false) break;
      // Exponential backoff: 500ms, 1s, 2s. Public APIs rate-limit and the
      // BCB endpoints in particular return sporadic 5xx under load.
      if (attempt < retries) await sleep(500 * 2 ** (attempt - 1));
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error(
    `Failed to fetch ${url} after ${retries} attempts: ${lastError?.message ?? 'unknown error'}`,
  );
}

/**
 * Fetch a URL as raw bytes, through a disk cache.
 *
 * Used for the CVM open datasets, which are published only as .zip archives of
 * tens of megabytes. The payload is cached verbatim so that a re-run neither
 * re-downloads nor risks receiving a revised file: CVM restates its daily
 * quota files when a fund corrects a figure, and a letter that silently changes
 * its numbers between runs is worse than one that is slightly out of date.
 *
 * @returns {Promise<{buffer: Buffer, retrieved_at: string, from_cache: boolean, url: string}>}
 */
export async function getBuffer(url, options = {}) {
  const { refresh = false, retries = DEFAULT_RETRIES, timeoutMs = 240_000 } = options;

  const file = `${cachePath(url)}.bin`;
  const meta = `${cachePath(url)}.meta.json`;

  if (!refresh && existsSync(file) && existsSync(meta)) {
    const envelope = JSON.parse(readFileSync(meta, 'utf8'));
    return { ...envelope, buffer: readFileSync(file), from_cache: true };
  }

  let lastError;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; xp-monthly-advisor/2.0)' },
      });
      if (!response.ok) {
        const error = new Error(`HTTP ${response.status} ${response.statusText} for ${url}`);
        error.retryable = response.status >= 500;
        throw error;
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length === 0) throw new Error(`Empty payload for ${url}`);

      const envelope = { url, retrieved_at: new Date().toISOString(), bytes: buffer.length };
      mkdirSync(CACHE_DIR, { recursive: true });
      writeFileSync(file, buffer);
      writeFileSync(meta, JSON.stringify(envelope, null, 2), 'utf8');
      return { ...envelope, buffer, from_cache: false };
    } catch (error) {
      lastError = error;
      if (error.retryable === false) break;
      if (attempt < retries) await sleep(500 * 2 ** (attempt - 1));
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error(
    `Failed to download ${url} after ${retries} attempts: ${lastError?.message ?? 'unknown error'}`,
  );
}
