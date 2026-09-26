import { Readable } from 'node:stream';

import { createFastifyServer } from '../../packages/server/src/api/fastify-adapter';
import type { AuthenticatedPrincipal, ServerApiPorts } from '../../packages/server/src/api/types';

/**
 * Wie viel JSON der Server vor der Anmeldung liest.
 *
 * Fastify parst den Body synchron, bevor der Dispatcher die Route, den
 * Principal oder die Methode prueft. Ein anonymer Body von 39 MB `[{},{},…]`
 * hielt den Event-Loop ueber zehn Sekunden fest — auf /api/x, /health oder
 * /t/… sogar ohne jedes Rate-Limit. Normale Anfragen brauchen keine 40 MB;
 * die grossen Bodies gehoeren wenigen angemeldeten Routen (Compose-Anhang,
 * Compose-Texte, PGP-Nachrichten).
 */

const MiB = 1024 * 1024;
const OWNER: AuthenticatedPrincipal = { userId: 'user-a', workspaceId: 'workspace-a', role: 'owner' };

/** Gueltiges JSON, das beim Parsen richtig teuer waere. */
function objectArrayJson(bytes: number): string {
  return `[${'{},'.repeat(Math.floor(bytes / 3))}{}]`;
}

/**
 * Ungueltiges JSON: Wird es geparst, antwortet Fastify 400. Jede andere
 * Antwort belegt, dass der Body gar nicht erst gelesen wurde.
 */
function brokenJson(bytes: number): string {
  return `{${'x'.repeat(bytes)}`;
}

type UploadCall = Parameters<NonNullable<ServerApiPorts['emailComposeAttachments']>['upload']>[0];

function makePorts(uploads: UploadCall[] = []): ServerApiPorts {
  return {
    mailAccess: {
      async assertPermission() { return undefined; },
      async resolveScope() { return { kind: 'all' }; },
    },
    mailResourceLookup: {
      async resolve(input: { target: { kind: string; id?: unknown } }) {
        return [{
          type: 'message',
          accountId: '7',
          folderId: '7',
          messageId: String(input.target.id),
        }];
      },
    },
    emailComposeAttachments: {
      async upload(input: UploadCall) {
        uploads.push(input);
        return {
          ok: true,
          path: `${input.workspaceId}/compose-drafts/${input.draftMessageId}/${input.filename}`,
          filename: input.filename,
          sizeBytes: Buffer.from(input.contentBase64, 'base64').length,
        };
      },
    },
  } as unknown as ServerApiPorts;
}

function jsonHeaders(): Record<string, string> {
  return { 'content-type': 'application/json' };
}

// F-A13A14-02: Anonyme Anfragen durften bis zu 40 MB JSON parsen lassen, bevor Route, Anmeldung oder Methode geprueft wurden.
describe('F-A13A14-02 Body-Limits vor der Anmeldung', () => {
  test('Pfade ausserhalb der API enden mit 404, ohne dass der Body gelesen wird', async () => {
    const app = createFastifyServer({ ports: makePorts() });
    try {
      for (const url of ['/api/x', '/api/v2/customers', '/wp-login.php']) {
        const small = await app.inject({ method: 'POST', url, headers: jsonHeaders(), payload: brokenJson(10) });
        expect([url, small.statusCode, small.json()]).toEqual([
          url,
          404,
          { error: { code: 'not_found', message: 'Route nicht gefunden' } },
        ]);

        const large = await app.inject({ method: 'POST', url, headers: jsonHeaders(), payload: brokenJson(2 * MiB) });
        expect([url, large.statusCode]).toEqual([url, 404]);
      }
    } finally {
      await app.close();
    }
  });

  test('Health, OpenAPI und Tracking nehmen keinen Body an', async () => {
    const app = createFastifyServer({ ports: makePorts() });
    try {
      for (const url of ['/health', '/health/ready', '/openapi.json', '/t/o/abc.gif', '/t/c/abc']) {
        const response = await app.inject({ method: 'POST', url, headers: jsonHeaders(), payload: objectArrayJson(4096) });
        expect([url, response.statusCode, response.json().code]).toEqual([url, 413, 'FST_ERR_CTP_BODY_TOO_LARGE']);
      }

      const oversized = await app.inject({ method: 'POST', url: '/health', headers: jsonHeaders(), payload: objectArrayJson(2 * MiB) });
      expect(oversized.statusCode).toBe(413);

      // Ohne Body bleibt alles wie gehabt.
      expect((await app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
      expect((await app.inject({ method: 'POST', url: '/health' })).statusCode).toBe(405);
    } finally {
      await app.close();
    }
  });

  test('anonymer Login mit uebergrossem Body endet mit 413, auch ohne Content-Length', async () => {
    const app = createFastifyServer({ ports: makePorts() });
    try {
      const declared = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        headers: jsonHeaders(),
        payload: objectArrayJson(2 * MiB),
      });
      expect(declared.statusCode).toBe(413);
      expect(declared.json().code).toBe('FST_ERR_CTP_BODY_TOO_LARGE');

      const chunked = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        headers: jsonHeaders(),
        payload: Readable.from([objectArrayJson(MiB), objectArrayJson(MiB)]),
      });
      expect(chunked.statusCode).toBe(413);
    } finally {
      await app.close();
    }
  });

  test('angemeldete Anfragen an gewoehnliche Routen sind auf 1 MiB begrenzt', async () => {
    const app = createFastifyServer({ ports: makePorts(), resolvePrincipal: () => OWNER });
    try {
      const tooLarge = await app.inject({
        method: 'POST',
        url: '/api/v1/customers',
        headers: jsonHeaders(),
        payload: JSON.stringify({ name: 'x'.repeat(MiB + 1) }),
      });
      expect(tooLarge.statusCode).toBe(413);

      const belowLimit = await app.inject({
        method: 'POST',
        url: '/api/v1/customers',
        headers: jsonHeaders(),
        payload: JSON.stringify({ name: 'x'.repeat(MiB - 1024) }),
      });
      expect(belowLimit.statusCode).not.toBe(413);
    } finally {
      await app.close();
    }
  });

  test('die Upload-Routen verlangen die Anmeldung, bevor sie den Body lesen', async () => {
    const uploads: UploadCall[] = [];
    const app = createFastifyServer({ ports: makePorts(uploads) });
    try {
      for (const [method, url] of [
        ['POST', '/api/v1/email/messages/44/compose-attachments'],
        ['POST', '/api/v1/email/compose-drafts'],
        ['PATCH', '/api/v1/email/messages/44/compose-draft'],
        ['POST', '/api/v1/email/compose/send'],
        ['POST', '/api/v1/email/compose/validate-outbound'],
        ['POST', '/api/v1/pgp/messages/encrypt'],
        ['POST', '/api/v1/pgp/messages/sign'],
      ] as const) {
        const response = await app.inject({ method, url, headers: jsonHeaders(), payload: brokenJson(2 * MiB) });
        expect([method, url, response.statusCode, response.json()]).toEqual([
          method,
          url,
          401,
          { error: { code: 'unauthorized', message: 'Authentifizierung erforderlich' } },
        ]);
      }
      expect(uploads).toEqual([]);
    } finally {
      await app.close();
    }
  });

  test('der angemeldete Compose-Upload nimmt weiterhin einen 25-MB-Anhang an', async () => {
    const uploads: UploadCall[] = [];
    const resolvePrincipal = jest.fn(() => OWNER);
    const app = createFastifyServer({ ports: makePorts(uploads), resolvePrincipal });
    const contentBase64 = Buffer.alloc(25 * MiB, 7).toString('base64');
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/email/messages/44/compose-attachments',
        headers: jsonHeaders(),
        payload: JSON.stringify({ filename: 'scan.pdf', contentBase64, contentType: 'application/pdf' }),
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().data).toEqual({
        success: true,
        path: 'workspace-a/compose-drafts/44/scan.pdf',
        filename: 'scan.pdf',
        sizeBytes: 25 * MiB,
      });
      expect(uploads).toHaveLength(1);
      expect(uploads[0]?.contentBase64).toBe(contentBase64);
      // Der vorgezogene Principal wird wiederverwendet, nicht ein zweites Mal aufgeloest.
      expect(resolvePrincipal).toHaveBeenCalledTimes(1);
    } finally {
      await app.close();
    }
  });

  test('die uebrigen Upload-Routen lassen angemeldete Bodies ueber 1 MiB zum Handler durch', async () => {
    const app = createFastifyServer({ ports: makePorts(), resolvePrincipal: () => OWNER });
    const text = 'x'.repeat(1_500_000);
    try {
      for (const [method, url, body] of [
        ['POST', '/api/v1/email/compose-drafts', { accountId: 7, bodyText: text }],
        ['PATCH', '/api/v1/email/messages/44/compose-draft', { bodyText: text, bodyHtml: text }],
        ['POST', '/api/v1/email/compose/send', { accountId: 7, subject: 's', to: 'a@example.com', bodyText: text, bodyHtml: text }],
        ['POST', '/api/v1/email/compose/validate-outbound', { messageId: 44, subject: 's', to: 'a@example.com', bodyText: text, bodyHtml: text }],
        ['POST', '/api/v1/pgp/messages/encrypt', { plaintext: text, recipientEmails: ['a@example.com'] }],
        ['POST', '/api/v1/pgp/messages/sign', { plaintext: text, passphrase: 'secret' }],
      ] as const) {
        const response = await app.inject({ method, url, headers: jsonHeaders(), payload: JSON.stringify(body) });
        // Die Fake-Ports kennen diese Handler nicht (503/400) — entscheidend ist,
        // dass Fastify den Body angenommen und an den Dispatcher gegeben hat.
        expect([method, url, response.statusCode === 413, response.json().code]).toEqual([method, url, false, undefined]);
      }
    } finally {
      await app.close();
    }
  });

  // F-A13A14-02: Anonyme JSON-Bodies bis 1 MiB wurden auf allen /api/v1-Routen vor der Anmeldung geparst (rund 110 ms je MiB).
  test('nicht oeffentliche /api/v1-Routen verlangen die Anmeldung, bevor sie den Body lesen (E4)', async () => {
    const app = createFastifyServer({ ports: makePorts() });
    try {
      for (const [method, url] of [
        ['POST', '/api/v1/customers'],
        ['PATCH', '/api/v1/workflows/5'],
        ['POST', '/api/v1/auth/users'],
        ['POST', '/api/v1/workflows/webhook/incoming'],
        ['POST', '/api/v1/webhooks/incoming'],
        ['POST', '/api/v1/gibt-es-nicht'],
        // Oeffentlicher Pfad, aber nicht mit dieser Methode.
        ['POST', '/api/v1/health'],
      ] as const) {
        for (const payload of [brokenJson(10), brokenJson(MiB - 1024)]) {
          const response = await app.inject({ method, url, headers: jsonHeaders(), payload });
          expect([method, url, response.statusCode, response.json()]).toEqual([
            method,
            url,
            401,
            { error: { code: 'unauthorized', message: 'Authentifizierung erforderlich' } },
          ]);
        }
      }
    } finally {
      await app.close();
    }
  });

  test('die oeffentlichen Routen bleiben ohne Anmeldung erreichbar und lesen hoechstens 64 KiB (E4)', async () => {
    const app = createFastifyServer({ ports: makePorts() });
    try {
      for (const [method, url] of [
        ['POST', '/api/v1/auth/login'],
        ['POST', '/api/v1/auth/refresh'],
        ['POST', '/api/v1/auth/logout'],
        ['POST', '/api/v1/auth/initial-setup'],
        ['POST', '/api/v1/auth/captcha-verify'],
        ['POST', '/api/v1/auth/mfa/verify'],
        ['POST', '/api/v1/auth/invitations/tok123/accept'],
        ['POST', '/api/v1/portal/returns/tok123'],
      ] as const) {
        // Ungueltiges JSON erreicht den Parser (400) — der Body wird also gelesen.
        const parsed = await app.inject({ method, url, headers: jsonHeaders(), payload: brokenJson(10) });
        expect([method, url, parsed.statusCode]).toEqual([method, url, 400]);

        const tooLarge = await app.inject({ method, url, headers: jsonHeaders(), payload: objectArrayJson(64 * 1024 + 16) });
        expect([method, url, tooLarge.statusCode, tooLarge.json().code]).toEqual([method, url, 413, 'FST_ERR_CTP_BODY_TOO_LARGE']);
      }

      // Unter der Grenze kommt der Body beim Dispatcher an.
      const refresh = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/refresh',
        headers: jsonHeaders(),
        payload: JSON.stringify({ padding: 'x'.repeat(60 * 1024) }),
      });
      expect([refresh.statusCode, refresh.json().error.code]).toEqual([401, 'refresh_cookie_required']);

      for (const url of ['/api/v1/auth/login-config', '/api/v1/auth/setup-state', '/api/v1/health']) {
        const response = await app.inject({ method: 'GET', url });
        expect([url, response.json().error?.code]).not.toEqual([url, 'unauthorized']);
      }
    } finally {
      await app.close();
    }
  });

  test('angemeldete Auth-, Portal- und Webhook-Routen lesen hoechstens 64 KiB (E4)', async () => {
    const resolvePrincipal = jest.fn(() => OWNER);
    const app = createFastifyServer({ ports: makePorts(), resolvePrincipal });
    try {
      for (const [method, url] of [
        ['POST', '/api/v1/auth/users'],
        ['PATCH', '/api/v1/auth/security-settings'],
        ['POST', '/api/v1/workflows/webhook/incoming'],
        ['POST', '/api/v1/webhooks/incoming'],
      ] as const) {
        const tooLarge = await app.inject({ method, url, headers: jsonHeaders(), payload: objectArrayJson(64 * 1024 + 16) });
        expect([method, url, tooLarge.statusCode]).toEqual([method, url, 413]);

        const fits = await app.inject({
          method,
          url,
          headers: jsonHeaders(),
          payload: JSON.stringify({ body: { padding: 'x'.repeat(60 * 1024) } }),
        });
        expect([method, url, fits.statusCode === 413]).toEqual([method, url, false]);
      }

      // Gewoehnliche Routen behalten 1 MiB, und der vorgezogene Principal wird
      // wiederverwendet statt ein zweites Mal aufgeloest.
      resolvePrincipal.mockClear();
      const ordinary = await app.inject({
        method: 'POST',
        url: '/api/v1/customers',
        headers: jsonHeaders(),
        payload: JSON.stringify({ name: 'x'.repeat(512 * 1024) }),
      });
      expect(ordinary.statusCode).not.toBe(413);
      expect(resolvePrincipal).toHaveBeenCalledTimes(1);
    } finally {
      await app.close();
    }
  });
});
