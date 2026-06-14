import type { Kysely } from 'kysely';

import {
  knowledgeContextsForDirection,
  type KnowledgeContext,
  isKnowledgeContext,
} from '../../../shared/knowledge-context';
import { formatKnowledgeChunksForPrompt } from '../../../shared/knowledge-prompt';
import type { ServerDatabase } from './db/schema';
import type { WorkspaceTransaction } from './db/workspace-context';

export type WorkflowKnowledgeChunkMatch = {
  id: number;
  title: string | null;
  content: string;
};

async function keywordSearchChunks(
  trx: WorkspaceTransaction,
  workspaceId: string,
  knowledgeBaseId: number,
  query: string,
  limit: number,
): Promise<WorkflowKnowledgeChunkMatch[]> {
  const rows = await trx
    .selectFrom('workflow_knowledge_chunks')
    .select(['id', 'title', 'content'])
    .where('workspace_id', '=', workspaceId)
    .where('knowledge_base_id', '=', knowledgeBaseId)
    .orderBy('id', 'desc')
    .limit(200)
    .execute();
  const chunks = rows.map((row) => ({
    id: Number(row.id),
    title: row.title === null || row.title === undefined ? null : String(row.title),
    content: String(row.content ?? ''),
  }));
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .filter((term) => term.length > 2)
    .slice(0, 12);
  if (terms.length === 0) return chunks.slice(0, limit);
  return chunks
    .map((chunk) => {
      const haystack = `${chunk.title ?? ''}\n${chunk.content}`.toLowerCase();
      let score = 0;
      for (const term of terms) {
        if (haystack.includes(term)) score += 1;
      }
      return { chunk, score };
    })
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map((item) => item.chunk);
}

async function findKnowledgeBaseIdForContext(
  trx: WorkspaceTransaction,
  workspaceId: string,
  accountId: number | null,
  context: KnowledgeContext,
): Promise<number | null> {
  if (accountId != null) {
    const accountRow = await trx
      .selectFrom('workflow_knowledge_bases')
      .select('id')
      .where('workspace_id', '=', workspaceId)
      .where('knowledge_context', '=', context)
      .where('account_id', '=', accountId)
      .executeTakeFirst();
    if (accountRow) return Number(accountRow.id);
  }
  const globalRow = await trx
    .selectFrom('workflow_knowledge_bases')
    .select('id')
    .where('workspace_id', '=', workspaceId)
    .where('knowledge_context', '=', context)
    .where('account_id', 'is', null)
    .executeTakeFirst();
  return globalRow ? Number(globalRow.id) : null;
}

export async function listKnowledgeBaseIdsForWorkflow(
  trx: WorkspaceTransaction,
  workspaceId: string,
  accountId: number | null,
  direction: string | undefined,
): Promise<number[]> {
  const contexts = knowledgeContextsForDirection(
    direction as 'inbound' | 'outbound' | 'draft_created' | undefined,
  );
  const ids = new Set<number>();
  for (const context of contexts) {
    if (!isKnowledgeContext(context)) continue;
    const id = await findKnowledgeBaseIdForContext(trx, workspaceId, accountId, context);
    if (id != null) ids.add(id);
  }
  return [...ids];
}

export async function searchKnowledgeForWorkflow(
  trx: WorkspaceTransaction,
  workspaceId: string,
  accountId: number | null,
  direction: string | undefined,
  query: string,
  limit = 5,
  explicitKbId?: number | null,
): Promise<WorkflowKnowledgeChunkMatch[]> {
  const kbIds = new Set<number>();
  if (explicitKbId != null && explicitKbId > 0) kbIds.add(explicitKbId);
  for (const id of await listKnowledgeBaseIdsForWorkflow(trx, workspaceId, accountId, direction)) {
    kbIds.add(id);
  }
  const merged: WorkflowKnowledgeChunkMatch[] = [];
  const perKb = Math.max(1, Math.ceil(limit / Math.max(1, kbIds.size)));
  for (const kbId of kbIds) {
    merged.push(...await keywordSearchChunks(trx, workspaceId, kbId, query, perKb));
  }
  return merged.slice(0, limit);
}

export async function buildKnowledgePromptAppend(
  trx: WorkspaceTransaction,
  workspaceId: string,
  accountId: number | null,
  direction: string | undefined,
  query: string,
): Promise<string> {
  const chunks = await searchKnowledgeForWorkflow(trx, workspaceId, accountId, direction, query, 5);
  return formatKnowledgeChunksForPrompt(chunks);
}

export type KnowledgeWorkflowSearchDb = Kysely<ServerDatabase>;
