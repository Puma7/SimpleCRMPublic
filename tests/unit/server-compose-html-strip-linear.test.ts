/**
 * @jest-environment node
 *
 * Server-Compose: HTML-Strip fuer PGP-Klartext und fuer die Ausgangspruefung
 * (eventStrings.combined_text) laeuft linear und liefert das bisherige Ergebnis.
 */
import type { Kysely } from 'kysely';

import type { ServerDatabase } from '../../packages/server/src/db/schema';
import {
  createEmailComposeSenderPort,
  createPostgresEmailOutboundValidationPort,
  type ComposeSenderStore,
} from '../../packages/server/src/mail-compose-send';

const WORKSPACE_ID = '10000000-0000-4000-8000-0000000000d7';
const HOSTILE_HTML = `<p>Hallo</p>Welt${'<'.repeat(80_000)}`;

/** Previous htmlToPlainTextForPgp chain (reference for the equality check). */
function legacyPgpPlainText(html: string): string {
  return html
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/\s*(p|div|li|tr|h[1-6])\s*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_match, code) => {
      const value = Number(code);
      return Number.isFinite(value) ? String.fromCodePoint(value) : '';
    })
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => {
      const value = Number.parseInt(code, 16);
      return Number.isFinite(value) ? String.fromCodePoint(value) : '';
    })
    .split(/\r?\n/)
    .map((line) => line.replace(/[ \t\f\v]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .trim();
}

function legacyEventHtmlPlain(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function fuzzSamples(): string[] {
  const samples = [
    '',
    'Nur Text',
    '<p>Hallo <b>Welt</b></p>',
    '<p>Secret <strong>text</strong><br>Line&nbsp;2 &amp; more</p>',
    'a <> b <<c>> d > e < f',
    '<p\nclass="x"\n>mehrzeilig</p><div>zwei</ div>< br/>drei',
    '&#65;&#x42;&lt;tag&gt;&quot;&#39;',
  ];
  const tokens = [
    '<', '>', '<>', 'a', ' ', '\n', '\t', '<p>', '</p>', '</ div >', '<br>', '< BR />', '<b', 'x>',
    '&amp;', '&nbsp;', '&#60;', '&#x3e;', 'ü',
  ];
  let seed = 0x5eed;
  const random = () => {
    seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
    return seed / 0x80000000;
  };
  for (let n = 0; n < 3000; n++) {
    const count = Math.floor(random() * 14);
    let html = '';
    for (let i = 0; i < count; i++) html += tokens[Math.floor(random() * tokens.length)];
    samples.push(html);
  }
  return samples;
}

function composeStore(): ComposeSenderStore {
  return {
    getDraft: async () => ({
      id: 44,
      accountId: 7,
      uid: -1,
      folderKind: 'draft',
      subject: 'PGP',
      bodyText: '',
      bodyHtml: null,
      messageIdHeader: null,
      inReplyToHeader: null,
      referencesHeader: null,
      ticketCode: null,
      threadId: null,
      draftAttachmentPathsJson: null,
      outboundHold: false,
      outboundBlockReason: null,
    }),
    getAccount: async () => ({
      id: 7,
      sourceSqliteId: 7,
      displayName: 'Service',
      emailAddress: 'service@example.com',
      imapHost: 'imap.example.com',
      imapUsername: 'service@example.com',
      smtpHost: 'smtp.example.com',
      smtpPort: 587,
      smtpTls: true,
      smtpUsername: 'service@example.com',
      smtpUseImapAuth: false,
      oauthProvider: null,
      protocol: 'imap',
      requestReadReceipt: false,
    }),
    getParentMessage: async () => null,
    getOrCreateThreadForTicket: async () => 'thread-1',
    getSyncInfo: async () => new Map(),
    setSyncInfo: async () => undefined,
    deleteSyncInfo: async () => undefined,
    claimSmtpOutbox: async () => 'claimed',
    tryAcquireSendingLock: async () => true,
    releaseSendingLock: async () => undefined,
    updateDraftForSend: async () => undefined,
    markDraftAsSent: async () => undefined,
    markMessageDone: async () => undefined,
  };
}

/** Sends a PGP-encrypted HTML-only draft and returns the plaintext handed to PGP. */
function pgpPlainTextSender() {
  const bodies: string[] = [];
  const sender = createEmailComposeSenderPort({
    store: composeStore(),
    smtpSend: async () => {
      throw new Error('SMTP darf in diesem Test nicht erreicht werden');
    },
    pgpMessages: {
      prepareOutboundBody: async (input) => {
        bodies.push(input.bodyText);
        return { ok: false, error: 'stop after PGP body' };
      },
    } as never,
  });
  return {
    async plainTextFor(bodyHtml: string): Promise<string | undefined> {
      bodies.length = 0;
      await sender.send({
        workspaceId: WORKSPACE_ID,
        actorUserId: 'user-1',
        values: {
          accountId: 7,
          draftMessageId: 44,
          subject: 'PGP',
          bodyText: '',
          bodyHtml,
          to: 'kunde@example.com',
          pgpEncrypt: true,
        },
      });
      return bodies[0];
    },
  };
}

function fakeValidationDb(): Kysely<ServerDatabase> {
  const rowsByTable: Record<string, { first: unknown; all: unknown[] }> = {
    email_messages: { first: { id: 44 }, all: [] },
    email_workflows: { first: undefined, all: [{ id: 5, name: 'Ausgang' }] },
  };
  const builder = (table: string): unknown => {
    const chain: Record<string, unknown> = new Proxy({}, {
      get: (_target, prop) => {
        if (prop === 'executeTakeFirst') return async () => rowsByTable[table]?.first;
        if (prop === 'execute') return async () => rowsByTable[table]?.all ?? [];
        return () => chain;
      },
    });
    return chain;
  };
  const trx = { selectFrom: builder };
  return {
    transaction: () => ({ execute: async (operation: (value: unknown) => Promise<unknown>) => operation(trx) }),
  } as unknown as Kysely<ServerDatabase>;
}

/** Runs the outbound validation and returns eventStrings.combined_text handed to the dry run. */
function outboundCombinedText() {
  const combined: string[] = [];
  const port = createPostgresEmailOutboundValidationPort({
    db: fakeValidationDb(),
    applyWorkspaceSession: async () => undefined,
    workflowDryRun: async (plan) => {
      const eventStrings = (plan.context as { eventStrings: Record<string, string> }).eventStrings;
      combined.push(eventStrings.combined_text);
      return { success: true, dryRun: true, status: 'ok', blocked: false };
    },
  });
  return {
    async of(bodyHtml: string): Promise<string | undefined> {
      combined.length = 0;
      await port.validate({
        workspaceId: WORKSPACE_ID,
        actorUserId: 'user-1',
        persistence: 'none',
        values: { messageId: 44, subject: '', bodyText: '', bodyHtml, to: '' },
      });
      return combined[0];
    },
  };
}

describe('server compose HTML strip', () => {
  // F-N-redos-02: htmlToPlainTextForPgp strippte per /<[^>]+>/g; unverschlossene '<' im HTML-Entwurf blockierten den Versand quadratisch.
  test('PGP plaintext from HTML-only drafts stays linear', async () => {
    const sender = pgpPlainTextSender();
    const started = Date.now();
    const plain = await sender.plainTextFor(HOSTILE_HTML);
    expect(Date.now() - started).toBeLessThan(1_500);
    expect(plain).toBe(`Hallo\nWelt${'<'.repeat(80_000)}`);
  });

  // F-N-redos-02: Der lineare Strip muss exakt den bisherigen PGP-Klartext liefern.
  test('PGP plaintext matches the previous regex chain', async () => {
    const sender = pgpPlainTextSender();
    for (const html of fuzzSamples()) {
      const expected = html.trim() ? legacyPgpPlainText(html) : '';
      expect(await sender.plainTextFor(html)).toBe(expected);
    }
  });

  // F-N-redos-02: outboundValidationEventStrings strippte bodyHtml per /<[^>]+>/g; die Ausgangspruefung beim Senden lief quadratisch.
  test('outbound validation strips draft HTML linearly', async () => {
    const validation = outboundCombinedText();
    const started = Date.now();
    const combined = await validation.of(HOSTILE_HTML);
    expect(Date.now() - started).toBeLessThan(1_500);
    expect(combined).toBe(`Hallo Welt${'<'.repeat(80_000)}`);
  });

  // F-N-redos-02: combined_text der Ausgangspruefung muss exakt dem bisherigen Ergebnis entsprechen.
  test('outbound validation combined_text matches the previous regex chain', async () => {
    const validation = outboundCombinedText();
    for (const html of fuzzSamples()) {
      expect(await validation.of(html)).toBe(legacyEventHtmlPlain(html));
    }
  });
});
