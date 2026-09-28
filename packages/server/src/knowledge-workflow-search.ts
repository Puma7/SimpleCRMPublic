import { buildKnowledgeQueryTerms, KNOWLEDGE_SMALL_KB_MAX_CHARS } from '@simplecrm/core';
import { sql as kyselySql, type Kysely } from 'kysely';

import { ensureWorkflowKnowledgeSections } from './db/postgres-workflow-runtime-read-ports';
import type { ServerDatabase } from './db/schema';
import type { WorkspaceTransaction } from './db/workspace-context';

/** Mirrors shared/knowledge-context — inlined for packages/server Docker build (no /shared copy). */
export const KNOWLEDGE_CONTEXTS = ['inbound', 'outbound', 'general', 'learnings'] as const;
export type KnowledgeContext = (typeof KNOWLEDGE_CONTEXTS)[number];

export function isKnowledgeContext(value: unknown): value is KnowledgeContext {
  return typeof value === 'string' && (KNOWLEDGE_CONTEXTS as readonly string[]).includes(value);
}

/** Learnings (TA-P5) werden in jeder Richtung zusätzlich gelesen. */
export function knowledgeContextsForDirection(
  direction: 'inbound' | 'outbound' | 'draft_created' | 'manual' | string | undefined,
): KnowledgeContext[] {
  if (direction === 'outbound' || direction === 'draft_created') {
    return ['general', 'outbound', 'learnings'];
  }
  if (direction === 'inbound') {
    return ['general', 'inbound', 'learnings'];
  }
  return ['general', 'learnings'];
}

function formatKnowledgeChunksForPrompt(
  chunks: readonly { title?: string | null; content: string }[],
): string {
  if (chunks.length === 0) return '';
  const blocks = chunks.map((chunk) => {
    const title = chunk.title?.trim();
    const body = chunk.content.trim();
    return title ? `### ${title}\n${body}` : body;
  });
  return `\n\n---\nRelevante Wissensbasis:\n\n${blocks.join('\n\n')}\n---\n`;
}

export type WorkflowKnowledgeChunkMatch = {
  /** Id des Abschnitts (workflow_knowledge_sections). */
  id: number;
  /** Wissensbasis des Treffers (für ein faires Zeichenbudget je Wissensbasis). */
  knowledgeBaseId: number;
  /** Name der Wissensbasis (Quellenangabe am Entwurf). */
  knowledgeBaseName: string | null;
  title: string | null;
  content: string;
};

type SectionRow = {
  id: number | string;
  knowledge_base_id: number | string;
  knowledge_base_name: string | null;
  title: string;
  content: string;
};

function mapSectionRow(row: SectionRow): WorkflowKnowledgeChunkMatch {
  return {
    id: Number(row.id),
    knowledgeBaseId: Number(row.knowledge_base_id),
    knowledgeBaseName: row.knowledge_base_name ?? null,
    title: row.title,
    content: row.content,
  };
}

/**
 * Plan 048: Suche je `##`-Abschnitt mit Volltext (`german`) und Rangfolge
 * (ts_rank_cd), höchstens `perKb` Treffer je Wissensbasis, in der Reihenfolge
 * der übergebenen Wissensbasen. Kleine Wissensbasen (≤ 6 000 Zeichen) gehen
 * ganz mit. Ohne Treffer (auch ohne Suchbegriffe, z. B. nur Füllwörter)
 * liefert eine große Wissensbasis nichts. Fehlende oder veraltete Abschnitte werden vorher
 * nachgebaut. Die Suchbegriffe enthalten nur Buchstaben und Ziffern und gehen
 * als Parameter an to_tsquery.
 */
export async function searchKnowledgeSections(
  trx: WorkspaceTransaction,
  workspaceId: string,
  knowledgeBaseIds: readonly number[],
  query: string,
  perKb: number,
): Promise<WorkflowKnowledgeChunkMatch[]> {
  const ids = [...new Set(knowledgeBaseIds.filter((id) => Number.isSafeInteger(id) && id > 0))];
  if (ids.length === 0) return [];
  const limit = Math.max(1, Math.floor(perKb));
  await ensureWorkflowKnowledgeSections(trx, workspaceId, ids, new Date());

  const sizes = await trx
    .selectFrom('workflow_knowledge_sections')
    .select([
      'knowledge_base_id',
      kyselySql<number | string>`sum(length(title) + length(content))`.as('size'),
    ])
    .where('workspace_id', '=', workspaceId)
    .where('knowledge_base_id', 'in', ids)
    .groupBy('knowledge_base_id')
    .execute();
  const small = new Set(sizes.filter((row) => Number(row.size) <= KNOWLEDGE_SMALL_KB_MAX_CHARS).map((row) => Number(row.knowledge_base_id)));
  const large = ids.filter((id) => !small.has(id) && sizes.some((row) => Number(row.knowledge_base_id) === id));
  const terms = buildKnowledgeQueryTerms(query);
  const byKb = new Map<number, WorkflowKnowledgeChunkMatch[]>();
  const add = (rows: readonly SectionRow[]) => {
    for (const row of rows) {
      const match = mapSectionRow(row);
      byKb.set(match.knowledgeBaseId, [...(byKb.get(match.knowledgeBaseId) ?? []), match]);
    }
  };

  const baseSelect = (kbIds: readonly number[]) => trx
    .selectFrom('workflow_knowledge_sections as s')
    .innerJoin('workflow_knowledge_bases as kb', (join) => join
      .onRef('kb.workspace_id', '=', 's.workspace_id')
      .onRef('kb.id', '=', 's.knowledge_base_id'))
    .select(['s.id as id', 's.knowledge_base_id as knowledge_base_id', 'kb.name as knowledge_base_name', 's.title as title', 's.content as content'])
    .where('s.workspace_id', '=', workspaceId)
    .where('s.knowledge_base_id', 'in', kbIds);

  const smallIds = ids.filter((id) => small.has(id));
  if (smallIds.length > 0) {
    add(await baseSelect(smallIds).orderBy('s.knowledge_base_id').orderBy('s.position').execute() as SectionRow[]);
  }
  if (large.length > 0 && terms.length > 0) {
    const tsquery = kyselySql`to_tsquery('german', ${terms.join(' | ')})`;
    const ranked = await trx
      .selectFrom(
        baseSelect(large)
          .select([
            kyselySql<number>`ts_rank_cd(s.search_vector, ${tsquery})`.as('rank'),
            kyselySql<number>`row_number() over (partition by s.knowledge_base_id order by ts_rank_cd(s.search_vector, ${tsquery}) desc, s.position)`.as('rn'),
          ])
          .where(kyselySql<boolean>`s.search_vector @@ ${tsquery}`)
          .as('ranked'),
      )
      .selectAll()
      .where('rn', '<=', limit)
      .orderBy('knowledge_base_id')
      .orderBy('rank', 'desc')
      .execute() as SectionRow[];
    add(ranked);
  }
  return ids.flatMap((id) => byKb.get(id) ?? []);
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
  // Eine im Knoten gewählte Wissensbasis ergänzt die Kontext-Wissensbasen der
  // Richtung — die Learnings eingeschlossen — statt sie zu ersetzen.
  for (const id of await listKnowledgeBaseIdsForWorkflow(trx, workspaceId, accountId, direction)) {
    kbIds.add(id);
  }
  // Je Wissensbasis gedeckelt, nicht insgesamt: sonst fielen die zuletzt
  // gelesenen (Learnings) heraus. Das Zeichenbudget verteilt joinKnowledgeWithinBudget.
  const perKb = Math.max(1, Math.ceil(limit / Math.max(1, kbIds.size)));
  return searchKnowledgeSections(trx, workspaceId, [...kbIds], query, perKb);
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
