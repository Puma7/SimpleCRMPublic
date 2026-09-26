/**
 * @jest-environment node
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as openpgp from 'openpgp';
import type { Kysely } from 'kysely';

import { createPostgresPgpMessageCryptoPort } from '../../packages/server/src/pgp/message-crypto-port';
import { PGP_SIGNED_PARTIAL_WARNING } from '../../shared/pgp-signature-status';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const SIGNED_TEXT = 'Hallo,\nanbei die Unterlagen fuer das Projekt.\n\nGruss Partner';
const FRAUD_TEXT = 'Neue Bankverbindung ab sofort: DE00 1234 5678 9000 0000 00. Bitte die offene Rechnung heute noch dorthin ueberweisen.';

let partnerPublicKeyArmor = '';
let partnerFingerprint = '';
let signedBlock = '';

beforeAll(async () => {
  const { privateKey, publicKey } = await openpgp.generateKey({
    userIDs: [{ email: 'partner@firma.de' }],
    format: 'armored',
  });
  partnerPublicKeyArmor = publicKey;
  partnerFingerprint = (await openpgp.readKey({ armoredKey: publicKey })).getFingerprint();
  signedBlock = await openpgp.sign({
    message: await openpgp.createCleartextMessage({ text: SIGNED_TEXT }),
    signingKeys: await openpgp.readPrivateKey({ armoredKey: privateKey }),
  });
});

function makeDb(message: { bodyText: string | null; bodyHtml: string | null }) {
  const updates: Array<Record<string, unknown>> = [];
  const db: any = {
    transaction() {
      return { execute: async <T>(operation: (trx: unknown) => Promise<T>) => operation(db) };
    },
    selectFrom(table: string) {
      const rows = table === 'email_messages'
        ? [{
          id: 5,
          body_text: message.bodyText,
          body_html: message.bodyHtml,
          from_json: { value: [{ address: 'partner@firma.de' }] },
        }]
        : table === 'pgp_peer_keys'
          ? [{ fingerprint: partnerFingerprint, public_key_armor: partnerPublicKeyArmor, trust_level: 'verified' }]
          : [];
      const builder = {
        select() { return builder; },
        where() { return builder; },
        orderBy() { return builder; },
        async executeTakeFirst() { return rows[0]; },
        async execute() { return rows; },
      };
      return builder;
    },
    updateTable(table: string) {
      const builder = {
        set(values: Record<string, unknown>) {
          updates.push({ table, ...values });
          return builder;
        },
        where() { return builder; },
        async execute() { return undefined; },
      };
      return builder;
    },
  };
  return { db: db as Kysely<any>, updates };
}

async function verify(message: { bodyText: string | null; bodyHtml: string | null }) {
  const { db, updates } = makeDb(message);
  const port = createPostgresPgpMessageCryptoPort({
    db,
    secrets: {} as any,
    applyWorkspaceSession: async () => undefined,
    importOpenPgp: async () => openpgp as any,
  });
  const result = await port.verifyMessage({ workspaceId: WORKSPACE_ID, actorUserId: USER_ID, messageId: 5 });
  return { result, persistedStatus: updates.at(-1)?.pgp_status };
}

describe('server PGP message verification coverage', () => {
  test('reports signed_valid when the signed block is the whole message (mailer whitespace tolerated)', async () => {
    const plain = await verify({ bodyText: `\r\n${signedBlock.replace(/\n/g, '\r\n')}\r\n\r\n`, bodyHtml: null });
    expect(plain.result).toEqual({
      ok: true,
      result: { valid: true, status: 'signed_valid', fingerprint: partnerFingerprint },
    });
    expect(plain.persistedStatus).toBe('signed_valid');

    const withHtmlArmor = await verify({
      bodyText: signedBlock,
      bodyHtml: `<html><body><pre>${signedBlock.replace(/\n/g, '<br>\n')}</pre></body></html>`,
    });
    expect(withHtmlArmor.result).toMatchObject({ ok: true, result: { valid: true, status: 'signed_valid' } });

    const withHtmlSignedText = await verify({
      bodyText: signedBlock,
      bodyHtml: '<div>Hallo,<br>anbei die Unterlagen fuer das Projekt.</div><div><br></div><div>Gruss Partner</div>',
    });
    expect(withHtmlSignedText.result).toMatchObject({ ok: true, result: { valid: true, status: 'signed_valid' } });
  });

  // F-A5-09: Ein eingebetteter, echt signierter Block machte die ganze Nachricht 'signed_valid', obwohl Text davor/danach oder der HTML-Teil unsigniert waren.
  test('reports signed_partial when unsigned content surrounds the signed block', async () => {
    const suffix = await verify({ bodyText: `${signedBlock}\n\n${FRAUD_TEXT}`, bodyHtml: null });
    const prefix = await verify({ bodyText: `${FRAUD_TEXT}\n${signedBlock}`, bodyHtml: null });
    const html = await verify({ bodyText: signedBlock, bodyHtml: `<p>${FRAUD_TEXT}</p>` });
    const htmlOnly = await verify({ bodyText: null, bodyHtml: `<p>${FRAUD_TEXT}</p>\n${signedBlock}` });
    const secondBlock = await verify({ bodyText: `${signedBlock}\n${signedBlock}`, bodyHtml: null });

    for (const outcome of [suffix, prefix, html, htmlOnly, secondBlock]) {
      expect(outcome.result).toEqual({
        ok: true,
        result: { valid: false, status: 'signed_partial', fingerprint: partnerFingerprint },
      });
      expect(outcome.persistedStatus).toBe('signed_partial');
    }
  });
});

describe('message viewer PGP partial signature warning', () => {
  test('viewer shows the shared partial-signature warning instead of a plain status label', () => {
    const viewer = readFileSync(join(__dirname, '..', '..', 'src/components/email/message-viewer.tsx'), 'utf8');
    expect(viewer).toContain('selectedMessage.pgp_status === PGP_SIGNED_PARTIAL_STATUS');
    expect(viewer).toContain('{PGP_SIGNED_PARTIAL_WARNING}');
    expect(PGP_SIGNED_PARTIAL_WARNING).toBe('Nur ein Teil dieser Nachricht ist signiert.');
  });
});
