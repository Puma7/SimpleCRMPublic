# Security Review — Automation API (Phase A & B)

Stand: Implementierung Phase A/B.

## Threat Model

| Bedrohung | Einstufung | Maßnahme |
|-----------|------------|----------|
| Lokaler Angreifer ohne Key | Mittel | API deaktiviert per Default; 401 ohne gültigen Key |
| Key-Leak (n8n-Export, Logs) | Hoch | Key nur einmal in UI; Keytar-Speicherung; Rate-Limit 60/min |
| LAN-Zugriff (bind 0.0.0.0) | Hoch | Opt-in mit Warnung; Default `127.0.0.1` |
| CSRF vom Browser | Niedrig | Kein Cookie-Auth; CORS `Allow-Origin: null` |
| Große Bodies (DoS) | Mittel | Max 1 MB Request-Body |
| SQL-Injection über API | Mittel | Prepared Statements in sqlite-service (unverändert) |
| Workflow execute mutiert Daten | Hoch | Default `dryRun: true`; explizit `dryRun: false` für Schreibzugriff |
| E-Mail HTML exfiltriert | Mittel | `body_html` nicht in API; `body_text` max 32k bei `includeBody=true` |
| Keytar / Passwörter | Kritisch | Keine IMAP/SMTP/OAuth-Keys in API-Responses (`sanitizeAccount`) |

## Implementierte Kontrollen

1. **Fail-closed:** `automation_api_enabled` muss `true` sein.
2. **Timing-safe Key-Vergleich** (`crypto.timingSafeEqual`).
3. **Scope-basierte Autorisierung** pro Route.
4. **Rate limiting** pro Key (60 Requests/Minute).
5. **Nur explizite HTTP-Methoden** (GET, POST, PATCH, DELETE).
6. **Positive Integer-IDs** in Pfaden.
7. **Kein Directory Traversal** — feste Route-Tabelle.
8. **Health/OpenAPI** ohne Auth (nur auf localhost sinnvoll; OpenAPI enthält keine Secrets).

## Bekannte Restrisiken / Phase C

| Risiko | Empfehlung |
|--------|------------|
| OpenAPI ohne Auth auf LAN | OpenAPI nur mit Auth wenn `bindLan` |
| Kein Audit-Log | Tabelle `api_request_log` (Phase D) |
| `dryRun: false` per API | UI-Warnung + optional separates Scope `workflows:write` |
| Kein HTTPS auf localhost | Dokumentiert; TLS-Terminierung extern |
| Phase C Webhooks inbound | HMAC + nonce + IP-Allowlist |

## Checkliste vor Produktivnutzung

- [ ] API nur bei Bedarf aktivieren
- [ ] LAN-Bindung **nicht** aktivieren ohne Firewall
- [ ] Minimal-Scopes für n8n-Key (z. B. nur `read` + `write`)
- [ ] Key nach Setup aus Zwischenablage löschen
- [ ] n8n-Credentials verschlüsselt speichern
- [ ] Workflow-Execute mit `dryRun: true` testen, bevor `false`

## Regression

- Bestehende **IPC**-Pfade unverändert (Services sind additive Schicht).
- Server startet/stoppt mit App; Port-Konflikt loggt Warnung, App bleibt lauffähig.

## Verifiziert (Mai 2026)

- Unit-Tests: Auth (401/403/429), Health ohne Key, API disabled (503), Server-Health-Smoke.
- Mock-Requests normalisieren Header wie Node (`authorization` lowercase).
- E-Mail-Actions: Whitelist im `switch`; unbekannte `action` → 400.
- Workflow-Execute: deaktivierte Workflows abgelehnt; `dryRun` default `true`.
- Routen nur unter `/api/v1` (kein Bypass ohne Prefix).
- Query-/JSON-IDs: positive Ganzzahlen (`coercePositiveInt`); ungültige `customerId`-Query → 400.
- Task-Toggle: `completed` muss explizit boolean sein.
- Key-Generierung: mindestens ein Scope (UI + IPC).
- Port-Konflikt (`EADDRINUSE`): Server startet nicht, App bleibt stabil.
