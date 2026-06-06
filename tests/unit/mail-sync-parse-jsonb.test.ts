/**
 * @jest-environment node
 */
import { parseMailSource } from '../../packages/server/src';

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
});
