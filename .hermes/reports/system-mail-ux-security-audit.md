# System-, Mail-, UX- und Security-Audit

Stand: 2026-07-14

Ausgangsbasis: `origin/main` auf Commit `712739f`

Audit-Branch: `codex/system-mail-ux-security-audit`

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

## 4. Verbleibende Risiken und Beta-Blocker

### P0: vor öffentlicher Beta

1. **Browser-Sessions auf HttpOnly-Cookies migrieren**
   `server-auth-session.ts` persistiert Access- und Refresh-Token in Web Storage. Jede erfolgreiche XSS hätte damit dauerhaften Session-Zugriff. Zielbild: rotierendes Refresh-Token als `HttpOnly; Secure; SameSite`, kurzlebiges Access-Token nur im Speicher, CSRF-Schutz, Credentials-CORS und ein getesteter Migrations-/Logout-Pfad.

2. **Login-Enumeration beseitigen**
   Der öffentliche Endpunkt `/auth/login-config?email=...` liefert benutzerspezifische PIN-/MFA-Merkmale und unterscheidet damit existierende Konten. Zielbild: generische öffentliche Konfiguration; PIN/MFA-Zustandswechsel erst nach gültiger Primärauthentifizierung mit einheitlichen Fehlern und Laufzeiten.

3. **CAPTCHA-/MFA-Zustände multi-instance-fähig machen**
   Consumed-Token- und Attempt-Stores sind prozesslokale Maps. Hinter mehreren API-Replikaten lassen sich Einmaligkeit und Versuchslimits umgehen. Zielbild: atomare Redis- oder PostgreSQL-Operation mit TTL, gehashtem Token-Key und Metriken.

4. **Electron-Navigation und Fenster hart begrenzen**
   `electron/main.js` setzt noch keinen `will-navigate`-Guard und keinen zentralen `setWindowOpenHandler`. Zielbild: Allowlist für `app://-`, den konfigurierten Dev-Origin, `about:blank` nur für den Printpfad und freigegebene Blob-Vorschauen; externe URLs ausschließlich nach bestehender Bestätigung über `shell.openExternal`.

5. **Öffentlichen Deploy-Config-IPC absichern**
   `setup:save-deploy-config` ist für Onboarding absichtlich vor Login erreichbar. Nach abgeschlossener Einrichtung kann derselbe Renderer den Zielserver weiter ändern. Zielbild: Schreiben nur im Setup-Zustand oder nach lokaler Owner-Reauthentifizierung; Änderungen revisionssicher auditieren.

6. **Mail-Coverage-Ratchet reparieren**
   `origin/main` erreicht 84,77% Statements / 78,82% Branches / 86,17% Functions bei einem hart verdrahteten 90/80/93-Ratchet. Der Branch verbessert auf 84,89/78,89/86,35, bleibt aber erwartbar rot. Die Schwelle darf nicht abgesenkt werden: fehlende Tests für Restore, Read Receipts, Thread-Heuristik, Spam-Store und Outbound Approval ergänzen und die Baseline danach neu festschreiben.

### P1: Stabilität und Mail-Korrektheit

1. **Server-Auto-Reply-Limit und Empfänger-Deduplizierung**
   Desktop hat Schutzlogik; der Server dokumentiert selbst, dass das Tageslimit pro Empfänger nicht durchgesetzt wird. Vor Aktivierung vollautomatischer Antworten braucht es ein transaktionales Workspace-/Empfänger-Limit und Audit-Ereignisse.

2. **SMTP-Commit macht Entwurf unveränderlich**
   Nach erfolgreichem SMTP, aber vor fehlgeschlagener IMAP-Sent-Kopie kann der Entwurf noch editiert werden. Die Recovery-Kopie könnte dadurch von der tatsächlich versendeten Mail abweichen. Updates nach SMTP-Commit müssen gesperrt oder gegen einen unveränderlichen RFC822-Snapshot ausgeführt werden.

3. **Quill ersetzen oder upstream patchen**
   `pnpm audit --prod` meldet GHSA-v3m3-f69x-jf25 für Quill 2.0.3; es gibt noch keine gepatchte Version. App-Sinks sind jetzt sanitisiert, der Dependency-Befund bleibt jedoch offen. Upgrade-/Replacement-Entscheidung und ein dauerhaftes XSS-Testset sind nötig.

4. **Electron-Login-Listener aufräumen**
   Wiederholtes Login/Logout kann pro erfolgreichem Login einen weiteren `destroyed`-Listener am selben `webContents` registrieren. Listener zentral registrieren oder vor Neuregistrierung entfernen.

5. **Echte Provider-Chaos-Tests**
   Es fehlen reproduzierbare Tests mit SMTP `250` plus anschließendem IMAP-Timeout, UIDVALIDITY-Wechsel, POP3-Unterbrechung, großen MIME-Multipart-Nachrichten und Rspamd-/Mailauth-Timeouts.

### P2: Betrieb und Beobachtbarkeit

1. Metriken für Inbound-Lag, Post-Process-Retries, Workflow-DLQ, SMTP-Commit-Recovery und MFA-Sperren.
2. Admin-Ansicht für dauerhaft offene Post-Process-Datensätze und fehlgeschlagene Scheduled Sends.
3. Produktions-CSP für Browser und Electron mit expliziten Regeln für Turnstile, konfigurierten API-Origin und notwendige Assets.
4. Bundle-Splitting: der Build erzeugt weiterhin Renderer-Chunks über 2,4 MB und 3,6 MB.

## 5. Verifikation

| Prüfung | Ergebnis |
|---|---|
| TypeScript Monorepo + Electron | bestanden ([Log](evidence/typecheck.log)) |
| ESLint, keine Warnungen | bestanden ([Log](evidence/lint.log)) |
| Vollständige Jest-Suite | 241 Suites, 2139 Tests bestanden ([Log](evidence/unit-integration-tests.log)) |
| Mailtests | 166 Suites; 974 bestanden, 1 übersprungen ([Log](evidence/mail-tests.log)) |
| Mail-Coverage-Ratchet | bestehender Main-Defekt; Branch 84,89%, Main 84,77% ([Branch](evidence/mail-coverage-ratchet.log), [origin/main](evidence/mail-coverage-origin-main.log)) |
| Server-Coverage-Lauf | bestanden; 69,20% Statements ([Log](evidence/server-coverage.log)) |
| UI-Coverage-Ratchet | bestanden; 13,47% Statements, 59,96% Branches ([Log](evidence/ui-coverage.log)) |
| Produktionsbuild | bestanden ([Log](evidence/build.log)) |
| Electron-E2E | 46/46 bestanden ([Log](evidence/electron-e2e.log)) |
| Native Runtime | nach E2E korrekt auf Node ABI 141 wiederhergestellt ([Log](evidence/native-status.log)) |
| TypeScript-Toolchain | konsistent ([Log](evidence/typescript-toolchain.log)) |
| Dangerous Defaults | bestanden ([Log](evidence/dangerous-defaults.log)) |
| Dependency-Audit | 1 Low: Quill GHSA-v3m3-f69x-jf25, kein Patch verfügbar ([Log](evidence/dependency-audit.log)) |
| Gerenderte Browser-QA | visuell auf Desktop und 390x844 geprüft ([Desktop](evidence/setup-desktop-light.png), [Mobil](evidence/setup-mobile.png)) |

## 6. Empfohlene Reihenfolge bis Beta

1. Cookie-basierte Browser-Session und generischen Login-State-Flow als eigener Security-PR umsetzen.
2. Shared CAPTCHA-/MFA-State mit atomaren TTL-Operationen einführen und Multi-Replica-Tests ergänzen.
3. Electron-Navigation, Window-Open und Setup-IPC gemeinsam härten; anschließend alle Print-, Attachment- und External-Link-Flows E2E testen.
4. SMTP-Commit-Snapshot und Auto-Reply-Rate-Limit umsetzen; mit Chaos-Tests gegen Doppelversand und abweichende Sent-Kopien absichern.
5. Mail-Coverage-Ratchet durch Tests statt Schwellenänderung wieder grün machen.
6. Quill-Entscheidung treffen und CSP ausrollen.
7. Erst danach eine Beta-Freigabe mit echten Testkonten für IMAP, POP3, Google OAuth, Microsoft OAuth, SMTP, Rspamd und PGP durchführen.

## 7. Beta-Abnahmekriterien

- Kein Refresh-Token ist über JavaScript lesbar.
- CAPTCHA und MFA bleiben bei zwei parallelen API-Instanzen einmalig und rate-limited.
- Account-Existenz ist über öffentliche Antworten und Timing nicht praktisch unterscheidbar.
- Automatische Antworten besitzen Anti-Loop-Header, Empfängerlimit und idempotenten Versand.
- SMTP-Erfolg erzeugt immer dieselbe unveränderliche RFC822-Nachricht in der Sent-Recovery.
- Mail-Ratchet, Volltest, Server-/UI-Ratchet, Build und Electron-E2E sind gleichzeitig grün.
- Kein offener kritischer oder hoher Security-Befund; ungepatchte Dependencies haben dokumentierte Mitigation und Owner.
