/**
 * Minimal ZIP reader.
 *
 * CVM publishes its open datasets only as .zip, and Node has no built-in
 * archive reader - zlib handles compression streams, not the container format.
 * Rather than add a dependency for one file format, this implements the small
 * part of the ZIP spec we actually need: locate the central directory, find an
 * entry by name, and inflate it.
 *
 * Supports the two storage methods that occur in practice (0 = stored,
 * 8 = deflate). Zip64 is not handled; CVM archives are far below the 4 GB
 * threshold that would require it, and an unsupported archive throws rather
 * than returning partial data.
 *
 * Reference: PKWARE APPNOTE.TXT, sections 4.3.6 (local header),
 * 4.3.12 (central directory), 4.3.16 (end of central directory).
 */

import { inflateRawSync } from 'node:zlib';

const SIG_EOCD = 0x06054b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;

const EOCD_MIN_SIZE = 22;
const MAX_COMMENT = 0xffff;

/** Locate the End Of Central Directory record, scanning backwards. */
function findEocd(buffer) {
  const start = Math.max(0, buffer.length - EOCD_MIN_SIZE - MAX_COMMENT);
  for (let i = buffer.length - EOCD_MIN_SIZE; i >= start; i -= 1) {
    if (buffer.readUInt32LE(i) === SIG_EOCD) return i;
  }
  throw new Error('Not a ZIP archive: end of central directory record not found.');
}

/**
 * List every entry in the archive.
 * @param {Buffer} buffer
 * @returns {Array<{name: string, method: number, compressedSize: number, size: number, offset: number}>}
 */
export function listEntries(buffer) {
  const eocd = findEocd(buffer);
  const entryCount = buffer.readUInt16LE(eocd + 10);
  let cursor = buffer.readUInt32LE(eocd + 16);

  const entries = [];
  for (let i = 0; i < entryCount; i += 1) {
    if (buffer.readUInt32LE(cursor) !== SIG_CENTRAL) {
      throw new Error(`Corrupt central directory at byte ${cursor} (entry ${i}).`);
    }
    const method = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const size = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const offset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.toString('utf8', cursor + 46, cursor + 46 + nameLength);

    entries.push({ name, method, compressedSize, size, offset });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** Inflate a single entry into a Buffer. */
export function readEntry(buffer, entry) {
  if (buffer.readUInt32LE(entry.offset) !== SIG_LOCAL) {
    throw new Error(`Corrupt local header for "${entry.name}".`);
  }
  // The local header repeats the name and extra fields with potentially
  // different lengths than the central directory, so re-read them here.
  const nameLength = buffer.readUInt16LE(entry.offset + 26);
  const extraLength = buffer.readUInt16LE(entry.offset + 28);
  const dataStart = entry.offset + 30 + nameLength + extraLength;
  const data = buffer.subarray(dataStart, dataStart + entry.compressedSize);

  if (entry.method === 0) return Buffer.from(data);
  if (entry.method === 8) return inflateRawSync(data);
  throw new Error(`Unsupported ZIP compression method ${entry.method} for "${entry.name}".`);
}

/**
 * Extract the first entry whose name matches `pattern`.
 * @param {Buffer} buffer
 * @param {RegExp} pattern
 * @returns {{name: string, content: Buffer}}
 */
export function extractMatching(buffer, pattern) {
  const entries = listEntries(buffer);
  const entry = entries.find((e) => pattern.test(e.name));
  if (!entry) {
    throw new Error(
      `No entry matching ${pattern} in archive. Contains: ${entries.map((e) => e.name).join(', ')}`,
    );
  }
  return { name: entry.name, content: readEntry(buffer, entry) };
}
