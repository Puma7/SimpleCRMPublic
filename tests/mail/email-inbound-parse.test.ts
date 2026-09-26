import { simpleParser } from 'mailparser';
import { parseInboundMailSource } from '../../electron/email/email-inbound-parse';
import { normalCidMails, repeatedCidImageMail } from './helpers/cid-mime';

const CID_INLINE_BUDGET = 16 * 1024 * 1024;

describe('parseInboundMailSource', () => {
  // C-A71: Die Standard-CID-Expansion von mailparser machte aus 157 KB Rohmail 136 Mio. Zeichen HTML (ab ~700 KB RangeError).
  test('bounds the html of a mail that references one inline image a thousand times', async () => {
    const { source, html } = repeatedCidImageMail(100 * 1024, 1000);
    expect(source.length).toBeLessThan(200 * 1024);

    const parsed = await parseInboundMailSource(source);

    expect(typeof parsed.html).toBe('string');
    const body = parsed.html as string;
    expect(body.length).toBeLessThanOrEqual(html.length + CID_INLINE_BUDGET);
    expect(body.startsWith('<html><body><img src="data:image/png;base64,')).toBe(true);
    expect(body.endsWith('<img src="cid:a"></body></html>')).toBe(true);
    expect(parsed.attachments).toHaveLength(1);
    expect(parsed.attachments?.[0]?.content?.length).toBe(100 * 1024);
  }, 30_000);

  // C-A71: Normale Mails muessen byte-identisch so ankommen wie mit mailparsers Standard-Inlining.
  test.each(normalCidMails())('keeps mailparser default html for: $name', async ({ source }) => {
    const legacy = await simpleParser(source);
    const parsed = await parseInboundMailSource(source);
    expect(parsed.html).toBe(legacy.html);
    expect(parsed.text).toBe(legacy.text);
    expect(parsed.attachments?.map((a) => a.content)).toEqual(legacy.attachments?.map((a) => a.content));
  });
});
