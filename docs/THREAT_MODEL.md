# SimpleCRM Server Edition Threat Model

This document records the current security model for the server-edition foundation.

## Security Goals

- Isolate workspaces at the database layer with PostgreSQL RLS.
- Keep plaintext secrets out of database rows, API responses, audit metadata, and server events.
- Authenticate browser/thin-client traffic with server-issued access tokens.
- Preserve an audit chain for security-relevant events.
- Fail closed when a renderer is configured for HTTP transport but has no server base URL.

## Trust Boundaries

- Browser or Electron thin client: untrusted UI runtime.
- Fastify API: trusted application boundary after authentication.
- PostgreSQL: trusted persistence boundary with RLS enabled and forced on tenant tables.
- Docker host and volume storage: operator-controlled but not protected against full disk compromise.
- SMTP/IMAP/POP3/OAuth providers: external systems.

## Authentication

Server-client auth uses:

- setup-state and initial owner setup routes;
- login, refresh, logout routes;
- persistent refresh-token rows;
- HMAC-signed access tokens;
- DB-backed principal resolution that rejects revoked/expired sessions and disabled users.

Invalid `Authorization` headers must not fall back to test/server principal headers.

### Initial setup token

`POST /api/v1/auth/initial-setup` requires `INITIAL_SETUP_TOKEN` (env + header `X-Initial-Setup-Token`). Without it, no owner account can be created. This closes unauthenticated workspace takeover on freshly deployed instances.

### Optional login security layers

Documented in [LOGIN_SECURITY.md](LOGIN_SECURITY.md). Summary:

| Control | Mitigation | Residual risk |
|---------|------------|---------------|
| Turnstile CAPTCHA | Bot cost before password check | Provider outage; email hints in `login-config` |
| 6-digit PIN | Second factor on shared workstations | Not mandatory per user; weak if workspace PIN on but user has no PIN |
| TOTP / email MFA | Strong second factor | Email MFA needs invite SMTP; TOTP secret in encrypted store |
| MFA challenge | Single-use in-memory token | Lost on process restart mid-login (user retries) |
| Login failure counter | DB-backed lockout | In-memory rate limits not cluster-wide |

Brute-force counters and CAPTCHA challenges are process-local unless extended for multi-node deployments.

## Workspace Isolation

The server foundation uses:

- `workspace_id` columns on tenant tables;
- forced PostgreSQL RLS;
- transaction-local `app.workspace_id`, `app.user_id`, and `app.role` settings;
- explicit cross-workspace flag only for controlled owner/admin/system tooling.

Representative live checks exist in `npm run test:server-rls`, but exhaustive per-table mutation and performance coverage remain open.

## Secret Handling

Server secrets use encrypted database envelopes:

- `SIMPLECRM_MASTER_KEY` is not stored in the database.
- Mail account passwords, OAuth refresh tokens, AI keys, and PGP private-key references are linked to encrypted secret rows.
- PGP private keys add a per-user passphrase-derived envelope.
- Responses expose configured booleans such as `apiKeyConfigured` or `privateKeyConfigured`, not secret material.

Standalone mode still uses OS keychain access for the standalone master-key foundation.

## Audit And Events

Audit events are hash-chained per workspace. Audit writes use a workspace transaction and advisory transaction lock to avoid hash-chain forks. Server events are persisted for replay and are also fanned out through WebSocket/LISTEN-NOTIFY foundations.

Event and audit metadata must avoid plaintext passwords, tokens, PGP private keys, passphrases, and spam-feature breakdown details that could leak sensitive message content.

## Known Residual Risks

- Disk/root compromise remains out of scope for Stufe 1. An attacker with host or volume access can copy database and attachment data.
- Full workflow side-effect parity is not complete; unsupported server workflow nodes should fail closed.
- Production mailbox stress drills for mail sync and workflow IMAP move/delete side effects remain open; OAuth-backed mail paths use server-side encrypted secrets for connection tests, sync, MDN, compose-send, Sent-copy, and workflow IMAP actions.
- Inbound PGP attachment decrypt/verify is available as transient server-client actions over stored attachment content; decrypted bytes are returned to the requester and are not persisted. Server compose send and the direct PGP plaintext API can encrypt/sign plaintext bodies plus bounded attachment payloads, and HTML drafts are reduced to encrypted text-only payloads so no unencrypted rich HTML part is sent.
- Retention and restore drills need more live-volume hardening before claiming production completeness.

## Operator Controls

- Keep `MASTER_KEY`, `ACCESS_TOKEN_SECRET`, `PG_ADMIN_PASSWORD`, and `PG_PASSWORD` outside source control.
- Restrict host and Docker volume access.
- Run `doctor` and restore drills regularly.
- Keep backups encrypted at the storage layer if they leave the server host.
- Review audit-chain verification after suspicious activity.
