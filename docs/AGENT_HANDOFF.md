# Agent handoff — SimpleCRM (E-Mail & Workflows)

**Last updated:** 2026-06-01 (main: Sprint #76, Restore/IMAP #77, CRM-Doku #78)  
**Integration branch:** `main`  
**Start docs:** [`PRODUCT_REQUIREMENTS.md`](PRODUCT_REQUIREMENTS.md) · [`INDEX.md`](INDEX.md)

---

## 1. Read this first

1. This file + [`LEARNINGS.md`](LEARNINGS.md).
2. **E-Mail:** [`DEVELOPER_EMAIL.md`](DEVELOPER_EMAIL.md), [`WORKFLOW_PHASES.md`](WORKFLOW_PHASES.md).
3. **CRM:** [`DEVELOPER_CRM.md`](DEVELOPER_CRM.md), [`CRM_PRODUCT_GUIDE.md`](CRM_PRODUCT_GUIDE.md).
4. **Backup/Restore:** [`MAIL_BETA_PHASE3_PLAN.md`](MAIL_BETA_PHASE3_PLAN.md), [`MAIL_TROUBLESHOOTING.md`](MAIL_TROUBLESHOOTING.md).
5. Verify: `npm test`, `npm run build:electron:main`, `npx eslint . --ext ts,tsx --max-warnings 0`.

**UI language:** German (Posteingang = inbox, Aufgaben = tasks, Kunden = customers).

---

## 2. Project

**SimpleCRM** — Electron + React + TypeScript, SQLite (`better-sqlite3`), no cloud CRM backend.

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

## 4. Recent product fixes (on `main`)

| Area | Notes |
|------|--------|
| Compose dialog | Fixed viewport, sticky footer, editor fill |
| External links | Confirm before `app:open-external-url` |
| Mail categories | Manual assignment in UI (#71) |
| Sent folder | IMAP append for outbound (#75) |

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

---

## 6. Open / backlog

| Item | Doc |
|------|-----|
| Restore wizard (auto ZIP → userData) | `MAIL_BETA_PHASE3_PLAN.md` P3-4c |
| IMAP multi-folder sync | `EMAIL_ROADMAP.md` |
| Embeddings RAG | `WORKFLOW_VISION.md` (vision, not all 🔲 = todo) |

**Do not merge** stale branch `cursor/mail-category-dnd-and-ux-d125` (pre-main compose regressions).

---

## 7. Commands

See root [`AGENTS.md`](../AGENTS.md): `npm install --legacy-peer-deps`, `xvfb-run --auto-servernum npm run electron:dev`.
