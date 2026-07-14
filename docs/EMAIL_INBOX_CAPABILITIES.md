# E-Mail-Postfach — Funktionsübersicht (Stand Prüfung)

Legende: **stabil** · **teilweise** · **geplant**

## Postfach & Aktionen

| Funktion | Status | Hinweis |
|----------|--------|---------|
| Posteingang, Gesendet, Archiv, Entwürfe, Spam, Papierkorb | stabil | Papierkorb = `soft_deleted` |
| Archivieren / Spam / Massenaktionen | stabil | Checkboxen + Bulk-IPC |
| Snooze (E-Mail) | stabil | `snoozed_until` |
| Kategorien (manuell + Workflow) | stabil | UI + `set_category` |
| Sidebar-Zähler Posteingang / Kategorien | stabil | Nur **unerledigte** offene Inbox-Mails (`done_local = 0`, nicht snoozed) — nicht Ungelesen |
| Sidebar-Zähler Gesendet | stabil | Nur Mails mit fehlgeschlagener IMAP-Server-Kopie (`sent_imap_sync_failed`) |
| Erledigt bei Archiv/Spam/Papierkorb | stabil | Automatisch `done_local = 1`; Wiederherstellen setzt wieder offen |
| Shift-Auswahl / Alle im Ordner | stabil | Bereichsauswahl; bis 500 IDs pro Ansicht |
| Bulk „Erledigt“ (Posteingang) | stabil | `BulkSetMessageDone` |
| Auto-Auswahl nächste Mail nach Erledigen/Archiv/Spam | stabil | Nächste Zeile in der Liste |
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
| Thread-Listenmodus | teilweise | Client-Dedup (Vorschau), keine Aufklappung |

## Workflows

| Funktion | Status | Hinweis |
|----------|--------|---------|
| Graph-Editor speichern | stabil | IPC `CompileWorkflowGraph` = Canvas-Dokument |
| Outbound blockiert bei Graph-Fehler | stabil | |
| Inbound: `sender_filter` / `ai.classify` direkt am Trigger | stabil | |
| Webhook / CRM-Trigger | teilweise | Vorhanden, Feintuning laufend |

## Backup & Diagnose

| Funktion | Status | Hinweis |
|----------|--------|---------|
| Diagnose-JSON | stabil | Einstellungen → Diagnose |
| Vollbackup ZIP | stabil | DB + Anhänge, ohne Keytar |
| Backup prüfen | stabil | Manifest + `database.sqlite` |
| Restore-Wizard | geplant | Manuell: `MAIL_BETA_PHASE3_PLAN.md` |

## Noch geplant / begrenzt

| Funktion | Status | Hinweis |
|----------|--------|---------|
| IMAP Multi-Folder (Sent / Archiv / Spam) | stabil | Opt-in pro Konto unter SMTP/IMAP-Einstellungen |
| PGP | begrenzt | Eingehende Klassifikation/Entschlüsselung, Cleartext-Signaturprüfung, serverseitige Private-Key-Passphrase-Rotation sowie Plaintext-/Compose-Sign/Encrypt lokal und serverseitig; Detached-/Anhang-Signaturen, Anhänge und HTML-Encryption-Ausbau offen |
| Open/Click-/Delivery-Evidenz | Server-Edition: opt-in umgesetzt; Standalone: bewusst aus. Siehe `EMAIL_EVIDENCE_TRACKING.md` |
| Abwesenheitsantwort pro Konto | stabil | Einstellungen → Konten bearbeiten |
