import fs from 'fs';
import os from 'os';
import path from 'path';
import { simpleParser } from 'mailparser';
import { buildComposeRfc822, encodeMailboxListHeader } from '../../electron/email/mail-rfc822-compose';

if (typeof setImmediate === 'undefined') {
  (globalThis as any).setImmediate = setTimeout;
}

function headerSection(raw: string): string {
  return raw.slice(0, raw.indexOf('\r\n\r\n'));
}

function headerCount(raw: string, name: string): number {
  return (headerSection(raw).match(new RegExp(`^${name}:`, 'gim')) ?? []).length;
}

describe('buildComposeRfc822', () => {
  it('includes file attachments in multipart/mixed', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rfc822-'));
    const attPath = path.join(dir, 'doc.txt');
    fs.writeFileSync(attPath, 'hello attachment');

    const buf = buildComposeRfc822({
      from: 'me@example.com',
      to: 'you@example.com',
      subject: 'Test',
      text: 'Body',
      attachments: [{ filename: 'doc.txt', path: attPath }],
    });

    const raw = buf.toString('utf-8');
    expect(raw).toContain('multipart/mixed');
    expect(raw).toContain('aGVsbG8gYXR0YWNobWVudA==');
    expect(raw).toContain('Content-Disposition: attachment');

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('encodes non-ASCII display names in From/To/Cc', () => {
    const buf = buildComposeRfc822({
      from: 'Müller GmbH <mueller@example.com>',
      to: 'Käufer <buyer@example.com>',
      cc: 'François <fr@example.com>',
      subject: 'Test',
      text: 'Body',
    });
    const raw = buf.toString('utf-8');
    expect(raw).toMatch(/^From: =\?UTF-8\?B\?/m);
    expect(raw).toMatch(/^To: =\?UTF-8\?B\?/m);
    expect(raw).toMatch(/^Cc: =\?UTF-8\?B\?/m);
    expect(raw).toContain('mueller@example.com');
    expect(raw).toContain('buyer@example.com');
    expect(raw).toContain('fr@example.com');
  });

  it('includes Bcc header only when bcc is provided (Sent append omits bcc)', () => {
    const withBcc = buildComposeRfc822({
      from: 'me@example.com',
      to: 'you@example.com',
      bcc: 'hidden@example.com',
      subject: 'Test',
      text: 'Body',
    }).toString('utf-8');
    expect(withBcc).toContain('Bcc:');

    const withoutBcc = buildComposeRfc822({
      from: 'me@example.com',
      to: 'you@example.com',
      subject: 'Test',
      text: 'Body',
    }).toString('utf-8');
    expect(withoutBcc).not.toContain('Bcc:');
  });

  it('encodes non-ASCII attachment filenames (RFC 2231)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rfc822-fn-'));
    const attPath = path.join(dir, 'rechnung.pdf');
    fs.writeFileSync(attPath, 'pdf');

    const buf = buildComposeRfc822({
      from: 'me@example.com',
      to: 'you@example.com',
      subject: 'Anhang',
      text: 'Body',
      attachments: [{ filename: 'Rechnung März.pdf', path: attPath }],
    });

    const raw = buf.toString('utf-8');
    expect(raw).toContain('filename*=UTF-8');
    expect(raw).toContain('name*=UTF-8');

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('emits exactly one syntactically valid Date and single-value headers for forward copies', async () => {
    const raw = buildComposeRfc822({
      from: 'SimpleCRM <mail@example.com>',
      to: 'recipient@example.com',
      subject: 'Fwd: Rechnung',
      text: 'Forwarded body',
      messageId: '<workflow-forward-copy-1@example.com>',
      extraHeaders: ['Auto-Submitted: auto-forwarded'],
      date: new Date('2026-06-13T12:36:00.000Z'),
    }).toString('utf8');

    expect(headerCount(raw, 'Date')).toBe(1);
    expect(headerCount(raw, 'From')).toBe(1);
    expect(headerCount(raw, 'To')).toBe(1);
    expect(headerCount(raw, 'Cc')).toBe(0);
    expect(headerCount(raw, 'Subject')).toBe(1);
    expect(headerSection(raw)).toContain('Date: Sat, 13 Jun 2026 12:36:00 GMT');
    expect(headerSection(raw)).not.toMatch(/^(Date|From|Sender|To|Cc|Subject):\s*$/im);

    const parsed = await simpleParser(Buffer.from(raw, 'utf8'));
    expect(parsed.date?.toISOString()).toBe('2026-06-13T12:36:00.000Z');
    expect(parsed.from?.value).toEqual([{ address: 'mail@example.com', name: 'SimpleCRM' }]);
    expect(parsed.to?.value).toEqual([{ address: 'recipient@example.com', name: '' }]);
    expect(parsed.subject).toBe('Fwd: Rechnung');
  });

  it('quotes display names containing commas instead of splitting them into invalid mailboxes', async () => {
    expect(encodeMailboxListHeader('Müller, Pascal <mail@example.com>')).toBe(
      '=?UTF-8?B?TcO8bGxlciwgUGFzY2Fs?= <mail@example.com>',
    );
    expect(encodeMailboxListHeader('SimpleCRM, Büro <mail@example.com>')).toBe(
      '=?UTF-8?B?U2ltcGxlQ1JNLCBCw7xybw==?= <mail@example.com>',
    );
    expect(encodeMailboxListHeader('Doe, Jane <jane@example.com>, ops@example.com')).toBe(
      '"Doe, Jane" <jane@example.com>, ops@example.com',
    );

    const raw = buildComposeRfc822({
      from: 'Müller, Pascal <mail@example.com>',
      to: 'Doe, Jane <jane@example.com>, ops@example.com',
      subject: 'Fwd: Überweisung',
      text: 'Body',
      date: new Date('2026-06-13T12:36:00.000Z'),
    }).toString('utf8');

    const parsed = await simpleParser(Buffer.from(raw, 'utf8'));
    expect(parsed.from?.value).toEqual([{ address: 'mail@example.com', name: 'Müller, Pascal' }]);
    expect(parsed.to?.value).toEqual([
      { address: 'jane@example.com', name: 'Doe, Jane' },
      { address: 'ops@example.com', name: '' },
    ]);
  });

  it('quotes a display name that contains "@" so the From header stays RFC 5322 valid', async () => {
    // Regression: a display name equal to the e-mail address (very common — the
    // account name defaults to the address) contains "@", which is NOT atext.
    // Left unquoted it produced `From: kontakt@x.com <kontakt@x.com>`, which
    // strict relays (IONOS) reject with 554. It must be a quoted-string.
    expect(encodeMailboxListHeader('kontakt@millandmaker.com <kontakt@millandmaker.com>')).toBe(
      '"kontakt@millandmaker.com" <kontakt@millandmaker.com>',
    );

    const raw = buildComposeRfc822({
      from: 'kontakt@millandmaker.com <kontakt@millandmaker.com>',
      to: 'pascal@leinfelder.in',
      subject: 'Test',
      text: 'Body',
      date: new Date('2026-06-14T17:13:31.000Z'),
    }).toString('utf8');

    expect(raw).toMatch(/^From: "kontakt@millandmaker\.com" <kontakt@millandmaker\.com>\r$/m);
    // The header now parses cleanly into a single valid address (mailparser drops
    // the display name as redundant since it equals the address — that's fine; the
    // point is the From is well-formed, not rejected as malformed).
    const parsed = await simpleParser(Buffer.from(raw, 'utf8'));
    expect(parsed.from?.value).toEqual([
      { address: 'kontakt@millandmaker.com', name: '' },
    ]);
  });

  it('splits a mailbox list correctly even when a quoted name ends with an escaped backslash', async () => {
    // The first display name's content is a literal backslash: `"ab\\"` — the \\
    // is an escaped backslash, so the following `"` CLOSES the quoted-string and
    // the comma still separates the two recipients. The old value[i-1] heuristic
    // kept inQuotes on and merged both into one (broken) mailbox.
    const raw = buildComposeRfc822({
      from: 'sender@example.com',
      to: '"ab\\\\" <first@example.com>, second@example.com',
      subject: 'x',
      text: 'b',
      date: new Date('2026-06-14T00:00:00.000Z'),
    }).toString('utf8');

    const parsed = await simpleParser(Buffer.from(raw, 'utf8'));
    expect((parsed.to?.value ?? []).map((v) => v.address)).toEqual([
      'first@example.com',
      'second@example.com',
    ]);
  });

  it('keeps atext-safe display names unquoted but quotes any other special', () => {
    // atom-safe -> unquoted
    expect(encodeMailboxListHeader('Mill and Maker <x@y.de>')).toBe('Mill and Maker <x@y.de>');
    expect(encodeMailboxListHeader('Mill & Maker <x@y.de>')).toBe('Mill & Maker <x@y.de>');
    // specials -> quoted-string (with escaping for \ and ")
    expect(encodeMailboxListHeader('John Q. Public <x@y.de>')).toBe('"John Q. Public" <x@y.de>');
    expect(encodeMailboxListHeader('a:b <x@y.de>')).toBe('"a:b" <x@y.de>');
    expect(encodeMailboxListHeader('back\\slash <x@y.de>')).toBe('"back\\\\slash" <x@y.de>');
    expect(encodeMailboxListHeader('say "hi" <x@y.de>')).toBe('"say \\"hi\\"" <x@y.de>');
  });
});
