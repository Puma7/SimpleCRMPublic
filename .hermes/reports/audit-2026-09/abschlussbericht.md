# Abschlussbericht: Sicherheits- und Bug-Audit SimpleCRM

**Stand:** 2026-09-25 · **Basis:** `main` @ `134b808` · **Branch:** `claude/jolly-cerf-hkvznl`
**Unterlagen:** `masterplan.md` (Vorgehen), `findings.md` (Befundregister mit Belegen je Befund), `freigabeliste.md` (Entscheidungen Teil 1), `freigabeliste-2.md` (offene Entscheidungen), `baseline.md`, `inventories/`

## 1. Ergebnis in Zahlen

| Kennzahl | Wert |
|---|---:|
| Kandidaten aus der Suche (Phase 2), Zitate mechanisch geprüft | 196, davon 0 halluziniert |
| Duplikate | 21 |
| Widerlegt / By Design | 5 / 7 |
| **Behoben** (roter Regressionstest, dann Fix) | **137** |
| Teilweise behoben (Rest in Freigabeliste 2) | 11 |
| Wartet auf Entscheidung (Freigabeliste 2) | 14 |
| Nicht separat geprüft (Info, in Freigabeliste 2 als E39) | 1 |
| Neue Befunde aus der Fix-Phase, behoben | 13 (siehe `findings.md`, Abschnitt „Neue Befunde“) |
| Commits auf dem Branch (Fixes, Tests, Doku) | ca. 180 |
| Neue Testdateien | über 90 |

Alle 7 hoch eingestuften Befunde sind behoben:
- F-A2a-01: Credential-Exfiltration über einen geänderten Mailserver-Host.
- F-A2b-01: Umgehung des Seiteneffekt-Gates für Workflows.
- F-A10-01: Der JTL-Sync überschrieb fremde Kunden.
- F-A10-03: Aufgaben-Sichtbarkeit in den Follow-up-Queues.
- F-A13A14-02: 40-MB-JSON vor der Anmeldung.
- F-A5-04: DOCX-Zip-Bombe.
- F-A5-05: quadratische Regex beim Mail-Parsing.

## 2. Vorgehen (Kurzfassung)

1. **Baseline:** alle Gates auf `main` grün. Postgres-Tests laufen nur als Nicht-root-Nutzer.
2. **Suche:** mehrere Finder-Agenten je Teilbereich; jeder Befund braucht ein wörtliches Code-Zitat. Das Zitat wurde mechanisch gegen den Quellcode geprüft.
3. **Falsifikation:**
   - Pro Befund versucht ein unabhängiger Prüfer, ihn zu widerlegen: Pfad, Erreichbarkeit, bestehende Schutzmaßnahmen, Absicht laut Doku und Tests.
   - Bei hoch und kritisch eingestuften Befunden folgt eine zusätzliche Exploit-Prüfung.
   - Ein Durchlauf als Nutzer ohne Rechte gegen alle Routen fand keinen schreibenden Datenzugriff ohne Gate.
4. **Freigabe:** Fixes mit Migration, Vertragsänderung oder sichtbarer Verhaltensänderung erst nach deiner Entscheidung (Teil 1: alle Empfehlungen freigegeben).
5. **Fixes:**
   - Je Befund zuerst ein Regressionstest, der vor dem Fix rot war; danach der kleinste Fix an der Ursache, ein Commit pro Befund.
   - Parallele Agenten in eigenen Worktrees; ich habe jeden Diff geprüft, per cherry-pick übernommen, Konflikte zusammengeführt und nach jedem Paket die volle Testbasis laufen lassen.
6. **Abnahme:** alle CI-Gates lokal (Abschnitt 5).

## 3. Was behoben ist (nach Bereichen)

- **Anmeldung und Sitzungen:**
  - Passwortwechsel und Admin-Reset widerrufen fremde Sitzungen.
  - Wiederverwendete Refresh-Tokens widerrufen alle Sitzungen (60 s Kulanz).
  - TOTP-Codes gelten nur einmal.
  - MFA-Änderungen verlangen das Passwort oder einen Code.
  - Das Passwortändern unterliegt Sperre und Passwortregeln.
  - Das Setup-Token darf kein Platzhalter sein.
  - Die Laufzeit des Logins verrät nicht mehr, ob eine Adresse existiert.
  - Der WebSocket verbindet sich nach einem Token-Refresh neu.
- **Mandanten- und Rechtetrennung:**
  - Aufgaben-Sichtbarkeit in Follow-up und Dashboard.
  - Snippets im DSGVO-Export nur mit Leserecht.
  - Konto-ACL bei Anhängen und beim Löschen von Konten (Desktop).
  - Server-Wechsel am Mailkonto oder KI-Profil verlangt neue Zugangsdaten.
  - Retourenpositionen nur mit Produkten und Gründen des eigenen Workspace.
- **Überlastung und DoS:**
  - JSON-Limit 1 MiB (40 MiB nur für angemeldete Upload-Routen).
  - Regex-Suche mit Timeout.
  - DOCX-, PGP- und DMARC-Dekompression begrenzt.
  - HTML-Textextraktion an 12 Stellen in linearer Zeit.
  - Zeilenlimits für SMTP-, IMAP- und POP3-Clients.
  - Argon2 im Threadpool.
  - IMAP-Import je Nachricht.
  - Rate-Limits mit IPv6-/64-Bündelung und begrenzten Maps.
- **Mail:**
  - Exakte Empfängeradressen.
  - Kein automatischer Neuversand bei unklarem Zustellstatus.
  - „Später senden“ mit PGP wird abgelehnt statt im Klartext versendet.
  - PGP-Status `signed_partial`.
  - PGP-Entwürfe behalten den Klartext bis zur SMTP-Annahme.
  - Anhangsnamen mit Unicode.
  - Entwurfsanhänge mit Quote und Aufräumen.
  - Weiterleiten mit Anhängen (Server).
  - Anti-Loop für Abwesenheitsantworten.
  - Header-Prüfungen greifen wieder (`raw_headers` enthielt „[object Object]“).
  - Die neueste Nachricht wird nicht bei jedem Poll neu geholt.
  - Desktop-PGP funktioniert wieder.
  - MDN nach RFC 8098.
- **Workflows:**
  - Inbound-Kette mit Delay, Mischform B1: Wartet hinter dem Delay kein kettenstoppender Knoten, laufen die nachrangigen Workflows sofort weiter, sonst seriell mit Hinweis im Editor.
  - Abbrechen bzw. Löschen eines wartenden Delays.
  - KI-Gegenprüfung:
    - Geänderte Entwürfe gehen in die manuelle Freigabe.
    - Ein Sibling-Abbruch stoppt auch `email.send_draft`.
    - Zweige mit Urteils-Port ohne Kante werden abgeschlossen.
  - Schritt- und Tiefenlimits für Schleifen und Subflows.
  - Platzhalter-Injektion aus dem Mailinhalt.
  - Deferred-Jobs, `task.due` und CRM-Trigger auf dem Desktop.
  - Importierte Workflows auf dem Desktop sind deaktiviert.
- **Jobs und Betrieb:**
  - Queues je Workspace.
  - Verwaiste Zeitversand-Claims laufen ab.
  - Stale-Locks zählen Versuche.
  - Atomarer Komplett-Reset.
  - Audit-Archiv mit fsync.
  - Backup und Restore atomar.
  - API-Container ohne root und ohne Capabilities.
  - HSTS.
  - Log-Schwärzung.
  - Release-Workflow mit minimalen Rechten.
  - Das SMTP-Relay überlebt Updates (neu: N-int-01).
  - TLS-Reload für das Relay.
  - Webhook-Dedup atomar.
- **CRM:**
  - JTL-Sync über den JTL-Schlüssel (Migration 0052).
  - Backfill der Aufgaben-Zuweisungen (Migration 0053).
  - Kunde löschen mit Rückfrage (409 bzw. Dialog).
  - Paging über 100 Einträge.
  - Kennzahlen mit deutschen Deal-Phasen.
  - Spalten-Allowlist gegen SQL-Injection (Desktop, 3 Stellen).
  - Lokales Datum für „heute“.
- **Oberfläche:**
  - HTML-Escaping (Entwürfe, Anrede, Signaturen, Textbausteine).
  - Keine Erfolgsmeldung für ungeprüfte Verbindungstests.
  - Kein Datenverlust bei gescheitertem Speichern oder Upload.
  - Fehler werden sichtbar statt leerer Listen.
  - CSV-Export gegen Formel-Injection.
  - DevTools nur in unverpackten Builds.

Jeder Eintrag lässt sich im Register (`findings.md`) mit Commit und Testdatei nachvollziehen.

## 4. Bewusste Grenzen und Restrisiken

- **Migrationen:**
  - 0052 entkoppelt JTL-Dubletten, statt zu löschen; der entfernte Schlüssel steht in `source_row.jtlLinkRemoved`.
  - Kunden, die der alte Sync überschrieben hat, ohne eine Dublette zu erzeugen, erkennt die Migration nicht. Die Originaldaten liegen in `sqlite_import_rows`.
  - Vor dem Deploy ein Backup ziehen (`docker/backup.sh`).
- **Update auf den non-root-Container:**
  - `update.sh` gibt die Volumes einmalig an uid 1000.
  - Wer das Relay nutzt, muss `key.pem` für uid 1000 lesbar machen und `COMPOSE_FILE` mit dem Relay-Override setzen. Das Update-Skript warnt in beiden Fällen.
- **Regex-Suche:** Legitime Suchen über sehr große Postfächer brechen nach 10 s ab.
- **Übergangsphase bei den Graphile-Queues:** Nach dem Deploy laufen alte Jobs noch in den bisherigen Queues und können kurz parallel zu neuen Jobs desselben Workspace laufen. Die Kette ist über Claims geschützt.
- **Tracking:** Der Override pro Nachricht wirkt nur noch bei aktivierter Admin-Policy (deine Entscheidung A3). Das gilt auch für die Tracking-Regel des Relays.
- **Weiter offen:** siehe `freigabeliste-2.md` (42 Punkte, jeweils mit Empfehlung).

## 5. Abnahme

Auf dem Branch-Stand nach der letzten Integration:

| Gate | Ergebnis |
|---|---|
| `pnpm run lint` (eslint, 0 Warnungen) | grün |
| `pnpm run typecheck` (core, server, desktop, web, electron) | grün |
| `check:typescript-toolchain` | grün |
| Jest Unit-Projekt | 3322/3322 |
| Jest Integration als Nicht-root (Embedded Postgres) | 568/570; die 2 roten Tests (`sqlite-task-calendar-atomic`) scheitern nur am Schreibrecht des Testnutzers im root-eigenen Checkout, als root 19/19 grün |
| Mail-Suite mit Coverage-Ratchet | 1378 grün, 1 übersprungen (bestehender PDF-Skip); 92,1 % Zeilen, 80,8 % Branches (Schwelle erfüllt) |
| Server-Coverage-Ratchet | erfüllt (69,7 / 71,8 / 67,9 / 69,7) |
| UI-Coverage-Ratchet | erfüllt (45,4 / 63,8 / 36,9 / 45,4) |
| `pnpm run build` | siehe Abschnitt 6 |

Nicht lokal ausgeführt:
- **Electron-E2E (CI-Job `electron-e2e`):** Er braucht das Electron-Binary samt Download, das hier nicht verfügbar ist.
- **`server-compose-smoke`:** Er braucht Docker. Stattdessen habe ich `docker compose config`, Caddy (validate und Funktionstest) und PostgreSQL 16 (Restore-Szenarien) einzeln geprüft.

## 6. Hinweise für den Merge

- Der Branch enthält zwei neue Migrationen (0052, 0053). Beide sind unter FORCE RLS als Nicht-Superuser getestet und idempotent.
- Neue öffentliche Route: `GET /api/v1/portal/returns/:token/config`. Additive API-Felder in der Readiness-API, in Compose-Attachments (`sourceAttachmentId`) und im Kunden-Delete (409 mit `dependents`).
- Die Doku ist ergänzt: `SETUP_SERVER.md`, `SMTP_RELAY.md`, `BACKUP_AND_RESTORE.md`, `THREAT_MODEL.md`, `GROUP_RIGHTS_ADMIN.md`, `EMAIL_EVIDENCE_TRACKING.md`, `USER_GUIDE_WORKFLOWS.md`, `WORKFLOW_PHASES.md`, `LOGIN_SECURITY.md`.
