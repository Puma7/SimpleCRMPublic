import nodemailer from 'nodemailer';

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
