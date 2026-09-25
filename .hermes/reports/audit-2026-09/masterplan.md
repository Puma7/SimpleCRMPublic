# Masterplan: Stabilisierung, Sicherheit und Verdrahtung

**Stand:** 2026-09-25
**Basis:** `main` @ `134b808` (Merge #191), keine offenen PRs oder Issues
**Arbeitsbranch:** `claude/jolly-cerf-hkvznl`
**Status:** Phase 0–2 abgeschlossen; Phase 3 (Falsifikation) und Phase 4 (Fixes) laufen – Stand im Befundregister `findings.md`

---

## 1. Ziel und Abgrenzung

**Ziel:** Bevor neue Features entstehen, wird SimpleCRM (Desktop- und Server-Edition) systematisch geprüft. Sicherheitslücken, Bugs, nicht behandelte Grenzfälle und fehlende Verdrahtung (UI ↔ API/IPC ↔ Core ↔ Workflows) werden gefunden, belegt, gegengeprüft und sauber behoben.

**Nicht im Umfang:**

- neue Features oder Produktideen (kommen danach in einer eigenen Phase),
- Refactorings, Umbenennungen oder Stilkorrekturen ohne konkreten Befund,
- Änderungen an Live-Infrastruktur, echten Postfächern oder Kundendaten.

## 2. Ausgangslage (geprüfte Fakten)

| Bereich | Dateien | Zeilen (ca.) |
|---|---:|---:|
| `packages/server/src` (Fastify/PostgreSQL) | 266 | 135.000 |
| `src` (React-Renderer) | 311 | 69.000 |
| `electron` (Main-Prozess, SQLite, IMAP/SMTP) | 207 | 39.000 |
| `packages/core/src` | 66 | 11.000 |
| `shared` | 73 | 8.000 |
| `tests` | 471 | 139.000 |

- **Angriffsfläche:** 424 HTTP-Routen (`.hermes/reports/api-route-inventory.json`), rund 360 IPC-Kanäle (`shared/ipc/channels.ts`), 54 Server-Migrationen, Docker-Stack (Caddy, API, Postgres, Backup, Relay).
- **Frühere Prüfungen:** `plans/001–023` (10.07.), System/Mail/UX/Security-Audit (14.07.), Multinutzer-Server-Audit (26.07.). Deren Befunde gelten als behoben oder bewusst verworfen.
- **Seit dem letzten Audit:** 191 Commits, davon 657 Dateiänderungen in `packages/server/src` (u. a. Mail-Sync-Scheduler, Mail-ACL-Shadow/Enforce, Auth-Probe, Pre-Production-Hardening, Backup-Skripte). **Dieser Code ist bisher nicht auditiert** und hat deshalb Vorrang.
- **Umgebung dieser Sitzung:** Node 22 statt der geforderten Node 24, `node_modules` fehlt, Docker und `psql` sind vorhanden, Netzwerkzugriff funktioniert. Eine lauffähige Test-Baseline muss erst hergestellt werden (Phase 0).

## 3. Grundprinzipien gegen Fehlalarme und Halluzinationen

1. **Kein Befund ohne Beleg.** Jeder Befund nennt Datei und Zeile, zitiert den Code wörtlich und beschreibt den konkreten Pfad vom Einstiegspunkt (Route, IPC, Job, Mail-Eingang) bis zur Stelle, an der der Fehler wirkt, sowie ein konkretes Szenario (Eingabe → falsches Ergebnis).
2. **Existenz wird mechanisch geprüft.** Zitate, Symbole und Zeilennummern werden per `grep` gegen den echten Code abgeglichen. Ein Befund mit falschem Zitat ist automatisch verworfen.
3. **Falsifikation vor Fix.** Ein zweiter, unabhängiger Prüfer bekommt den Auftrag, den Befund zu **widerlegen**: Gibt es einen Schutz an anderer Stelle (globaler Hook, RLS, Middleware, Schema-Validierung)? Ist der Pfad erreichbar? Ist das Verhalten dokumentiert gewollt (`docs/THREAT_MODEL.md` „Known Residual Risks“, `LEARNINGS*.md`, frühere INVALID-Einträge)?
4. **Reproduktion vor Fix.** Bestätigt ist ein Befund erst, wenn ein roter Test (Unit, Integration, Postgres oder E2E) oder ein dokumentiertes Repro-Skript ihn zeigt. Ohne Reproduktion bleibt er „plausibel“ und wird nicht ohne Rücksprache geändert.
5. **Kleinster Fix an der Ursache.** Kein Umbau „bei der Gelegenheit“. Jeder Fix bringt seinen Regressionstest mit.
6. **Parität prüfen.** Ein Fehler in der Server-Edition wird auch im Desktop-Pfad gesucht und umgekehrt, weil beide Editionen dieselbe Logik oft doppelt implementieren.

### Statusmodell eines Befunds

`KANDIDAT` → `BESTÄTIGT` | `PLAUSIBEL` | `WIDERLEGT` | `BY-DESIGN` | `DUPLIKAT` → `BEHOBEN` | `ZURÜCKGESTELLT`

## 4. Phasen im Überblick

| Phase | Inhalt | Ändert Code? | Ergebnis |
|---|---|---|---|
| 0 | Baseline: Toolchain, alle Gates, Dependency- und Secret-Scan | nein | `baseline.md` |
| 1 | Inventare: Routen, IPC, Verdrahtung, Workflow-Knoten, RLS | nein (nur Skripte/Berichte) | `inventories/` |
| 2 | Befundsuche in 14 Prüfbereichen | nein | Kandidaten in `findings.md` |
| 3 | Validierung, Falsifikation, Reproduktion | nur rote Tests | bestätigtes Befundregister |
| 4 | Behebung nach Schweregrad | ja | Fix-Commits mit Tests |
| 5 | Abnahme, Doku, Restrisiken | Doku | Abschlussbericht |

Nach Phase 3 gibt es einen **Haltepunkt**: Das bestätigte Befundregister wird vorgelegt, bevor irgendetwas behoben wird.

## 5. Phasen im Detail

### Phase 0: Baseline (keine Codeänderung)

- Node 24 LTS und pnpm 11.12.0 bereitstellen, `pnpm install --frozen-lockfile`.
- Alle CI-Gates lokal ausführen: `check:typescript-toolchain`, `lint`, `typecheck`, `test`, `test:mail`, `test:server:coverage` samt Ratchet, `test:ui:coverage:check`, `build`.
- PostgreSQL per Docker für die Postgres-Integrationstests; wenn möglich zusätzlich den `server-compose-smoke`-Ablauf und die Electron-E2E unter `xvfb-run`.
- `pnpm audit --prod` und eine Liste veralteter oder verwundbarer Abhängigkeiten, inklusive der per GitHub-URL gepinnten Pakete.
- Secret-Scan über Arbeitsbaum und Git-History. Gefundene Werte werden nie zitiert, nur Datei, Zeile und Typ.
- **Ergebnis:** `baseline.md`. Tests, die schon auf `main` rot sind, werden als eigene Befunde (Kategorie B0) geführt.

### Phase 1: Inventare (deterministisch per Skript statt per Einschätzung)

Diese Karten entstehen, wo möglich, durch Skripte. Das ist reproduzierbar und nicht anfällig für Halluzinationen.

1. **Routenmatrix:** jede der 424 Routen mit den Spalten Methode, Pfad, Auth-Pflicht, Capability, Workspace-Scope/RLS, Mail-ACL-Policy, CSRF, Rate-Limit, Schema-Validierung, Body-Limit. Leere Felder sind sofort Kandidaten.
2. **IPC-Matrix:** Kanal → Handler registriert? → im Preload freigegeben? → im Renderer genutzt? → Eingabe validiert? → Account-Scope geprüft?
3. **Verdrahtungsmatrix:** UI-Aufruf ↔ HTTP-Registry (`channel-http-registry.ts`) ↔ Server-Route ↔ IPC-Handler ↔ Core. Gesucht werden tote Enden (UI ohne Backend, Backend ohne UI, Aufrufe mit falschem Payload-Format) und Paritätslücken zwischen Desktop und Server.
4. **Workflow-Knoten-Matrix:** Knoten im Schema ↔ Desktop-Executor ↔ Server-Executor ↔ Eigenschaften-Panel ↔ Validierung (`shared/email-workflow-graph-validate.ts`).
5. **Datenbank-Matrix:** jede Tabelle ↔ RLS-Policy ↔ `workspace_id`-Spalte ↔ Indizes für Fremdschlüssel; SQLite-Schema gegen Postgres-Schema.

### Phase 2: Befundsuche (read-only, parallel)

Reihenfolge: **zuerst der ungeprüfte Code seit dem 26.07.**, dann die öffentlich erreichbaren Oberflächen, dann der Rest. Weil die Server-Edition aus dem Internet erreichbar ist, gilt die Bereichs-Priorität A3 → A1 → A2 → A4 → A12 → A13 → A14 → A5–A11 (siehe Abschnitt 9).

| ID | Prüfbereich | Wichtigste Pfade | Schwerpunkte |
|---|---|---|---|
| A1 | Authentifizierung und Sitzung | `packages/server/src/auth/`, `api/auth-*.ts`, `api/auth-session-cookie.ts`, `electron/auth/` | Login, MFA, CAPTCHA, Brute-Force-Sperre, Session-Fixation, Cookie-Flags, CSRF, Einladungs- und Reset-Token, Timing-Unterschiede, Logout/Invalidierung |
| A2 | Autorisierung und Mandantentrennung | `api/capabilities.ts`, `db/workspace-context.ts`, `mail-access/`, Migrationen | IDOR über `:id`-Routen, fehlende Capability-Checks, RLS-Lücken, Delegation, ACL-Rollout Shadow/Enforce, WebSocket-Events |
| A3 | Öffentliche Oberflächen ohne Login | `email-tracking-routes.ts`, `returns-routes.ts`, Returns-Portal, OAuth-Callback, `inbound-smtp-service.ts`, `relay-*`, Automation-API | Token-Raten, Enumeration, Rate-Limits, Missbrauch als offenes Relay oder als Redirect-Schleuder |
| A4 | SSRF und ausgehende Verbindungen | `workflow-http-request.ts`, `jobs/pinned-fetch.ts`, `ai-guarded-fetch.ts`, `jobs/webhook-handlers.ts`, `email-oauth.ts`, `mail-connection-test.ts`, JTL/MSSQL | DNS-Rebinding, Redirects, IPv6/IPv4-mapped, Verbindungstest als Port-Scanner |
| A5 | Mail-Verarbeitung und Darstellung | `mail-parse.ts`, Anhänge, HTML-Sanitizing, Iframe-Sandbox, `pgp/`, `mail-read-receipt-responder.ts`, Abwesenheitsnotiz | Header-/CRLF-Injection, XSS im Viewer, Auto-Reply-Schleifen, übergroße oder kaputte MIME-Strukturen |
| A6 | Injection | `mail-search-sql.ts`, `db/sql-ilike.ts`, rohe `sql`-Templates, Regex-Knoten, Platzhalter, Backup/Restore, SQLite-Migrationsimport | SQL-Injection, ReDoS, Path Traversal, Zip-Slip, Shell-Injection in Skripten |
| A7 | Electron-Desktop | `electron/main.js`, `preload.ts`, `electron/ipc/`, `update-service.ts`, Keytar/Secrets | Umfang der Preload-Freigaben, IPC-Eingabeprüfung, `open-external-url`, Datei-Dialoge, Update-Signatur, Navigationsschutz |
| A8 | Jobs und Nebenläufigkeit | `jobs/`, `mail-scheduled-send.ts`, `jobs/mail-sync-scheduler.ts`, `locks/`, Delayed Jobs | Doppelversand, Race Conditions, Idempotenz, Retry-Stürme, hängende Claims |
| A9 | Workflows | `electron/workflow/`, `packages/server/src/workflow-*.ts`, Knoten-Katalog | Parität Desktop/Server, Endlosschleifen, Limits, Datenfluss aus fremden Mails |
| A10 | CRM-Kern und Datenintegrität | `packages/core/src/crm/`, Deals, Tasks/Kalender, Custom Fields, JTL-Sync, DSGVO-Export | Atomarität, Paginierung, Zeitzonen/Sommerzeit, Umlaute/Unicode, Löschkaskaden |
| A11 | Frontend | `src/components/`, `src/services/transport/`, `src/app/` | veraltete Antworten, `dangerouslySetInnerHTML`, Fehlerbehandlung, UI-Rechte vs. Server-Rechte, Formularvalidierung |
| A12 | Infrastruktur und Betrieb | `docker/`, `Caddyfile`, Dockerfiles, Backup-/Restore-/Update-Skripte, `.github/workflows/` | Security-Header, TLS, Root-Container, Secrets in Images, Dateirechte der Backups, CI-Berechtigungen, Supply Chain |
| A13 | Kryptografie und Secrets | `db/postgres-secret-port.ts`, PGP, Token-Hashing, Logging | Verschlüsselung ruhender Secrets, Schlüsselrotation, Zufallsquellen, Secrets in Logs und Fehlermeldungen |
| A14 | Verfügbarkeit und Ressourcen | Body-Limits, Rate-Limits, Paginierungs-Obergrenzen, Queues | Speicher-Erschöpfung durch große Mails oder Anhänge, unbegrenzte Listen, ReDoS |

Jeder Prüfer arbeitet nur lesend und liefert Kandidaten im Format aus Abschnitt 6, ohne Fixes.

### Phase 3: Validierung, Falsifikation, Halluzinationsprüfung

Jeder Kandidat durchläuft diese Schritte. Scheitert er an einem, endet er als `WIDERLEGT`, `BY-DESIGN` oder `DUPLIKAT` und wird mit Begründung archiviert, nicht gelöscht.

1. **Existenz:** Zitat, Datei, Zeile und Symbol stimmen mit dem Code überein (automatisch per `grep`).
2. **Erreichbarkeit:** Der Pfad vom Einstiegspunkt ist lückenlos nachvollzogen, einschließlich globaler Hooks in `server-api.ts` und `fastify-adapter.ts`.
3. **Gegenprüfung:** Ein unabhängiger Prüfer versucht gezielt, den Befund zu widerlegen.
4. **Dokumentenabgleich:** Abgleich mit `THREAT_MODEL.md`, `LEARNINGS*.md`, früheren Audits und `plans/`.
5. **Reproduktion:** roter Test oder Repro-Skript. Die Test-Datei wird im Befund verlinkt.
6. **Einstufung:** Schweregrad, betroffene Edition (Server, Desktop, beide), Aufwand.

**Haltepunkt:** Das bestätigte Register geht an Pascal. Befunde mit Verhaltensänderung, Migration oder API-Bruch werden einzeln freigegeben.

### Phase 4: Behebung

- Reihenfolge: Kritisch → Hoch → Mittel → Niedrig, gebündelt nach Prüfbereich.
- Pro Befund: roter Test → kleinster Fix → Test grün → Nachbartests, `lint` und `typecheck` grün → Paritätsprüfung in der anderen Edition.
- Bestehende Migrationen werden nie verändert. Schemaänderungen kommen ausschließlich als neue Migration, jeweils für PostgreSQL und SQLite.
- Jeder Fix-Commit nennt die Befund-ID. Vor jedem Push folgt eine eigene, bewusst kritische Durchsicht des Diffs (Code-Review).
- Abhängigkeits-Updates: Patch- und Minor-Versionen im Rahmen des Lockfiles, Major-Sprünge nur nach Rücksprache.

### Phase 5: Abnahme

- Vollständiger Gate-Lauf wie in CI, dazu Electron-E2E und `server-compose-smoke`.
- Abschlussbericht mit allen Befunden und ihrem Endstatus, verbleibenden Restrisiken und offenen Punkten.
- `docs/AGENT_HANDOFF.md`, `docs/LEARNINGS*.md` und `docs/THREAT_MODEL.md` werden aktualisiert.
- Danach Übergang in die Feature-Phase.

## 6. Befundformat

```markdown
### F-<Bereich>-<Nr>: <Kurztitel>

- Status: KANDIDAT | BESTÄTIGT | PLAUSIBEL | WIDERLEGT | BY-DESIGN | DUPLIKAT | BEHOBEN
- Schweregrad: Kritisch | Hoch | Mittel | Niedrig | Info
- Edition: Server | Desktop | beide
- Ort: `pfad/datei.ts:123` (+ Zitat, wörtlich)
- Pfad: Einstiegspunkt → … → Stelle, an der der Fehler wirkt
- Szenario: konkrete Eingabe/Lage → falsches Ergebnis/Schaden
- Voraussetzungen: z. B. angemeldet, Capability X, Workspace-Mitglied
- Gegenprüfung: was geprüft wurde, um den Befund zu widerlegen, und warum es ihn nicht widerlegt
- Reproduktion: `tests/…/xyz.test.ts` (rot vor Fix)
- Fix: Commit-Hash, kurze Beschreibung
```

## 7. Schweregrade

| Stufe | Bedeutung |
|---|---|
| Kritisch | Ohne Login oder über Mandantengrenzen ausnutzbar; Übernahme, Datenabfluss oder Codeausführung |
| Hoch | Angemeldete Nutzer umgehen Rechte; Datenverlust oder Doppelversand im Normalbetrieb |
| Mittel | Ausnutzbar nur unter besonderen Bedingungen; falsches Verhalten mit spürbaren Folgen; tote Verdrahtung einer Kernfunktion |
| Niedrig | Härtung, seltene Grenzfälle ohne Datenschaden, Randfunktionen |
| Info | Beobachtung ohne direkten Handlungsbedarf |

## 8. Artefakte

Alle unter `.hermes/reports/audit-2026-09/`:

- `masterplan.md` (dieses Dokument)
- `baseline.md` (Phase 0)
- `inventories/` (Phase 1, inklusive der erzeugenden Skripte)
- `findings.md` (fortlaufendes Befundregister)
- `abschlussbericht.md` (Phase 5)

## 9. Entscheidungen (geklärt am 2026-09-25)

| Frage | Entscheidung | Folge für den Plan |
|---|---|---|
| Einsatz | **Server-Edition produktiv und aus dem Internet erreichbar** | Vorrang: A3 (öffentliche Flächen) → A1 (Auth) → A2 (Rechte/Mandanten) → A4 (SSRF) → A12 (Infra) → A13/A14; danach A5–A11. Der Desktop wird vollständig geprüft, bei gleichem Schweregrad aber nachrangig. Schweregrad-Einstufung geht von einem Angreifer im Internet ohne Konto aus. |
| Git/PRs | **Ein Branch, ein PR**: alles auf `claude/jolly-cerf-hkvznl`, ein Commit je Befund, am Ende ein PR | Kein Merge durch Claude. Befund-IDs stehen im Commit-Text, damit der große PR nachvollziehbar bleibt. |
| Prüftiefe | **Gründlich**: Multi-Agent-Workflow, alle 14 Bereiche, je Kandidat eine unabhängige Falsifikation | Phase 2 und 3 laufen als orchestrierter Workflow; die Reproduktion (roter Test) erfolgt danach durch Claude selbst. |
| Freigabe | **Bestätigte Befunde ohne Nebenwirkung** werden nach dem Haltepunkt direkt behoben | Einzelfreigabe nur bei Migrationen, API- oder Verhaltensänderungen, sichtbaren UX-Änderungen und Major-Updates von Abhängigkeiten. |

## 10. Risiken des Vorgehens

| Risiko | Gegenmaßnahme |
|---|---|
| KI-Prüfer erfinden Befunde oder zitieren falsch | Existenzprüfung per `grep`, unabhängige Falsifikation, Pflicht zur Reproduktion |
| Fix erzeugt Regression | roter Test vor Fix, volle Gates, Paritätsprüfung, Code-Review des Diffs |
| Scope-Creep (Fixes ohne Befund) | nur registrierte, bestätigte Befunde werden geändert |
| Veraltete Umgebung verfälscht Ergebnisse | Phase 0 stellt dieselbe Toolchain wie CI her |
| Bereits als „by design“ entschiedene Punkte kommen erneut hoch | Abgleich mit Threat Model, Learnings und früheren Audits in Phase 3 |
