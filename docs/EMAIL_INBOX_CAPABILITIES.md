# E-Mail-Postfach — Funktionsübersicht (Stand Prüfung)

Legende: **stabil** · **teilweise** · **geplant**

## Postfach & Aktionen

| Funktion | Status | Hinweis |
|----------|--------|---------|
| Posteingang, Gesendet, Archiv, Entwürfe, Spam, Papierkorb | stabil | Papierkorb = `soft_deleted` |
| Archivieren / Spam / Massenaktionen | stabil | Checkboxen + Bulk-IPC |
| Snooze (E-Mail) | stabil | `snoozed_until` |
| Shop-„Ordner“ | teilweise | Kategorien + Workflows |

## Lesen & Datenschutz

| Funktion | Status | Hinweis |
|----------|--------|---------|
| Klartext-Standard | stabil | |
| HTML-Ansicht (opt-in, DOMPurify) | stabil | Umschaltbar in der Lesevorschau |
| Riskante Anhänge (Warnung + Bestätigung) | stabil | IPC `confirmOpenRisky` |
| Große ausgelassene Anhänge | stabil | Metadaten `omitted` in `attachments_json`, Anzeige im Viewer |

## Antworten & Versand

| Funktion | Status | Hinweis |
|----------|--------|---------|
| Bcc, Reply-All | stabil | |
| Forward mit Originalanhängen | stabil | Standard: Anhänge übernommen, abwählbar |
| Entwurf vor erstem Sync | stabil | Lokaler INBOX-Ordner wird angelegt |
| Entwurf-Anhänge persistieren | stabil | `draft_attachment_paths_json` |
| SMTP + IMAP Sent-Append mit Anhängen | stabil | Gemeinsamer RFC822-Builder |
| OAuth SMTP (Google/Microsoft) | stabil | XOAUTH2 über IMAP-Credentials |
| Geplanter Versand | stabil | `scheduled_send_at` |

## Suche & Listen

| Funktion | Status | Hinweis |
|----------|--------|---------|
| Pagination / Load-more (Liste) | stabil | Serverseitig |
| Suche mit Load-more + Kategorie | stabil | FTS/LIKE/Regex, Offset |
| Filter (ungelesen, Anhang, Kunde, Workflow) | stabil | Serverseitig in `ListMessagesByView` |
| Prioritäts-Sortierung | stabil | Tags + Sort `priority` |
| Thread-Listenmodus | stabil | |

## Workflows

| Funktion | Status | Hinweis |
|----------|--------|---------|
| Graph-Editor speichern | stabil | IPC `CompileWorkflowGraph` = Canvas-Dokument |
| Outbound blockiert bei Graph-Fehler | stabil | |
| Inbound: `sender_filter` / `ai.classify` direkt am Trigger | stabil | |
| Webhook / CRM-Trigger | teilweise | Vorhanden, Feintuning laufend |

## Noch geplant / begrenzt

| Funktion | Status |
|----------|--------|
| IMAP Multi-Folder (Sent / Archiv / Spam) | stabil | Opt-in pro Konto unter SMTP/IMAP-Einstellungen |
| PGP-Entschlüsselung | geplant |
| Open/Click-Tracking | geplant |
| Abwesenheitsantwort pro Konto | stabil | Einstellungen → Konten bearbeiten |
