import { simpleParser, type ParsedMail } from 'mailparser';
import { cidInlineBudgetBytes, inlineCidImages } from './email-parse-utils';

/**
 * simpleParser for inbound RFC822 sources (IMAP, POP3, attachment recovery).
 * mailparser's default replaces every `cid:` reference to an image with the
 * full data: URL, without a limit (C-A71); here the parser keeps the links and
 * inlineCidImages inlines them within a budget. `html` keeps mailparser's
 * default shape: a non-empty string or false.
 */
export async function parseInboundMailSource(source: Buffer): Promise<ParsedMail> {
  const parsed = await simpleParser(source, { keepCidLinks: true });
  parsed.html = parsed.html
    ? inlineCidImages(parsed.html, parsed.attachments, cidInlineBudgetBytes(source.length))
    : false;
  return parsed;
}
