export const AUTH_SECURITY_SYNC_KEYS = {
  captchaEnabled: 'auth_security_captcha_enabled',
  pinKeypadEnabled: 'auth_security_pin_keypad_enabled',
  mfaEnabled: 'auth_security_mfa_enabled',
  mfaTotpEnabled: 'auth_security_mfa_totp_enabled',
  mfaEmailEnabled: 'auth_security_mfa_email_enabled',
} as const;

export type AuthSecurityWorkspaceSettings = {
  captchaEnabled: boolean;
  pinKeypadEnabled: boolean;
  mfaEnabled: boolean;
  mfaTotpEnabled: boolean;
  mfaEmailEnabled: boolean;
};

export type AuthMfaMethod = 'totp' | 'email';

export const DEFAULT_AUTH_SECURITY_WORKSPACE_SETTINGS: AuthSecurityWorkspaceSettings = {
  captchaEnabled: false,
  pinKeypadEnabled: false,
  mfaEnabled: false,
  mfaTotpEnabled: true,
  mfaEmailEnabled: false,
};

export function parseAuthSecuritySyncValues(
  values: Record<string, string | null | undefined>,
): AuthSecurityWorkspaceSettings {
  return {
    captchaEnabled: parseSyncFlag(values[AUTH_SECURITY_SYNC_KEYS.captchaEnabled]),
    pinKeypadEnabled: parseSyncFlag(values[AUTH_SECURITY_SYNC_KEYS.pinKeypadEnabled]),
    mfaEnabled: parseSyncFlag(values[AUTH_SECURITY_SYNC_KEYS.mfaEnabled]),
    mfaTotpEnabled: parseSyncFlag(values[AUTH_SECURITY_SYNC_KEYS.mfaTotpEnabled], true),
    mfaEmailEnabled: parseSyncFlag(values[AUTH_SECURITY_SYNC_KEYS.mfaEmailEnabled]),
  };
}

export function serializeAuthSecuritySyncValues(
  settings: AuthSecurityWorkspaceSettings,
): Record<string, string> {
  return {
    [AUTH_SECURITY_SYNC_KEYS.captchaEnabled]: settings.captchaEnabled ? 'true' : 'false',
    [AUTH_SECURITY_SYNC_KEYS.pinKeypadEnabled]: settings.pinKeypadEnabled ? 'true' : 'false',
    [AUTH_SECURITY_SYNC_KEYS.mfaEnabled]: settings.mfaEnabled ? 'true' : 'false',
    [AUTH_SECURITY_SYNC_KEYS.mfaTotpEnabled]: settings.mfaTotpEnabled ? 'true' : 'false',
    [AUTH_SECURITY_SYNC_KEYS.mfaEmailEnabled]: settings.mfaEmailEnabled ? 'true' : 'false',
  };
}

function parseSyncFlag(value: string | null | undefined, defaultValue = false): boolean {
  if (value === undefined || value === null || value.trim() === '') return defaultValue;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return defaultValue;
}
