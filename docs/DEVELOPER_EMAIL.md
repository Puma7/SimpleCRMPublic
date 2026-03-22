# E-Mail-Modul — Entwickler- & LLM-Referenz

Kurze technische Landkarte für Menschen und Assistenzsysteme, die am **Desktop-E-Mail-Feature** arbeiten. Detaillierte Plan-Phasen: [`EMAIL_PHASES.md`](EMAIL_PHASES.md). Tiefen-Review (Risiken/Fixes): [`email-system-deep-review.md`](email-system-deep-review.md).

## Architektur

| Schicht | Pfade | Rolle |
|--------|--------|--------|
| **Main** | `electron/email/*.ts` | Sync (IMAP/POP3), SMTP, Workflows, CRM-Helfer, OAuth, Anhänge, FTS, Export |
| **IPC** | `electron/ipc/email.ts`, `shared/ipc/channels.ts` (`email:*`) | Renderer ↔ Main |
| **Renderer** | `src/app/email/**` | Inbox, Workflows (React Flow), Einstellungen, Reporting |
| **Shared** | `shared/email-workflow-graph.ts`, `shared/email-constants.ts`, `shared/email-recipient-parse.ts` | Typen, Konstanten, Parsing |

Hintergrund: `electron/email/email-imap-services.ts` (Cron, IDLE), `email-sync-mutex.ts` (ein Sync pro Konto).

## Datenmodell (Auszug)

- **`email_messages`**: u. a. `uid`, `pop3_uidl`, `folder_kind`, `outbound_hold`, `thread_id`, `ticket_code`. **IMAP:** `uid ≥ 0`. **Entwürfe:** `uid < 0` ohne `pop3_uidl`. **POP3:** `uid < 0` **und** `pop3_uidl` gesetzt (stabiler Server-UIDL-String).
- **Unique:** `(account_id, folder_id, uid)`; partiell unique `(account_id, folder_id, pop3_uidl)` wo `pop3_uidl` nicht leer.
- **FTS5:** `email_messages_fts` (external content), Trigger auf `email_messages`; Suche in `email-crm-store.ts` mit MATCH + LIKE-Fallback.

## Wichtige Invarianten

1. **POP3-Identität:** Logische Zeile = **`pop3_uidl`**, nicht die volatile POP3-Message-Nummer.
2. **Listen/Suche/Reporting „echte Mails“:** Bedingung `(uid >= 0 OR pop3_uidl IS NOT NULL)` — schließt reine Entwürfe aus.
3. **Outbound-Workflows:** `evaluateOutboundWorkflows` ist **async**, **fail-closed** bei Engine-/Parse-Fehlern (Hold + block); alle konfigurierten Workflows werden trotzdem durchlaufen, bevor final blockiert wird.
4. **`forward_copy`:** Dedupe-Eintrag (`email_workflow_forward_dedup`) **nach** erfolgreichem SMTP — bei Fehler Retry möglich.

## Build & IPC

- Main-Prozess: `npm run build:electron:main` (`tsconfig.electron.json`).
- Native/Peer-Hinweis: `npm install --legacy-peer-deps` (siehe README).

## Dateien, die bei Änderungen oft zusammenspielen

- Schema/Migrationen: `electron/database-schema.ts`, `electron/sqlite-service.ts` (`runMigrations`)
- Nachricht speichern: `electron/email/email-store.ts` (`insertOrUpdateEmailMessage`, `allocatePop3NegativeUid`)
- Workflows: `email-workflow-engine.ts`, `email-workflow-store.ts`, `email-workflow-types.ts`, `email-workflow-graph-compile.ts`

## LLM-Hinweise

- Keine Secrets ins Repo; Passwörter/OAuth-Refresh/AI-Key: **Keytar**.
- IPC-Payloads nicht „raten“ — Kanäle und Semantik in `shared/ipc/channels.ts` und `electron/ipc/email.ts` nachlesen.
- Große Refactors am E-Mail-Modul: Mutex, FTS-Trigger und POP3-UID-Semantik berücksichtigen.
