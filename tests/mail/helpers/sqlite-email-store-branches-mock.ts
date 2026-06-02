/** Stateful SQLite mock for exhaustive email-store branch tests. */
import { createSqliteMock, type StmtMock } from './sqlite-mock';
import { createEmailStoreState, seedMessage, type EmailStoreState } from './sqlite-email-store-state';
import { POP3_UID_CEILING } from '../../../electron/email/email-store';

export type SqliteEmailStoreBranchesMock = ReturnType<typeof createSqliteEmailStoreBranchesMock>;

export function createSqliteEmailStoreBranchesMock() {
  const base = createSqliteMock();
  const { db, stmt } = base;
  let lastSql = '';
  let lastArgs: unknown[] = [];
  const state = createEmailStoreState();

  function messagesArray(): (typeof state.messages extends Map<number, infer V> ? V : never)[] {
    return [...state.messages.values()];
  }

  function findFolder(accountId: number, path: string) {
    return [...state.folders.values()].find((f) => f.account_id === accountId && f.path === path);
  }

  function routeGet(...args: unknown[]): unknown {
    lastArgs = args;
    if (lastSql.includes('MIN(uid)') && lastSql.includes('uid < 0 AND uid >')) {
      const [accountId, folderId, ceiling] = args as [number, number, number];
      const uids = messagesArray()
        .filter(
          (m) =>
            m.account_id === accountId &&
            m.folder_id === folderId &&
            (m.uid as number) < 0 &&
            (m.uid as number) > ceiling,
        )
        .map((m) => m.uid as number);
      return { m: uids.length ? Math.min(...uids) : null };
    }
    if (lastSql.includes('MIN(uid)')) {
      const [accountId, folderId, ceiling] = args as [number, number, number];
      const uids = messagesArray()
        .filter(
          (m) =>
            m.account_id === accountId &&
            m.folder_id === folderId &&
            (m.uid as number) <= (ceiling ?? POP3_UID_CEILING),
        )
        .map((m) => m.uid as number);
      return { m: uids.length ? Math.min(...uids) : null };
    }
    if (lastSql.includes('SUM(CASE')) {
      const msgs = lastSql.includes('account_id = ?')
        ? messagesArray().filter((m) => m.account_id === args[0])
        : messagesArray();
      const spamStatus = (m: Record<string, unknown>) => String(m.spam_status ?? 'clean');
      const inbox = msgs.filter(
        (m) =>
          !m.soft_deleted &&
          ((((m.uid as number) >= 0 || m.pop3_uidl) &&
            (m.folder_kind === 'inbox' || m.folder_kind == null || m.folder_kind === '') &&
            !m.archived &&
            !m.is_spam &&
            spamStatus(m) === 'clean') ||
            ((m.uid as number) < 0 && m.folder_kind === 'draft' && m.outbound_hold)),
      );
      return {
        trash: msgs.filter((m) => m.soft_deleted).length,
        inbox: inbox.length,
        inbox_unread: inbox.filter((m) => !m.seen_local).length,
        sent_failed: msgs.filter(
          (m) =>
            !m.soft_deleted &&
            m.folder_kind === 'sent' &&
            !m.is_spam &&
            (m as { sent_imap_sync_failed?: number }).sent_imap_sync_failed === 1,
        ).length,
        drafts: msgs.filter((m) => !m.soft_deleted && m.folder_kind === 'draft').length,
        archived: msgs.filter(
          (m) =>
            !m.soft_deleted &&
            m.archived &&
            ((m.uid as number) >= 0 || m.pop3_uidl) &&
            !m.is_spam,
        ).length,
        spam_review: msgs.filter(
          (m) =>
            !m.soft_deleted &&
            ((m.uid as number) >= 0 || m.pop3_uidl) &&
            spamStatus(m) === 'review',
        ).length,
        spam: msgs.filter(
          (m) =>
            !m.soft_deleted &&
            ((m.uid as number) >= 0 || m.pop3_uidl) &&
            (m.is_spam || spamStatus(m) === 'spam'),
        ).length,
      };
    }
    if (lastSql.includes('signature_html') && lastSql.includes('account_id = ?')) {
      const html = state.signatures.get(args[0] as number);
      return html ? { signature_html: html } : undefined;
    }
    if (lastSql.includes('trash_prev_')) {
      return state.messages.get(args[0] as number);
    }
    if (lastSql.includes('has_attachments')) {
      const m = state.messages.get(args[0] as number);
      return m ? { has_attachments: m.has_attachments, attachments_json: m.attachments_json } : undefined;
    }
    if (lastSql.includes('EMAIL_ACCOUNTS') || lastSql.includes('email_accounts')) {
      if (lastSql.includes('WHERE id =')) return state.accounts.get(args[0] as number);
      return undefined;
    }
    if (lastSql.includes('EMAIL_FOLDERS') || lastSql.includes('email_folders')) {
      if (lastSql.includes('WHERE id =')) return state.folders.get(args[0] as number);
      if (lastSql.includes('account_id = ? AND path =')) {
        return findFolder(args[0] as number, args[1] as string);
      }
    }
    if (lastSql.includes('pop3_uidl = ?')) {
      const [accountId, folderId, uidl] = args as [number, number, string];
      const m = messagesArray().find(
        (x) => x.account_id === accountId && x.folder_id === folderId && x.pop3_uidl === uidl,
      );
      return m ? { id: m.id } : undefined;
    }
    if (lastSql.includes('uid = ?') && lastSql.includes('SELECT id')) {
      const [accountId, folderId, uid] = args as [number, number, number];
      const m = messagesArray().find(
        (x) => x.account_id === accountId && x.folder_id === folderId && x.uid === uid,
      );
      return m ? { id: m.id } : undefined;
    }
    if (lastSql.includes('EMAIL_MESSAGES') || lastSql.includes('email_messages')) {
      if (lastSql.includes('WHERE id =')) return state.messages.get(args[0] as number);
    }
    return undefined;
  }

  function routeAll(...args: unknown[]): unknown[] {
    lastArgs = args;
    if (lastSql.includes('email_team_members')) return [...state.teamMembers];
    if (lastSql.includes('email_accounts') && lastSql.includes('LEFT JOIN')) {
      return [...state.accounts.values()].map((a) => ({
        account_id: a.id,
        display_name: a.display_name,
        email_address: a.email_address,
        signature_html: state.signatures.get(a.id as number) ?? null,
      }));
    }
    if (lastSql.includes('email_accounts')) return [...state.accounts.values()];
    if (lastSql.includes('email_folders')) return [...state.folders.values()];
    if (lastSql.includes('SELECT id, pop3_uidl FROM')) {
      return messagesArray()
        .filter(
          (m) =>
            m.folder_id === args[0] &&
            m.pop3_uidl &&
            String(m.pop3_uidl).trim(),
        )
        .map((m) => ({ id: m.id, pop3_uidl: m.pop3_uidl }));
    }
    if (lastSql.includes('SELECT pop3_uidl FROM')) {
      return messagesArray()
        .filter(
          (m) =>
            m.folder_id === args[0] &&
            m.pop3_uidl &&
            String(m.pop3_uidl).trim() &&
            (m.post_process_done ?? 1) === 1,
        )
        .map((m) => ({ pop3_uidl: m.pop3_uidl }));
    }
    if (lastSql.includes('uid IN')) {
      const folderId = args[0] as number;
      const uids = args.slice(1) as number[];
      return messagesArray()
        .filter((m) => m.folder_id === folderId && uids.includes(m.uid as number))
        .map((m) => ({ uid: m.uid, id: m.id }));
    }
    if (lastSql.includes('SELECT tag FROM')) {
      const tags = state.tags.get(args[0] as number);
      return tags ? [...tags].map((tag) => ({ tag })) : [];
    }
    if (lastSql.includes('SELECT id FROM') && lastSql.includes('ORDER BY id ASC')) {
      return messagesArray()
        .filter((m) => (m.uid as number) >= 0 || m.pop3_uidl)
        .filter((m) => !m.soft_deleted)
        .slice(args[1] as number, (args[1] as number) + (args[0] as number))
        .map((m) => ({ id: m.id }));
    }
    if (lastSql.includes('post_process_done, 0) = 0')) {
      return messagesArray()
        .filter(
          (m) =>
            m.folder_id === args[0] &&
            !(m.post_process_done ?? 1) &&
            ((m.uid as number) >= 0 || m.pop3_uidl),
        )
        .map((m) => ({
          id: m.id,
          message_id: m.message_id,
          in_reply_to: m.in_reply_to,
          references_header: m.references_header,
          subject: m.subject,
        }));
    }
    if (lastSql.includes('email_messages')) return messagesArray();
    return [];
  }

  function routeRun(...args: unknown[]): { changes: number; lastInsertRowid: number } {
    lastArgs = args;
    if (lastSql.includes('INSERT INTO') && lastSql.includes('email_accounts')) {
      const id = state.nextAccountId++;
      state.accounts.set(id, {
        id,
        display_name: args[0],
        email_address: args[1],
        imap_host: args[2],
        imap_port: args[3],
        imap_tls: args[4],
        imap_username: args[5],
        keytar_account_key: args[6],
        smtp_host: args[7],
        smtp_port: args[8],
        smtp_tls: args[9],
        smtp_username: args[10],
        smtp_use_imap_auth: args[11],
        smtp_keytar_account_key: args[12],
        protocol: args[13],
        pop3_host: args[14],
        pop3_port: args[15],
        pop3_tls: args[16],
        imap_sync_seen_on_open: args[17],
        created_at: args[18],
        updated_at: args[19],
        oauth_provider: null,
        oauth_refresh_keytar_key: null,
        sent_folder_path: 'Sent',
        vacation_enabled: 0,
        vacation_subject: null,
        vacation_body_text: null,
        request_read_receipt: 0,
      });
      return { changes: 1, lastInsertRowid: id };
    }
    if (lastSql.includes('DELETE FROM') && lastSql.includes('email_accounts')) {
      state.accounts.delete(args[0] as number);
      return { changes: 1, lastInsertRowid: 0 };
    }
    if (lastSql.includes('DELETE FROM') && lastSql.includes('signatures')) {
      state.signatures.delete(args[0] as number);
      return { changes: 1, lastInsertRowid: 0 };
    }
    if (lastSql.includes('INSERT INTO') && lastSql.includes('signatures')) {
      state.signatures.set(args[0] as number, args[1] as string);
      return { changes: 1, lastInsertRowid: 1 };
    }
    if (lastSql.includes('INSERT INTO') && lastSql.includes('email_folders')) {
      const id = state.nextFolderId++;
      state.folders.set(id, {
        id,
        account_id: args[0],
        path: args[1],
        delimiter: args[2],
        uidvalidity: args[3],
        uidvalidity_str: args[4],
        last_uid: args[5],
        pop3_uidl_str: args[6],
        last_synced_at: args[7],
      });
      return { changes: 1, lastInsertRowid: id };
    }
    if (lastSql.includes('UPDATE') && lastSql.includes('email_folders')) {
      const id = args[args.length - 1] as number;
      const folder = state.folders.get(id);
      if (folder) Object.assign(folder, { last_synced_at: args[args.length - 2] });
      return { changes: 1, lastInsertRowid: 0 };
    }
    if (lastSql.includes('INSERT INTO') && lastSql.includes('email_team_members')) {
      state.teamMembers.push({
        id: String(args[0]).trim(),
        display_name: String(args[1]).trim(),
        role: String(args[2]).trim() || 'agent',
        signature_html: args[3] ? String(args[3]).trim() : null,
        sort_order: (args[4] as number) ?? 0,
        created_at: String(args[5]),
      });
      return { changes: 1, lastInsertRowid: 0 };
    }
    if (lastSql.includes('DELETE FROM') && lastSql.includes('email_team_members')) {
      state.teamMembers = state.teamMembers.filter((m) => m.id !== args[0]);
      return { changes: 1, lastInsertRowid: 0 };
    }
    if (lastSql.includes('INSERT OR IGNORE INTO') && lastSql.includes('tags')) {
      const [messageId, tag] = args as [number, string];
      if (!state.tags.has(messageId)) state.tags.set(messageId, new Set());
      state.tags.get(messageId)!.add(tag);
      return { changes: 1, lastInsertRowid: 0 };
    }
    if (lastSql.includes('DELETE FROM') && lastSql.includes('tags')) {
      state.tags.get(args[0] as number)?.delete(args[1] as string);
      return { changes: 1, lastInsertRowid: 0 };
    }
    if (lastSql.includes('DELETE FROM') && lastSql.includes('email_messages')) {
      state.messages.delete(args[0] as number);
      return { changes: 1, lastInsertRowid: 0 };
    }
    if (lastSql.includes('ON CONFLICT') || lastSql.includes('INSERT INTO') && lastSql.includes('email_messages')) {
      const id = state.nextMessageId++;
      const uid = args[2] as number;
      seedMessage(state, {
        id,
        account_id: args[0],
        folder_id: args[1],
        uid,
        message_id: args[3],
        in_reply_to: args[4],
        references_header: args[5],
        subject: args[6],
        from_json: args[7],
        to_json: args[8],
        cc_json: args[9],
        bcc_json: args[10],
        date_received: args[11],
        snippet: args[12],
        body_text: args[13],
        body_html: args[14],
        seen_local: args[15],
        imap_thread_id: args[16],
        has_attachments: args[17],
        attachments_json: args[18],
        pop3_uidl: args[19],
        raw_headers: args[20],
        raw_rfc822_b64: args[21],
        folder_kind: args[22],
        archived: args[23],
        is_spam: args[24],
        spam_status: args[25],
      });
      return { changes: 1, lastInsertRowid: id };
    }
    if (lastSql.includes('UPDATE') && lastSql.includes('email_messages')) {
      if (lastSql.includes('assigned_to = NULL') && lastSql.includes('WHERE assigned_to')) {
        const memberId = args[0] as string;
        for (const msg of state.messages.values()) {
          if (msg.assigned_to === memberId) msg.assigned_to = null;
        }
        return { changes: 1, lastInsertRowid: 0 };
      }
      const id = args[args.length - 1] as number;
      const msg = state.messages.get(id);
      if (msg) {
        if (lastSql.includes('soft_deleted = 1') && lastSql.includes('trash_prev')) {
          msg.soft_deleted = 1;
          msg.trash_prev_archived = args[0];
          msg.trash_prev_is_spam = args[1];
          msg.trash_prev_folder_kind = args[2];
        } else if (lastSql.includes('soft_deleted = 0') && lastSql.includes('trash_prev_archived = NULL')) {
          msg.soft_deleted = 0;
          msg.archived = args[0];
          msg.is_spam = args[1];
          msg.folder_kind = args[2];
          msg.trash_prev_archived = null;
          msg.trash_prev_is_spam = null;
          msg.trash_prev_folder_kind = null;
        } else if (lastSql.includes('folder_kind = \'draft\'')) {
          msg.folder_kind = 'draft';
          msg.draft_attachment_paths_json = args[0];
        } else if (lastSql.includes('subject = ?') && lastSql.includes('body_text = ?')) {
          msg.subject = args[0];
          msg.body_text = args[1];
          msg.snippet = args[2];
          let idx = 3;
          if (lastSql.includes('body_html = ?')) {
            msg.body_html = args[idx++];
          }
          if (lastSql.includes('to_json = ?')) msg.to_json = args[idx++];
          if (lastSql.includes('cc_json = ?')) msg.cc_json = args[idx++];
          if (lastSql.includes('bcc_json = ?')) msg.bcc_json = args[idx++];
          if (lastSql.includes('draft_attachment_paths_json = ?')) {
            msg.draft_attachment_paths_json = args[idx++];
          }
          if (lastSql.includes('reply_parent_message_id = ?')) {
            msg.reply_parent_message_id = args[idx++];
          }
        } else if (lastSql.includes('folder_kind = \'sent\'')) {
          msg.folder_kind = 'sent';
          msg.outbound_hold = 0;
        } else if (lastSql.includes("spam_status = 'spam'")) {
          msg.is_spam = 1;
          msg.spam_status = 'spam';
          msg.soft_deleted = 0;
          msg.archived = 0;
          msg.done_local = 1;
        } else if (lastSql.includes("spam_status = 'review'")) {
          msg.is_spam = 0;
          msg.spam_status = 'review';
          msg.soft_deleted = 0;
          msg.archived = 0;
          msg.done_local = 0;
          msg.seen_local = 0;
          msg.folder_kind = 'inbox';
        } else if (lastSql.includes("spam_status = 'clean'")) {
          msg.is_spam = 0;
          msg.spam_status = 'clean';
          msg.soft_deleted = 0;
          msg.archived = 0;
          msg.done_local = 0;
          if (msg.folder_kind !== 'sent' && msg.folder_kind !== 'draft') msg.folder_kind = 'inbox';
        } else if (lastSql.includes('assigned_to =')) {
          msg.assigned_to = args[0];
        } else if (lastSql.includes('pop3_uidl = ?') || lastSql.includes('message_id = ?')) {
          Object.assign(msg, {
            message_id: args[0],
            subject: args[3],
            body_text: args[9],
            seen_local: Math.max(msg.seen_local as number, args[15] as number),
          });
        }
      }
      return { changes: 1, lastInsertRowid: 0 };
    }
    if (lastSql.includes('UPDATE') && lastSql.includes('email_accounts')) {
      const id = args[args.length - 1] as number;
      const acc = state.accounts.get(id);
      if (acc && lastSql.includes('display_name =')) acc.display_name = args[0];
      return { changes: 1, lastInsertRowid: 0 };
    }
    if (lastSql.includes('soft_deleted = 1') || lastSql.includes('archived = ?')) {
      return { changes: args.length > 2 ? 2 : 1, lastInsertRowid: 0 };
    }
    return { changes: 1, lastInsertRowid: state.nextMessageId };
  }

  db.prepare.mockImplementation((sql: string) => {
    lastSql = sql;
    return stmt;
  });
  stmt.get.mockImplementation((...args: unknown[]) => routeGet(...args));
  stmt.all.mockImplementation((...args: unknown[]) => routeAll(...args));
  stmt.run.mockImplementation((...args: unknown[]) => routeRun(...args));

  return {
    ...base,
    state,
    seedMessage: (partial: Record<string, unknown>) => seedMessage(state, partial),
    resetState: () => {
      const fresh = createEmailStoreState();
      Object.assign(state, fresh);
      stmt.get.mockImplementation((...args: unknown[]) => routeGet(...args));
      stmt.all.mockImplementation((...args: unknown[]) => routeAll(...args));
      stmt.run.mockImplementation((...args: unknown[]) => routeRun(...args));
    },
    resetStmt: (overrides?: Partial<StmtMock>) => {
      Object.assign(stmt, overrides);
    },
    getLastSql: () => lastSql,
    getLastArgs: () => lastArgs,
  };
}
