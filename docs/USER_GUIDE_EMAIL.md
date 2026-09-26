# E-Mail — Kurzanleitung für Anwender

SimpleCRM kann **E-Mail-Konten** einbinden (IMAP oder POP3), Mails **lesen**, **beantworten** und mit dem CRM **verknüpfen**. Alles läuft **lokal** auf Ihrem Rechner.

## Wo Sie was finden

Unter **E-Mail** in der Hauptnavigation gibt es eine **Unterleiste** mit vier Bereichen:

| Bereich | Tab in der E-Mail-Ansicht |
|---------|---------------------------|
| **Posteingang & Nachrichten** | **Postfach** (`/email`) |
| **Workflows automatisieren** | **Workflows** |
| **Zahlen & Übersicht** | **Auswertung** |
| **Konten, SMTP, KI, Team, Export** | **Einstellungen** (gruppierte Tabs oder **Beta**-Hub) |

### Beta-Oberfläche (optional)

In der E-Mail-Unterleiste können Sie **Klassisch** / **Beta** wählen (wird gespeichert). Die **Beta** betrifft vor allem **Einstellungen**: Übersicht mit Statuskarten, dann Bereiche Postfächer → Versand & Anmeldung → KI & Wissen → Automatisierung → Team → Datenschutz. Postfach und Workflows bleiben gleich; alle Funktionen sind dieselben wie in der klassischen Ansicht.

## Konto anlegen

1. Unter **E-Mail** ein neues Konto anlegen.
2. **Protokoll wählen:** **IMAP** (Ordner, meist komfortabler) oder **POP3** (klassisches Abrufen; Server speichert Mails je nach Einstellung).
3. Zugangsdaten eingeben — Passwörter werden im **System-Schlüsselbund** gespeichert, nicht im Klartext in der Datenbank.
4. Optional **Google** oder **Microsoft** über die Felder in den Einstellungen (OAuth) — dafür braucht es eine registrierte App beim Anbieter.

## Postfach nutzen

- **Synchronisieren:** Konten werden regelmäßig abgeglichen; Sie können auch manuell aktualisieren.
- **Ansichten:** Posteingang, Gesendet, **Gesendet (KI)**, Entwürfe, Archiv, Spam, Papierkorb (Zähler in der Sidebar).
- **Kategorien** links filtern die Liste (nur sinnvoll in der Inbox-Ansicht).
- **Suche** durchsucht Betreff, Kurztext und Inhalt (schneller mit der eingebauten Volltextsuche, wo verfügbar).
- **Nachricht:** Kunde verknüpfen, interne Notizen, Tags, **Zuweisung** an Teammitglieder, Anhänge **öffnen** oder **speichern**.
- **Archiv / Wiederherstellen / Papierkorb:** Mails werden nicht hart gelöscht, sondern ausgeblendet oder archiviert (Datenhaltung).

## Schreiben & Senden

- **Entwurf** speichern oder **Senden** — vor dem Versand können **ausgehende Workflows** die Nachricht prüfen oder blockieren (z. B. sensible Inhalte).
- **An** und **Cc:** Eine oder mehrere Adressen, z. B. `a@firma.de` oder `Name <a@firma.de>`.
- **HTML-Editor:** Formatierter Text; die Anwendung bereinigt den Inhalt aus Sicherheitsgründen.

### Angehaltene Mails und „Ohne Ausgangsprüfung senden“

Hält ein ausgehender Workflow eine Mail an, liegt der Entwurf im **Posteingang** mit dem gelben Hinweis **„Versand blockiert“** und dem Grund (ohne Grund: „Vom Workflow ohne Begründung angehalten – bitte E-Mail prüfen.“). Das gilt auch für automatische Antworten aus Workflows und für Mails mit **„Später senden“** — deren Planung wird dabei aufgehoben.

- **Korrigieren und senden:** Entwurf öffnen, anpassen, **Senden** — die Ausgangs-Workflows prüfen erneut.
- **Ohne Ausgangsprüfung senden:** Im Hinweis „Versand blockiert“ und im Entwurfsfenster eines angehaltenen Entwurfs. Nach der Rückfrage geht die Mail ohne erneuten Durchlauf der Ausgangs-Workflows raus. Jeder solche Versand wird protokolliert (Server: Audit-Log, Desktop: Protokoll).
- **Wer das darf:** **Einstellungen → Automatisierung → „Ausgangsprüfung überspringen erlauben“**: *Alle, die senden dürfen* (Standard), *Nur Owner und Admin* oder *Niemand*. Ändern können die Einstellung nur Owner und Admin.

### Wer hat gesendet? („Gesendet (KI)“)

Jede Mail, die SimpleCRM verschickt, merkt sich beim Versand, **wer** sie abgeschickt hat. In der Nachrichtenliste stehen dafür kleine Kennzeichen, in der Leseansicht eine Zeile unter den Adressen:

| Kennzeichen | Zeile in der Leseansicht | Bedeutung |
|---|---|---|
| *(keins)* | „Gesendet von: *Name*“ | Ein Mensch hat die Mail geschrieben oder einen KI-Entwurf **geändert** und dann gesendet. |
| **KI** | „Automatisch von KI gesendet (Workflow „…“)“ | Ein Workflow hat einen KI-Entwurf ohne menschliches Zutun verschickt. |
| **KI · freigegeben** | „KI-Entwurf, freigegeben von *Name*“ | Ein Mensch hat einen KI-Entwurf **unverändert** gesendet (z. B. über „Wartet auf Freigabe“ oder aus dem Entwurf). |
| **Automatik** | „Automatisch gesendet (Workflow „…“)“ | Ein Workflow ohne KI hat verschickt (z. B. „Entwurf erstellen“ + „Entwurf senden“). |
| **Relay** | „Über das SMTP-Relay gesendet (…)“ | Ein externes System (Shop, ERP) hat über das SMTP-Relay verschickt. |
| **ohne Prüfung** | „Ausgangsprüfung übersprungen“ | Beim Versand wurde **„Ohne Ausgangsprüfung senden“** verwendet. |

Beim Überfahren eines Kennzeichens mit der Maus erscheint der Name (Person, Workflow oder Relay). Namen werden beim Versand festgehalten; eine spätere Umbenennung ändert alte Mails nicht.

- **Gesendet (KI)** direkt unter **Gesendet** zeigt nur Mails mit **KI**, **KI · freigegeben** oder **Automatik** — praktisch zum Nachsehen, was die Automatik verschickt hat. **Gesendet** zeigt weiterhin alles. Die Suche in dieser Ansicht bleibt auf sie beschränkt; Mails lassen sich nicht dorthin verschieben.
- Schon **vor** dieser Funktion gesendete oder nur per IMAP abgeglichene Mails tragen keine Kennzeichnung.
- Mit aktivem Abgleich des Gesendet-Ordners legt der Abgleich für eine von SimpleCRM gesendete Mail **keine zweite Zeile** an, sondern übernimmt die vorhandene — die Kennzeichnung bleibt erhalten.

## Workflows (Kurz)

- **Auslöser:** z. B. neue Mail, gesendete Mail, neuer Entwurf, **Zeitplan** (Cron).
- **Aktionen:** z. B. Tags, Kategorie, Archiv, Weiterleitungskopie, Sperre vor dem Versand; erweiterte Knoten (KI, Code, CRM) über die **Palette** im Editor.
- **Vorlagen**, **Test (Dry-Run)** mit Nachrichten-ID und **Lauf-Historie** im Workflow-Editor.
- **Wissensbasis** für KI-Workflows: **E-Mail → Einstellungen** → Gruppe **KI & Automation** → **Wissensbasis**.
- **IMAP-Löschen / HTTP-Allowlist:** **Einstellungen → Automatisierung** (Link auch im Workflow-Editor unter **Erweitert**).
- Unter **Workflows** den grafischen Editor nutzen und speichern — Zeitpläne werden im Hintergrund neu geladen.

## Datenexport (DSGVO-Hilfe)

Unter **E-Mail → Einstellungen**:

- **ZIP mit Anhängeordner** — kann bei sehr vielen Dateien groß werden; oberhalb einer Größe muss ggf. der **Export nur mit Metadaten** gewählt werden.
- **ZIP nur Metadaten** — ohne die Dateien im Anhänge-Ordner; leichter und für Übersichten oft ausreichend.

**Hinweis:** Der Export enthält **keine** gespeicherten Passwörter aus dem Schlüsselbund.

## Wenn etwas nicht klappt

- **Versand blockiert:** Text der Meldung lesen — oft ein **ausgehender Workflow**. Inhalt anpassen oder Workflow in **E-Mail → Workflows** prüfen; bei Bedarf **„Ohne Ausgangsprüfung senden“** (siehe oben).
- **POP3:** Manche Server löschen Mails nach dem Abruf — das ist **Server-Verhalten**, nicht SimpleCRM.
- **TLS/SMTP:** In den SMTP-Einstellungen Port und Verschlüsselung zum Anbieter passend wählen (z. B. 587 mit TLS vs. 465).

Für technische Details und bewusst nicht umgesetzte Punkte siehe [`EMAIL_PHASES.md`](EMAIL_PHASES.md).
