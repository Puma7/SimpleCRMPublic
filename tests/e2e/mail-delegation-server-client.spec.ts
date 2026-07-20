import path from 'node:path';
import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import { expect, test } from '@playwright/test';
import react from '@vitejs/plugin-react';
import { createServer as createViteServer, type ViteDevServer } from 'vite';

import {
  createFastifyServer,
  createInMemoryServerEventBus,
  type MailDelegationBinding,
  type ServerApiPorts,
  type ServerEventPort,
} from '../../packages/server/src/api';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const MANAGER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OWNER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const AGENT_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const MANAGER_TOKEN = 'task-7-manager-token';
const OWNER_TOKEN = 'task-7-owner-token';
const ACCESS_BINDING_ID = 700;
const ACCOUNT_ID = 101;
const FOLDER_ID = 202;

type HarnessState = {
  managerHasAccess: boolean;
  accountListCalls: number;
  activeEventSubscriptions: number;
  bindings: MailDelegationBinding[];
  lastSaved: { permissions: readonly string[] } | null;
};

let vite: ViteDevServer | null = null;
let webServer: HttpServer | null = null;
let api: ReturnType<typeof createFastifyServer> | null = null;
let webOrigin = '';
let apiOrigin = '';
let state: HarnessState;

test.beforeAll(async () => {
  state = {
    managerHasAccess: true,
    accountListCalls: 0,
    activeEventSubscriptions: 0,
    bindings: [],
    lastSaved: null,
  };

  vite = await createViteServer({
    root: path.resolve(__dirname, 'server-client-harness'),
    configFile: false,
    logLevel: 'error',
    plugins: [react()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '../../src'),
        '@shared': path.resolve(__dirname, '../../shared'),
        '@simplecrm/core': path.resolve(__dirname, '../../packages/core/src/email/mail-permissions.ts'),
      },
    },
    server: { middlewareMode: true, hmr: false },
  });
  webServer = createHttpServer(vite.middlewares);
  await listenOnEphemeralPort(webServer);
  webOrigin = originFromAddress(webServer.address());

  const events = trackedEventPort(state);
  api = createFastifyServer({
    ports: createHarnessPorts(state, events),
    corsAllowedOrigins: [webOrigin],
    resolvePrincipal(request) {
      const credentials = `${String(request.headers.authorization ?? '')} ${String(request.headers['sec-websocket-protocol'] ?? '')}`;
      if (credentials.includes(MANAGER_TOKEN)) {
        return {
          workspaceId: WORKSPACE_ID,
          userId: MANAGER_ID,
          role: 'user',
          capabilities: ['users.manage'],
        };
      }
      if (credentials.includes(OWNER_TOKEN)) {
        return { workspaceId: WORKSPACE_ID, userId: OWNER_ID, role: 'owner' };
      }
      return undefined;
    },
  });
  await api.listen({ host: '127.0.0.1', port: 0 });
  apiOrigin = originFromAddress(api.server.address());
});

test.afterAll(async () => {
  await api?.close();
  await closeHttpServer(webServer);
  await vite?.close();
  api = null;
  webServer = null;
  vite = null;
});

test('profile, individual grant, and revoke travel through HTTP and the live ACL event', async ({ page, request }) => {
  const apiResponses: string[] = [];
  const browserErrors: string[] = [];
  page.on('response', (entry) => {
    if (entry.url().startsWith(apiOrigin)) apiResponses.push(`${entry.status()} ${entry.url()}`);
  });
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text());
  });
  const response = await page.goto(`${webOrigin}/?apiUrl=${encodeURIComponent(apiOrigin)}`);
  expect(response?.ok()).toBe(true);

  await expect(page.getByRole('heading', { name: 'Mailbox-Delegation' })).toBeVisible();
  await expect.poll(() => state.activeEventSubscriptions).toBe(1);
  await expect(page.getByText('Delegationen werden geladen.')).toHaveCount(0);
  if (await page.getByText('Delegationen konnten nicht geladen werden.').count()) {
    throw new Error(JSON.stringify({ apiResponses, browserErrors }, null, 2));
  }

  await page.getByLabel('Profil').selectOption('triage');
  await page.getByRole('checkbox', { name: 'Senden', exact: true }).check();
  await page.getByRole('button', { name: 'Berechtigung speichern' }).click();

  await expect.poll(() => state.lastSaved).toEqual({
    permissions: [
      'mail.attachment.read',
      'mail.comment',
      'mail.content.read',
      'mail.metadata.read',
      'mail.send',
      'mail.triage',
    ],
  });
  await expect(page.getByRole('button', { name: 'Löschen Agent' })).toBeVisible();

  const accountCallsBeforeRevoke = state.accountListCalls;
  const revoke = await request.delete(`${apiOrigin}/api/v1/email/access/bindings/${ACCESS_BINDING_ID}`, {
    headers: { Authorization: `Bearer ${OWNER_TOKEN}` },
  });
  expect(revoke.ok()).toBe(true);

  await expect.poll(() => state.accountListCalls).toBeGreaterThan(accountCallsBeforeRevoke);
  await expect(page.getByRole('option', { name: 'Support' })).toHaveCount(0);
  await expect(page.getByLabel('Konto', { exact: true })).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Löschen Agent' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Berechtigung speichern' })).toBeDisabled();

  await page.close();
  await expect.poll(() => state.activeEventSubscriptions).toBe(0);
});

function trackedEventPort(input: HarnessState): ServerEventPort {
  const bus = createInMemoryServerEventBus();
  return {
    publish: (event) => bus.publish(event),
    replay: (request) => bus.replay(request),
    subscribe(subscriber) {
      input.activeEventSubscriptions += 1;
      const subscription = bus.subscribe(subscriber);
      let closed = false;
      return {
        unsubscribe() {
          if (closed) return;
          closed = true;
          input.activeEventSubscriptions -= 1;
          subscription.unsubscribe();
        },
      };
    },
  };
}

function createHarnessPorts(input: HarnessState, events: ServerEventPort): ServerApiPorts {
  const now = '2026-07-20T10:00:00.000Z';
  return {
    auth: {
      async listUsers() {
        return [{
          id: AGENT_ID,
          email: 'agent@example.test',
          displayName: 'Agent',
          role: 'user',
          disabledAt: null,
          loginPinEnabled: false,
          mfaEnabled: false,
          mfaMethod: null,
          createdAt: now,
          updatedAt: now,
        }];
      },
      async findUserByEmail() { return null; },
      async verifyPassword() { return false; },
      async recordFailedLogin() { return 1; },
      async recordSuccessfulLogin() { return undefined; },
      async issueTokenPair() { return { accessToken: 'unused', refreshToken: 'unused', expiresInSeconds: 900 }; },
      async rotateRefreshToken() { return null; },
      async revokeRefreshToken() { return false; },
    },
    locks: {
      async list() { return []; },
      async acquire() { throw new Error('not used'); },
      async get() { return null; },
      async heartbeat() { return null; },
      async release() { return null; },
      async forceTakeover() { throw new Error('not used'); },
    },
    userGroups: {
      async list() { return []; },
      async create() { throw new Error('not used'); },
      async update() { throw new Error('not used'); },
      async delete() { return null; },
      async listMembers() { return []; },
      async addMember() { throw new Error('not used'); },
      async removeMember() { throw new Error('not used'); },
      async listPermissions() { return []; },
      async setPermissions() { throw new Error('not used'); },
    },
    emailAccounts: {
      async list() {
        input.accountListCalls += 1;
        return { items: input.managerHasAccess ? [emailAccount(now)] : [] };
      },
      async get() { return null; },
    },
    emailFolders: {
      async list() {
        return { items: input.managerHasAccess ? [emailFolder(now)] : [], nextCursor: null };
      },
      async get() { return null; },
    },
    mailAccess: {
      async assertPermission() {
        if (!input.managerHasAccess) throw new Error('mail_access_denied');
      },
      async resolveScope() {
        return input.managerHasAccess ? { kind: 'all' } : { kind: 'none' };
      },
    },
    mailResourceLookup: {
      async resolve() { return []; },
    },
    mailDelegation: {
      async listBindings(request) {
        if (!input.managerHasAccess && !request.actor.isOwner) {
          return { ok: true, bindings: [], nextCursor: null };
        }
        const rows = input.bindings
          .filter((binding) => request.cursor === undefined || binding.id > request.cursor)
          .sort((left, right) => left.id - right.id);
        const page = rows.slice(0, request.limit);
        return {
          ok: true,
          bindings: page,
          nextCursor: rows.length > request.limit ? page.at(-1)?.id ?? null : null,
        };
      },
      async replaceBinding(request) {
        if (!input.managerHasAccess && !request.actor.isOwner) return { ok: false, code: 'permission_denied' };
        const binding: MailDelegationBinding = {
          id: 901,
          subject: { ...request.subject, label: 'Agent' },
          resource: { ...request.resource, label: request.resource.type === 'account' ? 'Support' : 'INBOX' },
          permissions: request.permissions,
          profile: null,
          updatedAt: now,
        };
        input.bindings = [binding];
        input.lastSaved = { permissions: request.permissions };
        return { ok: true, binding, affectedUserIds: [AGENT_ID], deleted: false };
      },
      async replaceBindingById(request) {
        const existing = input.bindings.find((binding) => binding.id === request.bindingId);
        if (!existing) return { ok: false, code: 'binding_not_found' };
        const binding = { ...existing, permissions: request.permissions };
        input.bindings = [binding];
        return { ok: true, binding, affectedUserIds: [AGENT_ID], deleted: false };
      },
      async deleteBinding(request) {
        if (request.bindingId === ACCESS_BINDING_ID && request.actor.isOwner) {
          input.managerHasAccess = false;
          input.bindings = [];
          return { ok: true, bindingId: request.bindingId, affectedUserIds: [MANAGER_ID] };
        }
        const existing = input.bindings.find((binding) => binding.id === request.bindingId);
        if (!existing) return { ok: false, code: 'binding_not_found' };
        input.bindings = input.bindings.filter((binding) => binding.id !== request.bindingId);
        return { ok: true, bindingId: request.bindingId, affectedUserIds: [AGENT_ID] };
      },
    },
    events,
  } as ServerApiPorts;
}

function emailAccount(updatedAt: string) {
  return {
    id: ACCOUNT_ID,
    sourceSqliteId: ACCOUNT_ID,
    displayName: 'Support',
    emailAddress: 'support@example.test',
    protocol: 'imap',
    imapHost: 'imap.example.test',
    imapPort: 993,
    imapTls: true,
    imapUsername: 'support@example.test',
    smtpHost: null,
    smtpPort: null,
    smtpTls: true,
    smtpUsername: null,
    smtpUseImapAuth: true,
    pop3Host: null,
    pop3Port: null,
    pop3Tls: true,
    oauthProvider: null,
    sentFolderPath: null,
    syncSpamFolderPath: null,
    syncArchiveFolderPath: null,
    imapSyncSent: false,
    imapSyncArchive: false,
    imapSyncSpam: false,
    imapSyncSeenOnOpen: false,
    vacationEnabled: false,
    vacationSubject: null,
    vacationBodyText: null,
    requestReadReceipt: false,
    imapDeleteOptIn: false,
    defaultRemoteContentPolicy: 'ask',
    respondToReadReceipts: 'ask',
    imapPasswordConfigured: true,
    smtpPasswordConfigured: false,
    oauthRefreshConfigured: false,
    updatedAt,
  };
}

function emailFolder(updatedAt: string) {
  return {
    id: FOLDER_ID,
    sourceSqliteId: FOLDER_ID,
    accountSourceSqliteId: ACCOUNT_ID,
    accountId: ACCOUNT_ID,
    path: 'INBOX',
    delimiter: '/',
    uidValidity: 1,
    uidValidityText: '1',
    lastUid: 1,
    lastSyncedAt: updatedAt,
    pop3Uidl: null,
    updatedAt,
  };
}

function originFromAddress(address: string | AddressInfo | null | undefined): string {
  if (!address || typeof address === 'string') throw new Error('missing TCP server address');
  return `http://127.0.0.1:${address.port}`;
}

function listenOnEphemeralPort(server: HttpServer): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
}

function closeHttpServer(server: HttpServer | null): Promise<void> {
  if (!server?.listening) return Promise.resolve();
  server.closeAllConnections();
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}
