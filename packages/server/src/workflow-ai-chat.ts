import type { Kysely } from 'kysely';

import type { PostgresSecretPort } from './db/postgres-secret-port';
import type { EmailAiProfilesTable, ServerDatabase } from './db/schema';
import type { WorkspaceSessionApplier } from './db/workspace-context';
import { withWorkspaceTransaction } from './db/workspace-context';
import { recordAiUsageSafe, type AiTokenUsage } from './ai-usage';
import { evaluateAiBudgetSafe, readAiBudgetLimitsFromEnv } from './ai-budget';
import { callAiChat } from './ai-providers';

const OPENAI_CHAT_TIMEOUT_MS = 90_000;

const aiProfileColumns = [
  'id',
  'provider',
  'base_url',
  'model',
  'secret_id',
  'is_default',
  'sort_order',
] as const;

type AiProfileRow = Pick<
  import('kysely').Selectable<EmailAiProfilesTable>,
  typeof aiProfileColumns[number]
>;

export type WorkflowAiChatDeps = Readonly<{
  db: Kysely<ServerDatabase>;
  secrets: PostgresSecretPort;
  applyWorkspaceSession?: WorkspaceSessionApplier;
  now?: () => Date;
  fetchImpl?: typeof fetch;
}>;

export async function runWorkflowTrackedChatCompletion(
  deps: WorkflowAiChatDeps,
  input: Readonly<{
    workspaceId: string;
    messageId: number | null;
    nodeType: string;
    profileId?: number;
    actorUserId?: string | null;
    system: string;
    user: string;
  }>,
): Promise<string> {
  const profile = await withWorkspaceTransaction(
    deps.db,
    { workspaceId: input.workspaceId, role: 'system' },
    async (trx) => selectAiProfile(trx, input.workspaceId, input.profileId),
    { applySession: deps.applyWorkspaceSession },
  );
  if (!profile) throw new Error('KI-Profil nicht gefunden');

  const apiKey = await readProfileApiKey(deps.secrets, input.workspaceId, profile);
  if (!apiKey) throw new Error('Kein KI-API-Schlüssel konfiguriert');

  const budgetLimits = readAiBudgetLimitsFromEnv();
  if (budgetLimits.hardLimitMicroUsd != null || budgetLimits.softLimitMicroUsd != null) {
    const budget = await evaluateAiBudgetSafe(
      { db: deps.db, applyWorkspaceSession: deps.applyWorkspaceSession, now: deps.now },
      input.workspaceId,
      budgetLimits,
    );
    if (budget.decision === 'block') {
      throw new Error(`AI budget exceeded for workspace ${input.workspaceId}`);
    }
  }

  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  if (!fetchImpl) throw new Error('fetch is not available for workflow AI');

  const started = Date.now();
  let usage: AiTokenUsage | null = null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OPENAI_CHAT_TIMEOUT_MS);
  let output: string;
  try {
    const result = await callAiChat({
      provider: profile.provider,
      baseUrl: profile.base_url,
      model: profile.model,
      apiKey,
      system: input.system,
      user: input.user,
      temperature: 0.2,
      fetchImpl,
      signal: controller.signal,
    });
    usage = result.usage;
    output = result.content;
  } finally {
    clearTimeout(timeout);
  }

  await recordAiUsageSafe(
    { db: deps.db, applyWorkspaceSession: deps.applyWorkspaceSession, now: deps.now },
    {
      workspaceId: input.workspaceId,
      aiProfileId: Number(profile.id),
      model: profile.model,
      nodeType: input.nodeType,
      messageId: input.messageId,
      actorUserId: input.actorUserId ?? null,
      usage,
      latencyMs: Date.now() - started,
    },
  );
  return output;
}

async function selectAiProfile(
  trx: import('./db/workspace-context').WorkspaceTransaction,
  workspaceId: string,
  profileId: number | undefined,
): Promise<AiProfileRow | null> {
  if (profileId !== undefined) {
    return await trx
      .selectFrom('email_ai_profiles')
      .select(aiProfileColumns)
      .where('workspace_id', '=', workspaceId)
      .where('id', '=', profileId)
      .executeTakeFirst() ?? null;
  }
  const defaultProfile = await trx
    .selectFrom('email_ai_profiles')
    .select(aiProfileColumns)
    .where('workspace_id', '=', workspaceId)
    .where('is_default', '=', true)
    .orderBy('sort_order', 'asc')
    .orderBy('id', 'asc')
    .executeTakeFirst();
  if (defaultProfile) return defaultProfile;
  return await trx
    .selectFrom('email_ai_profiles')
    .select(aiProfileColumns)
    .where('workspace_id', '=', workspaceId)
    .orderBy('sort_order', 'asc')
    .orderBy('id', 'asc')
    .executeTakeFirst() ?? null;
}

async function readProfileApiKey(
  secrets: PostgresSecretPort,
  workspaceId: string,
  profile: AiProfileRow,
): Promise<string | null> {
  if (!profile.secret_id) return null;
  const secret = await secrets.readSecret({
    workspaceId,
    kind: 'email.ai_profile.api_key',
    name: `email_ai_profile:${Number(profile.id)}:api_key`,
  });
  const value = secret?.toString('utf8').trim();
  return value || null;
}
