# System-Audit: Multinutzer-Server-Edition

**Stand:** 2026-07-26 (Fixes abgeschlossen)  
**Branch:** `cursor/server-multiuser-system-audit-b75c`  
**Scope:** Fastify/PostgreSQL Multiuser-Server + Browser-HTTP-Transport (keine Desktop-IPC-Pfade außer Paritätsvergleich)

## 1. Methode

1. Kanonische Server-Route-Inventare in `packages/server/src/api/**` und `server-api.ts` kartiert.
2. Frontend-HTTP-Verdrahtung in `channel-http-registry.ts`, `server-auth-client.ts`, `renderer-transport.ts` abgeglichen.
3. Security-Pfade: Auth/MFA/CSRF, RLS, Mail-ACL, Public Surfaces, SSRF-Grenzen, Capabilities, Event-WebSocket.
4. Multiuser-Logik: Delegation, Locks, Scheduled Send, Job-Provenance, Task-Sichtbarkeit.
5. Alle validierten Findings behoben inkl. Regressionstests (siehe Abschnitt 5).

## 2. Gesamtbild

Die Server-Edition ist architektonisch ausgereift: Workspace-RLS, Mail-ACL, Auth-Härtung (CAPTCHA/MFA/CSRF), Job-Provenance und Compose/Scheduled-Send-Claims sind grundsätzlich solide. Der Audit fand echte Sicherheits- und Verdrahtungslücken; die validierten Punkte sind in diesem Branch geschlossen.

| Bereich | Bewertung |
|---------|-----------|
| Auth / Session / MFA | Solide |
| Workspace-RLS | Solide |
| Mail-ACL / Delegation / Locks | Solide (Categories-Reorder ACL-Bypass behoben) |
| Capability-Modell | `crm.write` serverseitig + UI erzwungen; AI-Profile → `workflows.manage` |
| AI-Provider-SSRF | Private Hosts blockiert + pinned-fetch + keine Roh-Body-Exfiltration |
| Frontend↔Backend-Verdrahtung | Draft-Approval ausgeblendet; Delayed-Jobs Ops; Maintenance-Shims gehärtet |
| Event-WebSocket Isolation | CRM-Payloads auf `{ id }` reduziert |

## 3. Sicherheitsbefunde

### S1 — Hoch (behoben): AI-Profil SSRF mit Antwort-Exfiltration

**Mitigation:**
- Private/reservierte Hosts und `.local`/`.internal`/`localhost` bei Profil-Create/Update abgelehnt.
- Runtime: `guardedAiPost` (`ai-guarded-fetch.ts`) mit Allowlist = Profil-Host, DNS-Private-IP-Check, pinned-fetch.
- Fehler: nur `KI API HTTP ${status}` — kein Response-Body an Caller.
- Profil-Create/Update/Delete erfordern `workflows.manage` (Admins/Owner inkl.).
- `transform-text` bleibt für authentifizierte User nutzbar (Compose/Viewer); SSRF-Pfad läuft über guarded fetch.

### S2 — Hoch (behoben): Capability `crm.write` wird nicht erzwungen

**Fix:** `forbidUnlessCrmWrite` auf allen CRM-Schreibrouten (Customers, Products, Deals, Tasks, Deal-Products, Calendar-Entries, Custom Fields/Values, Saved Views, Activity Log create, Follow-up snooze, JTL sync/order/refs). UI: `canWriteCrm` auf Listen, Detailseiten, Produkte, Kalender, Custom Fields, Follow-up, Kanban.

### S3 — Hoch (behoben): Task-/CRM-Events leaken Felder über WebSocket

**Fix:** Payload auf `{ id }` für task, customer, product, deal, deal_product, custom_field(s), saved_view, activity_log, jtl_*, calendar_event.

### S4 — Mittel (behoben): Mail-ACL-Bypass bei Category-Reorder

**Fix:** Inventar/Policy/OpenAPI auf `POST` vereinheitlicht.

### S5 — Looks solid (kein Befund)

Auth/CSRF/MFA, Delegation, Locks, Scheduled Send, Returns-Portal, Webhook-SSRF, GDPR-Export.

## 4. Frontend↔Backend-Verdrahtung

### B1 — Hoch (behoben): Custom-Field-SetValue Upsert

### B2 — Mittel (behoben): Draft-Freigabe im Servermodus ausgeblendet

### B3 — Mittel (behoben): Delayed-Jobs Ops in Diagnostik

List + Cancel; Cancel setzt Status `cancelled`, löscht unlocked `job_queue`-Continuations; Executor skippt `cancelled`.

### B4 — Niedrig (INVALID): JTL-Referenz-Mutationen ohne UI — kein UI-Bedarf

### B5 — Niedrig (behoben): Maintenance-Update-Shims werfen klaren Fehler statt Fake-Success

### B6 — Niedrig (INVALID): `activity-log/:id` ohne FE — kein UI-Bedarf

### B7 — Info: Automation.SetSettings Desktop-only — bewusst

## 5. In diesem PR behobene Punkte

| ID | Fix |
|----|-----|
| S3 | Task-/CRM-Event-Payloads auf `{ id }` |
| S4 | Categories-Reorder POST + ACL-Policy |
| B1 | Custom-Field-Value Upsert |
| S1 | Private AI-`baseUrl` + pinned-fetch + keine Roh-Exfiltration + Profil-Mutationen → `workflows.manage` |
| S2 | `crm.write` Server + UI |
| B2 | Draft-Approval UI nur Desktop |
| B3 | Delayed-Jobs List/Cancel inkl. Queue-Cancel |
| B5 | Maintenance Update-Shims |

## 6. Offene Empfehlungen (nicht Blocker)

1. **P2** OpenAPI mit kanonischem Route-Inventar automatisiert synchron halten.
2. **Hinweis Betrieb:** Bestehende User-Gruppen brauchen ggf. Grant `crm.write` / `workflows.manage`.

## 7. Verifikation

```sh
pnpm exec jest --config jest.config.cjs \
  tests/unit/ai-providers.test.ts \
  tests/unit/server-mail-job-event-acl.test.ts \
  tests/unit/calendar-entry-routes.test.ts \
  tests/unit/server-task-assignment.test.ts

pnpm exec jest --config jest.config.cjs tests/unit/server-edition-foundation.test.ts \
  --testNamePattern='server customer mutation routes require crm.write|server AI profile mutation routes'
```
