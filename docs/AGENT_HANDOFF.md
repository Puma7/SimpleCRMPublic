# Agent handoff — SimpleCRM (E-Mail & Workflows)

**Last updated:** 2026-07-13 (Node 24 / pnpm 11 / TypeScript 7 modernization)
**Integration branch:** `codex/typescript-7-modernization`
**Start docs:** [`PRODUCT_REQUIREMENTS.md`](PRODUCT_REQUIREMENTS.md) · [`INDEX.md`](INDEX.md)

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
| Toolchain | Node 24 LTS, pnpm 11.12.0, TypeScript 7.0.2+, SWC/Jest, ESLint 10 |
| ESM compatibility | `archiver` 8 and `electron-store` 11 load lazily from CommonJS entry points |

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
| Restore wizard (auto ZIP → userData) | ✅ `MAIL_BETA_PHASE3_PLAN.md` P3-4c |
| Multi-Folder IMAP (Sent/Archive/Spam) | ✅ Konten → SMTP |
| Settings: Konto-Overrides UI (Prompts/Canned/KB) | ✅ siehe `BACKLOG.md` |
| IMAP multi-folder sync | `EMAIL_ROADMAP.md` |
| Embeddings RAG | `WORKFLOW_VISION.md` (vision, not all 🔲 = todo) |

**Do not merge** stale branch `cursor/mail-category-dnd-and-ux-d125` (pre-main compose regressions).

---

## 7. Commands

See root [`AGENTS.md`](../AGENTS.md): `pnpm install`, `xvfb-run --auto-servernum pnpm run electron:dev`.
