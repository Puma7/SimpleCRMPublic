# System-, Mail-, UX- und Security-Audit

Stand: 2026-07-14

Ausgangsbasis: `origin/main` auf Commit `712739f`

Audit-Branch: `codex/system-mail-ux-security-audit-complete`

Pull Request: `#151`

Abschlussprüfung: 2026-07-14, 21:15 Uhr MESZ

## 1. Umfang und Methode

Geprüft wurden beide Editionen des Monorepos:

- Desktop: Electron, React, SQLite, lokale IMAP-/POP3-/SMTP-Verarbeitung.
- Server: Fastify, PostgreSQL, Job Queue, HTTP-Transport und Browser-Client.
- Mail-Lebenszyklus: Eingang, Persistierung, Nachverarbeitung, Security/Spam, Workflows, Viewer, Entwurf, Signatur, geplanter und direkter Versand.
- Authentifizierung: Setup, Passwort, CAPTCHA, PIN, MFA, Session-Speicherung und IPC-Freigaben.
- Sichtbare Oberflächen: Mail-Viewer, Composer, Mail-Einstellungen und Deploy-Setup.

Die Prüfung kombinierte Ausführungspfad-Analyse, Regressionstests, vollständige Jest-/Coverage-Läufe, Produktionsbuild, Electron-E2E und gerenderte Playwright-Prüfungen. Es wurden keine Live-Postfächer, Kundendaten oder produktiven Zugangsdaten verwendet.

## 2. Datenfluss

### 2.1 Desktop-Eingang

1. IMAP oder POP3 lädt RFC822-Daten.
2. Parsergebnis und rohe RFC822-Daten werden in SQLite persistiert.
3. `processNewMessagesAfterSync` persistiert Anhänge, ordnet Threads/Tickets zu, verknüpft Kunden und erkennt MDN/PGP-Merkmale.
4. Security-/Spam-Pipeline und Inbound-Workflows bewerten beziehungsweise verändern die Nachricht.
5. Viewer und Listen lesen denselben lokalen Datensatz über typisierte IPC-Kanäle.

Der Aufbau ist grundsätzlich plausibel. Kritisch war jedoch, dass ein Absturz zwischen Insert und Anhangspersistierung einen Pending-Datensatz ohne Parser-Anhänge hinterließ. Der Retry markierte ihn danach als erledigt, ohne die Anhänge wiederherzustellen. Dieser Datenverlustpfad ist behoben: Pending-Nachrichten werden aus `raw_rfc822_b64` erneut geparst; Fehler bei Anhängen oder Threading lassen den Post-Process-Status offen und blockieren den Inbound-Workflow bis zum erfolgreichen Retry, damit seine Seiteneffekte nicht doppelt ausgeführt werden.

### 2.2 Server-Eingang und Workflow

1. Server-Worker importieren Maildaten nach PostgreSQL in einen Workspace-Kontext.
2. Security- und Workflow-Jobs laufen transaktional und setzen Fortsetzungsvariablen.
3. KI-Knoten können adressierte Antwortentwürfe mit `reply_parent_message_id` erzeugen.
4. `email.send_draft` plant den Entwurf; der Scheduled-Send-Worker übernimmt SMTP und anschließend die Sent-Kopie.

Die KI-Entwürfe waren vorher im Server- und teilweise im Desktoppfad nicht versandfähig, weil Empfänger beziehungsweise Thread-Bezug fehlten. Beide Pfade adressieren nun den primären Antwortempfänger; der Server berücksichtigt zusätzlich `Reply-To` vor `From`.

### 2.3 Bearbeitung und Viewer

Der Viewer lädt Listeneintrag und vollständige Nachricht asynchron. Ein älterer Request konnte nach Verschieben, Löschen oder schneller Neuauswahl den aktuellen State überschreiben. Das erklärte den sporadischen Inhalt `...` und verlorene HTML-Aktionen. Eine monotone Request-ID verhindert jetzt, dass veraltete Antworten die aktuelle Auswahl setzen.

Der Composer speichert drei HTML-Zonen: editierbarer Text, Signatur und Zitat. DOMPurify entfernte beim Autosave die Kommentar-Marker, bevor die Zonen beim erneuten Öffnen getrennt wurden. Dadurch wanderten Signatur und Zitat in den normalen Body und konnten dupliziert werden. Die Zonen werden nun vor dem Sanitizing getrennt, einzeln bereinigt und anschließend mit den Markern wieder zusammengesetzt.

### 2.4 Ausgang

1. Composer speichert den Entwurf und Empfänger-/Threaddaten.
2. Direkter oder geplanter Versand validiert Empfänger, Anhänge, PGP und Outbound-Review.
3. Ein SMTP-Outbox-/Commit-Marker verhindert Doppelversand nach Teilausfällen.
4. Nach SMTP wird eine IMAP-Sent-Kopie angelegt und der Entwurf finalisiert.

Geplanter Versand meldete zuvor Erfolg, auch wenn das vorherige Speichern oder der Schedule-IPC fehlschlug. Beide Rückgaben werden nun geprüft; ungültige oder vergangene Zeitpunkte werden abgewiesen.

Automatische Serverantworten liefen zwar durch den Anti-Loop-Gate, erhielten im Compose-Sender aber keinen RFC-3834-Header. Inbound-Workflow-Versand setzt nun einen transaktionalen Marker; SMTP erzeugt `Auto-Submitted: auto-replied`, und die Finalisierung entfernt den Marker. Ein später manuell bearbeiteter, noch nicht versendeter Entwurf neutralisiert ihn.

## 3. Behobene Befunde

### Hoch

1. **Verlust von Anhängen nach Crash/Retry**
   Pending-Nachrichten werden aus dem gespeicherten RFC822-Original wiederaufgebaut und nur nach erfolgreicher Vorverarbeitung als erledigt markiert.

2. **Aktive Browser-Anhänge im CRM-Origin**
   HTML, SVG, XML und unbekannte MIME-Typen konnten als Blob im Browser-Origin geöffnet werden. Inline-Öffnung ist jetzt auf PDF und passive Rasterbilder begrenzt; alle anderen Typen werden heruntergeladen.

3. **Automatische Antwort ohne RFC-Anti-Loop-Kennzeichnung**
   Server-Workflow-Antworten tragen nun `Auto-Submitted: auto-replied` bis einschließlich SMTP-/Recovery-Pfad.

4. **Falscher Reply-To-Empfänger durch Regex-Mapping**
   KI-Entwürfe verwenden den strukturierten RFC-Adressparser; eine E-Mail-Adresse im Anzeigenamen kann die tatsächliche Mailbox nicht mehr überschreiben.

5. **CAPTCHA-Challenge wiederverwendbar**
   Eine gültige Challenge ist nach der ersten Login-Anfrage verbraucht. Der Client entfernt sie auch nach einem Fehlversuch und fordert sichtbar eine neue Prüfung.

6. **MFA konnte bei nicht verfügbarer Zustellmethode offen durchfallen**
   Ist die eingeschriebene Methode nicht verfügbar, endet Login jetzt mit `mfa_delivery_failed` statt ohne zweiten Faktor.

7. **MFA-/PIN-Änderungen konnten unter PostgreSQL trotz Erfolgsmeldung wirkungslos bleiben**
   Direkte Zugriffe über den Basis-Pool liefen außerhalb des Workspace-RLS-Kontexts. TOTP-Bestätigung, PIN, E-Mail-MFA und MFA-Deaktivierung verwenden nun ausnahmslos eine Workspace-Transaktion; ein fehlgeschlagenes TOTP-Update entfernt außerdem das bereits persistierte Secret wieder. Der Pfad ist durch einen RLS-Regressionstest und einen Live-Test mit zwei API-Replikaten abgesichert.

### Mittel

1. **Viewer-Race nach Move/Delete/Neuauswahl**
   Nur der jüngste Auswahl-Request darf Viewer-State setzen.

2. **Nicht adressierte KI-/Textbaustein-Entwürfe**
   Desktop und Server speichern Empfänger und Thread-Eltern; Server bevorzugt `Reply-To`.

3. **Signatur- und Zitatduplikation beim Autosave**
   Sanitizing erhält die Compose-Zonenmarker.

4. **Signaturidentität falsch beziehungsweise nicht auswählbar**
   Bestehende Zuweisung gewinnt, danach authentifizierter Nutzer und anschließend Team-Fallback. Desktop- und HTTP-Transport haben denselben Fallback. Die Identität ist je Entwurf auswählbar und die Signatur pro Mail editierbar.

5. **Stored-XSS-Risiko in Signatur-Editor und Vorschau**
   Eingaben, Editor-Ausgaben, Vorschauen und Speicherpayloads werden mit DOMPurify bereinigt. Dies mitigiert auch den aktuell ungepatchten Quill-Export-Advisory an den verwendeten App-Sinks.

6. **Geplanter Versand konnte falschen Erfolg anzeigen**
   Persistierung, Zeitwert und IPC-Ergebnis sind jetzt harte Vorbedingungen.

7. **Browser erlaubte nicht funktionsfähigen Desktop-Modus**
   Ohne Electron waren „Lokal“ und „Server installieren“ auswählbar und führten zu einer Oberfläche mit dauerhaften IPC-Fehlern. Im Browser ist jetzt ausschließlich „Server verbinden“ aktiv.

### Gering

1. Tote Einstellung „Konto-Details“ entfernt; alte Links werden auf „Konten“ migriert.
2. Fehlende Settings-Tab-IDs für Auth-Sicherheit, PGP und Audit-Log ergänzt.
3. Composer-Option „Im Posteingang offen lassen“ in den Optionsbereich verschoben.
4. Signatur kann direkt pro Nachricht bearbeitet werden; Standardverwaltung bleibt separat erreichbar.

## 4. Abschlussstatus des Maßnahmenplans

### P0: vor öffentlicher Beta

| Maßnahme | Status | Umsetzung und Nachweis |
|---|---|---|
| Browser-Sessions auf HttpOnly-Cookies migrieren | **Erledigt** | Rotierendes Refresh-Token liegt ausschließlich im `HttpOnly`-Cookie. Access-Token und Benutzer-Session leben nur im Renderer-Speicher; CSRF-Token, Credential-CORS, Legacy-Migration und Logout sind getestet. CSRF- und Access-State sind zusätzlich an den Server-Origin gebunden. Gleichzeitige Refreshes werden pro Origin zusammengeführt und browserweit über Web Locks serialisiert. |
| Login-Enumeration beseitigen | **Erledigt** | `/auth/login-config` akzeptiert keine E-Mail mehr und liefert niemals Benutzerdaten. Passwortprüfung verwendet für unbekannte Konten einen Dummy-Hash; PIN und MFA werden erst nach gültiger Primärauthentifizierung aufgelöst. Die öffentliche Konfiguration liest die fünf relevanten Workspace-Schalter in genau einer mandantenübergreifenden RLS-Transaktion statt in einer öffentlich triggerbaren N+1-Abfrage. |
| CAPTCHA-/MFA-Zustände multi-instance-fähig machen | **Erledigt** | Migration `0027_auth_challenge_state` und `AuthChallengeStore` speichern nur SHA-256-Token-Hashes und führen Consume-/Attempt-Operationen atomar in PostgreSQL mit Ablaufzeit aus. Replay und wechselnde Client-IP umgehen das Versuchslimit nicht mehr. |
| Electron-Navigation und Fenster hart begrenzen | **Erledigt** | `will-navigate`, `will-redirect` und `setWindowOpenHandler` erzwingen eine zentrale Allowlist. Print- und passive Attachment-Vorschauen laufen in isolierten Child-Windows ohne Node, Preload oder weitere Popups. |
| Öffentlichen Deploy-Config-IPC absichern | **Erledigt** | Die Deploy-Konfiguration ist nach dem ersten erfolgreichen Schreiben unveränderlich. Eine serialisierte First-Write-Queue verhindert zwei konkurrierende Gewinner; Rewrite- und Race-Tests sind vorhanden. |
| Mail-Coverage-Ratchet reparieren | **Erledigt** | Schwellen wurden nicht abgesenkt. Neue Laufzeittests für Restore, Read Receipts/MDN, Thread-Aggregation, Spam-Store und Outbound Approval erreichen 91,90% Statements/Lines, 80,02% Branches und 93,66% Functions. |

### P1: Stabilität und Mail-Korrektheit

| Maßnahme | Status | Umsetzung und Nachweis |
|---|---|---|
| Server-Auto-Reply-Limit und Deduplizierung | **Erledigt** | Migration `0028_auto_reply_limits` führt transaktionale Quellnachrichten-Deduplizierung sowie Workspace-/Konto-/Empfänger-/Tageszähler ein. Der Default ist eine automatische Antwort pro Empfänger und Tag; der Wert ist begrenzt konfigurierbar. |
| SMTP-Commit macht Versandkopie unveränderlich | **Erledigt** | Nach SMTP-Erfolg wird ein größenbegrenzter, versionierter RFC822-Snapshot einschließlich Konto- und Reply-Metadaten persistiert. Recovery und IMAP-Sent-APPEND verwenden ausschließlich diesen Snapshot, selbst wenn der Entwurf danach verändert wurde. Tokenisierte, erneuerbare Send-Locks verhindern, dass ein alter Worker den Lock eines neuen Workers entfernt. |
| Quill-Advisory | **Befristet akzeptiert** | Quill 2.0.3 ist weiterhin die neueste Version; upstream existiert kein Patch. SimpleCRM ruft den betroffenen `getSemanticHTML`-Pfad nicht auf. Eingabe, Paste, Change-Output, Vorschau und Persistierung werden sanitisiert und durch konkrete XSS-Tests geschützt. Owner, Review-Datum 2026-10-14 und Exit-Plan stehen in `docs/SECURITY_DEPENDENCY_EXCEPTIONS.md`. |
| Electron-Login-Listener aufräumen | **Erledigt** | Pro `webContents` wird über ein `WeakSet` genau ein `destroyed`-Cleanup registriert und nach Zerstörung entfernt. |
| Provider-Chaos und Ressourcenbegrenzung | **Code-seitig erledigt** | Deterministische Tests decken SMTP-Erfolg plus IMAP-Timeout/Recovery, UIDVALIDITY-Restore, POP3-Fehler, Mailauth-Timeout und Rspamd-Fallback ab. RFC822-Verarbeitung ist auf 80 MiB begrenzt; SMTP-Snapshots sind auf 96 MiB begrenzt. Reale Providerkonten bleiben Teil der Release-Abnahme, nicht der Unit-Test-Suite. |

### P2: Betrieb und Beobachtbarkeit

| Maßnahme | Status | Umsetzung und Nachweis |
|---|---|---|
| Betriebsmetriken | **Erledigt** | Diagnose liefert Inbound-Lag, Post-Process-Retries, Legacy-/Graphile-DLQ, Workflow-DLQ, SMTP-Recovery-Marker, MFA-Sperren und Lock-Alter. Große SMTP-Snapshots werden bei der Diagnose nicht aus PostgreSQL geladen oder detoastet. |
| Recovery-Ansicht | **Erledigt** | Diagnose zeigt dauerhaft offene Post-Process-Nachrichten und fehlgeschlagene Scheduled Sends; Admins können gezielt Post-Process oder Versand erneut einplanen. Alle Aktionen sind workspace-scoped und auditierbar. |
| Produktions-CSP | **Erledigt** | Caddy setzt CSP, `nosniff`, Referrer- und Permissions-Policy. Electron erzeugt eine CSP aus Dev-Origin beziehungsweise persistiertem Server-Origin; Turnstile, Blob-Vorschauen, Worker und notwendige Medienquellen sind explizit beschrieben. |
| Bundle-Splitting | **Erledigt** | Routen werden dynamisch geladen. Der größte allgemeine Renderer-Chunk liegt bei 323,31 kB; Monaco bleibt als bewusst isolierter, erst bei Editor-Nutzung geladener 3,63-MB-Chunk. Damit belastet er weder Login noch Mail-Inbox oder CRM-Startpfad. |

### Zusätzliche Abschlussbefunde

1. CSRF-State war zunächst nicht an den konfigurierten Server-Origin gebunden. Ein Wechsel von Server A zu Server B hätte dadurch wiederholt `403` erzeugt. Speicherung, Lesen und Löschen sind nun origin-spezifisch getestet.
2. Parallele `401`-Antworten konnten zunächst zwei Refresh-Rotationen gegeneinander ausführen. Eine pro Origin und Storage zusammengeführte Refresh-Operation plus Web Lock verhindert, dass ein Verlierer die neue Sitzung löscht.
3. Die öffentliche Login-Konfiguration enumerierte nach dem ersten Enumeration-Fix alle Workspaces mit Einzelabfragen. Ein dedizierter Bulk-Reader beseitigt diesen unauthentifizierten Connection-Pool-/N+1-Pfad.
4. Die Diagnose las zunächst alle `sync_info.value`-Felder und damit potenziell 96-MiB-SMTP-Snapshots. Die Query lädt Werte nur noch für die wenigen tatsächlich ausgewerteten Notice-/Scheduled-Send-Präfixe und begrenzt sie auf 64 KiB.
5. TOTP-, PIN- und MFA-Mutationen meldeten auf PostgreSQL Erfolg, obwohl RLS direkte Pool-Updates ohne Workspace-Kontext unterdrückte. Alle betroffenen Lese- und Schreibpfade laufen jetzt mit `role='system'` in einer explizit gesetzten Workspace-Transaktion; ein Live-Test bestätigt den persistierten TOTP-Zustand.
6. Die Operator-CLI-Tests hielten unter Windows den WSL-Launcher `bash.exe` für eine pfadkompatible POSIX-Shell und konnten dadurch statt des Fake-Dockers den echten Docker-Daemon treffen. Die Shell-Ausführung bleibt auf POSIX-Hosts vollständig aktiv und wird auf Windows gezielt übersprungen.

## 5. Verifikation

| Prüfung | Ergebnis |
|---|---|
| TypeScript Monorepo + Electron | bestanden ([Log](evidence/typecheck.log)) |
| ESLint, keine Warnungen | bestanden ([Log](evidence/lint.log)) |
| Vollständige Jest-Suite | 250 Suites, 2183 Tests bestanden ([Log](evidence/unit-integration-tests.log)) |
| Mailtests | 172 Suites; 1041 bestanden, 1 übersprungen ([Log](evidence/mail-tests.log)) |
| Mail-Coverage-Ratchet | bestanden; 91,90% Statements/Lines, 80,02% Branches, 93,66% Functions ([Log](evidence/mail-coverage-ratchet.log)) |
| Server-Coverage-Ratchet | bestanden; 69,42% Statements/Lines, 68,11% Branches, 66,80% Functions ([Lauf](evidence/server-coverage.log), [Ratchet](evidence/server-coverage-ratchet.log)) |
| UI-Coverage-Ratchet | bestanden; 13,78% Statements, 60,00% Branches ([Log](evidence/ui-coverage.log)) |
| Produktionsbuild | bestanden ([Log](evidence/build.log)) |
| Electron-E2E | 46/46 bestanden ([Log](evidence/electron-e2e.log)) |
| Native Runtime | nach E2E korrekt auf Node ABI 141 wiederhergestellt ([Log](evidence/native-status.log)) |
| TypeScript-Toolchain | konsistent ([Log](evidence/typescript-toolchain.log)) |
| Dangerous Defaults | bestanden ([Log](evidence/dangerous-defaults.log)) |
| Dependency-Audit | erwartete, befristet akzeptierte Ausnahme: 1 Low, Quill GHSA-v3m3-f69x-jf25, kein Patch verfügbar ([Log](evidence/dependency-audit.log)) |
| Docker-Compose-Konfiguration | bestanden; Services werden korrekt aufgelöst ([Log](evidence/docker-compose-config.log)) |
| Container-/PostgreSQL-Smoke | bestanden; PostgreSQL 18, 28 Migrationen, API/Caddy, Setup, Cookie-Rotation, CSRF, Backup, Doctor und Restore-Drill ([Log](evidence/docker-compose-smoke.log)) |
| Multi-Replica-Auth-Smoke | bestanden; zwei API-Replikate teilen CAPTCHA-Consume, MFA-Versuchslimit und Refresh-Rotation korrekt; TOTP persistiert durch RLS ([Log](evidence/multi-replica-auth-smoke.log)) |
| Docker-Engine | für die Abschlussläufe verfügbar; fremde lokale Container danach wieder laufend ([Log](evidence/docker-engine-status.log)) |
| Gerenderte Browser-QA | visuell auf Desktop und 390x844 geprüft ([Desktop](evidence/setup-desktop-light.png), [Mobil](evidence/setup-mobile.png)) |

Der lokale Compose-Lauf verwendete den vollständig aktuellen Build-Stage als Audit-Runtime-Image. Ausschließlich der unveränderte Produktionsschritt `CI=true pnpm prune --prod --ignore-scripts` blieb unter Docker Desktop für Windows hängen und wurde für diesen Lauf ausgelassen; derselbe reguläre Dockerfile-Pfad war auf dem zuvor gepushten PR-Stand in GitHub Actions grün. Nach dem nächsten Push muss die verpflichtende GitHub-CI den finalen, hier noch uncommitteten Stand erneut bestätigen.

## 6. Einordnung von „100% erledigt“

Die im ursprünglichen Bericht beschriebenen implementierbaren P0-, P1- und P2-Arbeitspakete sind abgearbeitet. Es gibt keinen bekannten offenen kritischen oder hohen Befund aus diesem Audit und keinen roten lokalen Merge-Gate.

„100%“ kann seriös nicht bedeuten, dass fremde Mailprovider oder noch nicht veröffentlichte Upstream-Patches ohne verfügbare externe Systeme getestet werden. Sämtliche im Bericht identifizierten und lokal ausführbaren Quellcode-, Datenbank-, Container- und Multi-Replica-Arbeitspakete sind abgearbeitet. Vor der öffentlichen Beta bleiben ausschließlich diese externen beziehungsweise zeitgebundenen Release-Abnahmen:

1. Echte Testkonten für IMAP, POP3, Google OAuth, Microsoft OAuth und SMTP sowie ein absichtlich unterbrochener Providerlauf.
2. Optional aktivierte Rspamd- und PGP-End-to-End-Abnahme, sofern diese Integrationen im Zielsystem verwendet werden.
3. Quill-Ausnahme spätestens am 2026-10-14 oder unmittelbar nach Veröffentlichung einer gepatchten Version erneut prüfen.
4. Nach Commit und Push dieses noch lokalen Abschlussstands die verpflichtende GitHub-CI einschließlich des regulären Production-Dockerfiles erneut grün abwarten.

## 7. Beta-Abnahmekriterien

| Kriterium | Stand |
|---|---|
| Kein Refresh-Token ist über JavaScript lesbar | **Erfüllt** |
| CAPTCHA und MFA verwenden gemeinsamen atomaren Zustand | **Erfüllt; mit zwei API-Replikaten und gemeinsamer PostgreSQL-Datenbank live geprüft** |
| Account-Existenz ist über öffentliche Konfiguration/Fehler nicht praktisch unterscheidbar | **Erfüllt** |
| Automatische Antworten besitzen Anti-Loop-Header, Empfängerlimit und Deduplizierung | **Erfüllt** |
| SMTP-Recovery verwendet dieselbe unveränderliche RFC822-Nachricht | **Erfüllt** |
| Mail-Ratchet, Volltest, Server-/UI-Ratchet, Build und Electron-E2E sind gleichzeitig grün | **Erfüllt** |
| Kein offener kritischer oder hoher Security-Befund | **Erfüllt** |
| Ungepatchte Dependency hat Mitigation, Owner, Frist und Exit-Plan | **Erfüllt** |
