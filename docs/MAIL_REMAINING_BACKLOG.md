# Mail — Rest-Backlog nach Tiefenanalyse (F/NF)

**Stand:** 2026-06-01 · Abgleich `origin/main` mit ursprünglichem Plan (F1–F19, NF1–NF18, AI-5, Beta-Blocker R/I).

**Gesamt:** ~90 % des Funktionsplans umgesetzt. Alpha-Gate (CI `test:mail`, Fresh-DB, Coverage-Ratchet) siehe [`MAIL_ALPHA_CHECKLIST.md`](MAIL_ALPHA_CHECKLIST.md).

---

## Schnell umsetzbar (geringer Aufwand, hoher Nutzen)

| ID | Thema | Aufwand | Maßnahme | Status |
|----|--------|---------|----------|--------|
| **DOC-AI5** | `PRODUCT_REQUIREMENTS.md` listet AI-5 als 🔲 | ~15 min | Doku: Embeddings-RAG ist in `knowledge-base.ts` / `email-openai.ts` (mit Keyword-Fallback) | ✅ in diesem Branch |
| **NF17a** | `assigned_to` verwaist nach Team-Löschung | ~30 min | `deleteEmailTeamMember` + Trigger/FK (NF17b) | ✅ |
| **UX-SB** | Sidebar-Badges nach Aktion verzögert | ~1 h | `mailMetricsRevision` + Invalidierung nach Mutationen | ✅ PR [#84](https://github.com/Puma7/SimpleCRMPublic/pull/84) |
| **R-3** | Dropdown-Mehrfachklick | — | `runningId` / `busy` in `apply-workflow-menu.tsx`, `message-more-actions-menu.tsx` | ✅ verifiziert |
| **R-4** | Outbound-Workflow aus Apply-Menü | — | `ApplyWorkflowMenu` + `filterWorkflowsForMessage` im Viewer | ✅ verifiziert |

### Umgesetzt (NF11 / NF3 / NF17b)

| ID | Thema | Status |
|----|--------|--------|
| **NF11** | `seen_local` Reconcile mit Server `\\Seen` | ✅ `email-seen-reconcile.ts` + IMAP-Upsert ohne MAX bei Sync |
| **NF3** | Sync-Mutex In-Flight-Abbruch | ✅ `AbortController` in `email-sync-mutex.ts`, IMAP/POP3 prüfen Signal |
| **NF17b** | `assigned_to` Referenzielle Integrität | ✅ FK auf Fresh-Install; Migration: Trigger + Orphan-Cleanup |

### Optional als Nächstes

| ID | Thema | Aufwand | Hinweis |
|----|--------|---------|---------|
| **TEST+** | Coverage Lücken `electron/email/**` | laufend | Ratchet ~90 %; gezielt Module mit &lt;80 % Branches |

---

## Mittlerer Aufwand (Beta-UX, kein Alpha-Blocker)

| ID | Thema | Aufwand | Beschreibung |
|----|--------|---------|--------------|
| _(NF11 erledigt)_ | | | |
| **NF12** | Workflow-`bodyText` Audit | 0,5 d | Diff/Log bei KI-geändertem Body (heute nur Banner) |
| **NF8** | OAuth Tenant härten | konfig | Default `common` ok für Consumer; Enterprise-Tenant dokumentieren |

---

## Phasen-Roadmap (Mail Security, 2026)

| Phase | Thema | Status |
|-------|--------|--------|
| 1 | Remote-Content Block-all + MDN | ✅ siehe [`MAIL_TRACKING_PRIVACY.md`](MAIL_TRACKING_PRIVACY.md) |
| 2 | Security Foundation (users, audit, IPC) | ✅ Basis (`auth:*`, `workspaces`, dormant `workspace_id`) |
| 3 | Threading (edges, expand, aliases) | ✅ Basis |
| 4 | Login UI + Benutzerverwaltung | ✅ optional `auth_middleware_v1` |
| 5 | PGP (OpenPGP.js Main) | ✅ Basis |

## Groß / bewusst zurückgestellt

| ID | Thema | Bewertung |
|----|--------|-----------|
| **F14** | Mehrbenutzer kryptographisch | Stufe 1 = Profil + Audit nur ([`MAIL_AUTH_THREAT_MODEL.md`](MAIL_AUTH_THREAT_MODEL.md)) |
| **F11** | Thread-Bulk / `imapflow.thread()` | Teilweise; Bulk-by-thread folgt |
| **F7** | Open/Click-Tracking (Marketing) | ⛔ Datenschutz — bewusst nicht |
| **F8** | S/MIME | Nach PGP ([`MAIL_PGP_THREAT_MODEL.md`](MAIL_PGP_THREAT_MODEL.md)) |
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
