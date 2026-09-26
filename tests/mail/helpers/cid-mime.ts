/** RFC822 sources with cid: inline images for the mail parser tests (C-A71). */

type MimePart = {
  headers: string[];
  body: string;
};

let boundaryCounter = 0;

function base64Body(content: Buffer): string {
  return content.toString('base64').replace(/.{76}/g, '$&\r\n');
}

function deterministicBytes(length: number, seed: number): Buffer {
  const out = Buffer.alloc(length);
  let state = seed >>> 0 || 1;
  for (let i = 0; i < length; i++) {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0;
    out[i] = state >>> 24;
  }
  return out;
}

function htmlPart(html: string): MimePart {
  return {
    headers: ['Content-Type: text/html; charset=utf-8', 'Content-Transfer-Encoding: 7bit'],
    body: html,
  };
}

function textPart(text: string): MimePart {
  return {
    headers: ['Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: 7bit'],
    body: text,
  };
}

function binaryPart(
  contentType: string,
  content: Buffer,
  opts: { contentId?: string; filename?: string; disposition?: 'inline' | 'attachment' } = {},
): MimePart {
  const headers = [
    `Content-Type: ${contentType}${opts.filename ? `; name="${opts.filename}"` : ''}`,
    'Content-Transfer-Encoding: base64',
  ];
  if (opts.contentId !== undefined) headers.push(`Content-ID: ${opts.contentId}`);
  headers.push(
    `Content-Disposition: ${opts.disposition ?? 'inline'}${opts.filename ? `; filename="${opts.filename}"` : ''}`,
  );
  return { headers, body: base64Body(content) };
}

function multipart(subtype: string, parts: MimePart[]): MimePart {
  boundaryCounter += 1;
  const boundary = `----=_cid_${subtype}_${boundaryCounter}`;
  const body = [
    ...parts.flatMap((part) => [`--${boundary}`, ...part.headers, '', part.body]),
    `--${boundary}--`,
    '',
  ].join('\r\n');
  return { headers: [`Content-Type: multipart/${subtype}; boundary="${boundary}"`], body };
}

function message(root: MimePart, subject = 'cid'): Buffer {
  return Buffer.from(
    [
      'From: sender@example.com',
      'To: recipient@example.com',
      `Subject: ${subject}`,
      'Message-ID: <cid-test@example.com>',
      'MIME-Version: 1.0',
      ...root.headers,
      '',
      root.body,
    ].join('\r\n'),
  );
}

/** One `imageBytes` large PNG part referenced `refs` times from the HTML (the C-A71 probe). */
export function repeatedCidImageMail(imageBytes: number, refs: number): { source: Buffer; html: string } {
  const html = `<html><body>${'<img src="cid:a">'.repeat(refs)}</body></html>`;
  const source = message(
    multipart('related', [
      htmlPart(html),
      binaryPart('image/png', Buffer.alloc(imageBytes, 7), { contentId: '<a>' }),
    ]),
  );
  return { source, html };
}

/** Everyday messages whose parsed HTML must stay exactly as mailparser's default inlining produced it. */
export function normalCidMails(): { name: string; source: Buffer }[] {
  const logo = deterministicBytes(3000, 1);
  const photo = deterministicBytes(40_000, 2);
  const icon = deterministicBytes(90, 3);
  const pdf = Buffer.from('%PDF-1.4\n% test\n');
  return [
    {
      name: 'single image referenced once',
      source: message(
        multipart('related', [
          htmlPart('<p>Hallo</p><img src="cid:logo@example.com" alt="Logo"><p>Gruss</p>'),
          binaryPart('image/png', logo, { contentId: '<logo@example.com>', filename: 'logo.png' }),
        ]),
      ),
    },
    {
      name: 'alternative text and html with two images and a pdf attachment',
      source: message(
        multipart('mixed', [
          multipart('related', [
            multipart('alternative', [
              textPart('Hallo Welt'),
              htmlPart(
                "<table><tr><td><img src='cid:photo.1@x'></td>" +
                  '<td><img width="16" src="cid:icon.2@x"></td></tr></table>',
              ),
            ]),
            binaryPart('image/jpeg', photo, { contentId: '<photo.1@x>' }),
            binaryPart('image/gif', icon, { contentId: '<icon.2@x>' }),
          ]),
          binaryPart('application/pdf', pdf, { filename: 'rechnung.pdf', disposition: 'attachment' }),
        ]),
      ),
    },
    {
      name: 'logo referenced in header and footer',
      source: message(
        multipart('related', [
          htmlPart('<img src="cid:logo"><p>Text</p><img src="cid:logo">'),
          binaryPart('image/png', logo, { contentId: '<logo>' }),
        ]),
      ),
    },
    {
      name: 'unquoted attributes and css references',
      source: message(
        multipart('related', [
          htmlPart(
            '<img src=cid:bg alt=a><div style="background:url(\'cid:bg\')">x</div>' +
              '<div style="background:url(cid:bg)">y</div><img src=cid:bg>',
          ),
          binaryPart('image/png', icon, { contentId: '<bg>' }),
        ]),
      ),
    },
    {
      name: 'non-image, unknown and look-alike references stay cid',
      source: message(
        multipart('related', [
          htmlPart(
            '<img src="cid:vector"><a href="cid:doc">pdf</a><img src="cid:missing">' +
              '<img src="CID:logo"><img src="xcid:logo"><img src="cid:logo">',
          ),
          binaryPart('image/svg+xml', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), {
            contentId: '<vector>',
          }),
          binaryPart('application/pdf', pdf, { contentId: '<doc>' }),
          binaryPart('image/png', logo, { contentId: '<logo>' }),
        ]),
      ),
    },
    {
      name: 'octet-stream image detected by file name',
      source: message(
        multipart('related', [
          htmlPart('<img src="cid:pic">'),
          binaryPart('application/octet-stream', icon, { contentId: '<pic>', filename: 'pic.png' }),
        ]),
      ),
    },
    {
      name: 'duplicate content id uses the first image',
      source: message(
        multipart('related', [
          htmlPart('<img src="cid:dup">'),
          binaryPart('application/pdf', pdf, { contentId: '<dup>' }),
          binaryPart('image/png', icon, { contentId: '<dup>' }),
          binaryPart('image/png', logo, { contentId: '<dup>' }),
        ]),
      ),
    },
    {
      name: 'content id with spaces around the brackets',
      source: message(
        multipart('related', [
          htmlPart('<img src="cid:spaced@x">'),
          binaryPart('image/png', icon, { contentId: ' < spaced@x > ' }),
        ]),
      ),
    },
    {
      name: 'html without cid references',
      source: message(multipart('alternative', [textPart('Nur Text'), htmlPart('<p>Nur <b>HTML</b></p>')])),
    },
    {
      name: 'plain text only',
      source: message(textPart('Kein HTML')),
    },
    {
      name: 'empty html part',
      source: message(
        multipart('related', [
          htmlPart(''),
          binaryPart('image/png', icon, { contentId: '<a>' }),
        ]),
      ),
    },
  ];
}
