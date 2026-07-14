# SimpleCRM — Documentation index

**For AI agents:** start with [`AGENT_HANDOFF.md`](AGENT_HANDOFF.md), then domain learnings below.

**Produktanforderungen (Muss/Soll/Ist):** [`PRODUCT_REQUIREMENTS.md`](PRODUCT_REQUIREMENTS.md)

## Handoff & continuity

| Document | Purpose |
|----------|---------|
| [**AGENT_HANDOFF.md**](AGENT_HANDOFF.md) | **Start here** — architecture, file map, verification |
| [**PRODUCT_REQUIREMENTS.md**](PRODUCT_REQUIREMENTS.md) | **Muss/Soll/Ist** — CRM, Mail, KI, Workflows, Backup |
| [**LEARNINGS.md**](LEARNINGS.md) | Master learning index + cross-cutting rules |
| [**LOGIN_SECURITY.md**](LOGIN_SECURITY.md) | **Server login** — CAPTCHA, PIN, MFA, Setup-Token, API |
| [LEARNINGS_AUTH.md](LEARNINGS_AUTH.md) | Auth hardening pitfalls + audit learnings |
| [LEARNINGS_EMAIL.md](LEARNINGS_EMAIL.md) | E-mail / IMAP / POP3 / SQLite pitfalls |
| [LEARNINGS_WORKFLOW.md](LEARNINGS_WORKFLOW.md) | Workflow engine, modular graphs, outbound/spam |

## CRM core

| Document | Purpose |
|----------|---------|
| [**CRM_PRODUCT_GUIDE.md**](CRM_PRODUCT_GUIDE.md) | **Product logic** — entities, pipeline, follow-up, JTL |
| [USER_GUIDE_CRM.md](USER_GUIDE_CRM.md) | End-user oriented (Kunden, Deals, Aufgaben, Nachverfolgung) |
| [DEVELOPER_CRM.md](DEVELOPER_CRM.md) | Technical map (schema, IPC, services, file map) |

## E-mail module

| Document | Purpose |
|----------|---------|
| [DEVELOPER_EMAIL.md](DEVELOPER_EMAIL.md) | Technical map (paths, invariants, IPC) |
| [EMAIL_EVIDENCE_TRACKING.md](EMAIL_EVIDENCE_TRACKING.md) | Server opt-in: Versand-, Zustell- und Interaktionsevidenz, Datenschutz und Workflows |
| [EMAIL_PHASES.md](EMAIL_PHASES.md) | Implementation checklist (phases 1–4) |
| [EMAIL_INBOX_CAPABILITIES.md](EMAIL_INBOX_CAPABILITIES.md) | Feature matrix (inbox, archive, spam, …) |
| [MAIL_SECURITY.md](MAIL_SECURITY.md) | P2 mailauth + P3 Rspamd (Desktop-Mail-Sicherheit) |
| [USER_GUIDE_EMAIL.md](USER_GUIDE_EMAIL.md) | End-user oriented |
| [**EMAIL_PRODUCT_GUIDE.md**](EMAIL_PRODUCT_GUIDE.md) | **Product logic** — Konten, Kategorien, Aktionen, Team, KI |
| [EMAIL_ROADMAP.md](EMAIL_ROADMAP.md) | Planned improvements from user feedback |
| [**MAIL_BETA_PHASE3_PLAN.md**](MAIL_BETA_PHASE3_PLAN.md) | **Beta Phase 3** — Backup, Migrationen, Diagnose, Doku (Umsetzungsplan) |
| [MAIL_TROUBLESHOOTING.md](MAIL_TROUBLESHOOTING.md) | Support-Matrix (Symptom → Aktion) |
| [MAIL_SINGLE_USER_LIMITS.md](MAIL_SINGLE_USER_LIMITS.md) | Single-User / Sandbox-Grenzen |
| [email-system-deep-review.md](email-system-deep-review.md) | Risks and review notes |
| [WORKFLOW_SPAM_ROUTING.md](WORKFLOW_SPAM_ROUTING.md) | Spam pipeline design |
| [OUTBOUND_EMAIL_WORKFLOW.md](OUTBOUND_EMAIL_WORKFLOW.md) | Outbound quality gate |

## Workflows

| Document | Purpose |
|----------|---------|
| [WORKFLOW_PHASES.md](WORKFLOW_PHASES.md) | **Ist-stand** W0–W7 + post-inbox additions + 2026-07 overhaul |
| [WORKFLOW_VISION.md](WORKFLOW_VISION.md) | Long-term target (not all 🔲 = todo) |
| [USER_GUIDE_WORKFLOWS.md](USER_GUIDE_WORKFLOWS.md) | End-user oriented (Editor, Vorlagen, KI-Antwort mit Gegenprüfung, Freigabe) |

## External automation API

| Document | Purpose |
|----------|---------|
| [API_V1.md](API_V1.md) | REST `/api/v1` reference |
| [SECURITY_AUTOMATION_API.md](SECURITY_AUTOMATION_API.md) | Auth, scopes, hardening |
| [EXTERNAL_AUTOMATION_API_PLAN.md](EXTERNAL_AUTOMATION_API_PLAN.md) | Phase plan (A/B) |

## Server edition

| Document | Purpose |
|----------|---------|
| [SERVER_EDITION_IMPLEMENTATION.md](SERVER_EDITION_IMPLEMENTATION.md) | Server-based rebuild status and verification |
| [SETUP_LOCAL.md](SETUP_LOCAL.md) | Local/standalone and browser server-client setup |
| [SETUP_SERVER.md](SETUP_SERVER.md) | Docker server setup with Caddy/PostgreSQL/API |
| [MIGRATION_STANDALONE_TO_SERVER.md](MIGRATION_STANDALONE_TO_SERVER.md) | Standalone PostgreSQL to server migration primitive |
| [BACKUP_AND_RESTORE.md](BACKUP_AND_RESTORE.md) | Backup, restore, restore-drill, and doctor operations |
| [THREAT_MODEL.md](THREAT_MODEL.md) | Server-edition trust boundaries, RLS, secrets, and residual risks |

## Setup

| Document | Purpose |
|----------|---------|
| [SETUP_WINDOWS.md](SETUP_WINDOWS.md) | Windows dev setup |
| [../AGENTS.md](../AGENTS.md) | Cursor Cloud commands & gotchas |
