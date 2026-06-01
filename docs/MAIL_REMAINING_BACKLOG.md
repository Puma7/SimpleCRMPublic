# Mail — Rest-Backlog nach Tiefenanalyse (F/NF)

**Stand:** 2026-06-01 · Abgleich `origin/main` mit ursprünglichem Plan (F1–F19, NF1–NF18, AI-5, Beta-Blocker R/I).

**Gesamt:** ~90 % des Funktionsplans umgesetzt. Alpha-Gate (CI `test:mail`, Fresh-DB, Coverage-Ratchet) siehe [`MAIL_ALPHA_CHECKLIST.md`](MAIL_ALPHA_CHECKLIST.md).

---

## Schnell umsetzbar (geringer Aufwand, hoher Nutzen)

| ID | Thema | Aufwand | Maßnahme | Status |
|----|--------|---------|----------|--------|
| **DOC-AI5** | `PRODUCT_REQUIREMENTS.md` listet AI-5 als 🔲 | ~15 min | Doku: Embeddings-RAG ist in `knowledge-base.ts` / `email-openai.ts` (mit Keyword-Fallback) | ✅ in diesem Branch |
| **NF17a** | `assigned_to` verwaist nach Team-Löschung | ~30 min | Beim `deleteEmailTeamMember`: `assigned_to = NULL` für betroffene Mails (App-Layer) | ✅ in diesem Branch |
| **UX-SB** | Sidebar-Badges nach Aktion verzögert | ~1 h | `mailMetricsRevision` + Invalidierung nach Mutationen | PR [#84](https://github.com/Puma7/SimpleCRMPublic/pull/84) |
| **R-3** | Dropdown-Mehrfachklick | — | `runningId` / `busy` in `apply-workflow-menu.tsx`, `message-more-actions-menu.tsx` | ✅ verifiziert |
| **R-4** | Outbound-Workflow aus Apply-Menü | — | `ApplyWorkflowMenu` + `filterWorkflowsForMessage` im Viewer | ✅ verifiziert |

### Optional als Nächstes (klein, kein Schema-Rebuild)

| ID | Thema | Aufwand | Hinweis |
|----|--------|---------|---------|
| **NF17b** | SQLite-FK `assigned_to` → `email_team_members` | mittel | Nur per Tabellen-Rebuild in Migration; NF17a reicht für Datenintegrität |
| **NF3** | Sync-Mutex In-Flight-Abbruch | mittel | `clearEmailAccountSyncLock` leert Queue; harter Abbruch laufender IMAP noch offen |
| **TEST+** | Coverage Lücken `electron/email/**` | laufend | Ratchet ~90 %; gezielt Module mit &lt;80 % Branches |

---

## Mittlerer Aufwand (Beta-UX, kein Alpha-Blocker)

| ID | Thema | Aufwand | Beschreibung |
|----|--------|---------|--------------|
| **NF11** | `seen_local` Reconcile | 0,5–1 d | Read-Status Webmail ↔ SimpleCRM angleichen (lokal gewinnt heute) |
| **NF12** | Workflow-`bodyText` Audit | 0,5 d | Diff/Log bei KI-geändertem Body (heute nur Banner) |
| **NF8** | OAuth Tenant härten | konfig | Default `common` ok für Consumer; Enterprise-Tenant dokumentieren |

---

## Groß / bewusst zurückgestellt

| ID | Thema | Bewertung |
|----|--------|-----------|
| **F14** | Mehrbenutzer-Login + User-Signatur | Roadmap „Hoch“; für Single-User-Desktop **kein** Alpha/Beta-Blocker ([`MAIL_SINGLE_USER_LIMITS.md`](MAIL_SINGLE_USER_LIMITS.md)) |
| **F11** | Echtes Server-Threading (Aufklappen, Thread-Bulk) | Display-Mode „Threads (Vorschau)“ vorhanden; Voll-Threading = eigenes Epic |
| **F7** | Open/Click-Tracking | ⛔ Datenschutz — bewusst nicht |
| **F8** | PGP/S/MIME Entschlüsselung | 🟡 nur Erkennungs-Hinweis im Viewer |
| **NF14** | `draft_created` nur einmal | by design, dokumentiert |

---

## Abgeschlossene Blöcke (Referenz)

### Funktionen F1–F19

- **16× ✅** vollständig (u. a. BCC, Snooze, Vacation, Bulk, .eml, Webhook, Multi-Folder, HTML-Ansicht)
- **F11 🟡** Thread-Gruppierung UI, kein Server-Threading
- **F7/F8** bewusst begrenzt
- **F14 ❌** einziges großes fehlendes Feature

### Struktur NF1–NF18

- **11× ✅** behoben (OAuth IDLE, POP3-Cache-Cap, FTS-Fallback-Toast, …)
- **5× 🟡** by-design / teilweise (NF3, NF8, NF11, NF12, NF14)
- **NF17** mit NF17a praktisch abgesichert

### Beta-Blocker R/I

| Blocker | Status |
|---------|--------|
| R-1 Post-Process Retry | ✅ |
| R-2 OAuth-Reauth-Banner | ✅ `imap-auth-notice-banner.tsx` |
| R-3 Dropdown-Doppelklick | ✅ busy-State |
| R-4 Apply-Workflow-Menü | ✅ |
| R-5 Reply-All Multi-Account | ✅ |
| I-3 … I-5 | ✅ |

### Tests (Qualität)

- **121** Mail-Jest-Suites / **627** Tests, CI-Step `test:mail`
- `email-vacation`, `email-inline-images`, `email-uidvalidity-reset` haben Mail-/Unit-Tests

---

## Empfohlene Reihenfolge (nach Alpha)

1. PR **#84** mergen (Sidebar-Zähler)
2. **NF11** seen-Reconcile (wenn Beta-Nutzer Webmail parallel nutzen)
3. **F14** nur bei echtem Team-Rollout planen (mit Login, Rechte, NF17b)

Siehe auch [`EMAIL_ROADMAP.md`](EMAIL_ROADMAP.md), [`PRODUCT_REQUIREMENTS.md`](PRODUCT_REQUIREMENTS.md).
