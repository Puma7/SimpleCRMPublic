import {
  MAIL_PERMISSIONS,
  MAIL_PERMISSION_PROFILES,
} from '../../packages/core/src/email';

describe('mail permissions', () => {
  test('defines unique permission keys', () => {
    expect(MAIL_PERMISSIONS).toEqual([
      'mail.metadata.read',
      'mail.content.read',
      'mail.attachment.read',
      'mail.attachment.suspicious_download',
      'mail.triage',
      'mail.comment',
      'mail.draft.create',
      'mail.draft.edit',
      'mail.send',
      'mail.send_as',
      'mail.delete',
      'mail.export',
      'mail.account.manage',
      'mail.delegation.manage',
    ]);
    expect(new Set(MAIL_PERMISSIONS).size).toBe(MAIL_PERMISSIONS.length);
  });

  test('expands each profile to an immutable permission set', () => {
    expect(MAIL_PERMISSION_PROFILES).toEqual({
      viewer: [
        'mail.metadata.read',
        'mail.content.read',
        'mail.attachment.read',
      ],
      triage: [
        'mail.metadata.read',
        'mail.content.read',
        'mail.attachment.read',
        'mail.triage',
        'mail.comment',
      ],
      editor: [
        'mail.metadata.read',
        'mail.content.read',
        'mail.attachment.read',
        'mail.triage',
        'mail.comment',
        'mail.draft.create',
        'mail.draft.edit',
      ],
      sender: [
        'mail.metadata.read',
        'mail.content.read',
        'mail.attachment.read',
        'mail.triage',
        'mail.comment',
        'mail.draft.create',
        'mail.draft.edit',
        'mail.send',
      ],
      manager: MAIL_PERMISSIONS,
    });
    expect(Object.isFrozen(MAIL_PERMISSION_PROFILES)).toBe(true);
    for (const permissions of Object.values(MAIL_PERMISSION_PROFILES)) {
      expect(Object.isFrozen(permissions)).toBe(true);
    }
  });

  test('reserves alias, account, and delegation administration for managers', () => {
    const restrictedPermissions = [
      'mail.send_as',
      'mail.account.manage',
      'mail.delegation.manage',
    ];

    for (const [profile, permissions] of Object.entries(MAIL_PERMISSION_PROFILES)) {
      if (profile === 'manager') continue;
      for (const permission of restrictedPermissions) {
        expect(permissions).not.toContain(permission);
      }
    }

    // Only managers are deliberately granted these high-impact permissions.
    expect(MAIL_PERMISSION_PROFILES.manager).toEqual(
      expect.arrayContaining(restrictedPermissions),
    );
  });
});
