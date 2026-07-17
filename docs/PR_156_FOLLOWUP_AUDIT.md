# PR 156: Audit der dokumentierten Claude-Follow-ups

Stand: 2026-07-17

## Zweck

Dieses Dokument ist die dauerhafte, repository-nahe Aufloesung der in PR 156
dokumentierten Follow-ups und der danach neu eingegangenen Review-Kommentare.
Es trennt bestaetigte Fehler, Defense-in-Depth, teilweise mitigierte externe
Risiken und falsifizierte beziehungsweise bereits behobene Hinweise. Damit
sollen dieselben Punkte nicht in spaeteren Reviews ohne Kontext erneut als
offene Findings erscheinen.

## Quellen

Die Follow-ups waren vor diesem Audit nicht in einer eigenen Repository-Datei
dokumentiert. Die primaere Quelle war die Beschreibung von PR 156. Zwei Punkte
standen zusaetzlich in Commit-Beschreibungen:

- `51bcfc85`: konkurrierende Vergabe von `nextLocalDraftUid`
- `1759a368`: fehlendes `FORCE RLS` fuer `auth_mfa_email_codes`
- Claude-Session: `https://claude.ai/code/session_01DSFQCGXdAXdmuWu92Qwo1U`

Die uebrigen Hinweise waren nur in der PR-Beschreibung enthalten.

Am 2026-07-17 kamen drei weitere Inline-Reviews hinzu:

- `discussion_r3601892535`: fehlende Admin-Gates fuer Mail-Security/Rspamd
- `discussion_r3601892548`: MSSQL-Settings-Metadaten fuer normale Benutzer
- `discussion_r3601892557`: HTTP-Fehler setzte den normalen Workflow-Pfad fort

Die abschliessende Gatekeeper-Pruefung desselben Tages fand drei weitere
Randfaelle: SMTP-I/O innerhalb der MFA-Transaktion, einen fehlenden terminalen
Workflow-Abschluss bei HTTP-Knoten mit reiner Fehlerkante und die weiterhin
skalare Uebergabe der aktuellen Sent-/Draft-Korrespondentenmenge.

## Ergebnisuebersicht

| Nr. | Finding | Ergebnis | Umsetzung in PR 156 |
|---:|---|---|---|
| 1 | `nextLocalDraftUid` konkurriert | Bestaetigt | Behoben: Ordnerzeile wird vor UID-Ermittlung gesperrt |
| 2 | MFA-E-Mail-Codes ohne Workspace/FORCE RLS | Bestaetigt | Behoben: Migration 0033, Workspace-Spalte, Policy, FORCE RLS |
| 3 | Principal-Fallback aus Request-Headern | Defense-in-Depth bestaetigt | Behoben: standardmaessig deaktiviert, explizites Test-Opt-in |
| 4 | Plus-Tag/Case wird fuer den Versand umgeschrieben | Bestaetigt | Behoben: Match-Key und Zustelladresse getrennt |
| 5 | IMAP-Cursor ueberspringt fehlgeschlagene UIDs dauerhaft | Bestaetigt | Behoben: persistente Pending-UID-Liste mit Retry |
| 6 | DOCX-Extraktion nur mit Compressed-Size-Gate | Bestaetigt | Behoben: ZIP-Zentralverzeichnis vor Mammoth begrenzt |
| 7 | Thread-Injection ueber Referenzen/Ticket-Betreff | Bestaetigt | Mitigiert: Korrespondenten-Kontinuitaet und kein Ticket-Neuanlegen aus Betreff |
| 8 | `forward_copy` sendet vor persistierter Dedup-Entscheidung | Bestaetigt | Behoben: `outbox`-Reservierung vor SMTP, kein blinder Retry |
| 9 | CRM-Side-Effects nur pro Run dedupliziert | Bestaetigt | Behoben: Run-ID aus fachlichem Idempotenzschluessel entfernt |
| 10 | Workflow-POST ohne externe Dedup-Information | Bestaetigt | Mitigiert: stabiler `Idempotency-Key` fuer POST |
| 11 | Continuation-Kontext kann groesser als 128 KiB werden | Bestaetigt | Behoben: Fehler vor Queue-Insertion |
| 12 | Kontozeile und Secrets in getrennten Transaktionen | Bestaetigt | Behoben: Kontoanlage und Secret-Verknuepfung atomar |
| 13 | Tracking-Routen ohne Rate-Limit | Falsifiziert/veraltet | Kein Fix: Token- und IP-Limits existieren bereits |
| 14 | Mail-Security/Rspamd-Endpunkte ohne Admin-Gate | Bestaetigt | Behoben: Lesen, Schreiben und Verbindungstest admin-only |
| 15 | MSSQL-Settings-GET ohne Admin-Gate | Bestaetigt | Behoben: gesamter Settings-Endpunkt admin-only |
| 16 | HTTP-Fehler folgt normalem Workflow-Nachfolger | Bestaetigt | Behoben: getrennte Success-/Error-Continuation, fail-closed ohne Fehlerkante |
| 17 | Message-lose CRM-Side-Effects kollidieren | Bestaetigt | Behoben: Run-Identitaet nur ohne Message |
| 18 | Message-lose HTTP-POSTs teilen Idempotency-Key | Bestaetigt | Behoben: Run-Identitaet nur ohne Message |
| 19 | Threading beruecksichtigt nur ersten Sent-Empfaenger | Bestaetigt | Behoben: Mengenueberschneidung auf beiden Nachrichtenseiten |
| 20 | Continuation-Limit blockiert lokale Knoten | Bestaetigt | Behoben: Limit nur an Queue-Grenzen |
| 21 | Einzelne benannte HTTP-Success-Kante geht verloren | Bestaetigt | Behoben: eindeutiger Custom-Success-Fallback |
| 22 | Outbound-Review-Forward reserviert nach Sendepfad | Bestaetigt | Behoben: Reservierung vor Compose-Sendepfad |
| 23 | E-Mail-MFA haelt DB-Transaktion waehrend SMTP | Bestaetigt | Behoben: kurze Reservierungs-/Aktivierungstransaktionen, Delivery-Status |
| 24 | HTTP-Erfolg mit reiner Fehlerkante bleibt dauerhaft deferred | Bestaetigt | Behoben: terminaler Success-Continuation-Job markiert den Workflow angewendet |

## Detailpruefung

### 1. Lokale Draft-UID-Kollision

**Verifikation:** `nextLocalDraftUid` las nur `min(uid) - 1`. Zwei Transaktionen
konnten denselben Wert lesen und anschliessend an der Unique-Constraint
`(workspace_id, account_source_sqlite_id, folder_source_sqlite_id, uid)`
kollidieren. Der Relay-Pfad hatte bereits das passende Muster.

**Fix:** Vor der MIN-Abfrage wird die zugehoerige Zeile in `email_folders` mit
`FOR UPDATE` gesperrt. Alle lokalen UID-Vergaben eines Ordners werden dadurch
serialisiert.

**Test:** Der Compose-Draft-Test prueft, dass die Ordnerzeile gesperrt wird.

### 2. `auth_mfa_email_codes` ohne FORCE RLS

**Verifikation:** Die Tabelle aus Migration 0020 enthielt keine
`workspace_id`-Spalte und hatte weder RLS noch FORCE RLS. Der Pre-Auth-Zugriff
war funktional, aber ausserhalb der sonstigen Workspace-Isolation.

**Fix:** Migration `0033_pr156_followup_hardening`:

- fuegt `workspace_id` hinzu und fuellt sie ueber `users.workspace_id`,
- erzwingt NOT NULL und einen Workspace-Fremdschluessel,
- aktiviert und erzwingt RLS,
- installiert `app.can_access_workspace(workspace_id)`,
- erweitert den produktiven RLS-Selbsttest,
- fuehrt Ausgabe und Verifikation in einer Workspace-Systemtransaktion aus.

### 3. Header-Trust-Principal-Fallback

**Verifikation:** Der Produktions-Bootstrap uebergab einen Access-Token-Signer
und war deshalb nicht direkt verwundbar. Der exportierte Fastify-Adapter
akzeptierte ohne Signer jedoch standardmaessig `x-simplecrm-*`-Header als
Principal. Das war eine unsichere Wiederverwendungsfalle.

**Fix:** Ohne Resolver oder Signer wird kein Principal mehr erzeugt. Der alte
Fallback ist nur noch ueber `allowHeaderPrincipalFallback: true` explizit fuer
kontrollierte Tests/Entwicklung aktivierbar.

### 4. Zustelladresse versus Matching-Key

**Verifikation:** `normalizeEmailAddress` ist absichtlich ein Matching-Key: es
lowercaset und entfernt Plus-Tags. Derselbe Helper wurde aber in
`email.forward_copy` fuer den tatsaechlichen SMTP-Empfaenger verwendet. Dadurch
konnte `User+Billing@example.com` als `user@example.com` versendet werden.

**Fix:** `emailAddressForDelivery` normalisiert nur die Domain (inklusive IDN),
laesst aber Local-Part, Case und Plus-Tag unveraendert. Kundenverknuepfung und
Korrespondenten-Matching verwenden weiterhin den bestehenden Match-Key.

### 5. Persistenter IMAP-Retry

**Verifikation:** Fetch-/Parserfehler landeten nur in einem lokalen
`skippedUids`-Set. Der Cursor durfte danach ueber diese UID hinweg weiterlaufen;
im naechsten inkrementellen Sync wurde sie nicht mehr gesucht.

**Fix:** Pro Konto/Ordner wird eine sortierte Pending-UID-Liste in `sync_info`
gespeichert. Ein Sync vereinigt Server-Suchergebnisse und Pending-Liste. Erfolg
entfernt die UID, Fehler behaelt sie. Bei geaenderter UIDVALIDITY wird die alte
Liste verworfen. Neuere Mail bleibt weiterhin synchronisierbar.

### 6. DOCX-/ZIP-Bombe

**Verifikation:** Der 15-MiB-Dateigroessen-Grenzwert galt nur fuer den
komprimierten Input. `mammoth.extractRawText` konnte davor ein stark
komprimiertes DOCX beliebig expandieren; der Timeout kann eine laufende
Dekompression nicht abbrechen.

**Fix:** Vor Mammoth wird das ZIP-Zentralverzeichnis lazy gelesen. Mehr als
2.048 Eintraege, mehr als 32 MiB deklarierte Gesamt-Expansion oder
verschluesselte Eintraege werden abgelehnt, ohne Entry-Inhalte zu dekomprimieren.

### 7. Thread-Injection

**Verifikation:** Referenzen wurden nur nach Account und normalisierten
Message-IDs aufgeloest. Ein bekannter/geratener Message-ID-Header oder Ticketcode
konnte deshalb einen fremden Absender in einen bestehenden Vorgang ziehen.

**Fix:** Der Resolver bestimmt den externen Korrespondenten (inbound: `From`,
sent/draft: `To`) und akzeptiert Referenz-Siblings nur bei gleicher normalisierter
Korrespondentenadresse. Ein Ticket im Betreff darf nur einen bereits bestehenden
Account-Thread mit demselben Korrespondenten treffen. Ein Betreff allein erzeugt
beim Sync keinen Thread mit angreifergesteuertem Ticketcode mehr.

**Restgrenze:** Eine gefaelschte `From`-Adresse, die exakt einen echten
Korrespondenten imitiert, kann ohne Einbezug von DKIM/DMARC-Evidence nicht sicher
unterschieden werden. Die Aenderung reduziert die Angriffsoberflaeche deutlich,
ist aber kein kryptografischer Absendernachweis.

### 8. `forward_copy` send-before-commit

**Verifikation:** SMTP lief vor dem Insert in
`email_workflow_forward_dedup`. Ein erfolgreicher Versand mit anschliessendem
DB-Fehler fuehrte beim Queue-Retry zu einem zweiten Versand.

**Fix:** Migration 0033 fuegt `delivery_status` (`outbox`/`sent`) hinzu. Der
direkte Forward reserviert den fachlichen Dedup-Key als `outbox`, bevor SMTP
beginnt. Erfolg markiert `sent` und queued die Continuation atomar. Bleibt nach
Crash oder SMTP-Fehler `outbox` stehen, wird ein automatischer Neuversand wegen
unklarem Zustellstatus blockiert.

**Trade-off:** Im unklaren Zustand ist eine manuelle Entscheidung noetig. Das
ist absichtlich konservativer als ein moeglicher Doppelversand.

### 9. CRM-Side-Effect-Dedup

**Verifikation:** Die deterministischen `source_sqlite_id`-Schluessel fuer
`crm.create_task` und `crm.log_activity` enthielten die Workflow-Run-ID. Derselbe
fachliche Vorgang in einem Retry-Run erzeugte daher neue Zeilen.

**Fix:** Die Schluessel bestehen jetzt aus Workspace, Workflow, Nachricht,
Knoten und Kunde. Wiederholte Runs finden die bestehende Task/Aktivitaet.

### 10. `http.request` POST

**Verifikation:** Ein POST konnte extern erfolgreich sein, bevor der lokale
Continuation-Insert fehlschlug. Exakte Einmaligkeit ist ueber eine HTTP-Grenze
ohne Kooperation des Zielsystems nicht erzwingbar.

**Fix:** POST-Jobs erhalten einen stabilen SHA-256-basierten
`Idempotency-Key`, abgeleitet aus Workspace, Workflow, Nachricht und Knoten. Der
Production-Handler validiert und erhaelt diesen Wert beim Lesen des Queue-
Payloads; der HTTP-Port sendet ihn unveraendert.

**Restgrenze:** Das Zielsystem muss `Idempotency-Key` honorieren. Ohne diese
Unterstuetzung bleibt externe Exactly-once-Semantik unmoeglich.

### 11. Continuation-Kontext

**Verifikation:** Async-Knoten kopierten `context.strings` und
`context.variables` in Job-Payloads. Die Production-Handler lehnten Werte ueber
128 KiB spaeter ab, wodurch die Kette ohne fachlichen Fehlerpfad strandete.

**Fix:** Vor Ausfuehrung eines nachgelagerten Knotens wird derselbe 128-KiB-Grenzwert
geprueft. Ueberschreitung wird als normaler Node-Fehler protokolliert; es wird
kein unzustellbarer Continuation-Job angelegt.

### 12. Atomare E-Mail-Kontoanlage

**Verifikation:** Konto-Insert, Secret-Upserts und Secret-Fremdschluessel liefen
in getrennten Transaktionen. Kompensation half bei normalen Exceptions, nicht
aber bei Prozessabbruch zwischen den Schritten.

**Fix:** Der PostgreSQL-Secret-Port bietet einen transaktionsgebundenen
Schreibpfad. Die Kontoanlage fuehrt Konto-Insert, IMAP-/SMTP-Secret-Upsert und
Pointer-Update innerhalb derselben Workspace-Transaktion aus. Ein Rollback
entfernt alle Teile gemeinsam.

### 13. Tracking-Rate-Limit

**Falsifikation:** Die globale Fastify-Ausnahme fuer `/t/` ist beabsichtigt,
weil Tracking-Routen eigene, token- und IP-basierte Limiter besitzen. Open und
Click haben getrennte Grenzwerte und Tests. Der Hinweis war fuer den aktuellen
Branch veraltet; ein weiterer Fix wuerde doppelte Limiter einfuehren.

### 14. Admin-Gates fuer Mail-Security und Rspamd

**Verifikation:** Die dedizierten Endpunkte
`/api/v1/email/settings/security` und
`/api/v1/email/settings/security/test-rspamd` liefen am inzwischen
admin-geschuetzten generischen `sync-info`-Endpunkt vorbei. Normale Benutzer
konnten damit unter anderem die Rspamd-URL lesen/aendern und einen serverseitigen
Verbindungstest zu einer angegebenen URL ausloesen. Das Frontend-Gate allein ist
keine Autorisierung.

**Fix:** GET und PATCH der Mail-Security-Settings sowie der Rspamd-Test verlangen
jetzt serverseitig `admin`/`owner`, bevor Settings gelesen, Payloads verarbeitet
oder Netzwerkzugriffe begonnen werden. Tests pruefen `403` und dass der
abgelehnte Rspamd-Aufruf `fetch` nicht erreicht.

### 15. Admin-Gate fuer MSSQL-Settings-Metadaten

**Verifikation:** PATCH, Passwortloeschung und Verbindungstest waren bereits
admin-only, GET `/api/v1/mssql/settings` jedoch nicht. Die Antwort enthaelt zwar
kein Passwort, aber interne Host-, Datenbank- und Benutzernamen sowie
`hasPassword`.

**Fix:** Der Admin-Check liegt jetzt am Anfang des gesamten MSSQL-Settings-
Handlers und gilt damit konsistent fuer GET und PATCH. Ein normaler Benutzer
erhaelt `403`, ohne dass der Settings-Port aufgerufen wird.

### 16. HTTP-Fehler durfte den Success-Pfad fortsetzen

**Verifikation:** Der HTTP-Worker queued bei Non-2xx, Timeout oder SSRF-Block die
gleiche `resumeNodeId` wie bei Erfolg. Ein Graph
`http.request -> email.release_outbound` konnte deshalb trotz fehlgeschlagenem
Freigabe-Request die E-Mail freigeben. `http.ok=false` im Kontext half nur, wenn
der nachfolgende Graph diese Variable freiwillig pruefte.

**Fix:** Der Scheduler speichert getrennte Erfolgs- und Fehlerziele. Nur eine
explizit mit `error`, `no`, `nein` oder `false` bezeichnete Kante darf bei einem
HTTP-Fehler fortgesetzt werden. Ohne solche Kante wirft der Worker einen Fehler;
der normale Nachfolger wird nicht queued und der Job bleibt retrybar. Ein
Workflow mit reiner Fehlerkante erhaelt ebenfalls einen stabilen Graphile-
Dedup-Key.

**Test:** Ein 503 mit nur normalem Nachfolger erzeugt keinen Continuation-Job.
Mit expliziter Fehlerkante wird genau deren Ziel mit `http.ok=false`, Status und
Fehlertext queued. Der Success-Test stellt weiterhin die normale Fortsetzung
sicher.

### 17. Message-lose CRM-Side-Effects kollidierten zwischen Laeufen

**Verifikation:** Der Retry-Fix fuer `crm.create_task` und `crm.log_activity`
verwendete nur Workspace, Workflow, Message, Node und Kunde. Fuer manuelle,
zeitgesteuerte oder Subflow-Laeufe ohne Message war die Message-Komponente
konstant `none`. Ein spaeterer legitimer Lauf wurde dadurch als Wiederholung
des ersten behandelt und erzeugte weder neue Aufgabe noch Aktivitaet.

**Fix:** Bei Message-basierten Workflows bleibt die Identitaet Message-scoped,
damit Wiederholungen derselben Mail dedupliziert werden. Nur bei Message-losen
Workflows wird stattdessen die persistierte Run-Source-ID verwendet. Zwei
legitime Laeufe bleiben damit getrennt, waehrend ein einzelner Lauf intern einen
stabilen Schluessel behaelt.

### 18. Message-lose HTTP-POSTs teilten einen Idempotency-Key

**Verifikation:** Derselbe `none`-Fallback floss in den HTTP-Idempotency-Key.
Ein Zielsystem, das den Header korrekt auswertet, konnte deshalb alle spaeteren
POST-Laeufe desselben Workflow-Knotens als Duplikat verwerfen.

**Fix:** HTTP verwendet dieselbe bedingte Ausfuehrungsidentitaet wie die CRM-
Side-Effects: Message-ID fuer Message-basierte Laeufe, Run-Source-ID fuer
Message-lose Laeufe. Retries des bereits eingereihten HTTP-Jobs behalten den im
Payload gespeicherten Key.

### 19. Thread-Kontinuitaet pruefte nur den ersten Sent-Empfaenger

**Verifikation:** Fuer Sent- und Draft-Nachrichten lieferte die
Korrespondentenfunktion nur den ersten `To`-Eintrag. Antwortete ein zweiter
Empfaenger mit gueltigem `In-Reply-To` oder `References`, fiel der
Sicherheitsvergleich durch und die legitime Antwort blieb unthreaded.

**Fix:** Sent/Draft-Zeilen stellen alle normalisierten, eindeutigen Empfaenger
fuer den Sicherheitsvergleich bereit. Inbound-Zeilen bleiben senderbasiert.
Die abschliessende Pruefung zeigte, dass Live-Sync und Backfill trotz pluralem
Helfer noch den skalaren Kompatibilitaetswert uebergaben. Beide Pfade uebergeben
nun die vollstaendige aktuelle Menge; Geschwister- und Ticket-Pruefung verwenden
eine normalisierte Mengenueberschneidung. Der skalare Helfer bleibt nur fuer
bestehende, nicht sicherheitskritische Aufrufer kompatibel.

### 20. Continuation-Limit blockierte lokale Knoten

**Verifikation:** Das 128-KiB-Limit wurde vor jedem Nicht-Condition-Knoten
geprueft. Dadurch konnten rein lokale Knoten einen temporaer grossen Kontext
weder reduzieren noch ohne Queue-Payload ausfuehren; auch grosse E-Mails wurden
vor lokalen Aktionen abgewiesen.

**Fix:** Die Groessenpruefung liegt jetzt ausschliesslich an den Grenzen, an
denen `eventStrings`/`eventVariables` in einen asynchronen Job oder Delayed-
Context serialisiert werden. Ein lokaler `logic.set_variable` darf den Kontext
vor dieser Grenze verkleinern; ein weiterhin zu grosser HTTP-, AI-, Forward-,
DMARC-, Delay- oder Subflow-Payload wird weiterhin abgewiesen.

### 21. Einzelne benannte HTTP-Success-Kanten gingen verloren

**Verifikation:** Die Trennung von Success- und Error-Continuation akzeptierte
nur unbenannte/default- oder yes-Kanten. Bestehende Graphen mit genau einer
benannten Erfolgskante wie `weiter` oder `ok` queued keinen Nachfolger mehr.

**Fix:** Explizite Default-/Yes-Kanten bleiben vorrangig. Fehlen sie, wird genau
eine nicht als `error`/`no`/`nein`/`false` markierte Kante als kompatibler
Success-Nachfolger akzeptiert. Mehrere mehrdeutige Custom-Kanten und reine
Error-Kanten werden nicht als Erfolg geraten.

### 22. Outbound-Review-Forward reservierte erst nach dem Sendepfad

**Verifikation:** Der direkte SMTP-Pfad reservierte bereits vor dem Send, der
`runOutboundReview`-Pfad schrieb den Dedup-Eintrag jedoch erst nach
`composeSender.send`. Ein erfolgreicher oder fuer Review gehaltener Versand mit
anschliessendem DB-Fehler konnte beim Job-Retry ein zweites Mal angestossen
werden.

**Fix:** Der Draft wird lokal erzeugt, danach wird die Forward-Zustellung vor
`composeSender.send` atomar als `outbox` reserviert. Nur der reservierende Lauf
darf den Sendepfad betreten. Erfolg oder Review-Pending markiert den Eintrag als
`sent`; ein unklarer Fehler laesst `outbox` stehen und blockiert automatischen
Neuversand.

### 23. E-Mail-MFA hielt eine Pool-Verbindung waehrend SMTP

**Verifikation:** Code-Erzeugung, Benutzer-Lock und SMTP-Versand liefen in
derselben Workspace-Transaktion. Ein langsamer oder nicht antwortender
Mailserver konnte deshalb pro parallelem Login eine PostgreSQL-Pool-Verbindung
bis zum SMTP-Timeout belegen.

**Fix:** Migration `0034_pr156_final_audit` ergaenzt den Zustellstatus
`pending`, `sent`, `failed` und `superseded`. Eine kurze Transaktion reserviert genau einen
laufenden Code pro Benutzer. SMTP laeuft danach ohne DB-Transaktion. Eine zweite
kurze Transaktion aktiviert den Code erst nach erfolgreichem Versand und
invalidiert dann aeltere Codes; bei SMTP-Fehler bleibt der vorherige Code aktiv
und die neue Reservierung wird als fehlgeschlagen konsumiert. Die Verifikation
akzeptiert ausschliesslich `sent`-Codes.

### 24. HTTP-Erfolg mit reiner Fehlerkante blieb deferred

**Verifikation:** Ein HTTP-Knoten mit ausschliesslicher `error`-Kante musste bis
zum Worker-Ergebnis deferred bleiben. Bei erfolgreichem HTTP-Ergebnis existierte
jedoch kein Success-Nachfolger und damit auch kein Job, der den erfolgreichen
Inbound-Workflow als angewendet markierte.

**Fix:** Solche HTTP-Jobs tragen `completeOnSuccess`. Der validierende
Produktions-Payload-Parser behaelt dieses Merkmal. Bei erfolgreicher Antwort
queued der HTTP-Worker einen expliziten terminalen `workflow.execute`-Job mit
Status- und Body-Kontext; dieser beendet den Run erfolgreich und schreibt den
Applied-Marker, ohne den HTTP-Knoten erneut auszufuehren. Der Fehlerfall folgt
weiterhin ausschliesslich der expliziten Fehlerkante.

## Verifikation

Neu oder erweitert wurden insbesondere Tests fuer:

- Zustelladressen mit Plus-Tag, Case und IDN-Domain,
- persistente IMAP-Pending-UIDs ueber zwei Sync-Laeufe,
- DOCX-Expansion vor Mammoth,
- Message- und Run-scoped CRM-Side-Effect-Dedup-Schluessel,
- Message- und Run-scoped HTTP-Idempotency-Keys,
- Continuation-Groessenlimit nur an asynchronen Queue-Grenzen,
- getrennte HTTP-Success-/Error-Fortsetzung mit sicherem Custom-Success-Fallback,
- Draft-Ordnersperre,
- Forward-Outbox bei unklarem SMTP-Ausgang,
- sicheren Principal-Default,
- MFA-Migration/RLS-Registrierung sowie SMTP-ausserhalb-der-Transaktion,
- terminalen HTTP-Erfolg bei reiner Fehlerkante inklusive Queue-Payload-Parser,
- Thread-Korrespondentenbestimmung fuer alle Sent-/Draft-Empfaenger,
- Admin-Gates fuer Mail-Security, Rspamd-Test und MSSQL-Metadaten.

Vor Merge sind mindestens Unit-, Integration-, Build- und Lint-Laeufe auf dem
vollstaendigen Branch auszufuehren. Die konkreten Ergebnisse stehen in PR 156.
