# E-Mail-System – Deep Review (Dry-Test / Code-Durchsicht)

**Stand des Reviews:** Codebasis nach Commit `0cda09b` (Branch `cursor/e-mail-workflow-system-11c9`).  
**Methode:** Statische Analyse der genannten Befunde gegen den aktuellen Quellcode; keine automatisierten Tests (im Projekt derzeit kaum/abwesend).

---

## Executive Summary – Gesamtbewertung

Das E-Mail-Modul ist **funktional breit aufgestellt** (IMAP/POP3/SMTP, Workflows, OAuth, Anhänge, Threading). Für einen **produktiven Einsatz** bestehen weiterhin **mehrere validierte Hochrisiko-Stellen** (IMAP Sent-Append, POP3-UID-Schema, Draft-UID-Kollision, Outbound-Workflow bei Exceptions, Workflow-Updates mit `COALESCE`). Ein Teil der im externen Report genannten Punkte ist **bereits behoben** (Reporting `perAccount`-Filter, Sync-Serialisierung, GDPR-Streaming für große Tabellen, Anhänge async/dedupe).

**Gesamteinschätzung:** *Kann grundsätzlich laufen*, aber **nicht** als „sicher gegen Datenkorruption / Policy-Verletzungen“ ohne die offenen CRITICAL/HIGH-Fixes.

---

## Architektur-Übersicht

| Schicht | Inhalt | Datenfluss |
|--------|--------|------------|
| **Main (Electron)** | `electron/email/*.ts` – Sync, SMTP, Workflows, CRM-Helfer, OAuth, Anhänge | SQLite (`better-sqlite3`), Keytar, Netzwerk (IMAP/POP3/SMTP/fetch) |
| **IPC** | `electron/ipc/email.ts` | Renderer ↔ Main, Kanäle `email:*` |
| **Renderer** | `src/app/email/*` | UI, React Flow Workflow-Editor, Compose |
| **Shared** | `shared/ipc/channels.ts`, `shared/email-workflow-graph.ts` | Typen / Kanalnamen |

Hintergrund: `email-imap-services.ts` (Cron, IDLE), Mutex pro Konto in `email-sync-mutex.ts`.

---

## Kritische Bugs (Severity: CRITICAL)

| ID | Befund | **Valide?** | Begründung (gegen aktuellen Code) |
|----|--------|-------------|-----------------------------------|
| **C1** | IMAP Append nutzt nach Fallback falschen Ordnernamen | **Ja** | In `email-imap-append.ts` wird bei Fehler `mailboxOpen('INBOX.Sent')` aufgerufen, danach aber weiter `client.append(folder, …)` mit dem **ursprünglichen** `folder` (z. B. `Sent`). |
| **C2** | POP3: Message-Nummer als `uid` → Kollision/Umschreiben | **Ja** | `insertOrUpdateEmailMessage` nutzt `ON CONFLICT(account_id, folder_id, uid)`. POP3-**Nummern** sind sitzungsabhängig; bei Server-Umnummerierung kann eine **neue** Nachricht dieselbe Nummer wie eine alte Zeile bekommen und die Zeile per UPSERT **überschreiben**. UIDL verhindert Duplikat-**Download**, nicht diesen Konflikt auf der DB-Ebene. |
| **C3** | Draft-UID-Kollision bei schneller Erstellung | **Ja** | `createComposeDraft` verwendet `-Math.floor(Date.now()/1000)` und bei Kollision nur **eine** Dekrementierung (`uid -= 1`). Ab dem **dritten** Entwurf innerhalb derselben Sekunde (und passender Existenz) ist eine Kollision möglich → UNIQUE-Verletzung. |

---

## Schwerwiegende Logikfehler (Severity: HIGH)

| ID | Befund | **Valide?** | Begründung |
|----|--------|-------------|------------|
| **H1** | Outbound-Workflow: Exception → Versand trotzdem möglich | **Ja (Policy)** | `evaluateOutboundWorkflows` setzt zuerst `setOutboundHold(false, null)`. Wirft ein Workflow in `runRulesOutbound` **vor** einem Block, fängt `catch` nur Logging → Schleife läuft weiter → `allowed: true` möglich. Für **Fail-closed** (Sicherheits-Workflow) ist das ein Loch. |
| **H2** | `updateWorkflow`: `cron_expr` / `graph_json` nicht leerbar; `COALESCE` | **Ja** | `UPDATE` nutzt `COALESCE(?, graph_json)` / `COALESCE(?, cron_expr)`. Übergabe von SQL-`NULL` lässt `COALESCE` den **Alt**wert behalten – explizites Löschen im UI ist so **nicht** möglich. `schedule_account_id` wird separat gesetzt und kann `NULL` sein. |
| **H3** | `domain_ends_with` bei mehreren Adressen in einem String | **Ja** | `matchSingleCondition` nutzt `lastIndexOf('@')` auf dem **gesamten** `to_address`/`cc_address`-String – bei `"a@x.com, b@y.com"` ist die extrahierte „Domain“ inhaltlich falsch. |
| **H4** | Reporting: `perAccount` ignoriert Account-Filter | **Nein (behoben)** | `email-reported-stats.ts` filtert `perAccount` mit demselben `accountIdFilter` wie `totals`. |
| **H5** | Thread-Merge: DELETE auf `email_threads` gefährdet andere Konten | **Teilweise / Edge** | Merge aktualisiert nur `WHERE account_id = ?`. In der Normalarchitektur sind Thread-IDs zufällig; **Quer-Konto-Kollision** ist unwahrscheinlich. Risiko bleibt, falls `thread_id` je Kontext doppelt genutzt würde oder künftig globale Tickets ohne Isolation geplant sind. **Empfehlung:** DELETE nur, wenn keine Message **anderer** Konten `thread_id = tid` hat, oder FK/Integrität absichern. |
| **H6** | SMTP: `secure` nur bei Port 465 | **Größtenteils valide als UX/Config-Thema** | `secure = Boolean(acc.smtp_tls) && port === 465` – bei 587 wird TLS typisch über STARTTLS gefahren (Nodemailer-Default). Die Checkbox **`smtp_tls`** wirkt für 587 **nicht** wie Nutzer erwarten könnte; unspezifische Ports bleiben riskant. Kein reiner „Crash“-Bug, aber **irreführende Konfiguration**. |

---

## Mittlere Probleme (Severity: MEDIUM)

| ID | Valide? | Kurz |
|----|---------|------|
| **M1** Keine IMAP/POP3-Timeouts | **Ja** | Hängende Verbindungen blockieren weiter den Mutex; globales Cron ist entschärft (Gap + Mutex), aber ein einzelner Hang kann lange anhalten. |
| **M2** GDPR: alle Anhänge, unkomprimiert | **Teilweise** | Metadaten sind gestreamt (JSONL); **Anhänge** weiterhin als Verzeichnis im ZIP → großer Speicher/Festplatten-Last. Kein Größen-Check/Progress. |
| **M3** Regex ReDoS | **Ja** | `new RegExp(needle)` im Main-Thread ohne Timeout/Schutz. |
| **M4** LIKE-Suche ohne FTS | **Ja** | Erwartbar langsam bei großen Tabellen. |
| **M5** Backfill alle IDs | **Ja** | `listMessageIdsForWorkflowBackfill` ohne LIMIT. |
| **M6** `forward_copy` mehrfach bei Backfill | **Ja** | `markWorkflowAppliedToMessage` schützt pro Workflow/Message; Backfill/erneute Ausführung ohne Applied-Flag kann mehrfach SMTP auslösen (je nach Aufrufkontext). |
| **M7** ReactQuill HTML ohne Sanitization | **Kontextabhängig** | Lokale Desktop-App: XSS-Risiko primär bei **fremdem HTML-Inhalt** (KI, Templates) und wenn Renderer fremde Inhalte unsicher rendert. Als **Defense-in-depth** trotzdem relevant. |
| **M8** Keine strikte E-Mail-Validierung Compose | **Ja** | Fehler kommen spät bei SMTP; UX/Sicherheit geringfügig. |
| **M9** POP3 UIDL auf 5000 begrenzt | **Ja** | Ältere UIDLs fallen raus → Nachrichten können erneut geladen werden (Duplikate), wenn der Server die nochmal ausliefert. |
| **M10** Kategoriepfad ohne Tiefenlimit | **Ja** | Sehr tiefe Pfade / rekursive UI theoretisch problematisch; Zyklen in DB sind ohne zusätzliche Checks nicht ausgeschlossen (Parent-Beziehung). |

---

## Niedrige Probleme (Severity: LOW)

**L1–L5** (leere `catch`, DRY, tote Platzhalter, monolithische `page.tsx`, Port-Parsing): **sämtlich valide** als Wartbarkeit/Qualität, keine unmittelbaren Produktions-Crashes.

---

## Performance

Die im Report genannten Punkte (LIKE, Backfill, Regex ohne Cache, N+1 `fetchOne`, viele IDLE-Clients) sind **größtenteils valide**. Zusätzlich wirkt der **Sync-Mutex** pro Konto als Schutz gegen parallele Last, kann aber die **Latenz** erhöhen, wenn ein Sync sehr lange dauert.

---

## Sicherheit

| Risiko | Valide? | Anmerkung |
|--------|---------|-----------|
| ReDoS (Workflow) | Ja | Siehe M3. |
| HTML in Compose | Teilweise | Siehe M7. |
| Credentials in React-State | Ja (DevTools) | Typisches Electron-Thema; Keytar für gespeicherte Secrets. |
| Attachment-Pfade | Gemildert | Sanitizing der Dateinamen; `openPath` für riskante Extensions mit Bestätigung (nach Fix `0cda09b`). |

---

## Frontend

Compose-Validierung, Größe von `page.tsx`, leere Fehlerbehandlung: wie im Report beschrieben **größtenteils valide** (UX/Wartung).

---

## Modul-für-Modul: „Kann es funktionieren?“

| Modul | Einschätzung | Haupt-Risiko (validiert) |
|-------|----------------|---------------------------|
| IMAP-Sync | Ja | M1, Performance N+1 |
| POP3-Sync | Eingeschränkt | **C2**, **M9** |
| SMTP | Ja mit Einschränkung | **H6** |
| Outbound-Workflows | Unzuverlässig für Safety | **H1** |
| Inbound-Workflows | Ja | M3, M6 |
| Threading JWZ | Ja | H5 (Edge) |
| IMAP Append Sent | Fehleranfällig | **C1** |
| Drafts | Eingeschränkt | **C3** |
| Reporting | OK | H4 obsolet |
| GDPR-Export | OK für JSONL | M2 (Anhänge-Größe) |
| Background-Services | Ja | M1 |
| Graph-Compiler | Linear | bekanntes Design-Limit |

---

## Priorisierter Behebungsplan (nur valide / offene Punkte)

### Sofort (vor produktivem Einsatz)

1. **C1 – `email-imap-append.ts`:** Variable `appendMailbox` setzen: erfolgreich geöffneter Pfad (primär oder Fallback), `append(appendMailbox, …)`.
2. **C2 – `email-pop3-sync.ts`:** Stabile lokale UID ableiten, z. B. **Hash/positiver Integer aus UIDL** + ggf. eigene Spalte `pop3_uidl` mit UNIQUE `(account_id, folder_id, pop3_uidl)` oder Migration des Unique-Keys – Ziel: kein UPSERT über volatile POP3-Nummer.
3. **C3 – `email-store.ts`:** Draft-UID z. B. **monoton negativ** (`SELECT MIN(uid) …`) oder **randomUUID** in dedizierter Spalte / negatives `AUTOINCREMENT`-Schema – kein Sekunden-Timestamp.
4. **H1 – `email-workflow-engine.ts`:** Policy **fail-closed:** bei Exception in Outbound-Workflow `allowed: false` mit technischem Grund **oder** `setOutboundHold(true, …)`; optional Unterscheidung „parse error“ vs. „SMTP error in action“.

### Kurzfristig

5. **H2 – `email-workflow-store.ts`:** Update-Strategie ohne `COALESCE` für nullable Felder: explizite Spaltenliste pro gesetztem Feld, oder Sentinel / `UPDATE … SET graph_json = CASE WHEN ? IS _sentinel THEN graph_json ELSE ? END` – Ziel: `null`/`''` kann Cron/Graph löschen.
6. **H3 – `email-workflow-types.ts`:** `domain_ends_with` auf **split + trim + pro Adresse** anwenden.
7. **H6 – `email-smtp.ts`:** `createTransport` mit klarer Semantik: z. B. Port 465 → `secure: true`; 587 + `smtp_tls` → `secure: false`, `requireTLS: true` o. Ä.; Dokumentation in UI.
8. **M1:** `socketTimeout` / Verbindungs-Timeouts (imapflow / POP3-Client) an zentraler Stelle.
9. **M3:** Regex-Länge begrenzen, vereinfachen, oder `re2`/Worker mit Timeout.
10. **M7/M8:** DOMPurify (oder gleichwertig) für gespeichertes HTML; einfache RFC5322-ähnliche Validierung für To/Cc.

### Mittelfristig

11. **M4:** SQLite **FTS5** für Suche (Migration, Trigger/Index-Pflege).
12. **M5/M6:** Backfill paginieren; `forward_copy` idempotent (z. B. Dedupe-Key in DB oder Applied-Flag pro Action-Typ).
13. **M9:** UIDL-Liste nicht hart auf 5000 kürzen – oder in Datei/DB mit Rolling-Hash speichern.
14. **M10:** Max-Tiefe für Kategoriepfad; Zyklus-Check bei `parent_id`.
15. **H5:** Vor `DELETE FROM email_threads` prüfen, ob noch Messages **beliebiger** Konten die ID referenzieren – oder `thread_id` als FK mit ON DELETE RESTRICT.
16. **L2:** Gemeinsame Helfer (`snippetFromParsed`, …) in `electron/email/email-parse-utils.ts`.
17. **Tests:** Mindestens Unit-Tests für UID-Strategie POP3/Draft, IMAP-Append-Pfad, Outbound-Exception-Pfad, `updateWorkflow` nulling.

---

## Verifizierung (nach Umsetzung)

- **C1:** Konto mit falschem Sent-Namen → Fallback-Ordner → Mail muss im geöffneten Ordner landen.
- **C2:** POP3-Session mit geänderter Nummerierung simulieren (Mock) → keine Überschreibung fremder Inhalte.
- **C3:** Viele Drafts in einer Schleife `< 1s`.
- **H1:** Outbound-Workflow, der absichtlich wirft → Versand blockiert.
- **H2:** Cron leeren, `graph_json` auf `null` setzen → DB wirklich leer.
- Regression: Sync, Send, Workflow-Editor speichern.

---

## Änderungshistorie dieses Dokuments

- Erstellt als Antwort auf externen Quality-Report; Befunde gegen Repository geprüft; **H4** und Teile von Sync/GDPR/Attachments als **bereits adressiert** markiert.

### Nachfolgende Code-Fixes (Überblick)

Die folgenden Punkte aus diesem Review wurden **in der Codebasis umgesetzt** (Details im Git-Log):

- **C1** Append-Ziel = tatsächlich geöffneter Sent-Ordner  
- **C2/C3** POP3: `pop3_uidl` + synthetische stabile `uid`, Draft-UIDs monoton negativ  
- **H1** Outbound-Workflow: bei Fehler **fail-closed** + Hold  
- **H2** `updateWorkflow`: explizite Spalten-Updates (inkl. `NULL` für Cron/Graph)  
- **H3** `domain_ends_with` pro Adresse  
- **H5** Thread-DELETE nur ohne verbleibende Referenzen  
- **H6** SMTP `requireTLS` bei TLS + Nicht-465  
- **M1** IMAP/POP3/SMTP Timeouts  
- **M2** GDPR: Anhänge-Größen-Check (4 GB-Grenze)  
- **M3** Regex: Längenlimit + `safe-regex`  
- **M4** FTS5 + Trigger + Suche  
- **M5** Backfill paginiert (500er-Seiten)  
- **M6** `forward_copy`-Dedupe-Tabelle  
- **M7/M8** DOMPurify + einfache Adressvalidierung Compose  
- **M9** UIDL-Liste vollständig (kein `slice(-5000)`)  
- **M10** Kategoriepfad max. Tiefe + UI-Tiefenlimit  
- **L2** `email-parse-utils.ts`  
- **L3** Canned-Template: firstName/email aus Kundendaten falls vorhanden  
