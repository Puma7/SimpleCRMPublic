import type { Kysely } from 'kysely';

import type { ServerEvent, ServerEventSubscription } from '../api';
import type { ServerDatabase } from './schema';
import { withWorkspaceTransaction, type WorkspaceSessionApplier } from './workspace-context';

export type PostgresServerEventPortOptions = Readonly<{
  db: Kysely<ServerDatabase>;
  replayLimit?: number;
  applyWorkspaceSession?: WorkspaceSessionApplier;
  notifications?: PostgresServerEventNotificationChannel;
}>;

export type PostgresServerEventSubscriber = (event: ServerEvent) => void | Promise<void>;

export type PostgresServerEventNotification = Readonly<{
  workspaceId: string;
  sequence: number;
}>;

export type PostgresServerEventNotificationChannel = Readonly<{
  notify(notification: PostgresServerEventNotification): Promise<void>;
  subscribe(subscriber: (notification: PostgresServerEventNotification) => void | Promise<void>): ServerEventSubscription;
  close?(): Promise<void>;
}>;

export type PostgresNotificationClient = Readonly<{
  connect(): Promise<void>;
  query(sql: string, params?: readonly unknown[]): Promise<unknown>;
  end(): Promise<void>;
  on(event: 'notification', listener: (message: { payload?: string }) => void): void;
}>;

export type PostgresServerEventNotificationChannelOptions = Readonly<{
  databaseUrl: string;
  channelName?: string;
  createClient?: (databaseUrl: string) => PostgresNotificationClient;
}>;

export function createPostgresServerEventPort(options: PostgresServerEventPortOptions) {
  const subscribers = new Set<PostgresServerEventSubscriber>();
  const deliveredSequences: number[] = [];
  const replayLimit = normalizeReplayLimit(options.replayLimit);
  options.notifications?.subscribe((notification) => {
    void loadAndEmit(notification).catch(() => undefined);
  });

  return {
    async publish(event: ServerEvent): Promise<void> {
      const stored = await withWorkspaceTransaction(
        options.db,
        {
          workspaceId: event.workspaceId,
          userId: undefined,
          role: 'system',
        },
        async (trx) => {
          const row = await trx
            .insertInto('server_events')
            .values({
              workspace_id: event.workspaceId,
              type: event.type,
              entity_type: event.entityType,
              entity_id: event.entityId,
              actor_user_id: event.actorUserId,
              occurred_at: event.occurredAt,
              payload: event.payload,
            })
            .returning([
              'sequence',
              'workspace_id',
              'type',
              'entity_type',
              'entity_id',
              'actor_user_id',
              'occurred_at',
              'payload',
            ])
            .executeTakeFirstOrThrow();

          return eventFromRow(row);
        },
        { applySession: options.applyWorkspaceSession },
      );

      await emit(stored);
      if (stored.sequence !== undefined) {
        await options.notifications?.notify({
          workspaceId: stored.workspaceId,
          sequence: stored.sequence,
        });
      }
    },
    subscribe(subscriber: PostgresServerEventSubscriber): ServerEventSubscription {
      subscribers.add(subscriber);
      return {
        unsubscribe() {
          subscribers.delete(subscriber);
        },
      };
    },
    async replay(input: {
      workspaceId: string;
      afterSequence?: number;
      limit?: number;
    }): Promise<readonly ServerEvent[]> {
      return withWorkspaceTransaction(
        options.db,
        {
          workspaceId: input.workspaceId,
          role: 'system',
        },
        async (trx) => {
          const rows = await trx
            .selectFrom('server_events')
            .select([
              'sequence',
              'workspace_id',
              'type',
              'entity_type',
              'entity_id',
              'actor_user_id',
              'occurred_at',
              'payload',
            ])
            .where('workspace_id', '=', input.workspaceId)
            .where('sequence', '>', input.afterSequence ?? 0)
            .orderBy('sequence', 'asc')
            .limit(normalizeReplayLimit(input.limit ?? replayLimit))
            .execute();

          return rows.map(eventFromRow);
        },
        { applySession: options.applyWorkspaceSession },
      );
    },
  };

  async function loadAndEmit(notification: PostgresServerEventNotification): Promise<void> {
    if (isDelivered(notification.sequence)) return;
    const event = await loadEventBySequence(notification);
    if (event) {
      await emit(event);
    }
  }

  async function loadEventBySequence(input: PostgresServerEventNotification): Promise<ServerEvent | null> {
    return withWorkspaceTransaction(
      options.db,
      {
        workspaceId: input.workspaceId,
        role: 'system',
      },
      async (trx) => {
        const row = await trx
          .selectFrom('server_events')
          .select([
            'sequence',
            'workspace_id',
            'type',
            'entity_type',
            'entity_id',
            'actor_user_id',
            'occurred_at',
            'payload',
          ])
          .where('workspace_id', '=', input.workspaceId)
          .where('sequence', '=', input.sequence)
          .executeTakeFirst();

        return row ? eventFromRow(row) : null;
      },
      { applySession: options.applyWorkspaceSession },
    );
  }

  async function emit(event: ServerEvent): Promise<void> {
    markDelivered(event.sequence);
    for (const subscriber of [...subscribers]) {
      await subscriber(event);
    }
  }

  function markDelivered(sequence: number | undefined): void {
    if (sequence === undefined || deliveredSequences.includes(sequence)) return;
    deliveredSequences.push(sequence);
    while (deliveredSequences.length > 10_000) {
      deliveredSequences.shift();
    }
  }

  function isDelivered(sequence: number): boolean {
    return deliveredSequences.includes(sequence);
  }
}

export async function createPostgresServerEventNotificationChannel(
  options: PostgresServerEventNotificationChannelOptions,
): Promise<PostgresServerEventNotificationChannel> {
  const channelName = normalizeChannelName(options.channelName ?? 'simplecrm_server_events');
  const subscribers = new Set<(notification: PostgresServerEventNotification) => void | Promise<void>>();
  const client = (options.createClient ?? createDefaultNotificationClient)(options.databaseUrl);
  try {
    await client.connect();
    await client.query(`LISTEN ${channelName}`);
  } catch (error) {
    await client.end().catch(() => undefined);
    throw error;
  }
  client.on('notification', (message) => {
    const notification = parseNotificationPayload(message.payload);
    if (!notification) return;
    for (const subscriber of [...subscribers]) {
      void Promise.resolve(subscriber(notification)).catch(() => undefined);
    }
  });

  return {
    async notify(notification) {
      await client.query('SELECT pg_notify($1, $2);', [
        channelName,
        JSON.stringify(notification),
      ]);
    },
    subscribe(subscriber) {
      subscribers.add(subscriber);
      return {
        unsubscribe() {
          subscribers.delete(subscriber);
        },
      };
    },
    async close() {
      await client.end();
    },
  };
}

function eventFromRow(row: {
  sequence: number;
  workspace_id: string;
  type: string;
  entity_type: string;
  entity_id: string;
  actor_user_id: string;
  occurred_at: Date | string;
  payload: unknown;
}): ServerEvent {
  return {
    sequence: Number(row.sequence),
    type: assertServerEventType(row.type),
    workspaceId: row.workspace_id,
    entityType: assertServerEventEntityType(row.entity_type),
    entityId: row.entity_id,
    actorUserId: row.actor_user_id,
    occurredAt: formatTimestamp(row.occurred_at),
    payload: isRecord(row.payload) ? row.payload : {},
  };
}

function assertServerEventType(value: string): ServerEvent['type'] {
  if (
    value === 'conversation_lock.acquired'
    || value === 'conversation_lock.heartbeat'
    || value === 'conversation_lock.released'
    || value === 'conversation_lock.force_takeover'
    || value === 'customer.created'
    || value === 'customer.updated'
    || value === 'customer.deleted'
    || value === 'product.created'
    || value === 'product.updated'
    || value === 'product.deleted'
    || value === 'deal.created'
    || value === 'deal.updated'
    || value === 'deal.deleted'
    || value === 'deal_product.created'
    || value === 'deal_product.updated'
    || value === 'deal_product.deleted'
    || value === 'task.created'
    || value === 'task.updated'
    || value === 'task.deleted'
    || value === 'calendar_event.created'
    || value === 'calendar_event.updated'
    || value === 'calendar_event.deleted'
    || value === 'custom_field.created'
    || value === 'custom_field.updated'
    || value === 'custom_field.deleted'
    || value === 'custom_field_value.created'
    || value === 'custom_field_value.updated'
    || value === 'custom_field_value.deleted'
    || value === 'saved_view.created'
    || value === 'saved_view.updated'
    || value === 'saved_view.deleted'
    || value === 'activity_log.created'
    || value === 'jtl_reference.created'
    || value === 'jtl_reference.updated'
    || value === 'jtl_reference.deleted'
    || value === 'spam_list_entry.created'
    || value === 'spam_list_entry.updated'
    || value === 'spam_list_entry.deleted'
    || value === 'spam_learning_event.created'
    || value === 'spam_decision.created'
    || value === 'spam_decision.updated'
    || value === 'spam_decision.deleted'
    || value === 'pgp_identity.created'
    || value === 'pgp_identity.updated'
    || value === 'pgp_identity.deleted'
    || value === 'pgp_peer_key.created'
    || value === 'pgp_peer_key.updated'
    || value === 'pgp_peer_key.deleted'
    || value === 'ai_profile.created'
    || value === 'ai_profile.updated'
    || value === 'ai_profile.deleted'
    || value === 'ai_prompt.created'
    || value === 'ai_prompt.updated'
    || value === 'ai_prompt.deleted'
    || value === 'workflow.created'
    || value === 'workflow.updated'
    || value === 'workflow.deleted'
    || value === 'workflow_version.created'
    || value === 'workflow_version.updated'
    || value === 'workflow_version.deleted'
    || value === 'workflow_knowledge_base.created'
    || value === 'workflow_knowledge_base.updated'
    || value === 'workflow_knowledge_base.deleted'
    || value === 'workflow_knowledge_chunk.created'
    || value === 'workflow_knowledge_chunk.updated'
    || value === 'workflow_knowledge_chunk.deleted'
    || value === 'workflow_delayed_job.created'
    || value === 'workflow_delayed_job.updated'
    || value === 'workflow_delayed_job.deleted'
    || value === 'automation_api_key.created'
    || value === 'automation_api_key.revoked'
    || value === 'email_account.created'
    || value === 'email_account.updated'
    || value === 'email_account.deleted'
    || value === 'email_message.updated'
    || value === 'email_message_tag.created'
    || value === 'email_message_tag.deleted'
    || value === 'email_category.created'
    || value === 'email_category.updated'
    || value === 'email_category.deleted'
    || value === 'email_message_category.created'
    || value === 'email_message_category.deleted'
    || value === 'email_internal_note.created'
    || value === 'email_internal_note.updated'
    || value === 'email_internal_note.deleted'
    || value === 'email_canned_response.created'
    || value === 'email_canned_response.updated'
    || value === 'email_canned_response.deleted'
    || value === 'email_remote_content_allowlist.created'
    || value === 'email_remote_content_allowlist.updated'
    || value === 'email_remote_content_allowlist.deleted'
    || value === 'email_team_member.created'
    || value === 'email_team_member.updated'
    || value === 'email_team_member.deleted'
    || value === 'email_thread_edge.created'
    || value === 'email_thread_edge.deleted'
    || value === 'email_thread_alias.created'
    || value === 'email_thread_alias.updated'
    || value === 'email_thread_alias.deleted'
    || value === 'email_thread.updated'
    || value === 'email_account_signature.created'
    || value === 'email_account_signature.updated'
    || value === 'email_account_signature.deleted'
    || value === 'email_read_receipt.created'
    || value === 'email_tracking.updated'
  ) {
    return value;
  }
  throw new Error(`unsupported server event type: ${value}`);
}

function assertServerEventEntityType(value: string): ServerEvent['entityType'] {
  if (value === 'email_message') return value;
  if (value === 'customer') return value;
  if (value === 'product') return value;
  if (value === 'deal') return value;
  if (value === 'deal_product') return value;
  if (value === 'task') return value;
  if (value === 'calendar_event') return value;
  if (value === 'custom_field') return value;
  if (value === 'custom_field_value') return value;
  if (value === 'saved_view') return value;
  if (value === 'activity_log') return value;
  if (value === 'jtl_reference') return value;
  if (value === 'spam_list_entry') return value;
  if (value === 'spam_learning_event') return value;
  if (value === 'spam_decision') return value;
  if (value === 'pgp_identity') return value;
  if (value === 'pgp_peer_key') return value;
  if (value === 'ai_profile') return value;
  if (value === 'ai_prompt') return value;
  if (value === 'workflow') return value;
  if (value === 'workflow_version') return value;
  if (value === 'workflow_knowledge_base') return value;
  if (value === 'workflow_knowledge_chunk') return value;
  if (value === 'workflow_delayed_job') return value;
  if (value === 'automation_api_key') return value;
  if (value === 'email_account') return value;
  if (value === 'email_message_tag') return value;
  if (value === 'email_category') return value;
  if (value === 'email_message_category') return value;
  if (value === 'email_internal_note') return value;
  if (value === 'email_canned_response') return value;
  if (value === 'email_remote_content_allowlist') return value;
  if (value === 'email_team_member') return value;
  if (value === 'email_thread_edge') return value;
  if (value === 'email_thread_alias') return value;
  if (value === 'email_thread') return value;
  if (value === 'email_account_signature') return value;
  if (value === 'email_read_receipt') return value;
  throw new Error(`unsupported server event entity type: ${value}`);
}

function formatTimestamp(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeReplayLimit(value: number | undefined): number {
  if (value === undefined || !Number.isInteger(value) || value < 1) return 1000;
  return Math.min(value, 10_000);
}

function createDefaultNotificationClient(databaseUrl: string): PostgresNotificationClient {
  const { Client } = require('pg') as typeof import('pg');
  const client = new Client({ connectionString: databaseUrl });
  return {
    async connect() {
      await client.connect();
    },
    async query(sql, params) {
      return client.query(sql, params ? [...params] : undefined);
    },
    async end() {
      await client.end();
    },
    on(event, listener) {
      client.on(event, listener);
    },
  };
}

function normalizeChannelName(value: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(value)) {
    throw new Error('event notification channelName must be a PostgreSQL identifier');
  }
  return value.toLowerCase();
}

function parseNotificationPayload(payload: string | undefined): PostgresServerEventNotification | null {
  if (!payload) return null;
  try {
    const parsed = JSON.parse(payload) as Record<string, unknown>;
    const workspaceId = parsed.workspaceId;
    const sequence = parsed.sequence;
    if (
      typeof workspaceId !== 'string'
      || typeof sequence !== 'number'
      || !Number.isSafeInteger(sequence)
      || sequence < 1
    ) {
      return null;
    }
    return { workspaceId, sequence };
  } catch {
    return null;
  }
}
