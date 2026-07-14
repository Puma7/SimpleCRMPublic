# Agent handoff — SimpleCRM (E-Mail & Workflows)

**Last updated:** 2026-07-14 (system/mail/UX/security audit)
**Integration branch:** `codex/system-mail-ux-security-audit-complete`
**Start docs:** [`PRODUCT_REQUIREMENTS.md`](PRODUCT_REQUIREMENTS.md) · [`INDEX.md`](INDEX.md)
**Current audit:** [`.hermes/reports/system-mail-ux-security-audit.md`](../.hermes/reports/system-mail-ux-security-audit.md)

---

## 1. Read this first

1. This file + [`LEARNINGS.md`](LEARNINGS.md).
2. **E-Mail:** [`DEVELOPER_EMAIL.md`](DEVELOPER_EMAIL.md), [`WORKFLOW_PHASES.md`](WORKFLOW_PHASES.md).
3. **CRM:** [`DEVELOPER_CRM.md`](DEVELOPER_CRM.md), [`CRM_PRODUCT_GUIDE.md`](CRM_PRODUCT_GUIDE.md).
4. **Backup/Restore:** [`MAIL_BETA_PHASE3_PLAN.md`](MAIL_BETA_PHASE3_PLAN.md), [`MAIL_TROUBLESHOOTING.md`](MAIL_TROUBLESHOOTING.md).
5. Verify: `pnpm run check:typescript-toolchain`, `pnpm test`, `pnpm run build`, `pnpm run lint`.

**UI language:** German (Posteingang = inbox, Aufgaben = tasks, Kunden = customers).

---

## 2. Project

**SimpleCRM** ships two editions from the same monorepo:

- Desktop: Electron + React + TypeScript with local SQLite (`better-sqlite3`).
- Server: Fastify API + PostgreSQL + browser client, deployed through Docker Compose; see [`SETUP_SERVER.md`](SETUP_SERVER.md).

| Environment | DB path (Linux) |
|-------------|-----------------|
| Packaged | `~/.config/simplecrm/database.sqlite` |
| Dev | `~/.config/Electron/database.sqlite` |

Windows dev vs packaged: see [`MAIL_SINGLE_USER_LIMITS.md`](MAIL_SINGLE_USER_LIMITS.md).

---

## 3. Architecture — workflows

- **Execution source:** `email_workflows.graph_json` (React Flow).
- **Runtime:** `electron/workflow/runtime.ts` → node registry in `electron/workflow/nodes/*.ts`.
- **Triggers:** `inbound` / `outbound` / `schedule` / CRM / webhook — see [`WORKFLOW_PHASES.md`](WORKFLOW_PHASES.md) (W0–W7, P1–P7 ✅).

**KI-Profil in Knoten:** `config.profileId` (number). UI: Dropdown in `node-properties-panel.tsx` (`AiProfileSelect`). Backend: `profileIdFromConfig` in `ai-nodes.ts`; bei Prompt-Knoten `effectiveProfileId` (Knoten > Prompt > Standard).

---

## 4. Recent product fixes and current branch

| Area | Notes |
|------|--------|
| Compose dialog | Fixed viewport, sticky footer, editor fill |
| External links | Confirm before `app:open-external-url` |
| Mail categories | Manual assignment in UI (#71) |
| Sent folder | IMAP append for outbound (#75) |
| Toolchain | Node 24 LTS, pnpm 11.12.0, TypeScript 7.0.2+, SWC/Jest, ESLint 10 |
| ESM compatibility | `archiver` 8 and `electron-store` 11 load lazily from CommonJS entry points |
| Native ABI | Cached Node 141 / Electron 148 `better-sqlite3` binaries; every Electron command restores Node in `finally` |
| Electron E2E | Each suite creates an isolated standalone user-data directory and completes first-run authentication |
| System audit | Viewer races, compose zones/signatures, scheduled sends, AI drafts, auto-reply headers, RLS-sichere MFA-Mutationen und multi-replizierter Login-Challenge-State gehärtet; siehe aktuellen Auditbericht |
| E-Mail-Evidenz | Server-only, standardmäßig aus; SMTP/DSN/MDN/Pixel/Klick/Antwort als getrennte Signale mit Retention und Workflow-Variablen |

---

## 5. Key files

| Area | Path |
|------|------|
| IPC mail | `electron/ipc/email.ts`, `shared/ipc/channels.ts` |
| Backup | `electron/email/email-local-backup.ts` |
| Compose | `src/components/email/compose-dialog.tsx` |
| Workflow UI | `src/components/email/workflow/node-properties-panel.tsx` |
| KI profile select | `src/components/email/ai-profile-select.tsx` |
| Diagnostics | `src/components/email/settings/diagnostics-panel.tsx` |
| E-Mail-Evidenz | `packages/server/src/email-tracking.ts`, `src/components/email/message-evidence-panel.tsx`, `docs/EMAIL_EVIDENCE_TRACKING.md` |
| Native ABI manager | `scripts/native-runtime-manager.mjs`, `scripts/run-with-electron-native.mjs` |
| Electron E2E session | `tests/e2e/helpers/electron-session.ts` |

---

## 6. Open / backlog

| Item | Doc |
|------|-----|
| Restore wizard (auto ZIP → userData) | ✅ `MAIL_BETA_PHASE3_PLAN.md` P3-4c |
| Multi-Folder IMAP (Sent/Archive/Spam) | ✅ Konten → SMTP |
| Settings: Konto-Overrides UI (Prompts/Canned/KB) | ✅ siehe `BACKLOG.md` |
| IMAP multi-folder sync | `EMAIL_ROADMAP.md` |
| Embeddings RAG | `WORKFLOW_VISION.md` (vision, not all 🔲 = todo) |
| Beta security and reliability audit | Code-Maßnahmen abgeschlossen; externe Release-Abnahmen siehe [`.hermes/reports/system-mail-ux-security-audit.md`](../.hermes/reports/system-mail-ux-security-audit.md), Abschnitt 6 |

**Do not merge** stale branch `cursor/mail-category-dnd-and-ux-d125` (pre-main compose regressions).

---

## 7. Commands

See root [`AGENTS.md`](../AGENTS.md): `pnpm install`, `xvfb-run --auto-servernum pnpm run electron:dev`.
