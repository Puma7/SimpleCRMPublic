import fs from 'fs';
import { createSqliteMock } from './helpers/sqlite-mock';

// SPIKE PROTOTYPE test (plan 022). Proves the erasure PREVIEW is non-destructive
// and that the guarded apply commits the DB tombstones BEFORE unlinking files.
// No real DB, no real filesystem writes — pure mock, exactly like the export test.
const { db, stmt } = createSqliteMock();

jest.mock('../../electron/sqlite-service', () => ({ getDb: () => db }));

import { planSubjectErasure, eraseSubject } from '../../electron/email/email-gdpr-erase';

function preparedSql(): string[] {
  return (db.prepare as jest.Mock).mock.calls.map((c) => String(c[0]));
}

const MUTATION = /\b(UPDATE|DELETE|BEGIN|COMMIT|ROLLBACK)\b/i;

describe('email-gdpr-erase (spike prototype)', () => {
  let unlinkSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    stmt.all.mockReset().mockReturnValue([]);
    stmt.get.mockReset().mockReturnValue(undefined);
    stmt.run.mockReset().mockReturnValue({ changes: 1, lastInsertRowid: 1 });
    unlinkSpy = jest.spyOn(fs, 'unlinkSync').mockImplementation(() => undefined);
    jest.spyOn(console, 'info').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('preview enumerates counts and attachment files', () => {
    stmt.all
      .mockReturnValueOnce([{ id: 1 }, { id: 2 }]) // message walk (< MESSAGE_BATCH → single call)
      .mockReturnValueOnce([
        { id: 10, storage_path: '/att/a' },
        { id: 11, storage_path: '/att/b' },
      ]); // attachments
    stmt.get
      .mockReturnValueOnce({ c: 3 }) // notes count
      .mockReturnValueOnce({ c: 1 }); // workflow-runs count

    const plan = planSubjectErasure({ emails: ['a@x.de'] });

    expect(plan.messageIds).toEqual([1, 2]);
    expect(plan.counts).toEqual({ messages: 2, notes: 3, attachments: 2, workflowRuns: 1 });
    expect(plan.attachmentFiles).toEqual(['/att/a', '/att/b']);
    expect(plan.selector).toEqual({ emails: ['a@x.de'], customerId: null });
  });

  test('preview issues only SELECTs — no mutation, no unlink', () => {
    stmt.all
      .mockReturnValueOnce([{ id: 1 }])
      .mockReturnValueOnce([{ id: 10, storage_path: '/att/a' }]);
    stmt.get.mockReturnValueOnce({ c: 0 }).mockReturnValueOnce({ c: 0 });

    planSubjectErasure({ emails: ['a@x.de'] });

    const sqls = preparedSql();
    expect(sqls.length).toBeGreaterThan(0);
    for (const s of sqls) expect(/^\s*SELECT/i.test(s)).toBe(true);
    expect(sqls.some((s) => MUTATION.test(s))).toBe(false);
    expect(stmt.run).not.toHaveBeenCalled();
    expect(unlinkSpy).not.toHaveBeenCalled();
  });

  test('escapes LIKE wildcards in the selector so `_` is literal, not a wildcard', () => {
    stmt.all.mockReturnValue([]);
    stmt.get.mockReturnValue({ c: 0 });

    planSubjectErasure({ emails: ['first_last@x.de'] });

    // The predicate opts into ESCAPE and the bound value backslash-escapes the
    // underscore, so it can't also match e.g. `firstXlast@x.de`.
    const sqls = preparedSql();
    expect(sqls.some((s) => s.includes("LIKE ? ESCAPE '\\'"))).toBe(true);
    const boundParams = (stmt.all as jest.Mock).mock.calls.flat();
    expect(boundParams).toContain('%first\\_last@x.de%');
    expect(boundParams).not.toContain('%first_last@x.de%');
  });

  test('eraseSubject defaults to dry-run and mutates nothing', () => {
    stmt.all
      .mockReturnValueOnce([{ id: 1 }])
      .mockReturnValueOnce([{ id: 10, storage_path: '/att/a' }]);
    stmt.get.mockReturnValueOnce({ c: 2 }).mockReturnValueOnce({ c: 0 });

    const result = eraseSubject({ emails: ['a@x.de'] }); // no options → dryRun defaults to true

    expect(result.dryRun).toBe(true);
    if (result.dryRun) {
      expect(result.plan.counts.messages).toBe(1);
      expect(result.plan.attachmentFiles).toEqual(['/att/a']);
    }
    const sqls = preparedSql();
    expect(sqls.some((s) => MUTATION.test(s))).toBe(false);
    expect(stmt.run).not.toHaveBeenCalled();
    expect(unlinkSpy).not.toHaveBeenCalled();
  });

  test('explicit apply wraps writes in BEGIN/COMMIT and unlinks files AFTER commit', () => {
    stmt.all
      .mockReturnValueOnce([{ id: 1 }, { id: 2 }])
      .mockReturnValueOnce([
        { id: 10, storage_path: '/att/a' },
        { id: 11, storage_path: '/att/b' },
      ]);
    stmt.get.mockReturnValueOnce({ c: 1 }).mockReturnValueOnce({ c: 0 });

    const result = eraseSubject({ emails: ['a@x.de'] }, { dryRun: false });

    expect(result.dryRun).toBe(false);

    const sqls = preparedSql();
    expect(sqls).toContain('BEGIN TRANSACTION');
    expect(sqls).toContain('COMMIT');
    expect(sqls.some((s) => /^\s*UPDATE\s+email_messages/i.test(s))).toBe(true);
    expect(sqls.some((s) => /^\s*UPDATE\s+email_internal_notes/i.test(s))).toBe(true);
    expect(sqls.some((s) => /^\s*UPDATE\s+email_workflow_runs/i.test(s))).toBe(true);

    // Attachment tombstone: storage_path is a bound NON-NULL sentinel, never NULL.
    const attSql = sqls.find((s) => /UPDATE\s+email_message_attachments/i.test(s)) ?? '';
    expect(attSql).toMatch(/storage_path\s*=\s*\?/i);
    expect(attSql).not.toMatch(/storage_path\s*=\s*NULL/i);
    // ...and the bound value for that statement is the '[erased]' sentinel.
    expect(stmt.run.mock.calls).toContainEqual(['[erased]', '[erased]', 1]);

    // Both files unlinked.
    expect(unlinkSpy).toHaveBeenCalledWith('/att/a');
    expect(unlinkSpy).toHaveBeenCalledWith('/att/b');
    if (!result.dryRun) {
      expect(result.unlinkedFiles).toEqual(['/att/a', '/att/b']);
      expect(result.orphanedFiles).toEqual([]);
      expect(result.audit.unlinkedFiles).toBe(2);
      expect(result.audit.selector).toEqual({ emails: ['a@x.de'], customerId: null });
    }

    // Ordering: the first unlink happens strictly AFTER the COMMIT was prepared.
    const prepareMock = db.prepare as jest.Mock;
    const commitIdx = prepareMock.mock.calls.findIndex((c) => c[0] === 'COMMIT');
    const commitOrder = prepareMock.mock.invocationCallOrder[commitIdx];
    const firstUnlinkOrder = unlinkSpy.mock.invocationCallOrder[0];
    expect(firstUnlinkOrder).toBeGreaterThan(commitOrder);
  });

  test('apply error path issues ROLLBACK and unlinks nothing', () => {
    stmt.all
      .mockReturnValueOnce([{ id: 1 }, { id: 2 }])
      .mockReturnValueOnce([{ id: 10, storage_path: '/att/a' }]);
    stmt.get.mockReturnValueOnce({ c: 0 }).mockReturnValueOnce({ c: 0 });

    // planSubjectErasure uses only .all()/.get(); the first .run() is BEGIN, the
    // second is the first UPDATE — throw there to simulate a mid-apply SQL error.
    let runCall = 0;
    stmt.run.mockReset().mockImplementation(() => {
      runCall += 1;
      if (runCall === 2) throw new Error('boom sql');
      return { changes: 1, lastInsertRowid: 1 };
    });

    expect(() => eraseSubject({ emails: ['a@x.de'] }, { dryRun: false })).toThrow('boom sql');

    const sqls = preparedSql();
    expect(sqls).toContain('BEGIN TRANSACTION');
    expect(sqls).toContain('ROLLBACK');
    expect(sqls).not.toContain('COMMIT');
    // File deletion is post-commit, so a rolled-back apply deletes nothing.
    expect(unlinkSpy).not.toHaveBeenCalled();
  });

  test('planSubjectErasure requires at least one selector', () => {
    expect(() => planSubjectErasure({})).toThrow(/at least one selector/i);
    // No selector → nothing is even prepared.
    expect(db.prepare).not.toHaveBeenCalled();
  });

  test('preview short-circuits to zero counts when no messages match', () => {
    stmt.all.mockReturnValueOnce([]); // empty message walk

    const plan = planSubjectErasure({ customerId: 42 });

    expect(plan.messageIds).toEqual([]);
    expect(plan.counts).toEqual({ messages: 0, notes: 0, attachments: 0, workflowRuns: 0 });
    expect(plan.attachmentFiles).toEqual([]);
    expect(plan.selector).toEqual({ emails: [], customerId: 42 });
    // Only the walk ran — no count/attachment queries.
    expect(preparedSql().length).toBe(1);
    expect(stmt.get).not.toHaveBeenCalled();
  });

  test('preview paginates the message walk across full batches', () => {
    stmt.all
      .mockReturnValueOnce(Array.from({ length: 2000 }, (_, i) => ({ id: i + 1 }))) // full batch → continue
      .mockReturnValueOnce([{ id: 2001 }]) // short batch → stop
      .mockReturnValueOnce([]); // attachments (none)
    stmt.get.mockReturnValueOnce({ c: 0 }).mockReturnValueOnce({ c: 0 });

    const plan = planSubjectErasure({ emails: ['a@x.de'] });

    expect(plan.messageIds.length).toBe(2001);
    expect(plan.counts.messages).toBe(2001);
  });

  test('apply records orphaned files when a post-commit unlink fails (no throw)', () => {
    stmt.all
      .mockReturnValueOnce([{ id: 1 }])
      .mockReturnValueOnce([{ id: 10, storage_path: '/att/a' }]);
    stmt.get.mockReturnValueOnce({ c: 0 }).mockReturnValueOnce({ c: 0 });
    unlinkSpy.mockImplementation(() => {
      throw new Error('EPERM');
    });

    const result = eraseSubject({ emails: ['a@x.de'] }, { dryRun: false });

    // The commit already happened, so a failed unlink only leaks a file — it does
    // not throw and does not corrupt the (committed) anonymization.
    expect(result.dryRun).toBe(false);
    if (!result.dryRun) {
      expect(result.unlinkedFiles).toEqual([]);
      expect(result.orphanedFiles).toEqual(['/att/a']);
      expect(result.audit.orphanedFiles).toBe(1);
    }
    expect(preparedSql()).toContain('COMMIT');
  });

  test('bcc-only subject: bcc_json is in the match predicate and bound once per address column', () => {
    stmt.all
      .mockReturnValueOnce([{ id: 1 }]) // message walk (matched via bcc)
      .mockReturnValueOnce([]); // attachments (none)
    stmt.get.mockReturnValueOnce({ c: 0 }).mockReturnValueOnce({ c: 0 });

    planSubjectErasure({ emails: ['bcc@x.de'] });

    // The predicate now covers bcc_json alongside from/to/cc.
    const walkSql = preparedSql().find((s) => /SELECT id FROM email_messages/i.test(s)) ?? '';
    expect(walkSql).toMatch(/bcc_json LIKE \?/i);

    // The address is bound once per address column (4×), proving a bcc-only data
    // subject is actually reached by the walk.
    const walkParams = stmt.all.mock.calls[0];
    expect(walkParams.filter((v: unknown) => v === '%bcc@x.de%')).toHaveLength(4);
  });

  test('apply anonymizes bcc_json and writes VALID JSON to every address column', () => {
    stmt.all
      .mockReturnValueOnce([{ id: 1 }])
      .mockReturnValueOnce([]); // no attachments
    stmt.get.mockReturnValueOnce({ c: 0 }).mockReturnValueOnce({ c: 0 });

    eraseSubject({ emails: ['bcc@x.de'] }, { dryRun: false });

    // The message UPDATE now sets bcc_json.
    const msgUpdateSql = preparedSql().find((s) => /^\s*UPDATE\s+email_messages/i.test(s)) ?? '';
    expect(msgUpdateSql).toMatch(/bcc_json\s*=\s*\?/i);

    // The message-anonymize run is the only 9-arg .run() call:
    // [subject, from_json, to_json, cc_json, bcc_json, snippet, body_text, body_html, id].
    const msgRun = stmt.run.mock.calls.find((c) => c.length === 9);
    expect(msgRun).toBeDefined();

    // (ii) Every address column parses as JSON — no SyntaxError downstream.
    for (const col of [1, 2, 3, 4]) {
      expect(() => JSON.parse(String(msgRun![col]))).not.toThrow();
    }
    // bcc_json specifically carries the valid-JSON tombstone (a JSON string), not
    // the raw '[erased]' that would blow up JSON.parse in ai-nodes/email-crm-store.
    expect(msgRun![4]).toBe('"[erased]"');
    // Non-JSON text columns keep the raw sentinel.
    expect(msgRun![0]).toBe('[erased]'); // subject
    expect(msgRun![5]).toBe('[erased]'); // snippet
    expect(msgRun![6]).toBe('[erased]'); // body_text
  });
});
