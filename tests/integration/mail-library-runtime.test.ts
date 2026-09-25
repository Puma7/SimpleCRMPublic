import nodemailer from 'nodemailer';
import { createRequire } from 'node:module';

type ParsedMail = {
  subject?: string;
  text?: string;
  to?: { value: { address: string; name: string }[] };
  attachments: { filename?: string; content: Buffer }[];
};

const { simpleParser } = require('mailparser') as {
  simpleParser(input: Buffer): Promise<ParsedMail>;
};

function localTransport(maxRecipients: number) {
  // Stream transport builds MIME locally; this test never opens an SMTP connection.
  const options = {
    streamTransport: true as const,
    buffer: true as const,
    disableFileAccess: true,
    disableUrlAccess: true,
    maxRecipients,
  };
  return nodemailer.createTransport(options);
}

describe('real mail library runtime compatibility', () => {
  test('rejects an oversized recipient list before transport instead of silently accepting it', async () => {
    const transport = localTransport(2);
    try {
      await expect(transport.sendMail({
        from: 'sender@example.test',
        to: ['one@example.test', 'two@example.test', 'three@example.test'],
        subject: 'Bounded recipients',
        text: 'Must not be delivered',
      })).rejects.toMatchObject({ code: 'EMAXRECIPIENTS' });
    } finally {
      transport.close();
    }
  });

  test('preserves quoted names, Unicode text and attachment bytes at the recipient limit', async () => {
    const transport = localTransport(2);
    try {
      const result = await transport.sendMail({
        from: { name: 'Büro', address: 'sender@example.test' },
        to: [
          { name: 'Müller, Anna', address: 'anna@example.test' },
          { name: 'Second recipient', address: 'second@example.test' },
        ],
        subject: 'Prüfung – Grüße',
        text: 'Grüße aus dem Büro.',
        attachments: [{ filename: 'beleg.txt', content: Buffer.from('Beleg äöü') }],
      });
      const parsed = await simpleParser(result.message);
      expect(parsed.subject).toBe('Prüfung – Grüße');
      expect(parsed.text?.trim()).toBe('Grüße aus dem Büro.');
      expect(parsed.to?.value).toEqual([
        { name: 'Müller, Anna', address: 'anna@example.test' },
        { name: 'Second recipient', address: 'second@example.test' },
      ]);
      expect(parsed.attachments).toHaveLength(1);
      expect(parsed.attachments[0].filename).toBe('beleg.txt');
      expect(parsed.attachments[0].content.equals(Buffer.from('Beleg äöü'))).toBe(true);
    } finally {
      transport.close();
    }
  });
});

describe('HTML-to-text dependency compatibility', () => {
  const mailRequire = createRequire(require.resolve('mailparser'));
  const { convert } = mailRequire('html-to-text') as {
    convert(html: string, options?: Record<string, unknown>): string;
  };
  test.each([
    {
      name: 'preserves defaults, Unicode and link formatting',
      html: '<h1>Grüße</h1><p>Hello <a href="https://example.test/a">Link</a>.</p>',
      options: {},
      expected: 'GRÜSSE\n\nHello Link [https://example.test/a].',
    },
    {
      name: 'composes root selectors and replaces nested arrays',
      html: '<h1>Keep Case</h1><p><a href="https://example.test/a">Link</a></p>',
      options: { selectors: [
        { selector: 'h1', options: { uppercase: false } },
        { selector: 'a', options: { linkBrackets: ['<', '>'] } },
      ] },
      expected: 'Keep Case\n\nLink <https://example.test/a>',
    },
    {
      name: 'keeps the last duplicate selector option',
      html: '<a href="https://example.test/a">Link</a>',
      options: { selectors: [
        { selector: 'a', options: { linkBrackets: ['<', '>'] } },
        { selector: 'a', options: { linkBrackets: ['{', '}'] } },
      ] },
      expected: 'Link {https://example.test/a}',
    },
    {
      name: 'replaces base-element selector arrays',
      html: '<header>Header</header><main><p>Body</p></main>',
      options: { baseElements: { selectors: ['main'] } },
      expected: 'Body',
    },
    {
      name: 'retains table and list formatting',
      html: '<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table><ol><li>One</li><li>Two</li></ol>',
      options: { selectors: [{ selector: 'table', format: 'dataTable' }] },
      expected: 'A   B\n1   2\n\n 1. One\n 2. Two',
    },
  ])('$name', ({ html, options, expected }) => {
    expect(convert(html, options)).toBe(expected);
  });

  test('mailparser synthesizes text from an actual HTML-only MIME message', async () => {
    const source = Buffer.from(
      'From: sender@example.test\r\nTo: recipient@example.test\r\n' +
      'Subject: HTML-only\r\nMIME-Version: 1.0\r\n' +
      'Content-Type: text/html; charset=utf-8\r\n\r\n' +
      '<h1>Grüße</h1><p>Hello <a href="https://example.test/a">Link</a>.</p>',
    );
    expect((await simpleParser(source)).text).toBe('GRÜSSE\n\nHello Link [https://example.test/a].');
  });
});
