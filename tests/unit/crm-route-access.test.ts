import {
  CRM_ROUTE_PREFIXES,
  isCrmRouteBlocked,
  isCrmRoutePath,
} from '@/components/crm-route-access';

/**
 * Gegenstueck zum serverseitigen crm.read-Gate: ohne das Recht liefert JEDER
 * CRM-Pfad 403. Die Navigation und die Befehlspalette duerfen dann nicht mehr
 * dorthin verweisen, und die Seiten selbst muessen einen Hinweis statt einer
 * Fehlerkaskade zeigen.
 */
describe('crm route access', () => {
  const blocked = {
    serverClientMode: true,
    capabilitiesReady: true,
    canReadCrm: false,
  };

  test('the dashboard counts as a CRM route — it aggregates customers and tasks', () => {
    expect(isCrmRoutePath('/')).toBe(true);
    expect(isCrmRouteBlocked('/', blocked)).toBe(true);
  });

  test('every listed prefix matches itself and its detail routes', () => {
    for (const prefix of CRM_ROUTE_PREFIXES) {
      expect({ prefix, crm: isCrmRoutePath(prefix) }).toEqual({ prefix, crm: true });
      expect({ prefix, crm: isCrmRoutePath(`${prefix}/42`) }).toEqual({ prefix, crm: true });
    }
  });

  test('mail and settings are not CRM routes', () => {
    for (const path of ['/email', '/email/workflows', '/email/settings', '/settings', '/login']) {
      expect({ path, crm: isCrmRoutePath(path) }).toEqual({ path, crm: false });
    }
  });

  test('a prefix must not match a longer sibling segment', () => {
    // /customers darf nicht /customers-export sperren (und umgekehrt).
    expect(isCrmRoutePath('/customers-export')).toBe(false);
    expect(isCrmRoutePath('/returnsomething')).toBe(false);
  });

  test('the desktop build is never blocked', () => {
    expect(isCrmRouteBlocked('/customers', { ...blocked, serverClientMode: false })).toBe(false);
  });

  test('nothing is blocked while the grants are still loading', () => {
    // Sonst blitzt der Hinweis im ersten Render auf, obwohl das Recht besteht.
    expect(isCrmRouteBlocked('/customers', { ...blocked, capabilitiesReady: false })).toBe(false);
  });

  test('a holder of crm.read passes', () => {
    expect(isCrmRouteBlocked('/customers', { ...blocked, canReadCrm: true })).toBe(false);
  });
});
