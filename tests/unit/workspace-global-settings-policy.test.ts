import { createServerApi } from '../../packages/server/src/api/server-api';
import type { ServerApiPorts } from '../../packages/server/src/api/types';
import { MailAccessDeniedError } from '../../packages/server/src/mail-access/service';

const WORKSPACE = '11111111-1111-4111-8111-111111111111';

/**
 * Workspace-globale Mail-EINSTELLUNGEN sind Konfiguration, keine Postfachdaten.
 * Ihre Schreibpfade an eine Mail-Delegation zu binden vermengte zwei
 * unabhaengige Berechtigungssysteme: ein reiner Einstellungsverwalter
 * (settings.manage, aber kein einziges freigegebenes Postfach) konnte weder das
 * Anhanglimit noch die Snooze-Zeiten noch die Antwortvorschlaege aendern — die
 * Mail-Policy lehnte schon vor dem Handler ab.
 *
 * Die drei PATCHes sind deshalb vom Mail-Gate ausgenommen. Das WEITET nur: alle
 * drei Handler rufen rejectUnlessSettingsManage, bevor sie irgendetwas
 * schreiben, ein Mail-Delegierter ohne diese Stufe kam also ohnehin nicht durch.
 * Die zugehoerigen GETs bleiben am Mail-Gate.
 */
describe('workspace-global mail settings policy', () => {
  const settingsManager = {
    userId: 'user-settings',
    workspaceId: WORKSPACE,
    role: 'user' as const,
    capabilities: ['settings.view', 'settings.manage'],
  };
  const settingsReader = {
    userId: 'user-reader',
    workspaceId: WORKSPACE,
    role: 'user' as const,
    capabilities: ['settings.view'],
  };

  const values = new Map<string, string | null>([
    ['email_max_attachment_mb', '25'],
    ['snooze_default_times_v1', null],
  ]);
  const setCalls: unknown[] = [];

  /** Verweigert JEDE Mail-Berechtigung — der Nutzer hat kein Postfach. */
  const makeApi = () => createServerApi({
    syncInfo: {
      async getMany(input: { keys: readonly string[] }) {
        return input.keys.map((key) => ({ key, value: values.get(key) ?? null }));
      },
      async setMany(input: unknown) {
        setCalls.push(input);
      },
    },
    mailAccess: {
      async assertPermission() {
        throw new MailAccessDeniedError('mail.metadata.read');
      },
      async resolveScope() {
        return { kind: 'none' };
      },
    },
    mailResourceLookup: {
      async resolve() {
        return [];
      },
    },
    audit: { async record() {} },
  } as unknown as ServerApiPorts);

  beforeEach(() => {
    setCalls.length = 0;
  });

  const writePaths = [
    ['/api/v1/email/settings/snooze', {
      eveningHour: 18,
      eveningMinute: 0,
      morningHour: 9,
      morningMinute: 5,
      nextWeekWeekday: 1,
      nextWeekHour: 9,
      nextWeekMinute: 30,
    }],
    ['/api/v1/email/settings/misc', { maxAttachmentMb: '30' }],
    ['/api/v1/email/settings/reply-suggestion', { autoEnabled: false }],
  ] as const;

  test('a settings manager without any mailbox may write all three', async () => {
    const api = makeApi();
    for (const [path, body] of writePaths) {
      const res = await api.handle({ method: 'PATCH', path, body, principal: settingsManager });
      expect({ path, status: res.status }).toEqual({ path, status: 200 });
    }
    expect(setCalls).toHaveLength(writePaths.length);
  });

  test('settings.view alone is still not enough to write', async () => {
    // Die Ausnahme betrifft NUR das Mail-Gate. Das Capability-Gate im Handler
    // bleibt die eigentliche Autorisierung.
    const api = makeApi();
    for (const [path, body] of writePaths) {
      const res = await api.handle({ method: 'PATCH', path, body, principal: settingsReader });
      expect({ path, status: res.status }).toEqual({ path, status: 403 });
    }
    expect(setCalls).toEqual([]);
  });

  test('the matching reads stay behind the mail gate', async () => {
    // Bewusst nicht mit ausgenommen: die GETs liefern Postfach-nahe Daten und
    // haengen weiter an mail.metadata.read.
    const api = makeApi();
    const misc = await api.handle({
      method: 'GET',
      path: '/api/v1/email/settings/misc',
      principal: settingsManager,
    });
    // Der Enforcer antwortet auf eine verweigerte Mail-Ressource bewusst mit
    // 404 statt 403, um die Existenz nicht zu verraten.
    expect({ status: misc.status, code: (misc.body as { error?: { code?: string } }).error?.code })
      .toEqual({ status: 404, code: 'mail_resource_not_found' });
  });

  test('a per-account reply-suggestion write still needs mail.account.manage on that account', async () => {
    // Die Ausnahme gilt dem WORKSPACE-GLOBALEN Fall. Mit einer accountId im Body
    // ist der Schreibzugriff postfachbezogen — vorher erzwang das
    // optionalAccount('body') im Manifest, und der Handler selbst prueft die
    // accountId nirgends. Ohne diese Pruefung koennte jeder settings.manage-
    // Halter die KI-Antwortvorschlaege JEDES Postfachs umschreiben.
    const api = makeApi();
    const res = await api.handle({
      method: 'PATCH',
      path: '/api/v1/email/settings/reply-suggestion',
      body: { accountId: 7, autoEnabled: false },
      principal: settingsManager,
    });
    expect({ status: res.status, code: (res.body as { error?: { code?: string } }).error?.code })
      .toEqual({ status: 404, code: 'mail_resource_not_found' });
    expect(setCalls).toEqual([]);
  });

  test('an unauthenticated write is rejected before the handler', async () => {
    const api = makeApi();
    const res = await api.handle({
      method: 'PATCH',
      path: '/api/v1/email/settings/snooze',
      body: { eveningHour: 18 },
    });
    expect(res.status).toBe(401);
    expect(setCalls).toEqual([]);
  });
});
