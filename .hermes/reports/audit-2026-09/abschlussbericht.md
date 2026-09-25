# Abschlussbericht: Sicherheits- und Bug-Audit SimpleCRM

**Stand:** 2026-09-25 · **Basis:** `main` @ `134b808` · **Branch:** `claude/jolly-cerf-hkvznl`
**Unterlagen:** `masterplan.md` (Vorgehen), `findings.md` (Befundregister mit Belegen je Befund), `freigabeliste.md` (Entscheidungen Teil 1), `freigabeliste-2.md` (offene Entscheidungen), `baseline.md`, `inventories/`

## 1. Ergebnis in Zahlen

| Kennzahl | Wert |
|---|---:|
| Kandidaten aus der Suche (Phase 2), Zitate mechanisch geprüft | 196, davon 0 halluziniert |
| Duplikate | 21 |
| Widerlegt / By Design | 5 / 7 |
| **Behoben** (roter Regressionstest, dann Fix) | **162**, das sind alle bestätigten und plausiblen Befunde |
| Dokumentiert statt behoben (Info, Architektur) | 1 (F-A2c-04: zusammengesetzte Fremdschlüssel, eigenes Vorhaben) |
| Neue Befunde aus der Fix-Phase, behoben | 21 (siehe `findings.md`, Abschnitt „Neue Befunde“) |
| Entscheidungen Freigabeliste Teil 1 / Teil 2 | 15 / 42, alle umgesetzt |
| Commits auf dem Branch | 235 |
| Neue Testdateien | 129 |

## 2. Vorgehen (Kurzfassung)

1. **Baseline:** alle Gates auf `main` grün. Postgres-Tests laufen nur als Nicht-root-Nutzer.
2. **Suche:** mehrere Finder-Agenten je Teilbereich; jeder Befund braucht ein wörtliches Code-Zitat. Das Zitat wurde mechanisch gegen den Quellcode geprüft.
3. **Falsifikation:**
   - Pro Befund versucht ein unabhängiger Prüfer, ihn zu widerlegen: Pfad, Erreichbarkeit, bestehende Schutzmaßnahmen, Absicht laut Doku und Tests.
   - Bei hoch und kritisch eingestuften Befunden folgt eine zusätzliche Exploit-Prüfung.
   - Ein Durchlauf als Nutzer ohne Rechte gegen alle Routen fand keinen schreibenden Datenzugriff ohne Gate.
4. **Freigabe:** Fixes mit Migration, Vertragsänderung oder sichtbarer Verhaltensänderung erst nach deiner Entscheidung (Teil 1: alle Empfehlungen freigegeben).
5. **Freigabe Teil 2:** Rund 40 Fixes waren als teilweise behoben markiert oder brauchten eine Entscheidung. Pascal hat alle Empfehlungen E1–E42 freigegeben; umgesetzt ist das in sechs weiteren Paketen.
6. **Fixes:**
   - Je Befund zuerst ein Regressionstest, der vor dem Fix rot war; danach der kleinste Fix an der Ursache, ein Commit pro Befund.
   - Parallele Agenten in eigenen Worktrees; ich habe jeden Diff geprüft, per cherry-pick übernommen, Konflikte zusammengeführt und nach jedem Paket die volle Testbasis laufen lassen.
7. **Abnahme:** alle CI-Gates lokal (Abschnitt 5) und CI auf dem PR.

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
  - 0052 entkoppelt JTL-Dubletten, statt zu löschen.
  - Kunden, die der alte Sync ohne Dublette überschrieben hat, erkennt 0052 nicht. Ihre Originaldaten liegen in `sqlite_import_rows`.
  - 0053 holt den Aufgaben-Backfill nach.
  - 0054 legt `trusted_authserv_id` an.
  - Vor dem Deploy ein Backup ziehen.
- **Update auf den non-root-Container:**
  - `update.sh` übergibt die Volumes einmalig an uid 1000.
  - Wer das Relay nutzt, macht `key.pem` für uid 1000 lesbar und setzt `COMPOSE_FILE` mit dem Relay-Override. Das Skript warnt, wenn eines davon fehlt.
- **Nutzer-Regex (E1):**
  - Die lineare V8-Engine greift nicht bei gebundenen Wiederholungen über 16 (`(a|a){0,30}b`) und nicht bei Relay-Mustern mit Flag `u` oder `v`.
  - Bereits gespeicherte Muster mit Lookaround oder Rückverweis laufen ungeschützt weiter; sie werden erst beim nächsten Speichern abgelehnt.
  - Vorschlag: zusätzlich `--enable-experimental-regexp-engine` und beim Speichern prüfen, ob das Muster mit dem Flag `l` kompiliert.
- **Authentication-Results (E6):**
  - Die Header werden nur genutzt, wenn die Live-DNS-Prüfung ausfällt, und nur mit passender authserv-id.
  - Weicht die authserv-id eines Anbieters von der Domain des IMAP-Hosts ab (z. B. Gmail mit `mx.google.com`), fehlt dieser Fallback, bis im Konto eine eigene authserv-id eingetragen ist.
- **Regex-Suche:** Legitime Suchen über sehr große Postfächer brechen nach 10 s ab. Pro Nutzer laufen höchstens zwei Suchen gleichzeitig; der Zähler gilt je Prozess.
- **Webhooks und Portal (E4):**
  - Webhook-Bodies über 64 KiB bekommen 413.
  - Im Portal kann eine Einsendung mit sehr vielen Positionen und langer Notiz mit Umlauten theoretisch über 64 KiB kommen.
- **Workflows:**
  - Nach einem UIDVALIDITY-Reset laufen neu indizierte Nachrichten wieder durch Workflows, Spam-Prüfung und Abwesenheitsantwort (E27 unverändert gelassen).
  - Ein Kreis über `logic.delay` ist auf dem Desktop nicht durch einen Hop-Zähler begrenzt; der Server hat einen.
- **Release:**
  - Die umgebaute Release-Pipeline (Build ohne Token, Publish-Job) läuft erst beim nächsten Tag wirklich.
  - Das macOS-Auto-Update bleibt aus, bis eine Signatur mit Apple Developer ID vorliegt (siehe `docs/RELEASE.md`).
- **Nicht angefasst (außerhalb des Auftrags):**
  - Die Desktop-Kontoverwaltung zeigt Nicht-Admins weiter die Knöpfe; die Aktion selbst wird abgelehnt.
  - Die MDN-Ausgangsprüfung wertet den Text der eingegangenen Mail aus statt den MDN-Text.
  - Das Deals-Kanban ist auf 100 Einträge begrenzt.
  - Toter Code `workflowDelayedJobs.create`.

## 5. Abnahme

Auf dem Branch-Stand nach der letzten Integration, einschließlich Freigabeliste Teil 2:

| Gate | Ergebnis |
|---|---|
| `pnpm run lint` (eslint, 0 Warnungen) | grün |
| `pnpm run typecheck` (core, server, desktop, web, electron) | grün |
| `check:typescript-toolchain` | grün |
| Jest Unit-Projekt | 3490 von 3490 grün, dazu der Base64-Test |
| Jest Integration als Nicht-root (Embedded Postgres) | 691 von 693; die 2 roten Tests (`sqlite-task-calendar-atomic`) scheitern nur am Schreibrecht des Testnutzers im root-eigenen Checkout, als root 19 von 19 grün |
| Mail-Suite mit Coverage-Ratchet | 1412 grün, 1 übersprungen (bestehender PDF-Skip), Schwelle erfüllt |
| Server-Coverage-Ratchet | erfüllt |
| UI-Coverage-Ratchet | erfüllt (48,3 / 64,6 / 36,9 / 48,3) |
| `pnpm run build` | grün |
| CI auf dem PR (build-and-test, server-compose-smoke, electron-e2e) | vor Teil 2 vollständig grün. Die Electron-E2E-Tests und der Compose-Smoke-Test mit Backup- und Restore-Probe liefen auf GitHub. |

In der CI aufgefallen und behoben:
- **Electron-E2E:** Zwei Aufräum-Tests kannten den neuen Rückfragedialog beim Löschen von Kunden noch nicht (F-A10-10).
- **Stack-Überlauf bei Base64:** Die Base64-Regex für große Uploads warf auf GitHub „Maximum call stack size exceeded“, nachdem im selben Prozess das V8-Flag aus E1 aktiv war. Sie ist durch eine Schleife ersetzt.
  - Lokal ließ sich das mit Node 24.21 nicht nachstellen.
  - Restrisiko: Andere Regex auf sehr großen Eingaben könnten mit dem Flag ebenso reagieren. Nach dem Deploy auf `RangeError` in den Logs achten.

## 6. Hinweise für den Merge

- Der Branch enthält drei neue Migrationen (0052, 0053, 0054). Alle sind unter FORCE RLS als Nicht-Superuser getestet und idempotent.
- Neue öffentliche Route: `GET /api/v1/portal/returns/:token/config`. Additive API-Felder in der Readiness-API, in Compose-Attachments (`sourceAttachmentId`) und im Kunden-Delete (409 mit `dependents`).
- **API- und IPC-Änderungen aus Teil 2:**
  - Additive Felder: `trustedAuthservId` am Mailkonto, `portalCaptchaEnabled` in den Sicherheitseinstellungen, `offset`/`priority` bei `GET /api/v1/tasks`, `jtlKkunde` am Kunden, `accountId` bei `PATCH …/compose-draft`, dazu der IPC-Kanal `pgp:set-peer-key-trust`.
  - Entfallen: `allowArbitraryRecipients` (wird bei Eingabe ignoriert).
  - Neue Ablehnungen:
    - 405 für `POST /api/v1/workflow-delayed-jobs`.
    - 400 `unsupported_trigger` für Desktop-Trigger auf dem Server.
    - 413 für Auth-, Portal- und Webhook-Bodies über 64 KiB.
    - 429 `regex_search_busy`.
    - 403 `target_more_privileged`.
- Die Doku ist ergänzt: `SETUP_SERVER.md`, `SMTP_RELAY.md`, `BACKUP_AND_RESTORE.md`, `THREAT_MODEL.md`, `GROUP_RIGHTS_ADMIN.md`, `EMAIL_EVIDENCE_TRACKING.md`, `USER_GUIDE_WORKFLOWS.md`, `WORKFLOW_PHASES.md`, `LOGIN_SECURITY.md`.
