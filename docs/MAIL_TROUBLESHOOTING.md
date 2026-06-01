# E-Mail — Support-Matrix (Symptom → Aktion)

Kurzreferenz für Support und Entwickler. Technische Details: [`DEVELOPER_EMAIL.md`](DEVELOPER_EMAIL.md), Diagnose: Einstellungen → **Diagnose & Backup**.

---

## Sync & Konten

| Symptom | Wahrscheinliche Ursache | Aktion |
|---------|-------------------------|--------|
| „Auth-Fehler“ / kein Sync | Abgelaufenes OAuth oder falsches Passwort | Konto bearbeiten, Passwort/OAuth neu verbinden |
| INBOX leer nach Update | Falsches `userData` (Dev vs. packaged) | Pfad prüfen (`MAIL_BETA_PHASE3_PLAN.md`), Diagnose → DB-Größe |
| UIDVALIDITY-Hinweis | Server hat Folder neu nummeriert | App legt Metadaten-Backup an; ggf. Tags prüfen |
| Nur ein Ordner synchron | Design: primär INBOX + Sent-Append | Roadmap: Multi-Folder |

---

## Versand & Entwürfe

| Symptom | Ursache | Aktion |
|---------|---------|--------|
| Senden grau / Hold | Outbound-Workflow blockiert | Entwurf im Posteingang (gelber Hinweis), Workflow-Log |
| Gesendet fehlt am Server | IMAP APPEND fehlgeschlagen | SMTP-Log, Konto → Sent-Ordner |
| Anhang fehlt nach Entwurf neu öffnen | Alte DB ohne `draft_attachment_paths` | Update, Entwurf neu anlegen |

---

## KI & Workflows

| Symptom | Ursache | Aktion |
|---------|---------|--------|
| KI antwortet nicht | Kein API-Key im **KI-Profil** | Einstellungen → KI-Profil, Key speichern |
| Falscher Anbieter/Modell | Knoten nutzt anderes `profileId` | Workflow-Knoten → KI-Profil-Dropdown |
| Workflow läuft nicht | Graph ungültig / deaktiviert | Editor speichern, Dry-Run, Lauf-Historie |

---

## Daten & Backup

| Symptom | Ursache | Aktion |
|---------|---------|--------|
| Kategorien/Keys „weg“ | Anderer `userData`-Ordner | Siehe Restore-Pfade in Phase-3-Plan |
| Backup zu groß | Anhänge > 8 GB | Alte Mails archivieren/löschen |
| Restore schlägt fehl | Keytar nicht im ZIP | Keys manuell neu setzen |

---

## UI

| Symptom | Aktion |
|---------|--------|
| Externer Link öffnet nicht | Bestätigungsdialog — URL prüfen |
| HTML-Anzeige leer | In Lesevorschau auf HTML umschalten |
| Compose-Dialog abgeschnitten | App-Update (Dialog `fixed` + Höhe) |

---

## Diagnose exportieren

1. Einstellungen → **Diagnose & Backup** → **Aktualisieren**
2. **JSON kopieren** an Support
3. Optional: **Vollbackup (ZIP)** + **Backup prüfen**
