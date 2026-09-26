# Freigabeliste: Befunde mit Nebenwirkung

**Stand:** 2026-09-25 · Grundlage: Befundregister `findings.md`

## Entscheidung (2026-09-25)

Pascal hat **alle Empfehlungen** freigegeben (A1–A5, B1 Mischform, B2–B5, C1–C5, D1–D4). Umsetzung und Commits stehen im Befundregister (`findings.md`, Status BEHOBEN).

Nachträglich gemeldet (Fix-Agent Mail-Versand):
- **F-A5-02** (mehrdeutiges SMTP-Ergebnis nach DATA → automatischer Neuversand): Umgesetzt wird die konservative Variante ohne neue Abläufe. Bei unklarem Zustellstatus bricht der geplante Versand ab („Zustellstatus unklar, bitte Gesendet-Ordner prüfen“) statt erneut zu senden. Eine eindeutige 4xx/5xx-Antwort auf DATA gilt als „nicht zugestellt“. Das entspricht dem Ziel „kein Doppelversand“, keine Migration, kein API-Bruch.
- **F-A5-11** (MDN nie versendet, sobald ein Outbound-Workflow aktiv ist): Umgesetzt wird nur der unstrittige Teil (keine neuen Review-Läufe pro Klick). Die Semantik der Freigabe (Dry-Run, abgeschlossener Lauf oder eigener Marker) bleibt als offene Entscheidung im Register.

---

Diese Befunde sind bestätigt. Ihr Fix braucht aber eine Migration, ändert einen API-Vertrag, ändert sichtbares Verhalten für legitime Nutzer oder erlaubt mehrere vertretbare Semantiken. Nach der vereinbarten Freigabeschwelle werden sie erst nach deiner Entscheidung umgesetzt. Die Empfehlung steht jeweils zuerst.

## A. Sicherheit (Server, aus dem Internet erreichbar)

| # | Befund | Problem | Empfehlung | Alternative |
|---|---|---|---|---|
| A1 | **F-A2a-01 / A4-01** (hoch) | Ein Nicht-Admin mit `mail.account.manage` (z. B. per Delegation) ändert IMAP/SMTP/POP3-Host und löst einen Sync aus. Das gespeicherte Passwort bzw. OAuth-Token geht an seinen Server. | Ändern sich Host, Port oder TLS und fehlt ein neues Passwort bzw. eine neue OAuth-Verbindung, wird der Aufruf abgelehnt (400 „Zugangsdaten bei Serverwechsel neu eingeben“). Die UI verlangt dann das Passwortfeld. | Endpunkt-Änderungen nur noch für Owner/Admin. |
| A2 | **F-A4-02** (mittel) | Dasselbe Muster beim KI-Profil: `workflows.manage` ändert `baseUrl`, der gespeicherte API-Key geht an den neuen Host. | Wie A1: Ändern sich Origin oder Provider, muss der API-Key neu eingegeben werden. | Nur Admin darf `baseUrl` ändern. |
| A3 | **F-A3a-02** (hoch) | Jedes Mitglied kann per Häkchen bzw. `trackingOverride:true` Öffnungs- und Klick-Tracking erzwingen, auch wenn der Admin es nie aktiviert hat (ohne Rechtsgrundlage und Bestätigung, DSGVO). | Der Override pro Nachricht wirkt nur bei aktivierter Admin-Policy, sonst wird er ignoriert. Die Checkbox erscheint nur bei aktivierter Policy. | Unverändert lassen und in der Doku als bewusste Entscheidung festhalten. |
| A4 | **F-A1-06** (niedrig) | MFA deaktivieren, TOTP neu einrichten und auf E-Mail-MFA wechseln gehen ohne erneute Authentifizierung. | Aktuelles Passwort (oder gültiger MFA-Code) im Request verlangen, dazu Audit-Einträge. Die UI fragt das Passwort ab. | Nur Audit-Einträge ergänzen. |
| A5 | **F-A1-10** (niedrig) | Keine Wiederverwendungserkennung für rotierte Refresh-Tokens. | Ohne Migration: Wird ein widerrufenes Token wiederverwendet, werden alle Sitzungen des Nutzers widerrufen. Dazu kommen ein Audit-Eintrag und eine Kulanzfrist von 60 s für Netzwerk-Retries. | Später mit Token-Familien (Migration). |

## B. Funktionen mit Semantik-Entscheidung

| # | Befund | Problem | Empfehlung | Alternative |
|---|---|---|---|---|
| B1 | **F-D1-03** (mittel) | Ein `logic.delay` in einem höher priorisierten Inbound-Workflow hält alle nachrangigen Workflows (Spam, Zuweisung, Tags, Auto-Antwort) für die Dauer des Delays an, bis zu 7 Tage oder mehr. | Mischform: Liegt hinter dem Delay kein kettenstoppender Knoten (`stopFurtherWorkflows`, `logic.stop_after_spam`), schaltet die Kette sofort weiter. Sonst bleibt sie seriell, und der Editor zeigt einen Hinweis. | (a) Seriell lassen, nur Doku und Editor-Hinweis. (b) Kette schaltet bei jedem Delay sofort weiter. |
| B2 | **F-A5-03** (mittel, Sicherheit) | „Später senden“ mit gesetzter PGP-Verschlüsselung verschickt die Mail im **Klartext**. | Sofort: Geplanter Versand wird bei PGP-Verschlüsselung oder -Signatur serverseitig und in der UI abgelehnt, mit klarer Meldung. Keine Migration nötig. | Vollständige Unterstützung: neue Spalte `scheduled_pgp_encrypt` (Server- und SQLite-Migration), Signieren bleibt ungeplant. |
| B3 | **F-A10-10** (niedrig) | Beim Löschen eines Kunden löscht der Desktop kommentarlos alle Deals, Aufgaben und Termine mit, der Server hinterlässt verwaiste Deals. | Einheitlich für beide Editionen: Gibt es abhängige Datensätze, wird abgelehnt (Server 409 mit Zählern), bis der Nutzer im Dialog „mitlöschen“ bestätigt. Der Server löscht dann in einer Transaktion mit. | Nur den Server an das Desktop-Verhalten angleichen (stille Kaskade). |
| B4 | **F-A3a-04** (mittel) | Nach Deaktivieren oder Ablauf des Trackings führen Links in bereits versendeten Kundenmails ins Leere. | Klick-Links leiten weiterhin zum Ziel, zeichnen aber nichts mehr auf. Endgültig gelöschte Links (DSGVO-Löschung) zeigen eine kurze Hinweisseite statt JSON. | Unverändert lassen (Datenschutz vor Nutzbarkeit). |
| B5 | **F-A13A14-06** (mittel) | Entwurfsanhänge haben weder Quote noch Aufräumen, ein Nutzer kann die Platte füllen. | Grenze pro Entwurf (50 MB, 50 Dateien, dieselbe Grenze wie beim Versand) und Aufräumen beim Senden bzw. Löschen. | Nur Aufräumen, keine Quote. |

## C. Migrationen und Datenkorrekturen

| # | Befund | Problem | Empfehlung |
|---|---|---|---|
| C1 | **F-A10-01** (hoch) | Der Server-JTL-Sync nutzt `kKunde`/`kArtikel` als `source_sqlite_id` und kollidiert mit migrierten SQLite-IDs: fremde Kunden bzw. Produkte werden überschrieben. | Neue Migration: Dubletten bereinigen, dann ein eindeutiger Index auf `(workspace_id, jtl_kkunde)` bzw. `jtl_kartikel`. Der Upsert läuft über den JTL-Schlüssel. Vorher ein Datenbank-Backup (vorhanden über `docker/backup.sh`). |
| C2 | **F-A2c-01** (niedrig) | Migration 0019 war wegen fehlendem RLS-Kontext ein stiller No-op, verwaiste Aufgaben bleiben unsichtbar. | Neue, idempotente Migration mit RLS-Kontext, die den Backfill nachholt. 0019 selbst bleibt unverändert. |
| C3 | **F-A5-09** (mittel) | Die PGP-Prüfung meldet „signiert gültig“ für die ganze Nachricht, obwohl nur ein eingebetteter Block signiert ist (Spoofing-Risiko). | Neuer Status `signed_partial` (nicht gültig), wenn außerhalb des signierten Blocks Inhalt steht. Der Viewer zeigt eine Warnung. Das ist ein API-Vertrag: neuer Statuswert. |
| C4 | **F-A3a-03** (mittel) | Ist in irgendeinem Workspace Login-CAPTCHA aktiv, liefert die Portal-Anlage dauerhaft 403. Das Portal-Frontend kennt kein CAPTCHA. | Die Entscheidung wird an den Workspace des Portals gebunden. Ein neuer öffentlicher Endpunkt `GET /api/v1/portal/returns/:token/config` liefert `captchaRequired` und `siteKey`, das Portal-Frontend rendert das Turnstile-Widget. |
| C5 | **F-D2-04** (niedrig) | `delegationGrantsAccess` in der Rollout-API sagt im Shadow-Modus „kein Zugriff“, obwohl nicht vergleichbare Rechte sofort wirken. (Der UI-Text ist bereits korrigiert.) | Zusätzliches Feld `delegationGrantsReadSendAccess` und `nonComparableRightsEffective` (additiv, bricht nichts). |

## D. Betrieb, Desktop

| # | Befund | Problem | Empfehlung |
|---|---|---|---|
| D1 | **F-A12-07** (niedrig) | Der API-Container läuft als root, `minio`/`pgadmin` sind nicht gepinnt. | `USER node` mit einmaligem `chown` im Update-Skript, `no-new-privileges`, `cap_drop: ALL`, feste Image-Tags. |
| D2 | **F-A2c-03** (niedrig) | Laufzeit-Rolle und DB-Eigentümer sind dieselbe Rolle, damit ist FORCE RLS nur eine Selbstbeschränkung. | Jetzt: als Restrisiko in `THREAT_MODEL.md` dokumentieren. Getrennte Owner- und App-Rolle als eigenes Vorhaben (Betriebsumstellung mit `REASSIGN OWNED`). |
| D3 | **F-A7b-05** (mittel, Desktop) | Anhänge werden mit absolutem Pfad gespeichert. Nach einem Restore auf einem anderen Rechner sind alle Anhänge unauffindbar. | Relative Pfade speichern, absolute Altpfade beim Lesen auf das aktuelle Anhang-Verzeichnis abbilden (einmalige Datenkorrektur). |
| D4 | **F-A7b-08** (mittel, Desktop) | Desktop-PGP ist funktionslos: Schlüssel werden unter `[object Object]` gespeichert, die Signaturprüfung scheitert. | Import und Prüfung nach dem Vorbild des Servers korrigieren. Bereits falsch gespeicherte Schlüssel müssen neu importiert werden (Hinweis in der UI). |
