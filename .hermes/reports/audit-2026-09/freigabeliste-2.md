# Freigabeliste Teil 2: Entscheidungen nach der Fix-Phase

**Stand:** 2026-09-25 · Grundlage: Befundregister `findings.md` (Status `FREIGABE_NOETIG` und `TEILWEISE`)

## Entscheidung (2026-09-25)

Pascal hat **alle Empfehlungen E1–E42** freigegeben und den PR sofort als Draft gewünscht. Bei E31, E41 und E42 lautet die Empfehlung „so lassen und dokumentieren“. Umsetzung und Commits stehen im Befundregister.

---

Die Fix-Agenten haben an diesen Stellen bewusst angehalten. Der Defekt ist jeweils bestätigt, aber der Fix braucht eine Migration, ändert einen API- oder IPC-Vertrag, schränkt Rechte legitimer Nutzer ein oder lässt mehrere vertretbare Semantiken zu. Die Empfehlung steht jeweils zuerst. Alles andere aus dem Audit ist behoben (siehe `abschlussbericht.md`).

## A. Sicherheit Server (aus dem Internet erreichbar)

| # | Befund | Problem | Empfehlung | Alternative |
|---|---|---|---|---|
| E1 | F-A13A14-04 (mittel) | Workflow- und Relay-Regex mit katastrophalem Backtracking bestehen die safe-regex-Prüfung. `(a\|a)*b` auf 24×`a` braucht 3 s. | V8-Flag `--enable-experimental-regexp-engine-on-excessive-backtracks` für API und Desktop setzen (die drei Muster fallen von über 20 s auf 2–3 ms), dazu Lookaround und Backreferences in Nutzer-Regex beim Speichern ablehnen. | `re2` als native Abhängigkeit, oder Auswertung in einem Worker mit Timeout |
| E2 | F-A2a-01 Rest | Es gibt einen Umweg in zwei Schritten: erst den SMTP-Host mit eigenem SMTP-Passwort ändern, dann nur „wie IMAP“ einschalten. Danach geht das IMAP-Passwort an den fremden Host. | Das Umschalten von `smtpUseImapAuth` zählt wie ein Endpunktwechsel und verlangt das Passwort der neuen Quelle (folgt direkt aus deiner Entscheidung A1). | – |
| E3 | F-A2b-06 (mittel) | Wer `users.manage` hat, darf Nicht-Admins mit mehr Rechten als er selbst bearbeiten, löschen und ihnen eine PIN setzen. | Das geht nur noch, wenn die Capabilities des Ziels eine Teilmenge der eigenen sind und das Ziel keine Mail-ACL-Bindings hat. Sonst 403 `target_more_privileged`. | Nur dokumentieren |
| E4 | F-A13A14-02 Rest | Anonyme JSON-Bodies bis 1 MiB werden vor der Anmeldung geparst, das kostet etwa 110 ms pro MiB und ist nur durch das Rate-Limit begrenzt. | Für alle nicht-öffentlichen `/api/v1`-Routen den Principal vor dem Body prüfen. Auth-, Portal- und Webhook-Routen bekommen ein Limit von 64 KiB. | Uploads später als Stream statt JSON (API-Änderung) |
| E5 | F-A6-03 Rest | Parallele Regex-Suchen eines Nutzers können den DB-Pool (10 Verbindungen) weiter belegen, jede bis zum Timeout von 10 s. | Höchstens 2 gleichzeitige Regex-Suchen pro Nutzer, darüber 429. | Kandidaten-Cap wie beim Desktop (5000) |
| E6 | F-A5-12 Rest | Setzt der eigene MTA keinen `Authentication-Results`-Header, zählt weiter der vom Absender eingeschleuste. | Vertrauenswürdige authserv-id pro Konto, Standard ist die Domain des IMAP-Hosts. Nur passende Blöcke gelten (RFC 8601). Braucht eine Migration und ein UI-Feld. | Einschränkung dokumentieren |
| E7 | F-A3a-07 Rest | Das Retourenportal ist standardmäßig ohne CAPTCHA. | CAPTCHA im Portal standardmäßig an, sobald Turnstile konfiguriert ist; der Workspace kann es abschalten. | So lassen (seit C4 pro Workspace einstellbar) |
| E8 | F-A3b-04 | Die Relay-Einstellung `allowArbitraryRecipients` wird gespeichert, aber nie durchgesetzt. Standard ist `false`. | Den toten Schalter aus API, Typen und UI entfernen (Vertragsänderung, aber ohne Funktionsverlust). | Durchsetzen (nur bekannte Kontakte), per Migration alle bestehenden Relays auf `true` setzen, dazu UI |
| E9 | F-A7-05 Server | Die Liste gefährlicher Anhangstypen in core ist unvollständig (.lnk, .url, .jar, .iso, .docm …). Auf dem Desktop ist sie ergänzt. | Die Liste in core ebenso ergänzen. Für diese Typen brauchen Viewer, Editor und Sender dann das Recht `mail.attachment.suspicious_download` (Standard nur „Manager“). | Nur auf dem Desktop |
| E10 | F-A4-05 Rest (neu) | POP3-Sync und POP3-Test beider Editionen melden sich bei ausgeschaltetem TLS im Klartext an, auch wenn der Server STLS anbietet. | STLS opportunistisch nutzen wie IMAP (STARTTLS, wenn angeboten). | – |
| E11 | F-A13A14-11 Rest | `PATCH /api/v1/mssql/settings` mit neuem Server und ohne Passwort behält das gespeicherte Secret. Das ist nur für Admins möglich und wird auditiert. | Dieselbe Regel wie beim Verbindungstest: Bei einem Serverwechsel muss das Passwort neu eingegeben werden. | So lassen |
| E12 | F-A3a-05 Rest | Jeder öffentliche Tracking-Abruf nimmt einen exklusiven Workspace-Advisory-Lock, und Hintergrundarbeit im Klick-Pfad ist unbegrenzt. | Geteilten Lock mit `lock_timeout` verwenden und die Hintergrundarbeit per Semaphor begrenzen. | – |
| E13 | F-A3b-01 Rest | Ein einzelner DMARC-Report mit 32 MiB kostet rund 7,8 s synchrones Parsen und bis zu 450.000 Zeilen. | Obergrenze von 100.000 Records pro Report per Vorzählung; darüber verwerfen und loggen. | Grenze auf 8 MiB senken, Worker-Thread, Absender-Allowlist |
| E14 | F-A12-04 Rest | Der Release-Build-Schritt (vite, tsc, electron-builder) sieht weiter das `GH_TOKEN`. | Build mit `--publish never`, dann ein getrennter Publish-Job mit `gh release upload`; Actions per SHA pinnen. | – |

## B. Desktop

| # | Befund | Problem | Empfehlung | Alternative |
|---|---|---|---|---|
| E15 | N-ds-02 (neu, mittel) | `Email.GetGoogleOAuthApp`, `GetMicrosoftOAuthApp` und `GetEmailMiscSettings` liefern OAuth-Client-Secrets und das Webhook-Secret an jeden angemeldeten Nutzer. Die Set-Kanäle prüfen keine Rolle. | Secrets nur an Owner/Admin, alle anderen bekommen `hasSecret`. Die Set-Kanäle verlangen Owner/Admin. | – |
| E16 | F-A7-03 Rest | Konto bearbeiten und löschen laufen mit Stufe „ro“; wer nur Lesezugriff hat, kann löschen. | Konto anlegen, bearbeiten und löschen nur für Owner/Admin, wie `mail.account.manage` auf dem Server. | Stufe „rw“ genügt |
| E17 | F-A7b-01 | Backup, Restore und DSGVO-Export laufen ohne Rollenprüfung. | Restore nur für Owner, Export und DSGVO-Export für Owner/Admin, die Panels werden für andere ausgeblendet. | So lassen (Desktop ist „unrestricted“ laut Rechtematrix) |
| E18 | F-A11b-10 | `mssql:get-settings` liefert das JTL-Passwort im Klartext an den Renderer. | `hasPassword` statt Klartext; bei einem Wechsel von Server, Port, Datenbank oder Benutzer muss das Passwort neu eingegeben werden (wie A1). | a) Fallback auf das alte Keytar-Konto wie beim Server; b) festes Keytar-Konto mit Migration |
| E19 | F-A7b-09 Rest | IMAP bei ausgeschaltetem TLS-Schalter nutzt kein STARTTLS, das Passwort geht im Klartext. | STARTTLS opportunistisch wie der Server (nutzen, wenn angeboten), an allen ImapFlow-Konstruktoren. | Neues Kontofeld „STARTTLS erzwingen“ mit Migration |
| E20 | F-A7-10 | Die Auto-Updates sind nicht signiert (macOS nur DMG, Windows ohne Signatur). | Zertifikate beschaffen: Apple Developer ID (ca. 99 USD pro Jahr) mit Notarisierung, Windows-Signatur über ein Cloud-HSM. Bis dahin das macOS-Auto-Update abschalten. | Nur dokumentieren |
| E21 | F-A7b-08 Rest | Kein Desktop-Pfad setzt den Vertrauensstatus eines Peer-Schlüssels. Gültige Signaturen bleiben deshalb „nicht vertrauenswürdig“ und werden nie grün. | Neue Aktion „Schlüssel als verifiziert markieren“ (IPC und UI). | – |
| E22 | F-A5-01 Rest (Desktop) | `email-forward-copy.ts:24` schreibt den Local-Part der Zieladresse klein. Die Zustellung an `Kunde+Tag@…` ändert damit die Adresse. | Adresse exakt erhalten wie auf dem Server. Der Dedupe-Schlüssel ändert sich, wenn in der Konfiguration Großbuchstaben stehen. | So lassen |

## C. Workflows und Mail-Semantik

| # | Befund | Problem | Empfehlung | Alternative |
|---|---|---|---|---|
| E23 | F-D1-05 | Deferierte KI-Knoten scheitern bei Mails ab etwa 75 KB Text an der Kontextgrenze von 128 KiB. | Nur für die Fortsetzung `body_text` auf etwa 48.000 Zeichen kürzen, `body_truncated` setzen und dokumentieren. | Beim Fortsetzen neu aus der DB laden (Live-Stand statt Snapshot); Grenze anheben |
| E24 | F-A5-11 | Die Lesebestätigung wird nie versendet, sobald ein Outbound-Workflow aktiv ist. Neue Prüfläufe pro Klick sind bereits behoben. | Freigabe, sobald ein Outbound-Prüflauf für genau diese Nachricht mit SEND abgeschlossen ist (Marker am Lauf). | Dry-Run beim Klick; eigener Freigabe-Marker durch den Nutzer |
| E25 | F-A9-04 | Ein asynchroner Knoten (KI, HTTP, Delay) im Je-Eintrag-Zweig einer Schleife bricht nach dem ersten Eintrag ab. Das betrifft beide Editionen. | Fail-closed: Solche Knoten mit Folgeknoten im Schleifenrumpf enden mit klarer Fehlermeldung. Dazu eine Warnung im Editor und ein Hop-Zähler gegen Endlosketten. | Fan-out je Eintrag; echter Schleifenrahmen in der Fortsetzung (Feature) |
| E26 | F-A9-03 | Der Schutz gegen Weiterleitungsschleifen greift nicht. | `Auto-Submitted: auto-forwarded` blockieren, in beiden Editionen. Rechnungs-Weiterleitungen (auto-generated, bulk) laufen weiter. | Eigener Marker-Header; `isAutomatedInboundMessage` (bricht die Vorlage `inbound-invoice-auto-forward`) |
| E27 | F-A7b-04 | Der erste Sync eines Kontos löst Workflows, KI-Vorschläge und Abwesenheitsantworten für die ganze Historie aus. Das betrifft beide Editionen. | Nachrichten aus einem nie synchronisierten Ordner gelten als historisch: Spam-Scoring ja, aber keine Inbound-Workflows, keine Vorschläge, keine Abwesenheitsantwort. | Nur `lastUid === 0` als Kriterium (trifft auch neue, leere Postfächer) |
| E28 | F-A9-13 Server | Der Browser-Import übernimmt `enabled` aus der Datei, ein fremder Workflow ist also sofort aktiv. Auf dem Desktop ist das behoben. | Auch auf dem Server importierte Workflows deaktiviert anlegen (ein bestehender Test schreibt das Gegenteil fest). | So lassen (gemildert durch `workflows.manage` und die Sperre von `code.*`) |
| E29 | F-A8-05 Rest | Ein per API angelegter Delayed Job bleibt für immer pending. | Das Anlegen per POST mit 405 ablehnen (Vertragsänderung). | Fortsetzung mit der Provenienz des Aufrufers einreihen |
| E30 | F-A9-01 Rest | Die Server-Vorlagenliste bietet `crm-deal-won-task` an, das Cron-Feld ist sichtbar, und die API prüft `triggerName` nicht. | Vorlage filtern, Cron-Feld im Server-Modus ausblenden, die API lehnt nicht unterstützte Trigger ab. | – |
| E31 | F-A9-09 | Nach dem Fix wiederholt `task.due` einen gescheiterten Lauf nicht mehr. | So lassen, der Fehler steht in der Lauf-Historie. | Begrenzter Retry mit Backoff |

## D. CRM, Oberfläche, Betrieb

| # | Befund | Problem | Empfehlung | Alternative |
|---|---|---|---|---|
| E32 | F-A10-07 Rest | „Abgeschlossen Gewonnen“ und „Abgeschlossen Verloren“ gelten in keiner Edition als geschlossen. | In Dashboard und Follow-up als geschlossen werten, in beiden Editionen. | So lassen (Doku nennt nur vier Namen) |
| E33 | F-A11a-04 | Ein Kontowechsel im Composer (neue Nachricht) leert alle Felder. | `PATCH …/compose-draft` additiv um `accountId` erweitern, mit Policy-Check am Zielkonto; Entwurf und Anhänge bleiben erhalten. | Felder übernehmen und den alten Entwurf löschen; Wechsel bei vorhandenen Anhängen sperren |
| E34 | F-A11b-07 | Scheitert das Abmelden, bleibt der Zustand hängen; ein zweiter Klick „meldet ab“, ohne die Sitzung zu widerrufen. | CSRF-Retry bzw. Backoff; die lokale Sitzung nur bei Erfolg oder 401 löschen, sonst ein Fehler-Toast. | Immer lokal abmelden (täuscht ein Logout vor) |
| E35 | F-A11b-04 Rest | Im Server-Webbuild gilt eine fremde `?serverUrl=` weiter für den aktuellen Aufruf. | Im Server-Webbuild ignorieren, bereits gespeicherte fremde Konfigurationen verwerfen, dazu ein Reset-Button auf der Login-Seite. | So lassen |
| E36 | F-A11b-01 / F-A10-05 | `GET /api/v1/tasks` kennt weder `offset` noch `priority`, die Aufgabenliste filtert daher falsch. | Additive Query-Parameter `offset` und `priority`. | Clientseitig sammeln und filtern |
| E37 | F-A10-12 | Die UI zeigt als JTL-Kundennummer die `source_sqlite_id`, nach C1 kann das falsch sein. | Additives Feld `jtlKkunde` in der Kunden-API. | – |
| E38 | F-A10-06 Rest | Deal-Mengen mit Nachkommastellen lassen den SQLite-Import abbrechen. | Runden und das im `source_row` vermerken; den Import je Domäne in eine Transaktion. | Spalte per Migration auf `numeric` umstellen |
| E39 | F-A3a-06 Rest / F-A2c-04 | Einspaltige Fremdschlüssel ohne `workspace_id`; `POST /returns` nimmt `customerId` und `emailMessageId` ungeprüft an. | Jetzt: Prüfung im Code (ohne Migration). Später: zusammengesetzte FKs als eigenes Vorhaben. | – |
| E40 | minio-Profil | `minio/minio` gibt es auf Docker Hub nicht mehr, das Profil lässt sich nicht ziehen. | Profil entfernen und in der Doku auf externes S3 verweisen. | Anderes Image wählen |
| E41 | F-A12-08 Teil 1 | Die Admin-Diagnose prüft keine Backups (laut Prüfurteil BY_DESIGN). | So lassen: Die API bekäme sonst Lesezugriff auf komplette Dumps. | Volume read-only in die API einhängen |
| E42 | F-A3a-04 Rest | Der Prune-Lauf löscht abgelaufene Tracking-Resolver, deren Links zeigen danach die Hinweisseite. | So lassen (Datenschutz). | Resolver länger aufbewahren |
