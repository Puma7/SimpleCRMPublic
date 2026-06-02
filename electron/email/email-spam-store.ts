import { getDb, getSyncInfo, setSyncInfo } from '../sqlite-service';
import {
  EMAIL_MESSAGES_TABLE,
  EMAIL_SPAM_DECISIONS_TABLE,
  EMAIL_SPAM_FEATURE_STATS_TABLE,
  EMAIL_SPAM_LEARNING_EVENTS_TABLE,
  EMAIL_SPAM_LIST_ENTRIES_TABLE,
} from '../database-schema';
import type { EmailMessageRow } from './email-store';
import { buildFeaturePreview, normalizeSenderEmail, senderDomain } from './email-spam-features';
import type {
  SpamListEntry,
  SpamListType,
  SpamPatternType,
  SpamScoreBreakdown,
  SpamTrainingLabel,
} from './email-spam-types';

const LEGACY_WHITELIST_KEY = 'workflow_sender_whitelist';
const LEGACY_BLACKLIST_KEY = 'workflow_sender_blacklist';
const LEGACY_MIGRATION_KEY = 'email_spam_legacy_lists_migrated_v1';

export type SpamListInput = {
  id?: number;
  listType: SpamListType;
  patternType?: SpamPatternType;
  pattern: string;
  accountId?: number | null;
  note?: string | null;
};

export type SpamFeatureStat = {
  feature_key: string;
  spam_count: number;
  ham_count: number;
};

type SpamListMatch = {
  listType: SpamListType;
  patternType: SpamPatternType;
  pattern: string;
  specificity: number;
};

function parseLegacyList(raw: string | null | undefined): string[] {
  return (raw ?? '')
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function normalizeSpamPattern(
  rawPattern: string,
  rawType?: SpamPatternType,
): { pattern: string; patternType: SpamPatternType } {
  const trimmed = rawPattern.trim().toLowerCase();
  if (!trimmed) throw new Error('Spam-Listen-Eintrag darf nicht leer sein');
  const withoutAt = trimmed.startsWith('@') ? trimmed.slice(1) : trimmed;
  const inferred: SpamPatternType = rawType ?? (withoutAt.includes('@') ? 'email' : 'domain');
  const pattern = inferred === 'email' ? normalizeSenderEmail(withoutAt) : withoutAt.replace(/^\.+|\.+$/g, '');
  const domainPattern = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
  const valid =
    inferred === 'email'
      ? /^[^\s@]+@[^\s@]+$/.test(pattern) && domainPattern.test(senderDomain(pattern))
      : domainPattern.test(pattern);
  if (!valid) {
    throw new Error('Ungültiger Spam-Listen-Eintrag');
  }
  return { pattern, patternType: inferred };
}

function findExistingEntry(input: {
  listType: SpamListType;
  patternType: SpamPatternType;
  pattern: string;
  accountId: number | null;
}): { id: number } | undefined {
  const sql =
    input.accountId == null
      ? `SELECT id FROM ${EMAIL_SPAM_LIST_ENTRIES_TABLE}
         WHERE list_type = ? AND pattern_type = ? AND pattern = ? AND account_id IS NULL
         LIMIT 1`
      : `SELECT id FROM ${EMAIL_SPAM_LIST_ENTRIES_TABLE}
         WHERE list_type = ? AND pattern_type = ? AND pattern = ? AND account_id = ?
         LIMIT 1`;
  const params =
    input.accountId == null
      ? [input.listType, input.patternType, input.pattern]
      : [input.listType, input.patternType, input.pattern, input.accountId];
  return getDb().prepare(sql).get(...params) as { id: number } | undefined;
}

export function saveSpamListEntry(input: SpamListInput): SpamListEntry {
  const { pattern, patternType } = normalizeSpamPattern(input.pattern, input.patternType);
  const accountId = input.accountId ?? null;
  const note = input.note?.trim() || null;
  const existing = input.id
    ? { id: input.id }
    : findExistingEntry({ listType: input.listType, patternType, pattern, accountId });

  if (existing) {
    getDb()
      .prepare(
        `UPDATE ${EMAIL_SPAM_LIST_ENTRIES_TABLE}
         SET list_type = ?, pattern_type = ?, pattern = ?, account_id = ?, note = ?, updated_at = datetime('now')
         WHERE id = ?`,
      )
      .run(input.listType, patternType, pattern, accountId, note, existing.id);
    const updated = getSpamListEntry(existing.id);
    if (!updated) throw new Error('Spam-Listen-Eintrag nicht gefunden');
    return updated;
  }

  const r = getDb()
    .prepare(
      `INSERT INTO ${EMAIL_SPAM_LIST_ENTRIES_TABLE}
       (list_type, pattern_type, pattern, account_id, note)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(input.listType, patternType, pattern, accountId, note);
  return getSpamListEntry(Number(r.lastInsertRowid))!;
}

export function getSpamListEntry(id: number): SpamListEntry | undefined {
  return getDb()
    .prepare(`SELECT * FROM ${EMAIL_SPAM_LIST_ENTRIES_TABLE} WHERE id = ?`)
    .get(id) as SpamListEntry | undefined;
}

export function deleteSpamListEntry(id: number): boolean {
  const r = getDb().prepare(`DELETE FROM ${EMAIL_SPAM_LIST_ENTRIES_TABLE} WHERE id = ?`).run(id);
  return r.changes > 0;
}

export function migrateLegacySpamLists(): void {
  if (getSyncInfo(LEGACY_MIGRATION_KEY)) return;
  for (const pattern of parseLegacyList(getSyncInfo(LEGACY_WHITELIST_KEY))) {
    try {
      saveSpamListEntry({ listType: 'allow', pattern });
    } catch {
      /* ignore invalid legacy entries */
    }
  }
  for (const pattern of parseLegacyList(getSyncInfo(LEGACY_BLACKLIST_KEY))) {
    try {
      saveSpamListEntry({ listType: 'block', pattern });
    } catch {
      /* ignore invalid legacy entries */
    }
  }
  setSyncInfo(LEGACY_MIGRATION_KEY, '1');
}

export function listSpamListEntries(accountId?: number | 'all' | null): SpamListEntry[] {
  migrateLegacySpamLists();
  if (typeof accountId === 'number') {
    return getDb()
      .prepare(
        `SELECT * FROM ${EMAIL_SPAM_LIST_ENTRIES_TABLE}
         WHERE account_id IS NULL OR account_id = ?
         ORDER BY list_type ASC, pattern_type ASC, pattern ASC`,
      )
      .all(accountId) as SpamListEntry[];
  }
  return getDb()
    .prepare(
      `SELECT * FROM ${EMAIL_SPAM_LIST_ENTRIES_TABLE}
       ORDER BY list_type ASC, pattern_type ASC, pattern ASC`,
    )
    .all() as SpamListEntry[];
}

function matchEntry(entry: SpamListEntry, senderEmail: string, domain: string): number {
  if (entry.pattern_type === 'email') return senderEmail === entry.pattern ? 100 : 0;
  if (domain === entry.pattern) return 80;
  if (domain.endsWith(`.${entry.pattern}`)) return 60;
  return 0;
}

export function selectSpamListMatch(
  entries: SpamListEntry[],
  row: EmailMessageRow,
): SpamListMatch | null {
  const preview = buildFeaturePreview(row);
  let bestAllow: SpamListMatch | null = null;
  let bestBlock: SpamListMatch | null = null;
  for (const entry of entries) {
    const specificity = matchEntry(entry, preview.senderEmail, preview.senderDomain);
    if (specificity <= 0) continue;
    const match = {
      listType: entry.list_type,
      patternType: entry.pattern_type,
      pattern: entry.pattern,
      specificity,
    };
    if (entry.list_type === 'allow') {
      if (!bestAllow || specificity > bestAllow.specificity) bestAllow = match;
    } else if (!bestBlock || specificity > bestBlock.specificity) {
      bestBlock = match;
    }
  }
  return bestAllow ?? bestBlock;
}

export function evaluateSpamListMatch(row: EmailMessageRow): SpamListMatch | null {
  return selectSpamListMatch(listSpamListEntries(row.account_id), row);
}

export function loadSpamFeatureStats(featureKeys: string[]): Map<string, SpamFeatureStat> {
  const out = new Map<string, SpamFeatureStat>();
  if (featureKeys.length === 0) return out;
  const placeholders = featureKeys.map(() => '?').join(',');
  const rows = getDb()
    .prepare(
      `SELECT feature_key, spam_count, ham_count
       FROM ${EMAIL_SPAM_FEATURE_STATS_TABLE}
       WHERE feature_key IN (${placeholders})`,
    )
    .all(...featureKeys) as SpamFeatureStat[];
  for (const row of rows) {
    out.set(row.feature_key, row);
  }
  return out;
}

export function recordSpamLearningForMessage(
  row: EmailMessageRow,
  label: SpamTrainingLabel,
  source: string,
): void {
  const featureKeys = buildFeaturePreview(row).featureKeys;
  const db = getDb();
  const spamInc = label === 'spam' ? 1 : 0;
  const hamInc = label === 'ham' ? 1 : 0;
  const insertEvent = db.prepare(
    `INSERT INTO ${EMAIL_SPAM_LEARNING_EVENTS_TABLE}
     (message_id, account_id, label, source, feature_keys_json)
     VALUES (?, ?, ?, ?, ?)`,
  );
  const upsertStat = db.prepare(
    `INSERT INTO ${EMAIL_SPAM_FEATURE_STATS_TABLE}
     (feature_key, spam_count, ham_count, updated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(feature_key) DO UPDATE SET
       spam_count = spam_count + excluded.spam_count,
       ham_count = ham_count + excluded.ham_count,
       updated_at = datetime('now')`,
  );
  const tx = db.transaction(() => {
    insertEvent.run(row.id, row.account_id, label, source, JSON.stringify(featureKeys));
    for (const featureKey of featureKeys) {
      upsertStat.run(featureKey, spamInc, hamInc);
    }
  });
  tx();
}

export function saveSpamDecision(
  messageId: number,
  row: EmailMessageRow,
  breakdown: SpamScoreBreakdown,
): void {
  const json = JSON.stringify(breakdown);
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE ${EMAIL_MESSAGES_TABLE}
       SET spam_score = ?,
           spam_score_label = ?,
           spam_decision_source = ?,
           spam_score_breakdown_json = ?,
           spam_decided_at = datetime('now')
       WHERE id = ?`,
    ).run(breakdown.score, breakdown.status, breakdown.source, json, messageId);
    db.prepare(
      `INSERT INTO ${EMAIL_SPAM_DECISIONS_TABLE}
       (message_id, account_id, score, status, source, breakdown_json, model_version)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      messageId,
      row.account_id,
      breakdown.score,
      breakdown.status,
      breakdown.source,
      json,
      breakdown.modelVersion,
    );
    db.prepare(
      `DELETE FROM ${EMAIL_SPAM_DECISIONS_TABLE}
       WHERE message_id = ?
         AND id NOT IN (
           SELECT id FROM ${EMAIL_SPAM_DECISIONS_TABLE}
           WHERE message_id = ?
           ORDER BY datetime(created_at) DESC, id DESC
           LIMIT 20
         )`,
    ).run(messageId, messageId);
  });
  tx();
}

export function labelForSpamStatus(status: string | null | undefined): SpamTrainingLabel | null {
  if (status === 'spam') return 'spam';
  if (status === 'clean') return 'ham';
  return null;
}

export function getSenderDomainForMessage(row: EmailMessageRow): string {
  const from = buildFeaturePreview(row).senderEmail;
  return senderDomain(from);
}
