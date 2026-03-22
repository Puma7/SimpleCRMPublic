# E-Mail — Kurzanleitung für Anwender

SimpleCRM kann **E-Mail-Konten** einbinden (IMAP oder POP3), Mails **lesen**, **beantworten** und mit dem CRM **verknüpfen**. Alles läuft **lokal** auf Ihrem Rechner.

## Wo Sie was finden

| Bereich | Navigation |
|---------|------------|
| **Posteingang & Nachrichten** | Menü **E-Mail** (oder Route `/email`) |
| **Workflows automatisieren** | **E-Mail → Workflows** |
| **SMTP, KI, OAuth, Team, Export** | **E-Mail → Einstellungen** (SMTP & KI) |
| **Zahlen & Übersicht** | **E-Mail → Reporting** (`/email/reporting`) |

## Konto anlegen

1. Unter **E-Mail** ein neues Konto anlegen.
2. **Protokoll wählen:** **IMAP** (Ordner, meist komfortabler) oder **POP3** (klassisches Abrufen; Server speichert Mails je nach Einstellung).
3. Zugangsdaten eingeben — Passwörter werden im **System-Schlüsselbund** gespeichert, nicht im Klartext in der Datenbank.
4. Optional **Google** oder **Microsoft** über die Felder in den Einstellungen (OAuth) — dafür braucht es eine registrierte App beim Anbieter.

## Postfach nutzen

- **Synchronisieren:** Konten werden regelmäßig abgeglichen; Sie können auch manuell aktualisieren.
- **Ansichten:** Posteingang, Gesendet, Entwürfe, Archiv.
- **Kategorien** links filtern die Liste (nur sinnvoll in der Inbox-Ansicht).
- **Suche** durchsucht Betreff, Kurztext und Inhalt (schneller mit der eingebauten Volltextsuche, wo verfügbar).
- **Nachricht:** Kunde verknüpfen, interne Notizen, Tags, **Zuweisung** an Teammitglieder, Anhänge **öffnen** oder **speichern**.
- **Archiv / Wiederherstellen / Papierkorb:** Mails werden nicht hart gelöscht, sondern ausgeblendet oder archiviert (Datenhaltung).

## Schreiben & Senden

- **Entwurf** speichern oder **Senden** — vor dem Versand können **ausgehende Workflows** die Nachricht prüfen oder blockieren (z. B. sensible Inhalte).
- **An** und **Cc:** Eine oder mehrere Adressen, z. B. `a@firma.de` oder `Name <a@firma.de>`.
- **HTML-Editor:** Formatierter Text; die Anwendung bereinigt den Inhalt aus Sicherheitsgründen.

## Workflows (Kurz)

- **Auslöser:** z. B. neue Mail, gesendete Mail, neuer Entwurf, **Zeitplan** (Cron).
- **Aktionen:** z. B. Tags, Kategorie, Archiv, Weiterleitungskopie, Sperre vor dem Versand.
- Unter **Workflows** den grafischen Editor nutzen und speichern — Zeitpläne werden im Hintergrund neu geladen.

## Datenexport (DSGVO-Hilfe)

Unter **E-Mail → Einstellungen**:

- **ZIP mit Anhängeordner** — kann bei sehr vielen Dateien groß werden; oberhalb einer Größe muss ggf. der **Export nur mit Metadaten** gewählt werden.
- **ZIP nur Metadaten** — ohne die Dateien im Anhänge-Ordner; leichter und für Übersichten oft ausreichend.

**Hinweis:** Der Export enthält **keine** gespeicherten Passwörter aus dem Schlüsselbund.

## Wenn etwas nicht klappt

- **Versand blockiert:** Text der Meldung lesen — oft ein **ausgehender Workflow**. Inhalt anpassen oder Workflow in **E-Mail → Workflows** prüfen.
- **POP3:** Manche Server löschen Mails nach dem Abruf — das ist **Server-Verhalten**, nicht SimpleCRM.
- **TLS/SMTP:** In den SMTP-Einstellungen Port und Verschlüsselung zum Anbieter passend wählen (z. B. 587 mit TLS vs. 465).

Für technische Details und bewusst nicht umgesetzte Punkte siehe [`EMAIL_PHASES.md`](EMAIL_PHASES.md).
