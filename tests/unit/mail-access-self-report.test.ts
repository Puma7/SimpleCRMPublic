import { createServerApi } from '../../packages/server/src/api/server-api';
import type { ServerApiPorts } from '../../packages/server/src/api/types';
import { MAIL_PERMISSIONS } from '../../packages/core/src/email/mail-permissions';
import { MailAccessService } from '../../packages/server/src/mail-access/service';

const WORKSPACE = '11111111-1111-4111-8111-111111111111';
const PATH = '/api/v1/email/access/self';

/**
 * Der Renderer kannte die Mail-ACL bisher gar nicht: /email/access/explain ist
 * admin-only und beantwortet ohnehin eine andere Frage (sieht Nutzer X die
 * Nachricht Y?). Also bot die Oberflaeche Bedienelemente an, deren Aufruf
 * garantiert im 403 endet — Konto anlegen/loeschen, SMTP, OAuth, Signaturen.
 *
 * Die Selbstauskunft beschreibt ausschliesslich den anfragenden Nutzer und ist
 * deshalb fuer jeden authentifizierten Principal unbedenklich.
 */
describe('mail access self report', () => {
  const user = { userId: 'user-a', workspaceId: WORKSPACE, role: 'user' as const };

  const makeApi = (resolveSelfPermissions?: unknown) => createServerApi({
    mailAccess: {
      async assertPermission() {},
      async resolveScope() {
        return { kind: 'none' };
      },
      ...(resolveSelfPermissions ? { resolveSelfPermissions } : {}),
    },
    mailResourceLookup: { async resolve() { return []; } },
  } as unknown as ServerApiPorts);

  test('reports the permissions the caller actually holds, per account', async () => {
    const calls: unknown[] = [];
    const api = makeApi(async (input: unknown) => {
      calls.push(input);
      return {
        permissions: ['mail.metadata.read', 'mail.account.manage'],
        accountPermissions: { 3: ['mail.account.manage', 'mail.metadata.read'], 7: ['mail.metadata.read'] },
      };
    });

    const res = await api.handle({ method: 'GET', path: PATH, principal: user });
    expect(res.status).toBe(200);
    expect((res.body as any).data).toEqual({
      role: 'user',
      unrestricted: false,
      permissions: ['mail.metadata.read', 'mail.account.manage'],
      accountPermissions: { 3: ['mail.account.manage', 'mail.metadata.read'], 7: ['mail.metadata.read'] },
    });
    // Ausschliesslich der eigene Nutzer — die Route nimmt keine userId entgegen.
    expect(calls).toEqual([{ workspaceId: WORKSPACE, userId: 'user-a' }]);
  });

  test('owners and admins short-circuit to every permission', async () => {
    // Sie halten implizit alles; die Bindings zu befragen waere sinnlos und
    // wuerde fuer sie ein leeres Ergebnis liefern.
    const resolve = jest.fn();
    const api = makeApi(resolve);
    for (const role of ['owner', 'admin'] as const) {
      const res = await api.handle({
        method: 'GET',
        path: PATH,
        principal: { ...user, role },
      });
      expect((res.body as any).data).toEqual({
        role,
        unrestricted: true,
        permissions: [...MAIL_PERMISSIONS],
        accountPermissions: {},
      });
    }
    expect(resolve).not.toHaveBeenCalled();
  });

  test('fails closed when no mail access port is configured', async () => {
    // Lieber zu wenig anbieten als zu viel: ohne Port meldet die Auskunft keine
    // Rechte, statt den Client raten zu lassen.
    const api = makeApi();
    const res = await api.handle({ method: 'GET', path: PATH, principal: user });
    expect(res.status).toBe(200);
    expect((res.body as any).data).toEqual({
      role: 'user',
      unrestricted: false,
      permissions: [],
      accountPermissions: {},
    });
  });

  test('requires authentication and rejects other methods', async () => {
    const api = makeApi(async () => ({ permissions: [], accountPermissions: {} }));
    expect((await api.handle({ method: 'GET', path: PATH })).status).toBe(401);
    expect((await api.handle({ method: 'PATCH', path: PATH, principal: user })).status).toBe(405);
  });
});

describe('MailAccessService.resolveSelfPermissions', () => {
  test('aggregates grants across permissions into a per-account map', async () => {
    const asked: string[] = [];
    const service = new MailAccessService({
      async resolveGrants({ permission }: { permission: string }) {
        asked.push(permission);
        if (permission === 'mail.metadata.read') {
          return [
            { bindingId: 1, resourceType: 'account', accountId: 7, folderId: null, messageId: null, constraints: null },
            { bindingId: 2, resourceType: 'folder', accountId: 3, folderId: 9, messageId: null, constraints: null },
          ];
        }
        if (permission === 'mail.account.manage') {
          return [{ bindingId: 3, resourceType: 'account', accountId: 3, folderId: null, messageId: null, constraints: null }];
        }
        return [];
      },
    });

    const result = await service.resolveSelfPermissions({ workspaceId: WORKSPACE, userId: 'user-a' });

    expect(result.permissions).toEqual(['mail.account.manage', 'mail.metadata.read']);
    // Nach Konto-Id sortiert, damit die Antwort stabil ist.
    expect(Object.keys(result.accountPermissions)).toEqual(['3', '7']);
    expect(result.accountPermissions[3]).toEqual(['mail.account.manage', 'mail.metadata.read']);
    expect(result.accountPermissions[7]).toEqual(['mail.metadata.read']);
    // Jede bekannte Berechtigung wird genau einmal abgefragt.
    expect(asked).toEqual([...MAIL_PERMISSIONS]);
  });

  test('folder-scoped mail.account.manage does not imply account management', async () => {
    const service = new MailAccessService({
      async resolveGrants({ permission }: { permission: string }) {
        if (permission === 'mail.account.manage') {
          return [{
            bindingId: 4,
            resourceType: 'folder',
            accountId: 3,
            folderId: 9,
            messageId: null,
            constraints: null,
          }];
        }
        return [];
      },
    });

    expect(await service.resolveSelfPermissions({ workspaceId: WORKSPACE, userId: 'user-a' }))
      .toEqual({ permissions: [], accountPermissions: {} });
  });

  test('a user without any binding reports nothing', async () => {
    const service = new MailAccessService({ async resolveGrants() { return []; } });
    expect(await service.resolveSelfPermissions({ workspaceId: WORKSPACE, userId: 'user-a' }))
      .toEqual({ permissions: [], accountPermissions: {} });
  });
});
