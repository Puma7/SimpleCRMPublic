import {
  EMPTY_MAIL_PERMISSION_REPORT,
  hasMailPermission,
  hasMailPermissionForAccount,
  parseMailPermissionReport,
} from '@/components/auth/mail-permissions';

/**
 * Die Mail-ACL ist von den Capability-Stufen unabhaengig: `settings.manage`
 * sagt nichts darueber, ob jemand ein Postfach anlegen darf. Ohne diesen
 * Bericht bot der Renderer Konto-, SMTP-, OAuth- und Signatur-Aktionen an, die
 * mail.account.manage verlangen und sonst garantiert im 403 enden.
 */
describe('client mail permissions', () => {
  const server = (report = EMPTY_MAIL_PERMISSION_REPORT, ready = true) => ({
    serverClientMode: true,
    ready,
    report,
  });

  test('a delegate holds only what the report lists', () => {
    const context = server({
      unrestricted: false,
      permissions: ['mail.metadata.read', 'mail.triage'],
      accountPermissions: { '3': ['mail.metadata.read', 'mail.triage'] },
    });
    expect(hasMailPermission(context, 'mail.triage')).toBe(true);
    expect(hasMailPermission(context, 'mail.account.manage')).toBe(false);
  });

  test('unrestricted holders pass everything', () => {
    const context = server({ unrestricted: true, permissions: [], accountPermissions: {} });
    expect(hasMailPermission(context, 'mail.account.manage')).toBe(true);
    expect(hasMailPermissionForAccount(context, 'mail.account.manage', 42)).toBe(true);
  });

  test('per-account questions do not leak across accounts', () => {
    const context = server({
      unrestricted: false,
      permissions: ['mail.account.manage'],
      accountPermissions: { '3': ['mail.account.manage'] },
    });
    // Irgendwo gehalten — aber eben nicht auf Konto 7.
    expect(hasMailPermission(context, 'mail.account.manage')).toBe(true);
    expect(hasMailPermissionForAccount(context, 'mail.account.manage', 3)).toBe(true);
    expect(hasMailPermissionForAccount(context, 'mail.account.manage', 7)).toBe(false);
    expect(hasMailPermissionForAccount(context, 'mail.account.manage', null)).toBe(false);
    // Zahl und String muessen dieselbe Antwort geben — die Antwort kommt als JSON.
    expect(hasMailPermissionForAccount(context, 'mail.account.manage', '3')).toBe(true);
  });

  test('the desktop build has no mail ACL and allows everything', () => {
    expect(hasMailPermission({ ...server(), serverClientMode: false }, 'mail.account.manage')).toBe(true);
    expect(hasMailPermissionForAccount({ ...server(), serverClientMode: false }, 'mail.account.manage', 9)).toBe(true);
  });

  test('nothing is gated while the report is still loading', () => {
    // Sonst blitzen Bedienelemente im ersten Render weg und kommen zurueck.
    const loading = server(EMPTY_MAIL_PERMISSION_REPORT, false);
    expect(hasMailPermission(loading, 'mail.account.manage')).toBe(true);
    expect(hasMailPermissionForAccount(loading, 'mail.account.manage', 3)).toBe(true);
  });

  test('a loaded but empty report gates everything', () => {
    const empty = server(EMPTY_MAIL_PERMISSION_REPORT, true);
    expect(hasMailPermission(empty, 'mail.metadata.read')).toBe(false);
  });

  test('parsing tolerates a malformed payload and fails closed', () => {
    expect(parseMailPermissionReport(null)).toEqual(EMPTY_MAIL_PERMISSION_REPORT);
    expect(parseMailPermissionReport({ permissions: 'nope', accountPermissions: 7 }))
      .toEqual(EMPTY_MAIL_PERMISSION_REPORT);
    expect(parseMailPermissionReport({
      unrestricted: false,
      permissions: ['mail.triage', 42],
      accountPermissions: { '3': ['mail.triage', null], '4': 'nope' },
    })).toEqual({
      unrestricted: false,
      permissions: ['mail.triage'],
      accountPermissions: { '3': ['mail.triage'] },
    });
  });
});
