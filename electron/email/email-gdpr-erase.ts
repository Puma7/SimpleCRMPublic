// SPIKE PROTOTYPE — not wired into IPC. Preview is the supported path; apply is dry-run by default.
//
// Direction spike (plan 022): a dry-run/preview counterpart to the GDPR data
// export (`electron/email/email-gdpr-export.ts`). It enumerates exactly what a
// data-subject erasure would touch WITHOUT mutating anything. The apply path
// (anonymize-in-place) exists only to prove the design and is guarded behind an
// explicit `dryRun: false`; it is deliberately NOT registered on any IPC channel
// and must never run against a real user database from production UI. See
// `docs/design/gdpr-erasure-spike.md` for the design and open questions.

import fs from 'fs';
import { getDb } from '../sqlite-service';
import {
  EMAIL_MESSAGES_TABLE,
  EMAIL_INTERNAL_NOTES_TABLE,
  EMAIL_MESSAGE_ATTACHMENTS_TABLE,
  EMAIL_WORKFLOW_RUNS_TABLE,
} from '../database-schema';

// Lifted from the export so the erase walk stays in step with it
// (`email-gdpr-export.ts:16-17`).
const MESSAGE_BATCH = 2000;

// Non-null tombstone sentinel. `email_message_attachments.storage_path` is
// `TEXT NOT NULL`, so it must never be set to NULL — it is overwritten with this
// sentinel after the real on-disk path has been captured for post-commit unlink.
const ERASED = '[erased]';

// The address columns (from_json/to_json/cc_json/bcc_json) are read back with
// JSON.parse downstream (e.g. ai-nodes.ts, email-crm-store.ts). A raw '[erased]'
// string is NOT valid JSON and would throw SyntaxError there, so those columns
// get a valid-JSON tombstone instead. Non-JSON text columns (subject/snippet/
// body_text/body_html) keep the raw ERASED sentinel.
const ERASED_JSON = JSON.stringify(ERASED); // → "[erased]" (a valid JSON string)

export type ErasureSelectorInput = {
  emails?: string[];
  customerId?: number;
};

export type ErasureCounts = {
  messages: number;
  notes: number;
  attachments: number;
  workflowRuns: number;
};

export type ErasurePlan = {
  selector: { emails: string[]; customerId: number | null };
  messageIds: number[];
  counts: ErasureCounts;
  /** Real on-disk attachment paths a real erase would unlink AFTER commit. */
  attachmentFiles: string[];
};

export type ErasureAudit = {
  erasedAt: string;
  selector: { emails: string[]; customerId: number | null };
  counts: ErasureCounts;
  unlinkedFiles: number;
  orphanedFiles: number;
};

export type ErasureResult =
  | { dryRun: true; plan: ErasurePlan }
  | {
      dryRun: false;
      plan: ErasurePlan;
      unlinkedFiles: string[];
      orphanedFiles: string[];
      audit: ErasureAudit;
    };

type MatchClause = { where: string; params: unknown[] };

/**
 * Build the OR-combined match predicate for the data subject. Emails are matched
 * by naive substring against the JSON address columns (an intentional prototype
 * shortcut — production must parse the address JSON; see design open questions),
 * and/or by `customer_id`.
 */
// Escape the LIKE metacharacters (\ % _) in a selector so a literal address is
// matched literally: without this, `first_last@x.com` (the `_` is a LIKE
// single-char wildcard) would also match `firstXlast@x.com` and anonymize the
// wrong person on the dryRun:false path. Paired with `ESCAPE '\'` on each LIKE.
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

function buildMatch(input: ErasureSelectorInput): MatchClause {
  const clauses: string[] = [];
  const params: unknown[] = [];
  for (const email of input.emails ?? []) {
    clauses.push(
      "(from_json LIKE ? ESCAPE '\\' OR to_json LIKE ? ESCAPE '\\' " +
        "OR cc_json LIKE ? ESCAPE '\\' OR bcc_json LIKE ? ESCAPE '\\')",
    );
    const like = `%${escapeLike(email)}%`;
    params.push(like, like, like, like);
  }
  if (typeof input.customerId === 'number') {
    clauses.push('customer_id = ?');
    params.push(input.customerId);
  }
  if (clauses.length === 0) {
    throw new Error(
      'planSubjectErasure requires at least one selector (emails or customerId)',
    );
  }
  return { where: clauses.join(' OR '), params };
}

function countScalar(sql: string, params: unknown[]): number {
  const row = getDb().prepare(sql).get(...params) as { c?: number } | undefined;
  return Number(row?.c ?? 0);
}

/**
 * Pure preview. Reads only — issues no writes and unlinks no files. Walks the
 * matching `email_messages` in batches (reusing the export's loop shape), then
 * counts the dependent rows an erasure would touch and collects every
 * attachment `storage_path` that a real erase would unlink.
 */
export function planSubjectErasure(input: ErasureSelectorInput): ErasurePlan {
  const db = getDb();
  const { where, params } = buildMatch(input);
  const selector = {
    emails: input.emails ?? [],
    customerId: typeof input.customerId === 'number' ? input.customerId : null,
  };

  // Message batch walk — reuses `email-gdpr-export.ts:91-111` (ORDER BY id ASC
  // LIMIT ? OFFSET ?, MESSAGE_BATCH).
  const messageIds: number[] = [];
  let offset = 0;
  for (;;) {
    const batch = db
      .prepare(
        `SELECT id FROM ${EMAIL_MESSAGES_TABLE}
         WHERE ${where}
         ORDER BY id ASC
         LIMIT ? OFFSET ?`,
      )
      .all(...params, MESSAGE_BATCH, offset) as { id: number }[];
    if (batch.length === 0) break;
    for (const row of batch) messageIds.push(row.id);
    offset += batch.length;
    if (batch.length < MESSAGE_BATCH) break;
  }

  if (messageIds.length === 0) {
    return {
      selector,
      messageIds,
      counts: { messages: 0, notes: 0, attachments: 0, workflowRuns: 0 },
      attachmentFiles: [],
    };
  }

  // Counts + collected paths use a subquery over the same predicate so the set
  // matches the walk without an unbounded IN (...) list.
  const notes = countScalar(
    `SELECT COUNT(*) AS c FROM ${EMAIL_INTERNAL_NOTES_TABLE}
     WHERE message_id IN (SELECT id FROM ${EMAIL_MESSAGES_TABLE} WHERE ${where})`,
    params,
  );

  const attachmentRows = db
    .prepare(
      `SELECT id, storage_path FROM ${EMAIL_MESSAGE_ATTACHMENTS_TABLE}
       WHERE message_id IN (SELECT id FROM ${EMAIL_MESSAGES_TABLE} WHERE ${where})
       ORDER BY id ASC`,
    )
    .all(...params) as { id: number; storage_path: string }[];
  const attachmentFiles = attachmentRows.map((r) => r.storage_path);

  const workflowRuns = countScalar(
    `SELECT COUNT(*) AS c FROM ${EMAIL_WORKFLOW_RUNS_TABLE}
     WHERE message_id IN (SELECT id FROM ${EMAIL_MESSAGES_TABLE} WHERE ${where})`,
    params,
  );

  return {
    selector,
    messageIds,
    counts: {
      messages: messageIds.length,
      notes,
      attachments: attachmentFiles.length,
      workflowRuns,
    },
    attachmentFiles,
  };
}

/**
 * Guarded apply. Defaults to a dry run — with `dryRun` unset or `true` it returns
 * the plan and mutates nothing. Only an explicit `{ dryRun: false }` performs the
 * anonymize-in-place erasure, in two phases:
 *   1. a transaction (BEGIN/COMMIT/ROLLBACK) tombstones the PII columns, setting
 *      each attachment row's `storage_path` to a NON-NULL sentinel; then
 *   2. AFTER the commit, the real on-disk attachment files (captured in the plan)
 *      are unlinked. Unlink is post-commit on purpose: a ROLLBACK restores rows
 *      but cannot un-delete files, so unlinking inside the transaction could
 *      strand rows pointing at missing storage. A failed post-commit unlink only
 *      leaks an orphaned file (logged) — the committed row no longer references it.
 */
export function eraseSubject(
  input: ErasureSelectorInput,
  options: { dryRun?: boolean } = {},
): ErasureResult {
  const plan = planSubjectErasure(input);

  // Dry run is the default and the only path reachable without an explicit opt-in.
  if (options.dryRun !== false) {
    return { dryRun: true, plan };
  }

  const db = getDb();

  // Phase 1: transactional anonymize-in-place (per the table→action mapping).
  db.prepare('BEGIN TRANSACTION').run();
  try {
    const updateMessage = db.prepare(
      `UPDATE ${EMAIL_MESSAGES_TABLE}
       SET subject = ?, from_json = ?, to_json = ?, cc_json = ?, bcc_json = ?, snippet = ?,
           body_text = ?, body_html = ?, attachments_json = NULL,
           raw_headers = NULL, raw_rfc822_b64 = NULL
       WHERE id = ?`,
    );
    const updateNote = db.prepare(
      `UPDATE ${EMAIL_INTERNAL_NOTES_TABLE} SET body = ? WHERE message_id = ?`,
    );
    const updateAttachment = db.prepare(
      `UPDATE ${EMAIL_MESSAGE_ATTACHMENTS_TABLE}
       SET filename_display = ?, content_sha256 = NULL, size_bytes = 0, storage_path = ?
       WHERE message_id = ?`,
    );
    const updateRun = db.prepare(
      `UPDATE ${EMAIL_WORKFLOW_RUNS_TABLE} SET log_json = NULL WHERE message_id = ?`,
    );

    for (const id of plan.messageIds) {
      // Address columns get the valid-JSON tombstone; text columns keep raw ERASED.
      // Order: subject, from_json, to_json, cc_json, bcc_json, snippet, body_text, body_html, id.
      updateMessage.run(
        ERASED,
        ERASED_JSON,
        ERASED_JSON,
        ERASED_JSON,
        ERASED_JSON,
        ERASED,
        ERASED,
        ERASED,
        id,
      );
      updateNote.run(ERASED, id);
      // storage_path is set to the NON-NULL sentinel (column is TEXT NOT NULL).
      updateAttachment.run(ERASED, ERASED, id);
      updateRun.run(id);
    }

    db.prepare('COMMIT').run();
  } catch (err) {
    try {
      db.prepare('ROLLBACK').run();
    } catch {
      /* ignore rollback failure — original error is rethrown below */
    }
    throw err;
  }

  // Phase 2: post-commit file cleanup — ONLY after the transaction committed.
  const unlinkedFiles: string[] = [];
  const orphanedFiles: string[] = [];
  for (const filePath of plan.attachmentFiles) {
    try {
      fs.unlinkSync(filePath);
      unlinkedFiles.push(filePath);
    } catch (err) {
      orphanedFiles.push(filePath);
      console.warn(
        `[gdpr-erase] failed to unlink attachment (orphaned, row already anonymized): ${filePath}`,
        err,
      );
    }
  }

  const audit: ErasureAudit = {
    erasedAt: new Date().toISOString(),
    selector: plan.selector,
    counts: plan.counts,
    unlinkedFiles: unlinkedFiles.length,
    orphanedFiles: orphanedFiles.length,
  };
  console.info('[gdpr-erase] audit', JSON.stringify(audit));

  return { dryRun: false, plan, unlinkedFiles, orphanedFiles, audit };
}
