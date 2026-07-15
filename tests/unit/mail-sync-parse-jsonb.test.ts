/**
 * @jest-environment node
 */
// Import directly from mail-parse (DB-free) instead of the server barrel — the
// mail Jest preset doesn't transform kysely's ESM, and the barrel pulls in the
// whole DB stack.
import {
  InboundMessageTooLargeError,
  assertInboundRfc822Base64Size,
  assertInboundRfc822Size,
} from '@simplecrm/core';
import { parseMailSource } from '../../packages/server/src/mail-parse';

// Regression for "messages with attachments fail to import": the parser must
// produce jsonb-safe values. A raw JS array would be serialized by node-postgres
// as a Postgres array literal and rejected by the jsonb column, so the json
// fields must be validated JSON *strings* (objects and arrays alike).
describe('parseMailSource json fields are jsonb-safe', () => {
  const mime = [
    'From: Alice <alice@example.com>',
    'To: Bob <bob@example.com>',
    'Subject: With attachment',
    'Message-ID: <att-1@example.com>',
    'Content-Type: multipart/mixed; boundary="b"',
    '',
    '--b',
    'Content-Type: text/plain; charset=utf-8',
    '',
    'Hello with attachment',
    '--b',
    'Content-Type: application/pdf; name="doc.pdf"',
    'Content-Disposition: attachment; filename="doc.pdf"',
    'Content-Transfer-Encoding: base64',
    '',
    'SGVsbG8=',
    '--b--',
    '',
  ].join('\r\n');

  test('attachmentsJson is a JSON string that parses to the attachment array', async () => {
    const parsed = await parseMailSource(Buffer.from(mime));

    expect(parsed.hasAttachments).toBe(true);
    expect(typeof parsed.attachmentsJson).toBe('string');
    const attachments = JSON.parse(parsed.attachmentsJson as string);
    expect(Array.isArray(attachments)).toBe(true);
    expect(attachments.length).toBe(1);
    expect(attachments[0]).toEqual(expect.objectContaining({ filename: 'doc.pdf' }));
  });

  test('address json fields are JSON strings (not raw objects/arrays)', async () => {
    const parsed = await parseMailSource(Buffer.from(mime));

    expect(typeof parsed.fromJson).toBe('string');
    expect(typeof parsed.toJson).toBe('string');
    expect(JSON.parse(parsed.fromJson as string)).toBeTruthy();
  });

  test('rejects oversized multipart sources before MIME expansion', async () => {
    const source = Buffer.from(mime);
    await expect(parseMailSource(source, source.length - 1)).rejects.toBeInstanceOf(InboundMessageTooLargeError);
    await expect(parseMailSource(source, source.length)).resolves.toEqual(expect.objectContaining({
      subject: 'With attachment',
      hasAttachments: true,
    }));
  });

  test('validates byte and stored base64 boundaries without large allocations', () => {
    expect(() => assertInboundRfc822Size(10, 10)).not.toThrow();
    expect(() => assertInboundRfc822Size(11, 10)).toThrow(InboundMessageTooLargeError);
    expect(() => assertInboundRfc822Base64Size(Buffer.alloc(10).toString('base64'), 10)).not.toThrow();
    expect(() => assertInboundRfc822Base64Size(Buffer.alloc(11).toString('base64'), 10))
      .toThrow(InboundMessageTooLargeError);
  });
});
