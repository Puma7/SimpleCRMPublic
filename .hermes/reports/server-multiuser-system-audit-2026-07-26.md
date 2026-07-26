# System-Audit: Multinutzer-Server-Edition

**Stand:** 2026-07-26  
**Branch:** `cursor/server-multiuser-system-audit-b75c`  
**Scope:** Fastify/PostgreSQL Multiuser-Server + Browser-HTTP-Transport (keine Desktop-IPC-Pfade außer Paritätsvergleich)

## 1. Methode

1. Kanonische Server-Route-Inventare in `packages/server/src/api/**` und `server-api.ts` kartiert.
2. Frontend-HTTP-Verdrahtung in `channel-http-registry.ts`, `server-auth-client.ts`, `renderer-transport.ts` abgeglichen.
3. Security-Pfade: Auth/MFA/CSRF, RLS, Mail-ACL, Public Surfaces, SSRF-Grenzen, Capabilities, Event-WebSocket.
4. Multiuser-Logik: Delegation, Locks, Scheduled Send, Job-Provenance, Task-Sichtbarkeit.
5. Gezielte Fixes für Hochrisiko-Befunde inkl. Regressionstests (siehe Abschnitt 5).

## 2. Gesamtbild

Die Server-Edition ist architektonisch ausgereift: Workspace-RLS, Mail-ACL, Auth-Härtung (CAPTCHA/MFA/CSRF), Job-Provenance und Compose/Scheduled-Send-Claims sind grundsätzlich solide. Der Audit fand dennoch **echte Sicherheits- und Verdrahtungslücken**, die für eine „hundert Prozent saubere“ Multinutzer-Produktion geschlossen werden müssen.

| Bereich | Bewertung |
|---------|-----------|
| Auth / Session / MFA | Solide |
| Workspace-RLS | Solide |
| Mail-ACL / Delegation / Locks | Solide (mit einem Method-Mismatch-Bypass, behoben) |
| Capability-Modell | Lücke bei `crm.write` |
| AI-Provider-SSRF | Hoch, teilweise mitigiert |
| Frontend↔Backend-Verdrahtung | Überwiegend gut; einige funktionale Lücken |
| Event-WebSocket Isolation | Task-Payload-Leak, behoben |

## 3. Sicherheitsbefunde

### S1 — Hoch (teilweise behoben): AI-Profil SSRF mit Antwort-Exfiltration

**Pfad:** `POST /api/v1/ai/profiles` + `POST /api/v1/ai/transform-text`  
**Dateien:** `workflow-routes.ts`, `postgres-workflow-read-ports.ts`, `ai-providers.ts`

Jeder authentifizierte User konnte ein AI-Profil mit beliebiger `http(s)`-`baseUrl` anlegen (inkl. `127.0.0.1` / RFC1918). `callAiChat` nutzt ungeschütztes `fetch` und gibt Response-Bodies (bzw. Fehlertexte bis 500 Zeichen) an den Caller zurück.

**Mitigation in diesem PR:**
- Private/reservierte Hosts und `.local`/`.internal`/`localhost` werden bei Profil-Create/Update abgelehnt (API + Port).
- **Offen:** DNS-Rebinding / öffentliche Hostnamen → private IPs zur Laufzeit; dafür fehlt noch pinned-fetch wie bei Webhooks.

**Empfehlung P0:** AI-Fetch über `guardedFetch`/`createPinnedFetch` legen; Fehlertexte nicht roh zurückgeben; Create/Update optional auf `workflows.manage` beschränken.

### S2 — Hoch (offen): Capability `crm.write` wird nicht erzwungen

**Dateien:** `capabilities.ts`, `customer-routes.ts`, `core-crm-routes.ts`, `extended-crm-routes.ts`, `shared/user-capabilities.ts`

`crm.write` ist in User-Groups konfigurierbar und wird Admins als Berechtigung angezeigt. CRM-Mutationen (`customers`, `products`, `deals`, `tasks`, Custom Fields, JTL-Writes) prüfen nur `requirePrincipal()`, nie `requireCapability(..., 'crm.write')`. Frontend gated CRM-Schreiben ebenfalls nicht über `hasCapability`.

**Impact:** Admins glauben, Schreibrechte zu steuern; jeder Workspace-User kann CRM-Daten ändern/löschen.

**Empfehlung P0:** `requireCapability(principal, 'crm.write')` auf allen CRM-Schreibrouten; UI entsprechend; Migration/Hinweis für bestehende Gruppen.

### S3 — Hoch (behoben): Task-Events leaken private Felder über WebSocket

**Dateien:** `async-policy-enforcer.ts`, `core-crm-routes.ts`

Task-Reads sind assignment-/group-scoped; `/api/v1/events` lieferte aber volle Payloads (`title`, `customerId`, `dueDate`, …) an alle Workspace-User.

**Fix:** Payload auf `{ id }` reduziert (analog `calendar_event`). Regression in `server-mail-job-event-acl.test.ts`.

### S4 — Mittel (behoben): Mail-ACL-Bypass bei Category-Reorder

**Dateien:** `mail-metadata-routes.ts`, `policy-manifest.ts`, `openapi.ts`, FE-Registry

Inventar/Policy/OpenAPI sagten `PATCH`, Handler + Frontend nutzen `POST`. Dadurch lief Reorder **ohne** Mail-ACL-Enforcement (`mail.triage`).

**Fix:** Inventar, Policy und OpenAPI auf `POST` vereinheitlicht.

### S5 — Looks solid (kein Befund)

- Login/Refresh/CSRF, Rate-Limits, Initial-Setup-Token (timing-safe)
- Mail-Delegation mit Privilege-Escalation-Schutz und `FOR UPDATE`
- Lock-Takeover admin-only
- Scheduled/Compose Send mit Provenance + `SKIP LOCKED`
- Returns-Portal Token + Rate-Limit
- Webhook-/Workflow-HTTP SSRF mit Allowlist + DNS-Pinning
- GDPR-Export mit Mail-Scope

## 4. Frontend↔Backend-Verdrahtung

### Funktionsfähig verdrahtet (Stichprobe bestätigt)

Kalender (`calendar-events` GET / `calendar-entries` Mutationen), Relays, Tracking-Settings, OAuth, Inbox-Archive-Recovery, Spam-Listen, User-Signatures, Notices, Mail-Delegation-Bindings, Maintenance Status/Doctor/Migrations/Reset, Auth-Security/MFA via `server-auth-client`.

### B1 — Hoch (behoben): Custom-Field-SetValue war create-only

Desktop `SetValue` ist Upsert. HTTP mappt auf `POST /customer-custom-field-values`, Server antwortete bei Existieren mit `409 value_conflict`. Auch Kunden-Create mit `customFields` (persistCustomerCustomFields) war betroffen.

**Fix:** Postgres-`create` upsertet bestehende `(customer, field)`-Zeilen.

### B2 — Mittel / bewusst Desktop-only: Draft-Freigabe (`ApproveDraftSend` / `DismissDraftApproval`)

UI zeigt Freigabe-Buttons bei `approval_state === 'pending'`. Server-Schema hat kein `approval_state`; Zwei-Stufen-KI-Knoten sind laut Transport-Test Desktop-only. Buttons erscheinen im reinen Serverbetrieb normalerweise nicht; der Codepfad bleibt tot und würde bei Migration/Alt-Daten fehlschlagen.

**Empfehlung:** UI im Servermodus hart ausblenden oder Server-Parity für Review-Freigabe nachziehen.

### B3 — Mittel: Workflow Delayed Jobs CRUD ohne UI

Server: `GET/POST/PATCH/DELETE /workflow-delayed-jobs`. UI zeigt nur Zähler in Diagnostik.

### B4 — Niedrig: JTL-Referenz-Mutationen ohne UI

Server kann Firmen/Warenlager/… per ID schreiben; FE listet nur + Order-Create.

### B5 — Niedrig: Maintenance-Update-Shims

`CheckForUpdates`/`InstallUpdate` mappen auf `GET /maintenance/status`. UI blendet Buttons im Servermodus aus → latent.

### B6 — Niedrig: `activity-log/:id` ohne FE

### B7 — Info: Automation.SetSettings Desktop-only

Server nutzt API-Keys + Workflow-Automation-Settings — bewusst.

## 5. In diesem PR behobene Punkte

| ID | Fix |
|----|-----|
| S3 | Task-Event-Payload auf `{ id }` |
| S4 | Categories-Reorder POST + ACL-Policy |
| B1 | Custom-Field-Value Upsert |
| S1 teilw. | Private AI-`baseUrl` blockiert |

## 6. Offene P0/P1-Empfehlungen

1. **P0** `crm.write` serverseitig erzwingen + UI-Gates.
2. **P0** AI-Fetch mit pinned-fetch / Allowlist; keine Roh-Response-Exfiltration.
3. **P1** Draft-Approval entweder Server-Parity oder UI-Entfernung im Servermodus.
4. **P1** Delayed-Jobs-Ops in Admin-UI oder dokumentiert als API-only.
5. **P1** Customer/Deal-Event-Payloads prüfen (analog Tasks: ggf. auf `{ id }` reduzieren).
6. **P2** OpenAPI mit kanonischem Route-Inventar automatisiert synchron halten.

## 7. Verifikation

Fokussierte Regressionen:

```sh
pnpm exec jest --config jest.config.cjs tests/unit/server-mail-job-event-acl.test.ts --testPathPattern=task
# sowie AI-Profil-Validierung und Categories-Reorder in server-edition-foundation
```

Vollständige Server-/Unit-Suites vor Merge empfohlen.
