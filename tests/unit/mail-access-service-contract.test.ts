import { MailAccessRolloutService } from '../../packages/server/src/mail-access/rollout-service';
import { MailAccessService } from '../../packages/server/src/mail-access/service';

/**
 * Mehrere Methoden des MailAccessService-Contracts sind ABSICHTLICH optional,
 * damit schlanke Test-Doubles ihn erfuellen. Der Preis: `implements
 * MailAccessService` erzwingt sie nicht mehr — eine Implementierung kann sie
 * stillschweigend weglassen, und der Compiler schweigt.
 *
 * Genau das ist passiert: `resolveSelfPermissions` existierte nur auf
 * MailAccessService, nicht auf der MailAccessRolloutService, die in der
 * Produktion als ports.mailAccess haengt. GET /email/access/self lief damit in
 * seinen Fail-closed-Zweig und meldete jedem Delegierten „keine Rechte" — die
 * Oberflaeche verbarg genau die Aktionen, die er ausfuehren durfte.
 *
 * Dieser Test haelt beide Implementierungen deckungsgleich. Wer dem Contract
 * eine optionale Methode hinzufuegt, muss sie hier eintragen ODER bewusst
 * begruenden, warum die Rollout-Variante ohne sie auskommt.
 */
describe('mail access service contract', () => {
  /** In der Produktion tatsaechlich aufgerufen — nicht bloss deklariert. */
  const REQUIRED_IN_PRODUCTION = [
    'assertPermission',
    'resolveScope',
    'resolveGroupPeerUserIds',
    'resolveConstraintSubjectUserIds',
    'resolveSelfPermissions',
    'explainMessageVisibility',
  ] as const;

  const implementsAll = (instance: object) =>
    REQUIRED_IN_PRODUCTION.filter(
      (method) => typeof (instance as Record<string, unknown>)[method] !== 'function',
    );

  const port = {
    async resolveGrants() {
      return [];
    },
  };

  test('the rollout service used in production implements every required method', () => {
    const rollout = new MailAccessRolloutService({
      state: {} as never,
      legacy: {} as never,
      newAcl: port as never,
    });
    expect(implementsAll(rollout)).toEqual([]);
  });

  test('the plain service implements them too', () => {
    expect(implementsAll(new MailAccessService(port as never))).toEqual([]);
  });

  test('the rollout service resolves self permissions through the new ACL', async () => {
    // Wie die Sichtbarkeitsfilter: die eigenen Rechte stammen immer aus der
    // NEUEN ACL, auch im Shadow-Modus — die Auskunft beschreibt, was nach dem
    // Rollout gilt.
    const asked: string[] = [];
    const rollout = new MailAccessRolloutService({
      // Nach dem Rollout (enforce) entscheidet allein die neue ACL.
      state: { async getState() { return { mode: 'enforce', diagnostic: null }; } } as never,
      legacy: {} as never,
      newAcl: {
        async resolveGrants({ permission }: { permission: string }) {
          asked.push(permission);
          return permission === 'mail.account.manage'
            ? [{ bindingId: 1, resourceType: 'account', accountId: 5, folderId: null, messageId: null, constraints: null }]
            : [];
        },
      } as never,
    });

    const result = await rollout.resolveSelfPermissions({
      workspaceId: '11111111-1111-4111-8111-111111111111',
      userId: 'user-a',
    });

    expect(result).toEqual({
      permissions: ['mail.account.manage'],
      accountPermissions: { 5: ['mail.account.manage'] },
    });
    expect(asked.length).toBeGreaterThan(1);
  });

  test('in shadow mode the report is intersected with the legacy account scope', async () => {
    // Im Shadow-Modus lautet die tatsaechliche Entscheidung
    // `legacyAllowed && (!enforceConstraints || newAllowed)`. Nur die neue ACL
    // zu melden liesse den Renderer bei legacyDenyNewAllow Bedienelemente
    // anbieten, die sicher scheitern.
    const rollout = new MailAccessRolloutService({
      state: { async getState() { return { mode: 'shadow', diagnostic: null }; } } as never,
      legacy: {
        // Legacy erlaubt nur Konto 5, nicht Konto 9.
        async resolveAccountScope() { return [5]; },
      } as never,
      newAcl: {
        async resolveGrants({ permission }: { permission: string }) {
          if (permission !== 'mail.account.manage') return [];
          return [
            { bindingId: 1, resourceType: 'account', accountId: 5, folderId: null, messageId: null, constraints: null },
            { bindingId: 2, resourceType: 'account', accountId: 9, folderId: null, messageId: null, constraints: null },
          ];
        },
      } as never,
    });

    const result = await rollout.resolveSelfPermissions({
      workspaceId: '11111111-1111-4111-8111-111111111111',
      userId: 'user-a',
    });

    // Konto 9 faellt raus: die neue ACL erlaubt es, die alte nicht — der Server
    // wuerde im Shadow-Modus ablehnen.
    expect(result.accountPermissions).toEqual({ 5: ['mail.account.manage'] });
  });
});
