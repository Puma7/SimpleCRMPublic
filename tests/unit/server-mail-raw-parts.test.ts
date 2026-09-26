import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  decodeRunExactly,
  ensurePartObject,
  findBase64Runs,
  packPartsContainer,
  rawPartPath,
  reassembleParts,
  sha256Hex,
  stripRuns,
  unpackPartsContainer,
} from '../../packages/server/src/mail-raw-parts';
import { encodeRawWithPartsForStorage, loadStoredRaw } from '../../packages/server/src/mail-raw-storage';

/**
 * Anhänge nicht doppelt speichern: Base64-Blöcke im Original, die exakt einem
 * gespeicherten Anhang entsprechen, werden herausgenommen und beim Lesen
 * byte-genau wieder eingesetzt. Alles andere bleibt unverändert im Original.
 */
describe('server: attachment parts taken out of the stored original', () => {
  const pdf = Buffer.alloc(30_000);
  for (let i = 0; i < pdf.length; i += 1) pdf[i] = (i * 2654435761) % 256;

  function mime(options: { eol: '\r\n' | '\n'; lineLength: number; finalEol?: boolean }): Buffer {
    const eol = options.eol;
    const b64 = pdf.toString('base64');
    const lines: string[] = [];
    for (let i = 0; i < b64.length; i += options.lineLength) lines.push(b64.slice(i, i + options.lineLength));
    const text = [
      'From: kunde@example.com',
      'Subject: Angebot',
      'Content-Type: multipart/mixed; boundary="xyz"',
      '',
      '--xyz',
      'Content-Type: text/plain',
      '',
      'Hallo',
      'Gruss',
      '',
      '--xyz',
      'Content-Type: application/pdf; name="angebot.pdf"',
      'Content-Transfer-Encoding: base64',
      '',
      ...lines,
    ].join(eol);
    return Buffer.from(options.finalEol === false ? text : `${text}${eol}--xyz--${eol}`, 'latin1');
  }

  test.each([
    ['CRLF, 76 characters', { eol: '\r\n' as const, lineLength: 76 }],
    ['LF, 72 characters', { eol: '\n' as const, lineLength: 72 }],
    ['one long line', { eol: '\r\n' as const, lineLength: 1_000_000 }],
    ['last line without line ending', { eol: '\r\n' as const, lineLength: 76, finalEol: false }],
  ])('%s: the part is found and the original is reassembled exactly', async (_label, layout) => {
    const raw = mime(layout);
    const runs = findBase64Runs(raw);
    const found = runs.map((run) => ({ run, data: decodeRunExactly(raw, run) })).filter((entry) => entry.data);
    expect(found).toHaveLength(1);
    expect(found[0]!.data!.equals(pdf)).toBe(true);

    const { skeleton, parts } = stripRuns(raw, [{ run: found[0]!.run, sha256: sha256Hex(pdf), size: pdf.length }]);
    expect(skeleton.length).toBeLessThan(raw.length - pdf.length);
    const unpacked = unpackPartsContainer(packPartsContainer(skeleton, parts));
    const back = await reassembleParts(unpacked.skeleton, unpacked.parts, async () => pdf);
    expect(back.equals(raw)).toBe(true);
  });

  test('base64 that does not re-encode exactly stays in the original', () => {
    const raw = Buffer.from(`Subject: x\r\n\r\n${pdf.toString('base64').slice(0, 4001)}\r\n`, 'latin1');
    for (const run of findBase64Runs(raw)) expect(decodeRunExactly(raw, run)).toBeNull();
  });

  test('a stored original without its parts round-trips or is refused; a wrong part is detected', async () => {
    const raw = mime({ eol: '\r\n', lineLength: 76 });
    const [run] = findBase64Runs(raw).filter((candidate) => decodeRunExactly(raw, candidate));
    const stripped = stripRuns(raw, [{ run: run!, sha256: sha256Hex(pdf), size: pdf.length }]);

    const stored = await encodeRawWithPartsForStorage(raw, stripped, async () => pdf);
    expect(stored.raw_rfc822_codec).toBe('br-parts');
    expect(stored.raw_rfc822_part_sha256s).toEqual([sha256Hex(pdf)]);
    expect(stored.raw_rfc822_z.length).toBeLessThan(pdf.length / 4);
    await expect(loadStoredRaw(stored, { readPart: async () => pdf })).resolves.toEqual(raw);

    await expect(loadStoredRaw(stored)).rejects.toThrow('no attachments root');
    const other = Buffer.from(pdf);
    other[0] = other[0]! ^ 1;
    await expect(loadStoredRaw(stored, { readPart: async () => other })).rejects.toThrow('does not match its sha256');
    await expect(encodeRawWithPartsForStorage(raw, stripped, async () => other)).rejects.toThrow();
  });

  test('part objects are hard links of the verified attachment file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'simplecrm-raw-parts-'));
    try {
      const file = join(dir, 'angebot.pdf');
      writeFileSync(file, pdf);
      const parts = join(dir, 'raw-parts');
      const sha = sha256Hex(pdf);
      await expect(ensurePartObject(parts, sha, pdf.length, file)).resolves.toBe(true);
      expect(statSync(rawPartPath(parts, sha)).ino).toBe(statSync(file).ino);
      await expect(ensurePartObject(parts, sha, pdf.length, file)).resolves.toBe(true);

      const wrong = join(dir, 'anderes.pdf');
      writeFileSync(wrong, Buffer.alloc(pdf.length));
      await expect(ensurePartObject(join(dir, 'other'), sha, pdf.length, wrong)).resolves.toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
