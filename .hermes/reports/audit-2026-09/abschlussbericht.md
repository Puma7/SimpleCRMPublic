# Abschlussbericht: Sicherheits- und Bug-Audit SimpleCRM

**Stand:** 2026-09-25 · **Basis:** `main` @ `134b808` · **Branch:** `claude/jolly-cerf-hkvznl`
**Unterlagen:** `masterplan.md` (Vorgehen), `findings.md` (Befundregister mit Belegen je Befund), `freigabeliste.md` (Entscheidungen Teil 1), `freigabeliste-2.md` (Entscheidungen Teil 2), `freigabeliste-3.md` (Entscheidungen zu den Codex-Befunden), `codex-abgleich.md` (alle 110 Codex-Einträge mit Urteil und Commit), `baseline.md`, `inventories/`

## 1. Ergebnis in Zahlen

| Kennzahl | Wert |
|---|---:|
| Kandidaten aus der Suche (Phase 2), Zitate mechanisch geprüft | 196, davon 0 halluziniert |
| Duplikate | 21 |
| Widerlegt / By Design | 5 / 5 (F-A7-01 und F-A2b-05 sind durch die Freigaben G1 und G3 inzwischen behoben) |
| **Behoben** (roter Regressionstest, dann Fix) | **164**, das sind alle bestätigten und plausiblen Befunde plus die zwei revidierten By-Design-Einstufungen |
| Dokumentiert statt behoben (Info, Architektur) | 1 (F-A2c-04: zusammengesetzte Fremdschlüssel, eigenes Vorhaben) |
| Neue Befunde aus der Fix-Phase, behoben | 29 (siehe `findings.md`, Abschnitt „Neue Befunde“; N-cx-01 bis N-cx-08 aus dem Codex-Abgleich) |
| Codex-Befunde aus PR #192 (Anhang A/B/C) | 110 Einträge: 78 in diesem Durchgang behoben, 30 waren durch frühere Commits dieses PRs schon geschlossen, 2 By-Design, 0 offen (siehe Abschnitt 7) |
| Entscheidungen Freigabeliste Teil 1 / Teil 2 / Teil 3 | 15 / 42 / 12, alle umgesetzt |
| Commits auf dem Branch | 305 (davon 62 nach dem Merge von PR #192) |
| Neue Testdateien | 184 (einschließlich der Tests aus PR #192) |

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
7. **Codex-Abgleich:** PR #192 (paralleler Codex-Lauf) ist per Merge-Commit `37c5d02` übernommen. Seine 110 ungeprüften Einträge wurden einzeln auf dem gemergten Stand nachvollzogen, gegen dieses Register abgeglichen und wie oben behandelt: roter Test, Fix, ein Commit pro Ursache; Punkte mit Nebenwirkung über Freigabeliste Teil 3.
8. **Abnahme:** alle CI-Gates lokal (Abschnitt 5) und CI auf dem PR.

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
- **Authentication-Results (E6, G8):**
  - Die Header werden nur genutzt, wenn die Live-DNS-Prüfung ausfällt, nur das oberste Feld zählt, und nur mit passender authserv-id.
  - Weicht die authserv-id eines Anbieters von der Domain des IMAP-Hosts ab (z. B. Gmail mit `mx.google.com`) oder setzt ein zusätzlicher interner Hop ein eigenes Feld darüber, fehlt dieser Fallback. Auf dem Server hilft eine eigene authserv-id im Konto; der Desktop hat dafür kein Feld.
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
- **API-, IPC- und Betriebsänderungen aus dem Codex-Abgleich (Teil 3):**
  - Neue Ablehnungen auf dem Server: 403 für `POST`/`PATCH /api/v1/returns` ohne `crm.write`; 403 `owner_management_requires_owner`, wenn ein Nicht-Owner Owner vergibt, einlädt oder Owner-Konten ändert (auch beim Annehmen alter Owner-Einladungen); 403 für Editoren ohne `workflows.manage`, die einen aktiven Seiteneffekt-Workflow stilllegen oder umbauen; 404 bei mehrdeutigen Legacy-Konto-IDs; `compile-graph` meldet „Workflow-Graph zu komplex“ im bestehenden Format.
  - Additiv: optionales Feld `tls` beim SMTP-Verbindungstest. `/ai/transform-text` ignoriert `customerId` ohne `crm.read`.
  - WebSocket/Replay: Nicht-Mail-Ereignisse nur noch mit dem Leserecht der REST-Route (Automation-Keys nur Admin, Workflows/Wissen `workflows.view`, CRM `crm.read`).
  - MFA-Challenges, die vor dem Update ausgestellt wurden (höchstens 5 Minuten gültig), werden einmalig abgelehnt.
  - **Betrieb (G9):** `restore.sh` und der Restore-Drill melden sich als `simplecrm_app` an; ein manueller Aufruf mit Admin-`DATABASE_URL` wird mit Hinweis abgelehnt. `PG_RESTORE_ROLE` entfällt, neu ist `RESTORE_DRILL_MAINTENANCE_DATABASE_URL` (Standard: Admin-Verbindung, nur für CREATE/DROP der Drill-DB).
  - Desktop-IPC: neuer Preload-Kanal `email:register-dropped-compose-attachments`; Workflow-, Wissensbasis-, Konto-, Verbindungstest-, OAuth-Abschluss- und Konto-Signatur-Kanäle nur Owner/Admin; alle mutierenden Konto-Kanäle verlangen `rw`; unauflösbare Objekt-IDs nur Owner/Admin.

## 7. Codex-Abgleich (PR #192)

Pascal hat zusätzlich einen Codex-Lauf auf demselben Ausgangsstand (`134b808`) machen lassen (PR #192, Entwurf). Er ist per Merge-Commit `37c5d02` vollständig in diesen PR übernommen: strikte Proxy-Vertrauensregel (Hop-Zahlen werden abgelehnt; `update.sh` bricht vorher mit Hinweis ab), Prod-Deps-Stage im API-Image, Abhängigkeits-Updates (Overrides beider Seiten zusammengeführt), Quill-Clipboard-Härtung, Tests und drei Anhänge mit 110 ungeprüften Einträgen.

**Vorgehen:** Sechs thematische Prüf-Agenten haben jeden Eintrag auf dem gemergten Stand nachvollzogen (Einstieg bis Senke mit Datei und Zeile, Halluzinationsprüfung, Abgleich mit diesem Register, Prüfung, ob unser Fix Codex' konkrete Variante wirklich abdeckt). Danach wie im Hauptaudit: roter Test, kleinster Fix, ein Commit pro Ursache (Betreff mit Codex-IDs), Punkte mit Nebenwirkung über `freigabeliste-3.md` (G1–G12, alle Empfehlungen freigegeben).

**Ergebnis** (Einzelheiten je Eintrag in `codex-abgleich.md`):

| Ergebnis | Einträge |
|---|---:|
| In diesem Durchgang behoben | 78 |
| Durch frühere Commits dieses PRs schon geschlossen (im Code nachvollzogen) | 30 |
| By-Design (LAN-Automation als Opt-in; zweiter Workspace im Produkt nicht anlegbar) | 2 |
| Offen | 0 |

Die wichtigsten neuen Befunde aus Codex' Liste:
- **Desktop-Rollen:** Agent und Viewer konnten Code-Workflows (JavaScript/Python mit den Rechten des Programms) anlegen, damit waren E15–E17 umgehbar (G1). Verbindungstests schickten gespeicherte Passwörter an beliebige Hosts. Objekt-IDs ohne aufgelöstes Konto liefen an der Konto-ACL vorbei. Owner-Verwaltung nur noch durch Owner (G3).
- **Server:** Nicht-Mail-Ereignisse (Automation-Keys, Workflows, Wissen, CRM) gingen per WebSocket an alle. Race zwischen Passwortwechsel und Token-Rotation. Delegations-Manager konnten fremde Bindings per POST/PATCH einengen. Retouren ohne `crm.write`. Mutationsantworten ohne Anhang- und Eltern-Projektion. Windows-Pfadtrenner in der Anhang-Ausnahme. Relay-Anzeigename wurde zu zwei Absendern. Dry-Run führte Aliase live aus.
- **Ressourcen:** CID-Inline-Bilder (157 KB Rohmail → 136 Mio. Zeichen HTML, ab 700 KB Prozessabsturz), exponentielle Graph-Kompilierung, DOCX-DOM-Explosion trotz Byte-Budget (jetzt Worker, G7), POP3-/SMTP-Antworten ohne Gesamtfrist, Backup-Manifest ohne Grenze.
- **Infra:** Restore und Drill liefen als Superuser, Dump-SQL konnte per `RESET ROLE` zurück (G9); die Metadatenprüfung wertete Views als Admin aus.
- **Beim Beheben neu gefunden:** N-cx-01 (Auto-Antwort-Einstellungen gingen auf dem Desktop verloren), N-cx-02 (Server-Entwurfsfunktionen trafen empfangene POP3-Mails), N-cx-03 (CRM-Ereignisse ohne `crm.read`), N-cx-04 (Desktop-Sitzungen überlebten Rollen- und Passwortwechsel), N-cx-05 (Desktop-Workflow-HTTP ließ NAT64, 6to4, Teredo und weitere reservierte Bereiche durch), N-cx-06 bis N-cx-08 (Rspamd- und POP3-Antworten ohne Byte- bzw. Zeitgrenze).

**Restpunkte aus dem Codex-Abgleich** (bewusst nicht umgesetzt oder außerhalb der Freigaben):
- Desktop: Eine pauschale Owner/Admin-Pflicht für alle KI-Profil- und Spam-Einstellungen (C-B16) nimmt Agenten Rechte und ist nicht freigegeben. Die gefährlichen Teile (Key-Umleitung, Rspamd-Ziel) sind behoben.
- Workflows: Kein Autor-Recheck beim Cron-Feuern (bräuchte eine Migration); ein aktiver Workflow mit Override-Schlüssel, aber harmlosem Graphen, bleibt für Editoren abschaltbar. `mssql.query`/`jtl.order_context` lesen im Server-Dry-Run live (G11, dokumentiert). Ein ausgehender Desktop-Dry-Run ohne Vorschau ruft die KI weiter auf, sperrt aber nichts.
- PDF-Extraktion läuft weiter im Hauptprozess (nur Dateigrenze und Timeout). Pro Prozess bis zu zwei DOCX-Worker gleichzeitig (je ca. 550 MB Heap).
- Eine POP3-Zeile über 1 MiB bricht die Verbindung ab und wird beim nächsten Sync erneut versucht (RFC-Grenze 998 Zeichen).
- `GET /auth/invitations/:token` zeigt eine alte Owner-Einladung eines inzwischen nicht mehr berechtigten Einladenden noch als gültig an; das Annehmen scheitert korrekt.
- `crm.read`-Nutzer erhalten die id-Invalidierung (id, customerId) auch für private Aufgaben anderer (Zeilenregel, war vorher so).
- Desktop-POP3 UIDL/RETR laufen über node-pop3 nur mit dem Leerlauf-Timeout des Sockets (keine Gesamtfrist). Die Server-Prüfung der KI-Profil-`baseUrl` beim Speichern nutzt noch die ältere Adressliste; zur Laufzeit greift die vollständige Prüfung.
- PR #192 ist in diesem PR vollständig enthalten. Wird #193 per Merge-Commit gemergt, markiert GitHub #192 automatisch als gemergt; bei Squash muss #192 von Hand geschlossen werden.
