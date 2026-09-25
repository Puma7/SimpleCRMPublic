# Inventar: Routen-Probe als Nutzer ohne Rechte

**Stand:** 2026-09-25 · **Basis:** Branch `claude/jolly-cerf-hkvznl` (nach F-DEP-01 … F-D1-02)

## Methode

Deterministische Ergänzung zur LLM-Befundsuche. Sie verwendet dieselbe Routen-Extraktion wie `tests/unit/api-auth-surface.test.ts`: Pfadliterale und Regex-Muster aus `packages/server/src/api/*.ts`, IDs als `1` eingesetzt.

- Aufrufer: angemeldeter Principal, Rolle `user`, **keine** Capabilities, keine Mail-Grants.
- Jede Route × `GET`/`POST`/`PATCH`/`DELETE` mit leerem Body über `createServerApi(...).handle`.
- Alle Ports sind Proxies, die beim **ersten** Aufruf werfen. Der erste erreichte Port zeigt, ob zuerst eine Schranke (`mailAccess`, `mailResourceLookup`, `auth`) oder eine Datenoperation erreicht wird.
- Rohdaten: `lowpriv-route-probe.json` (710 Zeilen; 404/405 ausgelassen).

## Ergebnis

| Ergebnis | Anzahl |
|---|---:|
| 403 (Capability/Rolle fehlt) | 403 |
| zuerst Mail-ACL (`mailAccess`) | 153 |
| zuerst Mail-Ressourcen-Lookup (Teil der ACL-Prüfung) | 95 |
| 400 (Eingabevalidierung vor der Rechteprüfung) | 69 |
| Datenport ohne vorherige Schranke | 29 (siehe unten) |
| 200 | 5 (`/health`, `/api/v1/health`, Logout, Zählpixel, eigene Capabilities) |

Datenport ohne vorherige Schranke, einzeln bewertet:

| Route(n) | Erster Port | Bewertung |
|---|---|---|
| `GET /api/v1/ai/profiles[/:id]`, `GET /api/v1/ai/prompts[/:id]` | `aiProfiles`/`aiPrompts` | gewollt: Compose/Viewer brauchen die Profile, Schreibzugriff verlangt `workflows.manage` (Audit 26.07., S1) |
| `GET /api/v1/user-groups` | `userGroups.list` | gewollt (Zuweisungs-UI) |
| `GET/DELETE /api/v1/email/access/bindings[/:id]` | `mailDelegation` | Rechteprüfung im Port (`canManageResource`) |
| `…/tracking/events/:eventId/ip-insight` | `audit.record` | gewollt: die Verweigerung wird vor der 403 protokolliert |
| `GET /api/v1/email/settings/snooze`, `GET /api/v1/workflow/settings/automation` | `syncInfo.getMany` | nur Leseeinstellungen ohne Secrets |
| `POST /api/v1/webhooks/incoming`, `POST /api/v1/workflows/webhook/incoming` | `syncInfo.getMany` | verlangt zusätzlich das Webhook-Secret bzw. Automation-Scope |
| `…/workflows/by-source/:id[/execute]`, `POST /api/v1/workflows/:id/execute` | `workflows.get/list` | Lookup vor der Capability-Prüfung, danach `rejectUnlessWorkflowView/Edit/Manage`; keine Ausgabe ohne Recht |
| `…/pgp/identities/by-source/:id…`, `POST /api/v1/pgp/peer-keys/by-source/:id` | `pgpIdentities/pgpPeerKeys.list` | als Befund F-A2a-04 im Register (nicht inventarisierte Methoden am Mail-Enforcer vorbei) |
| Portal, Setup, Einladungen, Login-Konfiguration | diverse | bewusst öffentlich (siehe `PUBLIC_SURFACE` in `api-auth-surface.test.ts`) |

**Fazit:** Kein Nutzer ohne Rechte erreicht eine schreibende Datenoperation ohne vorherige Schranke. Die einzige offene Stelle (PGP `by-source`) ist bereits als Befund erfasst. Die 69 Fälle mit Validierung vor der Rechteprüfung verraten nur die Existenz des Formats, keine Daten.
