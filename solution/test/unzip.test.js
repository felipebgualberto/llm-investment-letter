import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { listEntries, readEntry, extractMatching } from '../src/lib/unzip.js';

/** Build a minimal, spec-correct ZIP in memory so the test needs no fixture. */
function buildZip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const { name, content, store = false } of files) {
    const raw = Buffer.from(content, 'utf8');
    const data = store ? raw : deflateRawSync(raw);
    const nameBuf = Buffer.from(name, 'utf8');

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(store ? 0 : 8, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(store ? 0 : 8, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);

    offset += local.length + nameBuf.length + data.length;
  }

  const centralBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);

  return Buffer.concat([...locals, centralBuf, eocd]);
}

test('lists every entry in the central directory', () => {
  const zip = buildZip([
    { name: 'registro_classe.csv', content: 'a;b\n1;2' },
    { name: 'registro_fundo.csv', content: 'x;y\n3;4' },
  ]);
  const entries = listEntries(zip);
  assert.equal(entries.length, 2);
  assert.deepEqual(entries.map((e) => e.name), ['registro_classe.csv', 'registro_fundo.csv']);
});

test('inflates a deflated entry back to its exact bytes', () => {
  const payload = 'CNPJ_Classe;Denominacao_Social\n43917493000131;RIZA LOTUS PLUS ADVISORY';
  const zip = buildZip([{ name: 'registro_classe.csv', content: payload }]);
  const { content } = extractMatching(zip, /registro_classe\.csv$/);
  assert.equal(content.toString('utf8'), payload);
});

test('reads a stored (uncompressed) entry', () => {
  const zip = buildZip([{ name: 'plain.csv', content: 'stored payload', store: true }]);
  const entries = listEntries(zip);
  assert.equal(readEntry(zip, entries[0]).toString('utf8'), 'stored payload');
});

test('a non-ZIP buffer throws instead of returning garbage', () => {
  assert.throws(() => listEntries(Buffer.from('not a zip file at all')), /not a zip archive/i);
});

test('a missing entry names what the archive actually holds', () => {
  const zip = buildZip([{ name: 'other.csv', content: 'x' }]);
  assert.throws(() => extractMatching(zip, /registro_classe\.csv$/), /other\.csv/);
});
