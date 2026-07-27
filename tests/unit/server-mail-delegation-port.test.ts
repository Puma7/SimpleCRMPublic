import type { MailPermission } from '../../packages/core/src/email/mail-permissions';
import {
  createPostgresMailDelegationPort,
} from '../../packages/server/src/mail-access/postgres-mail-delegation-port';

const WORKSPACE = '11111111-1111-4111-8111-111111111111';
const ACTOR = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const AGENT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

describe('createPostgresMailDelegationPort', () => {
  test('uses a workspace-bound transaction for binding replacement', async () => {
    const contexts: unknown[] = [];
    const trx = createDelegationTransaction({
      actor: { id: ACTOR, role: 'admin', disabled_at: null },
      subject: { id: AGENT, display_name: 'Agent', role: 'user', disabled_at: null },
      account: { id: 101, display_name: 'Support' },
      folder: null,
      existingBinding: null,
      affectedUsers: [{ id: AGENT }],
    });
    const db = {
      transaction: () => ({ execute: async (operation: (transaction: typeof trx) => unknown) => operation(trx) }),
    };
    const port = createPostgresMailDelegationPort({
      db: db as never,
      applyWorkspaceSession: async (_trx, command) => {
        contexts.push(command.params);
      },
    });

    const result = await port.replaceBinding({
      workspaceId: WORKSPACE,
      actor: { userId: ACTOR, isOwner: false, isAdmin: true },
      subject: { type: 'user', id: AGENT },
      resource: { type: 'account', accountId: 101 },
      permissions: ['mail.metadata.read'],
    });

    expect(result).toMatchObject({ ok: true, affectedUserIds: [AGENT] });
    expect(contexts).toEqual([[WORKSPACE, ACTOR, 'admin', 'off']]);
    expect(trx.calls).toEqual(expect.arrayContaining([
      ['deleteFrom', 'mail_acl_binding_permissions'],
      ['insertInto', 'mail_acl_bindings'],
      ['insertInto', 'mail_acl_binding_permissions'],
    ]));
  });

  test('validates active same-workspace subjects and folder-account consistency before persisting', async () => {
    const trx = createDelegationTransaction({
      actor: { id: ACTOR, role: 'admin', disabled_at: null },
      subject: null,
      account: { id: 101, display_name: 'Support' },
      folder: { id: 202, account_id: 999, path: 'INBOX' },
      existingBinding: null,
      affectedUsers: [],
    });
    const db = {
      transaction: () => ({ execute: async (operation: (transaction: typeof trx) => unknown) => operation(trx) }),
    };
    const port = createPostgresMailDelegationPort({ db: db as never, applyWorkspaceSession: async () => {} });

    await expect(port.replaceBinding({
      workspaceId: WORKSPACE,
      actor: { userId: ACTOR, isOwner: false, isAdmin: true },
      subject: { type: 'user', id: AGENT },
      resource: { type: 'folder', accountId: 101, folderId: 202 },
      permissions: ['mail.metadata.read'],
    })).resolves.toEqual({ ok: false, code: 'subject_not_found' });

    expect(trx.calls).not.toContainEqual(['insertInto', 'mail_acl_bindings']);
  });

  test('blocks delegated managers from granting permissions they do not hold', async () => {
    const trx = createDelegationTransaction({
      actor: { id: ACTOR, role: 'user', disabled_at: null },
      subject: { id: AGENT, display_name: 'Agent', role: 'user', disabled_at: null },
      account: { id: 101, display_name: 'Support' },
      folder: null,
      existingBinding: null,
      affectedUsers: [{ id: AGENT }],
      actorPermissions: ['mail.delegation.manage', 'mail.metadata.read'],
    });
    const db = {
      transaction: () => ({ execute: async (operation: (transaction: typeof trx) => unknown) => operation(trx) }),
    };
    const port = createPostgresMailDelegationPort({ db: db as never, applyWorkspaceSession: async () => {} });

    await expect(port.replaceBinding({
      workspaceId: WORKSPACE,
      actor: { userId: ACTOR, isOwner: false, isAdmin: false },
      subject: { type: 'user', id: AGENT },
      resource: { type: 'account', accountId: 101 },
      permissions: ['mail.metadata.read', 'mail.send'],
    })).resolves.toEqual({ ok: false, code: 'privilege_escalation' });
  });

  test('bounds re-delegation by the actor\'s own manage-grant filters', async () => {
    // Manage nur fuer Kategorie 5 (Binding 501), metadata.read dagegen
    // unbeschraenkt (Binding 502). Ohne die Verwaltungs-Autoritaet koennte der
    // Manager ein Binding ohne jeden Filter vergeben und damit mehr verteilen,
    // als er verwalten darf.
    const fixtures = {
      actor: { id: ACTOR, role: 'user', disabled_at: null },
      subject: { id: AGENT, display_name: 'Agent', role: 'user', disabled_at: null },
      account: { id: 101, display_name: 'Support' },
      folder: null,
      existingBinding: null,
      affectedUsers: [{ id: AGENT }],
      actorPermissionBindings: [
        { bindingId: 501, permission: 'mail.delegation.manage' as const },
        { bindingId: 502, permission: 'mail.metadata.read' as const },
      ],
      actorAuthorityConstraints: [{
        binding_id: 501,
        kind: 'category',
        mode: 'allow',
        assignment_mode: null,
        value_ids: [5],
        value_texts: null,
      }],
    };
    const portFor = (trx: ReturnType<typeof createDelegationTransaction>) => createPostgresMailDelegationPort({
      db: { transaction: () => ({ execute: async (operation: (t: typeof trx) => unknown) => operation(trx) }) } as never,
      applyWorkspaceSession: async () => {},
    });

    const unfiltered = createDelegationTransaction(fixtures);
    await expect(portFor(unfiltered).replaceBinding({
      workspaceId: WORKSPACE,
      actor: { userId: ACTOR, isOwner: false, isAdmin: false },
      subject: { type: 'user', id: AGENT },
      resource: { type: 'account', accountId: 101 },
      permissions: ['mail.metadata.read'],
      constraints: null,
    })).resolves.toEqual({ ok: false, code: 'privilege_escalation' });

    const withinManageScope = createDelegationTransaction(fixtures);
    await expect(portFor(withinManageScope).replaceBinding({
      workspaceId: WORKSPACE,
      actor: { userId: ACTOR, isOwner: false, isAdmin: false },
      subject: { type: 'user', id: AGENT },
      resource: { type: 'account', accountId: 101 },
      permissions: ['mail.metadata.read'],
      constraints: {
        assignmentMode: null,
        categoryAllowIds: [5],
        categoryExcludeIds: [],
        tagAllowValues: [],
        tagExcludeValues: [],
      },
    })).resolves.toMatchObject({ ok: true });

    // Das kumulative Budget wird unter einer Advisory-Sperre AUF DAS SUBJEKT
    // geprueft. FOR UPDATE auf die gefundenen Bindings genuegte nicht: es nimmt
    // keine Luecken-Sperre und sperrt bei einem Subjekt ohne Bindings gar
    // nichts, sodass zwei parallele Creates beide unter dem Budget landen
    // koennten.
    expect(withinManageScope.calls).toContainEqual(
      ['sql', expect.stringContaining('pg_advisory_xact_lock')],
    );
  });

  test('rejects a visibility filter that names an unknown category', async () => {
    // Eine Id aus einem fremden Workspace (oder eine geloeschte) wuerde
    // gespeichert, faende aber nie eine email_message_categories-Zeile: der
    // Ausschlussfilter liesse dann JEDE Nachricht durch.
    const trx = createDelegationTransaction({
      actor: { id: ACTOR, role: 'admin', disabled_at: null },
      subject: { id: AGENT, display_name: 'Agent', role: 'user', disabled_at: null },
      account: { id: 101, display_name: 'Support' },
      folder: null,
      existingBinding: null,
      affectedUsers: [{ id: AGENT }],
      unknownCategoryIds: [4242],
    });
    const port = createPostgresMailDelegationPort({
      db: { transaction: () => ({ execute: async (operation: (t: typeof trx) => unknown) => operation(trx) }) } as never,
      applyWorkspaceSession: async () => {},
    });

    await expect(port.replaceBinding({
      workspaceId: WORKSPACE,
      actor: { userId: ACTOR, isOwner: false, isAdmin: true },
      subject: { type: 'user', id: AGENT },
      resource: { type: 'account', accountId: 101 },
      permissions: ['mail.metadata.read'],
      constraints: {
        assignmentMode: null,
        categoryAllowIds: [],
        categoryExcludeIds: [4242],
        tagAllowValues: [],
        tagExcludeValues: [],
      },
    })).resolves.toMatchObject({ ok: false, code: 'category_not_found' });

    // Die Existenzpruefung sperrt die Kategoriezeilen mit FOR SHARE. Ohne diese
    // Sperre waere sie rein zeitpunktbezogen: value_ids hat keinen
    // Fremdschluessel, ein paralleles Loeschen der Kategorie koennte direkt nach
    // der Pruefung committen und liesse einen ins Leere zeigenden — und damit
    // wirkungslosen — Ausschlussfilter zurueck.
    expect(trx.calls).toContainEqual(['forShare', 'email_categories']);
  });

  test('a constrained manager cannot delete a binding beyond its own authority', async () => {
    // Der Loeschpfad hat keinen Zielzustand zum Vergleichen — geprueft wird das
    // BESTEHENDE Binding: wer nur fuer Kategorie X verwalten darf, soll die
    // unbeschraenkte Delegation eines fremden Teams nicht widerrufen koennen.
    const trx = createDelegationTransaction({
      actor: { id: ACTOR, role: 'user', disabled_at: null },
      subject: { id: AGENT, display_name: 'Agent', role: 'user', disabled_at: null },
      account: { id: 101, display_name: 'Support' },
      folder: null,
      existingBinding: {
        id: 901,
        workspace_id: WORKSPACE,
        subject_type: 'user',
        subject_id: AGENT,
        resource_type: 'account',
        account_id: 101,
        folder_id: null,
        message_id: null,
        updated_at: new Date('2026-07-19T12:00:00.000Z'),
      },
      affectedUsers: [{ id: AGENT }],
      actorPermissionBindings: [
        { bindingId: 501, permission: 'mail.delegation.manage' as const },
        { bindingId: 502, permission: 'mail.metadata.read' as const },
      ],
      actorAuthorityConstraints: [{
        binding_id: 501,
        kind: 'category',
        mode: 'allow',
        assignment_mode: null,
        value_ids: [5],
        value_texts: null,
      }],
    });
    const port = createPostgresMailDelegationPort({
      db: { transaction: () => ({ execute: async (operation: (t: typeof trx) => unknown) => operation(trx) }) } as never,
      applyWorkspaceSession: async () => {},
    });

    await expect(port.replaceBinding({
      workspaceId: WORKSPACE,
      actor: { userId: ACTOR, isOwner: false, isAdmin: false },
      subject: { type: 'user', id: AGENT },
      resource: { type: 'account', accountId: 101 },
      permissions: [],
    })).resolves.toMatchObject({ ok: false, code: 'privilege_escalation' });
  });

  test('the dedicated DELETE route enforces the same manage authority', async () => {
    // Sonst weicht ein eingeschraenkter Manager der PATCH-Pruefung einfach ueber
    // DELETE /email/access/bindings/:id aus.
    const trx = createDelegationTransaction({
      actor: { id: ACTOR, role: 'user', disabled_at: null },
      subject: { id: AGENT, display_name: 'Agent', role: 'user', disabled_at: null },
      account: { id: 101, display_name: 'Support' },
      folder: null,
      existingBinding: {
        id: 901,
        workspace_id: WORKSPACE,
        subject_type: 'user',
        subject_id: AGENT,
        resource_type: 'account',
        account_id: 101,
        folder_id: null,
        message_id: null,
        updated_at: new Date('2026-07-19T12:00:00.000Z'),
      },
      affectedUsers: [{ id: AGENT }],
      actorPermissionBindings: [
        { bindingId: 501, permission: 'mail.delegation.manage' as const },
      ],
      actorAuthorityConstraints: [{
        binding_id: 501,
        kind: 'category',
        mode: 'allow',
        assignment_mode: null,
        value_ids: [5],
        value_texts: null,
      }],
    });
    const port = createPostgresMailDelegationPort({
      db: { transaction: () => ({ execute: async (operation: (t: typeof trx) => unknown) => operation(trx) }) } as never,
      applyWorkspaceSession: async () => {},
    });

    await expect(port.deleteBinding({
      workspaceId: WORKSPACE,
      actor: { userId: ACTOR, isOwner: false, isAdmin: false },
      bindingId: 901,
    })).resolves.toMatchObject({ ok: false, code: 'privilege_escalation' });
  });

  test('a constrained manager may delete a binding inside its authority', async () => {
    // Kein Ueberschiessen: dasselbe Filterprofil wie die eigene Autoritaet.
    const constraintRows = [{
      binding_id: 501,
      kind: 'category',
      mode: 'allow',
      assignment_mode: null,
      value_ids: [5],
      value_texts: null,
    }];
    const trx = createDelegationTransaction({
      actor: { id: ACTOR, role: 'user', disabled_at: null },
      subject: { id: AGENT, display_name: 'Agent', role: 'user', disabled_at: null },
      account: { id: 101, display_name: 'Support' },
      folder: null,
      existingBinding: {
        id: 901,
        workspace_id: WORKSPACE,
        subject_type: 'user',
        subject_id: AGENT,
        resource_type: 'account',
        account_id: 101,
        folder_id: null,
        message_id: null,
        updated_at: new Date('2026-07-19T12:00:00.000Z'),
      },
      affectedUsers: [{ id: AGENT }],
      actorPermissionBindings: [
        { bindingId: 501, permission: 'mail.delegation.manage' as const },
        { bindingId: 502, permission: 'mail.metadata.read' as const },
      ],
      actorAuthorityConstraints: constraintRows,
      existingConstraints: [{ ...constraintRows[0]!, binding_id: 901 }],
    });
    const port = createPostgresMailDelegationPort({
      db: { transaction: () => ({ execute: async (operation: (t: typeof trx) => unknown) => operation(trx) }) } as never,
      applyWorkspaceSession: async () => {},
    });

    await expect(port.replaceBinding({
      workspaceId: WORKSPACE,
      actor: { userId: ACTOR, isOwner: false, isAdmin: false },
      subject: { type: 'user', id: AGENT },
      resource: { type: 'account', accountId: 101 },
      permissions: [],
    })).resolves.toMatchObject({ ok: true, deleted: true });
  });

  test('an admin deletes any binding regardless of constraints', async () => {
    const trx = createDelegationTransaction({
      actor: { id: ACTOR, role: 'admin', disabled_at: null },
      subject: { id: AGENT, display_name: 'Agent', role: 'user', disabled_at: null },
      account: { id: 101, display_name: 'Support' },
      folder: null,
      existingBinding: {
        id: 901,
        workspace_id: WORKSPACE,
        subject_type: 'user',
        subject_id: AGENT,
        resource_type: 'account',
        account_id: 101,
        folder_id: null,
        message_id: null,
        updated_at: new Date('2026-07-19T12:00:00.000Z'),
      },
      affectedUsers: [{ id: AGENT }],
    });
    const port = createPostgresMailDelegationPort({
      db: { transaction: () => ({ execute: async (operation: (t: typeof trx) => unknown) => operation(trx) }) } as never,
      applyWorkspaceSession: async () => {},
    });

    await expect(port.replaceBinding({
      workspaceId: WORKSPACE,
      actor: { userId: ACTOR, isOwner: false, isAdmin: true },
      subject: { type: 'user', id: AGENT },
      resource: { type: 'account', accountId: 101 },
      permissions: [],
    })).resolves.toMatchObject({ ok: true, deleted: true });
  });

  test('blocks non-admin re-delegation of relative assignment modes onto other subjects', async () => {
    const trx = createDelegationTransaction({
      actor: { id: ACTOR, role: 'user', disabled_at: null },
      subject: { id: AGENT, display_name: 'Agent', role: 'user', disabled_at: null },
      account: { id: 101, display_name: 'Support' },
      folder: null,
      existingBinding: null,
      affectedUsers: [{ id: AGENT }],
      actorPermissions: ['mail.delegation.manage', 'mail.metadata.read'],
      actorAuthorityConstraints: [{
        binding_id: 501,
        kind: 'assignment',
        mode: 'filter',
        assignment_mode: 'assigned_to_me',
        value_ids: null,
        value_texts: null,
      }],
    });
    const db = {
      transaction: () => ({ execute: async (operation: (transaction: typeof trx) => unknown) => operation(trx) }),
    };
    const port = createPostgresMailDelegationPort({ db: db as never, applyWorkspaceSession: async () => {} });

    await expect(port.replaceBinding({
      workspaceId: WORKSPACE,
      actor: { userId: ACTOR, isOwner: false, isAdmin: false },
      subject: { type: 'user', id: AGENT },
      resource: { type: 'account', accountId: 101 },
      permissions: ['mail.metadata.read'],
      constraints: {
        assignmentMode: 'assigned_to_me',
        categoryAllowIds: [],
        categoryExcludeIds: [],
        tagAllowValues: [],
        tagExcludeValues: [],
      },
    })).resolves.toEqual({ ok: false, code: 'privilege_escalation' });
  });

  test('revalidates preserved constraints on permission-only updates', async () => {
    const existingBinding = {
      id: 901,
      workspace_id: WORKSPACE,
      subject_type: 'user' as const,
      subject_id: AGENT,
      resource_type: 'account' as const,
      account_id: 101,
      folder_id: null,
      message_id: null,
      updated_at: '2026-07-20T10:00:00.000Z',
    };
    const trx = createDelegationTransaction({
      actor: { id: ACTOR, role: 'user', disabled_at: null },
      subject: { id: AGENT, display_name: 'Agent', role: 'user', disabled_at: null },
      account: { id: 101, display_name: 'Support' },
      folder: null,
      existingBinding,
      affectedUsers: [{ id: AGENT }],
      actorPermissions: ['mail.delegation.manage', 'mail.metadata.read', 'mail.content.read'],
      actorAuthorityConstraints: [{
        binding_id: 501,
        kind: 'category',
        mode: 'allow',
        assignment_mode: null,
        value_ids: [7],
        value_texts: null,
      }],
      existingConstraints: [], // unconstrained existing target binding
    });
    const db = {
      transaction: () => ({ execute: async (operation: (transaction: typeof trx) => unknown) => operation(trx) }),
    };
    const port = createPostgresMailDelegationPort({ db: db as never, applyWorkspaceSession: async () => {} });

    await expect(port.replaceBinding({
      workspaceId: WORKSPACE,
      actor: { userId: ACTOR, isOwner: false, isAdmin: false },
      subject: { type: 'user', id: AGENT },
      resource: { type: 'account', accountId: 101 },
      permissions: ['mail.metadata.read', 'mail.content.read'],
      // constraints omitted → preserve existing (null) which exceeds category authority
    })).resolves.toEqual({ ok: false, code: 'privilege_escalation' });
  });

  test('blocks permission-only updates that preserve relative modes on other subjects', async () => {
    const existingBinding = {
      id: 901,
      workspace_id: WORKSPACE,
      subject_type: 'user' as const,
      subject_id: AGENT,
      resource_type: 'account' as const,
      account_id: 101,
      folder_id: null,
      message_id: null,
      updated_at: '2026-07-20T10:00:00.000Z',
    };
    const trx = createDelegationTransaction({
      actor: { id: ACTOR, role: 'user', disabled_at: null },
      subject: { id: AGENT, display_name: 'Agent', role: 'user', disabled_at: null },
      account: { id: 101, display_name: 'Support' },
      folder: null,
      existingBinding,
      affectedUsers: [{ id: AGENT }],
      actorPermissions: ['mail.delegation.manage', 'mail.metadata.read', 'mail.content.read'],
      actorAuthorityConstraints: [{
        binding_id: 501,
        kind: 'assignment',
        mode: 'filter',
        assignment_mode: 'assigned_to_me',
        value_ids: null,
        value_texts: null,
      }],
      existingConstraints: [{
        binding_id: 901,
        kind: 'assignment',
        mode: 'filter',
        assignment_mode: 'assigned_to_me',
        value_ids: null,
        value_texts: null,
      }],
    });
    const db = {
      transaction: () => ({ execute: async (operation: (transaction: typeof trx) => unknown) => operation(trx) }),
    };
    const port = createPostgresMailDelegationPort({ db: db as never, applyWorkspaceSession: async () => {} });

    await expect(port.replaceBinding({
      workspaceId: WORKSPACE,
      actor: { userId: ACTOR, isOwner: false, isAdmin: false },
      subject: { type: 'user', id: AGENT },
      resource: { type: 'account', accountId: 101 },
      permissions: ['mail.metadata.read', 'mail.content.read'],
    })).resolves.toEqual({ ok: false, code: 'privilege_escalation' });
  });

  test('bulk-hydrates delegation pages with a constant query count', async () => {
    const small = createListTransaction(2);
    const large = createListTransaction(20);
    const createPort = (trx: ReturnType<typeof createListTransaction>) => createPostgresMailDelegationPort({
      db: {
        transaction: () => ({ execute: async (operation: (transaction: typeof trx) => unknown) => operation(trx) }),
      } as never,
      applyWorkspaceSession: async () => {},
    });

    const smallResult = await createPort(small).listBindings({
      workspaceId: WORKSPACE,
      actor: { userId: ACTOR, isOwner: true, isAdmin: false },
      limit: 2,
    });
    const largeResult = await createPort(large).listBindings({
      workspaceId: WORKSPACE,
      actor: { userId: ACTOR, isOwner: true, isAdmin: false },
      limit: 20,
    });

    expect(selectQueryCount(small)).toBe(7);
    expect(selectQueryCount(large)).toBe(7);
    expect(smallResult).toMatchObject({ ok: true, nextCursor: null });
    expect(largeResult).toMatchObject({ ok: true, nextCursor: null });
  });

  test('returns deterministic bounded pages after the validated id cursor', async () => {
    const trx = createListTransaction(6);
    const port = createPostgresMailDelegationPort({
      db: {
        transaction: () => ({ execute: async (operation: (transaction: typeof trx) => unknown) => operation(trx) }),
      } as never,
      applyWorkspaceSession: async () => {},
    });

    const result = await port.listBindings({
      workspaceId: WORKSPACE,
      actor: { userId: ACTOR, isOwner: false, isAdmin: true },
      cursor: 2,
      limit: 2,
    });

    expect(result).toMatchObject({
      ok: true,
      bindings: [{ id: 3 }, { id: 4 }],
      nextCursor: 4,
    });
  });

  test('locks an existing binding row before patch and delete replacement semantics', async () => {
    const existingBinding = {
      id: 901,
      workspace_id: WORKSPACE,
      subject_type: 'user' as const,
      subject_id: AGENT,
      resource_type: 'account' as const,
      account_id: 101,
      folder_id: null,
      message_id: null,
      updated_at: '2026-07-20T10:00:00.000Z',
    };
    const patchTrx = createDelegationTransaction({
      actor: { id: ACTOR, role: 'admin', disabled_at: null },
      subject: { id: AGENT, display_name: 'Agent', role: 'user', disabled_at: null },
      account: { id: 101, display_name: 'Support' },
      folder: null,
      existingBinding,
      affectedUsers: [{ id: AGENT }],
    });
    const deleteTrx = createDelegationTransaction({
      actor: { id: ACTOR, role: 'admin', disabled_at: null },
      subject: { id: AGENT, display_name: 'Agent', role: 'user', disabled_at: null },
      account: { id: 101, display_name: 'Support' },
      folder: null,
      existingBinding,
      affectedUsers: [{ id: AGENT }],
    });
    const createPort = (trx: typeof patchTrx) => createPostgresMailDelegationPort({
      db: {
        transaction: () => ({ execute: async (operation: (transaction: typeof trx) => unknown) => operation(trx) }),
      } as never,
      applyWorkspaceSession: async () => {},
    });

    await createPort(patchTrx).replaceBindingById({
      workspaceId: WORKSPACE,
      actor: { userId: ACTOR, isOwner: false, isAdmin: true },
      bindingId: 901,
      permissions: ['mail.metadata.read'],
    });
    await createPort(deleteTrx).deleteBinding({
      workspaceId: WORKSPACE,
      actor: { userId: ACTOR, isOwner: false, isAdmin: true },
      bindingId: 901,
    });

    expect(patchTrx.calls.filter(([operation]) => operation === 'forUpdate')).toHaveLength(1);
    expect(deleteTrx.calls.filter(([operation]) => operation === 'forUpdate')).toHaveLength(1);
  });
});

function selectQueryCount(trx: { calls: unknown[][] }): number {
  return trx.calls.filter(([operation]) => operation === 'selectFrom').length;
}

function createListTransaction(bindingCount: number) {
  const calls: unknown[][] = [];
  const bindings = Array.from({ length: bindingCount }, (_, index) => {
    const id = index + 1;
    const group = id % 2 === 0;
    return {
      id,
      workspace_id: WORKSPACE,
      subject_type: group ? 'group' as const : 'user' as const,
      subject_id: group ? String(1000 + id) : `user-${id}`,
      resource_type: group ? 'folder' as const : 'account' as const,
      account_id: 100 + id,
      folder_id: group ? 200 + id : null,
      message_id: null,
      updated_at: '2026-07-20T10:00:00.000Z',
    };
  });
  const rowsByTable: Record<string, Array<Record<string, unknown>>> = {
    mail_acl_bindings: bindings,
    mail_acl_binding_permissions: bindings.map((row) => ({
      binding_id: row.id,
      permission_key: 'mail.metadata.read',
    })),
    mail_acl_binding_constraints: [],
    users: bindings
      .filter((row) => row.subject_type === 'user')
      .map((row) => ({ id: row.subject_id, workspace_id: WORKSPACE, display_name: `User ${row.id}` })),
    user_groups: bindings
      .filter((row) => row.subject_type === 'group')
      .map((row) => ({ id: Number(row.subject_id), workspace_id: WORKSPACE, name: `Group ${row.id}` })),
    email_accounts: bindings.map((row) => ({
      id: row.account_id,
      workspace_id: WORKSPACE,
      display_name: `Account ${row.id}`,
    })),
    email_folders: bindings
      .filter((row) => row.folder_id !== null)
      .map((row) => ({ id: row.folder_id, workspace_id: WORKSPACE, path: `Folder ${row.id}` })),
  };

  const createBuilder = (table: string) => {
    const wheres: Array<[string, string, unknown]> = [];
    let rowLimit: number | undefined;
    const builder = {
      select: () => builder,
      selectAll: () => builder,
      where: (...args: unknown[]) => {
        if (typeof args[0] === 'string') wheres.push(args as [string, string, unknown]);
        return builder;
      },
      orderBy: () => builder,
      limit: (value: number) => {
        rowLimit = value;
        return builder;
      },
      execute: async () => {
        let rows = [...(rowsByTable[table] ?? [])];
        for (const [rawColumn, operator, value] of wheres) {
          const column = rawColumn.split('.').at(-1)!;
          if (operator === '=') rows = rows.filter((row) => row[column] === value);
          if (operator === '>') rows = rows.filter((row) => Number(row[column]) > Number(value));
          if (operator === 'in' && Array.isArray(value)) rows = rows.filter((row) => value.includes(row[column]));
        }
        return rowLimit === undefined ? rows : rows.slice(0, rowLimit);
      },
      executeTakeFirst: async () => {
        const rows = await builder.execute();
        return rows[0];
      },
    };
    return builder;
  };

  return {
    calls,
    selectFrom(table: string) {
      calls.push(['selectFrom', table]);
      return createBuilder(table);
    },
  };
}

function createDelegationTransaction(fixtures: {
  actor: unknown;
  subject: unknown;
  account: unknown;
  folder: unknown;
  existingBinding: unknown;
  affectedUsers: unknown[];
  actorPermissions?: readonly MailPermission[];
  /** Verteilt die Berechtigungen des Actors auf mehrere Bindings (Autoritaet je Binding). */
  actorPermissionBindings?: ReadonlyArray<{ bindingId: number; permission: MailPermission }>;
  actorAuthorityConstraints?: Array<Record<string, unknown>>;
  existingConstraints?: Array<Record<string, unknown>>;
  /** Kategorie-Ids, die es im Workspace NICHT gibt (Default: alle existieren). */
  unknownCategoryIds?: readonly number[];
}) {
  const calls: unknown[][] = [];
  const selectCounts = new Map<string, number>();
  const nextCount = (key: string) => {
    const current = selectCounts.get(key) ?? 0;
    selectCounts.set(key, current + 1);
    return current;
  };
  const rowsFor = (table: string, joined: string[], inIds: readonly number[]): unknown[] => {
    if (table === 'email_categories') {
      // Standardmaessig existiert jede abgefragte Kategorie; die Fixture kann
      // einzelne Ids ausdruecklich als unbekannt markieren.
      const unknown = new Set(fixtures.unknownCategoryIds ?? []);
      return inIds.filter((id) => !unknown.has(id)).map((id) => ({ id }));
    }
    if (table === 'users') {
      const index = nextCount('users');
      if (index === 0) return fixtures.subject ? [fixtures.subject] : [];
      if (index === 1) return fixtures.affectedUsers;
      return fixtures.subject ? [fixtures.subject] : [];
    }
    if (table === 'user_groups') return fixtures.subject ? [fixtures.subject] : [];
    if (table === 'email_accounts') return fixtures.account ? [fixtures.account] : [];
    if (table === 'email_folders') return fixtures.folder ? [fixtures.folder] : [];
    if (table === 'user_group_members') {
      if (joined.includes('users')) return fixtures.affectedUsers.map((user) => ({ user_id: (user as { id: string }).id }));
      return [];
    }
    if (table === 'mail_acl_bindings' && joined.includes('mail_acl_binding_permissions')) {
      if (fixtures.actorPermissionBindings) {
        return fixtures.actorPermissionBindings.map((entry) => ({
          id: entry.bindingId,
          subject_type: 'user',
          subject_id: ACTOR,
          resource_type: 'account',
          account_id: 101,
          folder_id: null,
          permission_key: entry.permission,
        }));
      }
      return (fixtures.actorPermissions ?? []).map((permission) => ({
        id: 501,
        subject_type: 'user',
        subject_id: ACTOR,
        resource_type: 'account',
        account_id: 101,
        folder_id: null,
        permission_key: permission,
      }));
    }
    if (table === 'mail_acl_bindings') return fixtures.existingBinding ? [fixtures.existingBinding] : [];
    if (table === 'mail_acl_binding_permissions') {
      return [{ binding_id: (fixtures.existingBinding as { id?: number } | null)?.id ?? 901, permission_key: 'mail.metadata.read' }];
    }
    if (table === 'mail_acl_binding_constraints') {
      const index = nextCount('mail_acl_binding_constraints');
      // First load is usually authority constraints; later loads target existing binding.
      if (index === 0 && fixtures.actorAuthorityConstraints) return fixtures.actorAuthorityConstraints;
      if (fixtures.existingConstraints) return fixtures.existingConstraints;
      return fixtures.actorAuthorityConstraints ?? [];
    }
    return [];
  };
  const createBuilder = (table: string, operation: 'select' | 'insert' | 'update' | 'delete') => {
    const joined: string[] = [];
    let inIds: readonly number[] = [];
    const builder = {
    select: () => builder,
    selectAll: () => builder,
    where: (...args: unknown[]) => {
      if (args[1] === 'in' && Array.isArray(args[2])) inIds = args[2] as number[];
      return builder;
    },
    whereRef: () => builder,
    innerJoin: (joinTable: string) => {
      joined.push(joinTable);
      return builder;
    },
    leftJoin: () => builder,
    orderBy: () => builder,
    forUpdate: () => {
      calls.push(['forUpdate', table]);
      return builder;
    },
    forShare: () => {
      calls.push(['forShare', table]);
      return builder;
    },
    values: () => builder,
    returning: () => builder,
    returningAll: () => builder,
    onConflict: () => builder,
    set: () => builder,
    execute: async () => rowsFor(table, joined, inIds),
    executeTakeFirst: async () => {
      if (table === 'mail_acl_bindings' && operation === 'insert') {
        return {
          id: 901,
          workspace_id: WORKSPACE,
          subject_type: 'user',
          subject_id: AGENT,
          resource_type: 'account',
          account_id: 101,
          folder_id: null,
          message_id: null,
          updated_at: new Date('2026-07-19T12:00:00.000Z'),
        };
      }
      return rowsFor(table, joined, inIds)[0] ?? undefined;
    },
    executeTakeFirstOrThrow: async () => ({ id: 901, updated_at: new Date('2026-07-19T12:00:00.000Z') }),
  };
    return builder;
  };
  return {
    calls,
    /**
     * Roh-SQL laeuft ueber diesen Executor. Gebraucht wird er fuer die
     * Advisory-Sperre der Budget-Pruefung — sie darf im Fake nichts tun, muss
     * aber sichtbar sein, damit ein Test sie zusichern kann.
     */
    getExecutor() {
      return {
        async executeQuery(compiled: { sql: string }) {
          calls.push(['sql', compiled.sql]);
          return { rows: [] };
        },
      };
    },
    selectFrom(table: string) {
      calls.push(['selectFrom', table]);
      return createBuilder(table, 'select');
    },
    insertInto(table: string) {
      calls.push(['insertInto', table]);
      return createBuilder(table, 'insert');
    },
    deleteFrom(table: string) {
      calls.push(['deleteFrom', table]);
      return createBuilder(table, 'delete');
    },
    updateTable(table: string) {
      calls.push(['updateTable', table]);
      return createBuilder(table, 'update');
    },
  };
}
