# E-Mail-Modul: Phasen-Checkliste (Plan vs. Stand)

Diese Datei fasst die ursprünglichen Plan-Phasen mit dem **aktuellen Implementierungsstand** zusammen (Desktop/Electron).

## Phase 1 – Kern (Postfach, Protokolle, Versand)

| Thema | Status |
|--------|--------|
| IMAP einlesen (imapflow), inkrementell | ✅ |
| SMTP (nodemailer), optional eigenes SMTP-Passwort | ✅ |
| POP3 (node-pop3), UIDL | ✅ |
| Mail parsen (mailparser) | ✅ |
| Passwörter / OAuth-Refresh in Keytar | ✅ Passwort + Google + Microsoft Refresh |
| Sent-Kopie per IMAP APPEND | ✅ |

## Phase 2 – CRM-Mail & Bedienung

| Thema | Status |
|--------|--------|
| Ticket-Codes, Threads (JWZ + optional IMAP threadId) | ✅ |
| Kundenverknüpfung, Kategorien, Notizen | ✅ |
| Suche, Ansichten Inbox/Sent/Drafts/Archiv | ✅ |
| Soft-Delete, Archiv | ✅ |
| Team-Zuweisung | ✅ |
| HTML-Composer (React Quill) | ✅ |
| Anhänge: Metadaten + Speicherung auf Disk (≤25 MB/Stück) + Öffnen/Speichern | ✅ |

## Phase 3 – Workflows & Automatisierung

| Thema | Status |
|--------|--------|
| Regel-Engine (JSON) inbound/outbound/draft | ✅ |
| Visueller Editor (React Flow) → Kompilat | ✅ (linearer Graph-Pfad) |
| Zeit-Trigger: Cron + **Sync für gewähltes Konto** | ✅ `schedule_account_id` |
| Aktionen: Weiterleiten-Kopie, Anhang-Tag, Kategorie, … | ✅ |
| Cron-Jobs nach Speichern neu laden | ✅ `restartEmailWorkflowCrons` |

**Offen / vereinfacht:** Verzweigungen im Graph pro Kante (mehrere parallele Regelpfade) sind nicht voll modelliert.

## Phase 4 – Integration, Reporting, Compliance

| Thema | Status |
|--------|--------|
| Google OAuth (Gmail) | ✅ |
| Microsoft OAuth (Outlook IMAP/SMTP Scopes) | ✅ (Refresh-Flow; Tenant ggf. `common` anpassen) |
| Reporting / Kennzahlen | ✅ Seite `/email/reporting` (Basis-Metriken) |
| DSGVO: Datenexport-Paket (ZIP, ohne Keytar-Secrets) | ✅ (große Tabellen als **JSONL**-Streams: `messages_index.jsonl`, `internal_notes.jsonl`) |
| Omni-Channel | ❌ bewusst out of scope |
| SLA-Eskalationen, Ticketsystem-Tiefe | ❌ nicht umgesetzt |

---

**Fazit:** Phasen 1–3 sind für ein **lokales Team-CRM** fachlich weitgehend abgedeckt; Phase 4 ist für **OAuth, Reporting-Übersicht und Export** ergänzt, nicht aber für Omni-Channel oder SLA-Workflows.
