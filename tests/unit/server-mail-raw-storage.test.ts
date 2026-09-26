import { brotliCompressSync } from 'node:zlib';

import { buildRfc822FromStored } from '../../packages/server/src/mail-security-check';
import {
  StoredRawIntegrityError,
  encodeRawForStorage,
  loadStoredRaw,
  loadStoredRawOrNull,
  sha256Hex,
} from '../../packages/server/src/mail-raw-storage';

/**
 * Mail-Original komprimiert speichern: verlustfrei (Rückweg bewiesen), prüfbar
 * (sha256 + Größe) und für Altbestand (base64-Text) weiter lesbar.
 */
describe('server: raw RFC 822 original storage', () => {
  const attachment = Buffer.alloc(40_000);
  for (let i = 0; i < attachment.length; i += 1) attachment[i] = (i * 7919) % 251;
  const source = Buffer.from([
    'From: Kunde <kunde@example.com>',
    'To: support@example.test',
    'Subject: Angebot mit Anhang äöü',
    'Message-ID: <raw-1@example.com>',
    'MIME-Version: 1.0',
    'Content-Type: multipart/mixed; boundary="b1"',
    '',
    '--b1',
    'Content-Type: text/plain; charset=utf-8',
    '',
    'Guten Tag, anbei das Angebot. '.repeat(200),
    '--b1',
    'Content-Type: application/octet-stream; name="daten.bin"',
    'Content-Transfer-Encoding: base64',
    '',
    attachment.toString('base64').replace(/.{76}/g, '$&\r\n'),
    '--b1--',
    '',
  ].join('\r\n'), 'utf8');

  test('round trip is exact and the stored value is smaller than the base64 text it replaces', async () => {
    const stored = await encodeRawForStorage(source);
    expect(stored.raw_rfc822_b64).toBeNull();
    expect(stored.raw_rfc822_codec).toBe('br');
    expect(stored.raw_rfc822_sha256).toBe(sha256Hex(source));
    expect(stored.raw_rfc822_size).toBe(source.length);
    expect(stored.raw_rfc822_z.length).toBeLessThan(source.toString('base64').length * 0.6);

    const loaded = await loadStoredRaw(stored);
    expect(loaded?.equals(source)).toBe(true);
  });

  test('legacy base64 rows stay readable; no original means null', async () => {
    await expect(loadStoredRaw({ raw_rfc822_b64: source.toString('base64') }))
      .resolves.toEqual(source);
    await expect(loadStoredRaw({ raw_rfc822_b64: null, raw_rfc822_z: null })).resolves.toBeNull();
  });

  test('a damaged original is reported, never passed on', async () => {
    const stored = await encodeRawForStorage(source);
    // Gleiche Länge, ein Byte anders: nur die Prüfsumme bemerkt es.
    const tampered = Buffer.from(source);
    tampered[20] = tampered[20]! ^ 1;
    const otherContent = brotliCompressSync(tampered);
    await expect(loadStoredRaw({ ...stored, raw_rfc822_z: otherContent })).rejects.toThrow('does not match its sha256');
    await expect(loadStoredRaw({ ...stored, raw_rfc822_z: Buffer.from('kein brotli') })).rejects.toBeInstanceOf(StoredRawIntegrityError);
    await expect(loadStoredRaw({ ...stored, raw_rfc822_size: source.length + 1 })).rejects.toThrow('expected');
    await expect(loadStoredRaw({ ...stored, raw_rfc822_codec: 'zstd' })).rejects.toThrow('unknown raw_rfc822_codec');

    const errors = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await expect(loadStoredRawOrNull({ ...stored, raw_rfc822_z: otherContent }, 'test')).resolves.toBeNull();
      expect(errors).toHaveBeenCalledWith(expect.stringContaining('does not match its sha256'));
    } finally {
      errors.mockRestore();
    }
  });

  test('security checks use the original bytes when given', () => {
    expect(buildRfc822FromStored({
      rawRfc822: source,
      rawRfc822B64: null,
      rawHeaders: 'Subject: nur Kopfzeilen',
      bodyText: null,
      bodyHtml: null,
    })?.equals(source)).toBe(true);
  });
});
