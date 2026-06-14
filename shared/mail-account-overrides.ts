import { isAllAccountsScope, type MailAccountScope } from './mail-account-scope';

export type AccountOverrideScope = MailAccountScope | null | undefined;
export type AccountOverrideScopePayload =
  | AccountOverrideScope
  | AccountOverrideScopePayloadObject;
type AccountOverrideScopePayloadObject = {
  readonly accountId?: AccountOverrideScope;
  readonly accountScope?: AccountOverrideScope;
};

export type ScopedAccountOverrideRow = {
  id: number;
  account_id: number | null;
  /** Stable functional key shared by a global row and its account-specific override. */
  override_key: string | null;
  sort_order?: number | null;
};

function rowKey(row: ScopedAccountOverrideRow): string {
  return row.override_key && row.override_key.trim() ? row.override_key.trim() : `id:${row.id}`;
}

export function isGlobalAccountOverride(row: ScopedAccountOverrideRow): boolean {
  return row.account_id == null;
}

export function isAccountSpecificOverride(row: ScopedAccountOverrideRow): boolean {
  return row.account_id != null;
}

export function accountOverrideScopeFromPayload(
  payload?: AccountOverrideScopePayload,
): AccountOverrideScope {
  if (isAccountOverrideScopePayloadObject(payload)) {
    return payload.accountId ?? payload.accountScope;
  }
  return payload;
}

function isAccountOverrideScopePayloadObject(
  payload: AccountOverrideScopePayload,
): payload is AccountOverrideScopePayloadObject {
  return payload != null && typeof payload === 'object' && !Array.isArray(payload);
}

/**
 * Returns globally visible rows plus the selected account's overrides.
 * If an account row shares override_key with a global row, the account row replaces it.
 * With `all` scope no account override is applied, keeping the shared inbox globally consistent.
 */
export function resolveScopedAccountOverrides<T extends ScopedAccountOverrideRow>(
  rows: readonly T[],
  scope: AccountOverrideScope,
): T[] {
  const accountId = typeof scope === 'number' && !isAllAccountsScope(scope) ? scope : null;
  const effective = new Map<string, T>();

  for (const row of rows) {
    if (row.account_id == null) effective.set(rowKey(row), row);
  }

  if (accountId != null) {
    for (const row of rows) {
      if (row.account_id === accountId) effective.set(rowKey(row), row);
    }
  }

  return [...effective.values()].sort((a, b) => {
    const ao = a.sort_order ?? 0;
    const bo = b.sort_order ?? 0;
    return ao - bo || a.id - b.id;
  });
}
