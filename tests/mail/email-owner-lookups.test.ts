/**
 * @jest-environment node
 *
 * Eigentuemer-Lookups, mit denen die Mail-IPC (ipc-account-scope) Objekt-IDs
 * auf ihr Konto aufloest. Echte SQLite (frisches Schema).
 */
import Database from 'better-sqlite3';

let db: Database.Database;

jest.mock('../../electron/sqlite-service', () => {
  const actual = jest.requireActual('../../electron/sqlite-service');
  return {
    ...actual,
    getDb: () => db,
  };
});

import { bootstrapFreshDatabaseSchema } from '../../electron/sqlite-service';
import { getMessageAccountIds } from '../../electron/email/email-store';
import {
  getAiPromptById,
  getCannedResponseById,
  getInternalNoteMessageId,
} from '../../electron/email/email-crm-store';
import { getKnowledgeBaseById } from '../../electron/workflow/knowledge-base';
import { getWorkflowRunMessageId } from '../../electron/workflow/run-steps';

function insert(table: string, cols: Record<string, unknown>): number {
  const keys = Object.keys(cols);
  const r = db
    .prepare(`INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`)
    .run(...Object.values(cols));
  return Number(r.lastInsertRowid);
}

describe('Eigentuemer-Lookups fuer die Konto-ACL', () => {
  let messageA: number;
  let messageB: number;

  beforeEach(() => {
    db = new Database(':memory:');
    bootstrapFreshDatabaseSchema(db);
    for (const id of [1, 2]) {
      insert('email_accounts', {
        id,
        display_name: `Konto ${id}`,
        email_address: `k${id}@firma.de`,
        imap_host: 'imap.firma.de',
        imap_username: `k${id}`,
        keytar_account_key: `k${id}`,
      });
      insert('email_folders', { id, account_id: id, path: 'INBOX' });
    }
    messageA = insert('email_messages', { account_id: 1, folder_id: 1, uid: 1, subject: 'A' });
    messageB = insert('email_messages', { account_id: 2, folder_id: 2, uid: 1, subject: 'B' });
  });

  afterEach(() => {
    db.close();
  });

  // C-A14: Bulk-Kanaele brauchen das Konto jeder Nachricht, unbekannte IDs fehlen in der Map.
  test('getMessageAccountIds liefert das Konto je bekannter Nachricht', () => {
    expect(getMessageAccountIds([messageA, messageB, 999, messageA])).toEqual(
      new Map([
        [messageA, 1],
        [messageB, 2],
      ]),
    );
    expect(getMessageAccountIds([])).toEqual(new Map());
  });

  // C-A25/C-A29/C-A49: Notizen, Vorlagen, Prompts, Wissensbasen und Laeufe wurden nicht aufgeloest.
  test('Notiz, Vorlage, Prompt, Wissensbasis und Lauf nennen ihr Konto bzw. ihre Nachricht', () => {
    const note = insert('email_internal_notes', { message_id: messageB, body: 'Notiz' });
    const canned = insert('email_canned_responses', { title: 'B', body: 'b', account_id: 2 });
    const cannedGlobal = insert('email_canned_responses', { title: 'G', body: 'g' });
    const prompt = insert('email_ai_prompts', { label: 'B', user_template: 'x', account_id: 2 });
    const kb = insert('workflow_knowledge_bases', { name: 'B', account_id: 2 });
    const workflow = insert('email_workflows', { name: 'W', trigger: 'inbound', definition_json: '{}' });
    const run = insert('email_workflow_runs', {
      workflow_id: workflow,
      message_id: messageB,
      direction: 'inbound',
      status: 'ok',
    });
    const cronRun = insert('email_workflow_runs', { workflow_id: workflow, direction: 'cron', status: 'ok' });

    expect(getInternalNoteMessageId(note)).toBe(messageB);
    expect(getCannedResponseById(canned)?.account_id).toBe(2);
    expect(getCannedResponseById(cannedGlobal)?.account_id).toBeNull();
    expect(getAiPromptById(prompt)?.account_id).toBe(2);
    expect(getKnowledgeBaseById(kb)?.account_id).toBe(2);
    expect(getWorkflowRunMessageId(run)).toEqual({ message_id: messageB });
    expect(getWorkflowRunMessageId(cronRun)).toEqual({ message_id: null });

    expect(getInternalNoteMessageId(999)).toBeUndefined();
    expect(getCannedResponseById(999)).toBeUndefined();
    expect(getAiPromptById(999)).toBeUndefined();
    expect(getKnowledgeBaseById(999)).toBeUndefined();
    expect(getWorkflowRunMessageId(999)).toBeUndefined();
  });
});
