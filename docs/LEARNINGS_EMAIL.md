# E-Mail-Modul — Learnings (für später)

Konkrete Erkenntnisse aus Design, Implementierung und QA — **kurz**, damit sie beim nächsten Refactor nicht verloren gehen.

## Protokolle & Identität

- **POP3-Message-Nummern** sind sitzungsabhängig. **Nie** allein als Datenbank-Schlüssel verwenden. Stabil: **UIDL** + eigene Spalte (`pop3_uidl`).
- **Negative `uid`** für lokale Entwürfe und für POP3-Zeilen sparen Konflikte mit IMAP-UIDs, erfordern aber überall explizite Filter: **`(uid >= 0 OR pop3_uidl IS NOT NULL)`** für „echte Mailbox-Mails“ vs. reine Entwürfe.

## SQLite & Suche

- **FTS5** als `content='email_messages'` verlangt **Trigger** und einmaliges **`rebuild`** nach Anlage — sonst leerer Index.
- **MATCH**-Syntax ist nicht gleich **LIKE**; Fallback auf LIKE für komische Suchbegriffe ist sinnvoll.

## Workflows & Sicherheit

- **Outbound fail-open** bei Exceptions war ein Sicherheitsrisiko. **Fail-closed** mit Hold — aber: alle Workflows **trotzdem ausführen**, damit Logging und spätere Regeln nicht „stumm“ wegfallen.
- **`forward_copy`:** Dedupe **vor** SMTP blockiert Retries nach SMTP-Fehler. Dedupe **nach** erfolgreichem Send ist robuster.

## IMAP / Netzwerk

- **Sent-Append:** `mailboxOpen` kann einen **anderen** Ordner als den konfigurierten öffnen — `append` muss denselben **tatsächlich geöffneten** Pfad nutzen.
- **Timeouts** (IMAP/POP3/SMTP) verhindern nicht alles, reduzieren aber hängende Main-Prozess-Sessions; **Mutex pro Konto** verhindert parallele Syncs.

## Frontend

- **Strikte Ein-Zeilen-E-Mail-Regex** bricht reale Eingaben (`Name <a@b.de>`). Besser: **parsen** und extrahieren (geteiltes Modul).
- **DOMPurify** nach React Quill: schützt vor Script/HTML-Injection aus KI/Textbausteinen; kann legitimes Markup stärker kürzen — bewusster Trade-off.

## Konfiguration & Betrieb

- **`npm install --legacy-peer-deps`:** aktuell nötig wegen Peer-Konflikten im Baum (Dokumentation im README beibehalten).
- **GDPR-ZIP:** Vollständiger Anhänge-Ordner kann riesig sein — **Export ohne Anhänge** anbieten + Größenlimit mit klarer Meldung.

## Threading

- **`email_threads` löschen** nur, wenn **keine** Message mehr die `thread_id` referenziert — vermeidet Waisen bei seltenen ID-Kollisionen über Konten hinweg.

## SQL & Datenbank-Pattern

- **COALESCE-Falle:** `COALESCE(?, spalte)` im UPDATE verhindert das Löschen eines Feldes auf `NULL` — stattdessen **dynamische SET-Klauseln** (nur gesetzte Felder in den SQL-String aufnehmen). Fünfmal derselbe Fehler (Account-Update, Folder-Upsert, Draft-Update, AI-Prompt-Update).
- **Parameter-Reihenfolge bei dynamischem SQL:** Wenn JOIN- und WHERE-Klauseln bedingt zusammengebaut werden, muss die Reihenfolge im `params`-Array **exakt** der Platzhalter-Reihenfolge im SQL entsprechen. Nicht `[accountId, categoryId]` wenn SQL `JOIN … category_id = ? WHERE account_id = ?` ist.

## Netzwerk-Reconnect

- **Backoff nach Erfolg zurücksetzen:** IDLE-Reconnect muss `retryCount = 0` übergeben, wenn die vorherige Verbindung **erfolgreich** war (`close`-Event ≠ Verbindungsfehler). Sonst wächst der Delay monoton und kühlt nie ab.
- **Timer-IDs speichern:** Pending `setTimeout`-Reconnects in einer Map speichern und bei `stop` per `clearTimeout` aufräumen — sonst können nach Restart „Ghost-Clients" aus alten Timern entstehen.
