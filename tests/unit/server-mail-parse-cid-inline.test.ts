/**
 * @jest-environment node
 */
import { parseMailSource } from '../../packages/server/src/mail-parse';
import { normalCidMails, repeatedCidImageMail } from '../mail/helpers/cid-mime';

const { simpleParser } = jest.requireActual('mailparser') as {
  simpleParser(source: Buffer): Promise<{ html?: string | false }>;
};

const CID_INLINE_BUDGET = 16 * 1024 * 1024;

describe('server parseMailSource cid inline images', () => {
  // C-A71: mailparsers Standard-CID-Expansion machte aus 157 KB Rohmail 136 Mio. Zeichen bodyHtml; ab ~700 KB beendete ein RangeError den API-Prozess.
  test('bounds the html of a mail that references one inline image many times', async () => {
    const { source, html } = repeatedCidImageMail(100 * 1024, 200);

    const parsed = await parseMailSource(source);

    expect(parsed.bodyHtml!.length).toBeLessThanOrEqual(html.length + CID_INLINE_BUDGET);
    expect(parsed.bodyHtml!.startsWith('<html><body><img src="data:image/png;base64,')).toBe(true);
    expect(parsed.bodyHtml!.endsWith('<img src="cid:a"></body></html>')).toBe(true);
    expect(parsed.attachments).toHaveLength(1);
  }, 30_000);

  // C-A71: Normale Mails muessen byte-identisch so ankommen wie mit mailparsers Standard-Inlining.
  test.each(normalCidMails())('keeps mailparser default html for: $name', async ({ source }) => {
    const legacy = await simpleParser(source);
    const parsed = await parseMailSource(source);
    expect(parsed.bodyHtml).toBe(typeof legacy.html === 'string' ? legacy.html : null);
  });
});
