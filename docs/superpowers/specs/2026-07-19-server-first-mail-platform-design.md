# Server-first Mail Platform: Berechtigungen, Migration, Verschluesselung, Anhaenge und Kollaboration

**Stand:** 2026-07-19  
**Status:** Fachlich freigegeben  
**Zielplattform:** SimpleCRM Server Edition  

## 1. Anlass und Zielbild

SimpleCRM wird strategisch server-first weiterentwickelt. Die Desktop-/Einzelplatzedition
bleibt kompatibel, ist fuer die hier beschriebenen kollaborativen Funktionen aber keine
gleichrangige Zielplattform mehr.

Das Programm schliesst fuenf zusammenhaengende Produktluecken:

1. Durchgaengige Mailbox-Berechtigungen und Delegation.
2. Resumierbare historische Mailmigration aus IMAP und Microsoft 365.
3. S/MIME und anwendungsseitige Verschluesselung im Ruhezustand.
4. Eine globale, sichere Anhangszentrale ohne Cloud-Speicher-Anbindung.
5. Schlanke Zusammenarbeit an Entwuerfen ohne formale Freigabesperre.

Die Funktionen werden nicht als voneinander isolierte Erweiterungen umgesetzt. Sie bauen
auf gemeinsamen Autorisierungs-, Inhalts-, Job-, Audit- und Ereignisgrenzen auf.

## 2. Bestehende Grundlagen

Der aktuelle Stand stellt bereits wichtige Bausteine bereit:

- Fastify-API, PostgreSQL, RLS und Graphile Worker in `packages/server`.
- Mailkonten, Ordner, Nachrichten, Anhaenge, Suche und Workflows.
- `user_account_access` mit voneinander abweichenden Desktop- und Servermodellen.
- Workspace-weite Rollen, Benutzergruppen und Capability Grants.
- XChaCha20-Poly1305 Secret Envelopes und versionierte Master-Key-Unterstuetzung.
- PGP, Mailauth, Spam Decision Engine und verschluesselte Tracking-Rohdaten.
- Conversation Locks mit Heartbeat, Ablauf und auditiertem Admin-Takeover.
- Ein einfacher KI-bezogener Entwurfszustand fuer bestehende Outbound-Workflows.
- PostgreSQL-Import-Checkpoints und Job-Queue-Muster fuer unterbrechbare Arbeiten.
- Persistierte Anhaenge mit Hash, extrahiertem Text und sicherem Downloadpfad.

Die neue Architektur verwendet diese Grundlagen, ersetzt aber die fragmentierte
Mailautorisierung und die Klartextspeicherung von Mailinhalten.

## 3. Verbindliche Produktentscheidungen

- Die Umsetzung ist server-first.
- Owner und Admins besitzen vollstaendigen Mailzugriff.
- Normale Benutzer erhalten standardmaessig keinen Mailzugriff.
- Rechte koennen Benutzern und Gruppen auf Konto- oder Ordnerebene gewaehrt werden.
- Die Administration kombiniert Rollenprofile mit einzeln anpassbaren Rechten.
- Mailinhalte, RFC822, Anhaenge, Kommentare und Revisionsinhalte werden
  anwendungsseitig verschluesselt.
- Der Server darf Inhalte nach erfolgreicher Autorisierung entschluesseln.
- Klartext-FTS wird durch HMAC-basierte Blindindizes ersetzt.
- Jeder Workspace erhaelt ein passwortgeschuetztes Offline-Recovery-Paket.
- S/MIME-Identitaeten gehoeren einem Mailkonto, nicht einem Benutzer.
- Historische Migration importiert nur nach SimpleCRM und veraendert die Quelle nicht.
- Exchange bedeutet ausschliesslich Microsoft 365 ueber Microsoft Graph.
- Lokale Exchange-Server und EWS sind nicht Bestandteil des Programms.
- Cloud-Speicher wie OneDrive, SharePoint, Google Drive oder Dropbox sind nicht Bestandteil.
- Entwurfsfeedback ist unverbindlich und blockiert den Versand nicht.
- Es gibt kein gleichzeitiges Live-Editing. Pro Entwurf arbeitet genau ein Editor.

## 4. Architekturprinzipien

### 4.1 Modularer Monolith

Die Funktionen bleiben im bestehenden Monorepo und Serverprozess. Es werden keine neuen
Microservices eingefuehrt. Rechenintensive oder lange Arbeiten laufen weiterhin ueber
Graphile Worker hinter klaren Ports.

### 4.2 Eine Autorisierungsgrenze

REST, WebSocket, Suche, Exporte, Anhangsdownloads, Workflows, KI, Migrationen und Worker
verwenden dieselbe Mail-ACL. Kein Adapter darf lediglich `workspace_id` pruefen und daraus
Mailzugriff ableiten.

### 4.3 Ein verschluesselter Content Store

Mailtexte, RFC822, Anhaenge, extrahierte Inhalte, Kommentare und Entwurfsrevisionen werden
als verschluesselte Inhaltsobjekte gespeichert. Fachliche Tabellen referenzieren diese
Objekte, statt eigene unverschluesselte Dateipfade oder Textkopien zu verwalten.

### 4.4 Expand-and-contract

Schemaerweiterung, Dual-Write, Backfill, Verifikation, Reader-Umschaltung und Entfernen
alter Klartextpfade sind getrennte Releaseschritte. Ein unterbrochener Backfill darf weder
alte noch neue Leser unbrauchbar machen.

## 5. Zentrale Mail-ACL

### 5.1 Ressourcen und Subjekte

ACL-Subjekte:

- `user`
- `group`

ACL-Ressourcen:

- `account`
- `folder`
- `message` nur fuer explizit geteilte Nachrichten oder Entwuerfe

Lokale Views wie Inbox, Spam, Archiv und Papierkorb sind keine ACL-Ressourcen. Die
Berechtigung einer Nachricht folgt ihrem Konto und ihrem realen Ordner.

### 5.2 Berechtigungsschluessel

- `mail.metadata.read`
- `mail.content.read`
- `mail.attachment.read`
- `mail.attachment.suspicious_download`
- `mail.triage`
- `mail.comment`
- `mail.draft.create`
- `mail.draft.edit`
- `mail.send`
- `mail.send_as`
- `mail.delete`
- `mail.export`
- `mail.account.manage`
- `mail.delegation.manage`

Die Schluessel sind unabhaengig. Es gibt keine Rangfolge, in der beispielsweise
`send_only` unbeabsichtigt ein Leserecht erfuellt.

`mail.send` erlaubt den Versand ueber das fest konfigurierte Konto mit dessen normaler
Absenderadresse. `mail.send_as` ist ein zusaetzliches Recht fuer abweichende, vom Konto
erlaubte From-Identitaeten oder Aliase. Solange SimpleCRM keine Aliasverwaltung anbietet,
ist fuer den normalen Shared-Inbox-Versand nur `mail.send` erforderlich.

### 5.3 Datenmodell

`mail_acl_bindings`

- `id`
- `workspace_id`
- `subject_type`
- `subject_user_id` oder `subject_group_id`
- `resource_type`
- `account_id`
- optional `folder_id`
- optional `message_id`
- `profile_key`
- `created_by_user_id`
- `created_at`, `updated_at`

`mail_acl_binding_permissions`

- `workspace_id`
- `binding_id`
- `permission_key`
- eindeutiger Schluessel aus `binding_id`, `permission_key`

Profile sind UI-Vorlagen. Fuer die Autorisierung zaehlt ausschliesslich die normalisierte
Menge der Berechtigungsschluessel.

### 5.4 Vererbung

- Kontorechte gelten fuer alle Ordner des Kontos.
- Ordnerrechte gelten nur fuer den ausgewaehlten Ordner.
- Fuer einen auf einzelne Ordner beschraenkten Benutzer wird kein Kontoleserecht vergeben.
- Mehrere Benutzer- und Gruppenbindungen werden vereinigt.
- Es gibt keine expliziten Deny-Regeln.
- Owner und Admins erhalten vor der ACL-Auswertung alle Rechte.

### 5.5 Enforcement

`requireMailPermission(principal, permission, resource)` schuetzt Einzelaktionen.

`scopeMailQuery(principal, permission)` liefert SQL-kompatible Konto- und Ordnerscopes fuer
Listen, Suche, Statistiken, Exporte und Bulk-Aktionen.

Jede Mailroute und jeder Mailjob wird in einem Policy-Manifest klassifiziert. CI lehnt
eine neue Route oder einen neuen Job ohne Policy ab.

WebSocket-Ereignisse werden vor der Auslieferung an jeden Empfaenger gefiltert. Ein
Ereignis darf keine Nachrichtendaten enthalten, die der Empfaenger nicht lesen darf.

Benutzerinitiierte Jobs speichern `initiated_by_user_id` und die benoetigte Operation.
Systemjobs verwenden eng begrenzte Service-Principals statt eines allgemeinen
Admin-Bypasses.

### 5.6 Administration

Vordefinierte Profile:

- Lesen
- Bearbeiten
- Antworten/Senden
- Postfach verwalten

Admins koennen die Einzelrechte eines Profils vor dem Speichern anpassen. Die UI zeigt
Benutzer und Gruppen sowie einen Konto-/Ordnerbaum. Jede Aenderung erzeugt ein Auditevent
mit altem und neuem Rechtesatz.

### 5.7 Migration bestehender Rechte

Bestehende `user_account_access`-Eintraege werden deterministisch in ACL-Bindings
ueberfuehrt. Die Migration dokumentiert die Abbildung fuer Desktop-`access_level` und
Server-`can_read`/`can_send`. Unbekannte Werte werden nicht grosszuegig interpretiert,
sondern blockiert und im Migrationsbericht ausgewiesen.

## 6. Verschluesselter Mail Content Store

### 6.1 Schluesselhierarchie

1. Der Instanz-Master-Key umschliesst versionierte Workspace Key Encryption Keys.
2. Jedes Inhaltsobjekt erhaelt einen zufaelligen Content Encryption Key.
3. Der Content-Key wird mit dem aktiven Workspace-Key umschlossen.
4. Der Payload wird mit XChaCha20-Poly1305 verschluesselt.
5. Ein separater versionierter Workspace-Suchschluessel erzeugt Blindindex-Tokens.

Die Rotation eines Workspace-Keys verpackt nur Content-Keys neu. Eine Suchschluesselrotation
erzeugt einen zweiten versionierten Index und entfernt den alten erst nach Verifikation.

### 6.2 Datenmodell

`mail_content_objects`

- `id`
- `workspace_id`
- `kind`
- `storage_kind`: `database` oder `file`
- `ciphertext` fuer begrenzte Datenbankobjekte
- `storage_path` fuer verschluesselte Dateien
- `algorithm`
- `nonce_or_stream_header`
- `wrapped_content_key`
- `workspace_key_version`
- `plaintext_size`
- `keyed_content_hash`
- `created_at`

`mail_message_content_refs`

- `message_id`
- `field_kind`: `subject`, `body_text`, `body_html`, `raw_rfc822`
- `content_object_id`

Anhangs-, Kommentar- und Revisionszeilen erhalten ebenfalls `content_object_id`.

### 6.3 Kryptografische Bindung

Associated Data bindet jedes Objekt mindestens an:

- Workspace-ID
- Objekt-ID
- Objektart
- fachliche Elternreferenz
- Schluesselversion
- Chunkindex bei Streaming-Inhalten

Ein Ciphertext oder Chunk aus einem anderen Workspace, einer anderen Nachricht oder einer
anderen Position muss die Authentifizierung verlieren.

### 6.4 Dateispeicherung

RFC822 und Anhaenge werden chunkweise verschluesselt. Das Format erlaubt begrenzte,
authentifizierte Range-Reads fuer grosse Vorschauen und Downloads. Tempfiles sind zu
vermeiden; unvermeidbare Tempdaten liegen nur in einem geschuetzten Laufzeitverzeichnis
und werden auch nach Fehlern entfernt.

### 6.5 Blindindex

`mail_search_terms`

- `workspace_id`
- `message_id`
- `field_kind`
- `search_key_version`
- `term_hash`
- `prefix_length`

Indexiert werden normalisierte Woerter und begrenzte Praefixe. Die Anwendung:

1. hasht Suchbegriffe mit dem Workspace-Suchschluessel,
2. ermittelt ACL-gefilterte Kandidaten,
3. entschluesselt eine begrenzte Kandidatenmenge,
4. verifiziert den echten Treffer,
5. erzeugt Snippet und Hervorhebung im Speicher.

Klartext-FTS fuer Betreff, Body oder Anhangstext wird nach dem Rollout entfernt.

### 6.6 Recovery und Rotation

Der Owner kann ein passwortgeschuetztes Recovery-Paket exportieren. Es enthaelt den
versionierten Workspace-Schluesselbund einschliesslich Suchschluesseln und die fuer die
Wiederherstellung notwendigen Metadaten, aber keine Mailinhalte. S/MIME-Private-Keys
werden als eigener verschluesselter Content-Objekttyp unter dieser Schluesselhierarchie
gespeichert, damit sie durch dasselbe Recovery-Paket wiederherstellbar sind. Die
Paketverschluesselung verwendet eine speicherharte Passwortableitung mit versionierten
Parametern.

Recovery-Erzeugung, Download, Import und Schluesselrotation sind hochsensible,
vollstaendig auditierte Adminaktionen. Ein Restore-Drill muss die Entschluesselung alter
und neuer Schluesselversionen nachweisen.

### 6.7 Fehlerverhalten

- Fehlende oder falsche Schluessel liefern einen expliziten Fehler.
- Eine Nachricht darf nicht als scheinbar leer dargestellt werden.
- Integritaetsfehler markieren das Inhaltsobjekt als beschaedigt und alarmieren den Betrieb.
- Klartext, Keys, Passphrasen und unverschluesselte Dateinamen gelangen nicht in Logs,
  Audit-Metadaten oder Events.

## 7. Historische Mailmigration

### 7.1 Quellen und Ziel

- Phase 1: generisches IMAP mit TLS, Passwort oder unterstuetztem OAuth.
- Phase 2: Microsoft 365 ueber Microsoft Graph und OAuth mit `Mail.Read`.
- Ziel ist ein bestehendes SimpleCRM-Mailkonto.
- Die Quelle wird nur gelesen und niemals veraendert.
- Es findet kein Upload zu einem Ziel-Mailprovider statt.

Quellzugangsdaten und OAuth-Refresh-Tokens liegen ausschliesslich im verschluesselten
Secret Store. Sie werden nach erfolgreichem Abschluss oder bewusstem Abbruch sofort
geloescht. Pausierte oder fehlgeschlagene Laeufe duerfen die Quelle hoechstens 30 Tage
weiter referenzieren; danach wird der Lauf abgebrochen und das Secret entfernt.

### 7.2 Wizard

1. Quelle und Zielkonto waehlen.
2. Verbindung und Least-Privilege-Berechtigung testen.
3. Ordner, Mengen, Groessen und Zeitraeume inventarisieren.
4. Ordner und optionalen Datumsbereich auswaehlen.
5. Importvorschau bestaetigen.
6. Lauf starten, pausieren, fortsetzen oder abbrechen.
7. Abschluss und Verifikation anzeigen.

### 7.3 Datenmodell

`mail_migration_runs`

- Quelle, Zielkonto, Initiator
- Status
- Gesamtzaehler und Bytefortschritt
- Start-, Heartbeat- und Abschlusszeit
- begrenzte letzte Fehlermeldung

`mail_migration_folder_runs`

- Quellordner-ID und Anzeigename
- Zielordnerzuordnung
- entdeckte, importierte, uebersprungene und fehlgeschlagene Elemente
- Ordnerstatus

`mail_migration_checkpoints`

- IMAP UIDVALIDITY und letzte bestaetigte UID
- oder Graph Paging-/Delta-State
- Lease Owner und Lease-Ablauf

`mail_migration_items`

- stabile Quellidentitaet
- Zielnachricht-ID
- keyed RFC822-Fingerprint
- Ergebnis und begrenzter Fehlercode
- eindeutiger Idempotenzschluessel

### 7.4 Wiederaufnahme

Worker verwenden Leases und Heartbeats. Ein Ersatzworker darf nur abgelaufene Leases
uebernehmen. Checkpoints werden erst nach dauerhaft gespeicherter Nachricht, Anhaengen,
Content-Objekten und Suchindex fortgeschrieben.

Graph respektiert `Retry-After`. IMAP und Graph verwenden begrenztes exponentielles
Backoff mit Jitter. Dauerhafte Fehler eines Elements werden protokolliert und blockieren
nicht automatisch den gesamten Ordner.

### 7.5 Deduplizierung

- Primaer gilt die stabile Quellidentitaet.
- Fuer vorhandene SimpleCRM-Mails wird ein keyed kanonischer RFC822-Fingerprint verwendet.
- Message-ID allein ist niemals ein Dedupe-Schluessel.
- Gleiche Message-ID mit unterschiedlichem Inhalt bleibt als Konflikt erhalten.
- Ein wiederholter oder fortgesetzter Lauf erzeugt keine zweite Zielnachricht.
- Gmail `All Mail` wird bei paralleler Ordnerauswahl standardmaessig ausgeschlossen.

### 7.6 Nebenwirkungen

Importierte historische Mails loesen standardmaessig keine Vacation Reply, KI-Antwort,
Trackingaktion oder Inbound-Workflows aus. Threading, Kundenverknuepfung, Anhangsextraktion
und Suche werden ausgefuehrt. Ein spaeterer Workflow-Backfill ist eine separate,
ausdrueckliche Adminaktion.

### 7.7 Abschlussbericht

Der Bericht enthaelt pro Lauf und Ordner:

- importierte Nachrichten und Bytes
- Idempotenz-Skips
- echte Inhaltsduplikate
- Message-ID-Konflikte
- Fehler nach Code und Phase
- Zeitraum und Laufzeit
- Verifikationsstichproben

Der Bericht ist als JSON und CSV exportierbar und enthaelt keine Zugangsdaten.

## 8. S/MIME pro Mailkonto

### 8.1 Standard und Adapter

S/MIME wird als eigener Adapter neben PGP umgesetzt. Die Implementierung folgt S/MIME 4.0
und CMS. ASN.1/CMS wird nicht selbst geschrieben. PKI.js ist ein geeigneter Kandidat und
wird durch OpenSSL-, Outlook- und Thunderbird-Interoperabilitaetsfixtures abgesichert.

### 8.2 Kontenidentitaeten

`smime_account_identities`

- `workspace_id`, `account_id`
- Zertifikatsfingerprint und oeffentliche Zertifikatskette
- verschluesselte Private-Key-Referenz
- E-Mail-Identitaet aus SAN
- Gueltigkeitszeitraum
- Status und Verwendungszweck
- `active_for_signing`
- Erstellungs- und Rotationsmetadaten

Der Import erfolgt als PKCS#12. Die Importpassphrase wird nie gespeichert. Der Private Key
wird als `smime_private_key` im verschluesselten Mail Content Store gespeichert und ist
damit Bestandteil des Workspace-Recovery-Modells. Pro Konto ist genau eine Identitaet
aktiv fuer neue Signaturen. Alte Private Keys bleiben fuer die Entschluesselung alter
Nachrichten erhalten.

### 8.3 Empfaengerzertifikate

`smime_peer_certificates`

- normalisierte E-Mail-Adresse
- Zertifikat und Kette
- Fingerprint
- Quelle: manuell oder eingehende Signatur
- Trust-Status
- Validierungs- und Widerrufsstatus
- first/last seen

Aus eingehenden Mails gelernte Zertifikate werden nicht blind vertraut. Adresse,
Zertifikatskette, Gueltigkeit und Trust Store muessen passen.

### 8.4 Widerrufspruefung

OCSP und CRL verwenden einen SSRF-geschuetzten Fetcher mit Protokoll-, DNS-, IP-, Groessen-
und Timeoutgrenzen. Ergebnisse werden begrenzt gecacht. Die UI unterscheidet `valid`,
`invalid`, `unknown_ca`, `expired`, `revoked` und `revocation_unknown`.

### 8.5 Versand

- Nur Signatur: `multipart/signed`.
- Nur Verschluesselung: `application/pkcs7-mime`.
- Signatur plus Verschluesselung: sign-then-encrypt.
- Das eigene Kontozertifikat wird als Empfaenger aufgenommen.
- Fehlt fuer einen Empfaenger ein gueltiges Zertifikat, wird der gesamte verschluesselte
  Versand blockiert.
- PGP und S/MIME sind pro Nachricht gegenseitig exklusiv.

### 8.6 Empfang

S/MIME-Erkennung, Verifikation und Entschluesselung erfolgen vor HTML-Sanitizing,
Content-Spampruefung und Workflow-Auswertung. Parsergrenzen beschraenken Nachrichtengroesse,
CMS-Verschachtelung, Zertifikatsanzahl und Ressourcenverbrauch.

Header Protection wird als spaetere kompatible Erweiterung eingeplant. Die erste Version
priorisiert Interoperabilitaet mit gaengigen Clients.

## 9. Anhangszentrale

### 9.1 Funktionen

- globale cursorbasierte Anhangsliste
- Suche nach Dateiname und extrahiertem Text ueber Blindindex
- Filter nach Konto, Ordner, Richtung, Absender, Empfaenger, Kunde, Zeitraum, Groesse und Typ
- Herkunftsnachricht, Thread und CRM-Kunde oeffnen
- sicheren Anhang anzeigen oder herunterladen
- vorhandenen Anhang einem Entwurf hinzufuegen

Alle Abfragen werden vor Pagination nach ACL gefiltert.

### 9.2 Wiederverwendung und Lebenszyklus

Anhangszeilen referenzieren unveraenderliche `mail_content_objects`. Eine Draft-Referenz
enthaelt Content-Objekt, Anzeigename, Reihenfolge, Disposition und optional CID. Sie kopiert
keinen Dateipfad.

Beim Versand wird der autorisierte Inhalt entschluesselt und in das MIME uebernommen.
Der Garbage Collector entfernt ein Content-Objekt nur, wenn keine Nachricht, kein Entwurf,
keine Revision und keine laufende Migration mehr darauf verweist und die Sicherheitsfrist
abgelaufen ist.

### 9.3 Vorschau

- Inline nur Bilder, Text und ausgewaehlte PDFs.
- Isolierter Sandbox-Kontext ohne Skripte, Netzwerk, Cookies oder Auth-Tokens.
- Keine aktive Office-, HTML-, Archiv- oder Executable-Vorschau.
- Bereinigte Dateinamen und Downloadheader.
- Kein unverschluesselter persistenter Thumbnail- oder Tempfile-Cache.
- PGP-/S/MIME-Container erst nach autorisierter Entschluesselung darstellen.

### 9.4 Malwarestatus

Jedes Inhaltsobjekt besitzt einen Status:

- `pending`
- `clean`
- `suspicious`
- `failed`
- `not_scanned`

Der Scanner wird ueber einen Adapter angebunden, beispielsweise ClamAV im Docker-Stack.
Verdaechtige Dateien duerfen nicht inline geoeffnet oder wiederverwendet werden. Ein
Download benoetigt Warnung und `mail.attachment.suspicious_download`.

Cloud-Speicher-Anbindungen werden nicht vorbereitet oder implementiert.

## 10. Schlanke Entwurfskollaboration

### 10.1 Teilen

Entwuerfe erben Kontorechte und koennen zusaetzlich per Message-ACL mit Benutzern oder
Gruppen geteilt werden. Moegliche Rechte sind ansehen, kommentieren und bearbeiten.
Entwurfsfreigabe erteilt niemals `mail.send` oder `mail.send_as`.

### 10.2 Ein-Editor-Modell

Conversation Locks werden fuer Entwuerfe verwendet. Heartbeats halten die Sperre aktiv,
verwaiste Sperren laufen aus und Owner/Admin duerfen sie auditiert uebernehmen.

Jeder Save sendet eine erwartete Revision. Ein veralteter Save erhaelt HTTP 409 und darf
keine neuere Version ueberschreiben.

### 10.3 Revisionen

`mail_draft_revisions`

- `workspace_id`, `message_id`
- fortlaufende Revisionsnummer
- verschluesselte Subject-/Body-Content-Referenzen
- Attachment-Referenzsnapshot
- `created_by_user_id`, `created_at`
- Anlass: save, share, feedback_request oder send

Revisionen werden standardmaessig 180 Tage aufbewahrt; die Grenze ist pro Workspace
zwischen 30 und 3650 Tagen konfigurierbar. Der finale Versandsnapshot bleibt so lange wie
die gesendete Nachricht erhalten. Gesendete Entwuerfe sind unveraenderlich.

### 10.4 Kommentare

`mail_comments`

- `workspace_id`, `message_id`
- `author_user_id`
- verschluesselte Body-Referenz
- Status offen oder erledigt
- `resolved_by_user_id`, `resolved_at`
- `created_at`, `updated_at`

Kommentare sind flach. Es gibt keine Inline-Textanker und keine verschachtelten Threads.
Bestehende interne Notizen werden als Legacy-Kommentare mit unbekanntem oder systemischem
Autor migriert.

### 10.5 Feedback-Anfragen

`mail_feedback_requests` adressiert einen Benutzer oder eine Gruppe. Der Empfaenger kann
kommentieren oder die Anfrage als erledigt markieren. Offene Anfragen oder Kommentare
blockieren den Versand nicht.

### 10.6 Historie und Events

Die Aktivitaetshistorie umfasst Erstellen, Bearbeiten, Teilen, Feedback-Anfrage, Kommentar,
Erledigen, Lock-Uebernahme und Versand. Benachrichtigungen erfolgen zunaechst nur in der
Anwendung und ueber ACL-gefilterte Server-Events.

Die bestehende technische Outbound-Sperre fuer Sicherheits- und KI-Workflows bleibt eine
separate Funktion und wird nicht als menschliche Freigabelogik umgedeutet.

## 11. API-Grenzen

Geplante API-Familien:

- `/api/v1/email/access/*`
- `/api/v1/email/content/*` nur hinter fachlichen Ressourcen, keine freie Objekt-API
- `/api/v1/email/migrations/*`
- `/api/v1/email/smime/*`
- `/api/v1/email/attachments`
- `/api/v1/email/drafts/:id/shares`
- `/api/v1/email/messages/:id/comments`
- `/api/v1/email/drafts/:id/feedback-requests`
- `/api/v1/email/drafts/:id/revisions`

Content-Objekt-IDs duerfen niemals allein zum Download berechtigen. Jede Route loest die
fachliche Elternressource auf und prueft deren ACL.

Mutationen verwenden Idempotency Keys, wo Wiederholung externe oder dauerhafte
Seiteneffekte erzeugen kann. Listen verwenden Cursor statt ungebundener Offsets.

## 12. Fehler- und Konsistenzmodell

- Autorisierungsfehler: 403 ohne Offenlegung, ob die fremde Ressource existiert.
- Unbekannte Ressource im eigenen Scope: 404.
- Veraltete Entwurfsrevision: 409 mit aktueller Revisionsnummer, ohne fremden Inhalt.
- Laufende oder besetzte Ressource: 409/423 mit sicherer Lock-Metadatenantwort.
- Temporare Providerfehler: resumierbarer Jobstatus und Backoff.
- Dauerhafte Importfehler: Elementfehler plus `completed_with_warnings`.
- Kryptografischer Integritaetsfehler: fail closed, Alarm und kein Klartextfallback.
- Malwareverdacht: Quarantaenezustand, keine Vorschau/Wiederverwendung.

DB-Zeile, verschluesseltes Objekt, Referenz und Checkpoint werden so transaktional wie
moeglich geschrieben. Dateisystemoperationen verwenden staging, fsync/atomaren Rename und
einen Cleanup-Reconciler fuer verwaiste Zwischenobjekte.

## 13. Rollout

1. Charakterisierungstests und Policy-Inventar.
2. ACL-Schema, Ports und Admin-UI hinter Feature Flag.
3. ACL-Shadow-Modus und Abweichungsdiagnostik.
4. ACL-Enforcement fuer REST, Jobs, Events, Suche und Downloads.
5. Content-Store-Schema und verschluesseltes Dual-Write.
6. Resumierbarer Content- und Blindindex-Backfill.
7. Restore- und Recovery-Drill.
8. Reader-Umschaltung und Abschaltung von Klartext-FTS.
9. Entfernen alter Klartextdaten nach verifiziertem Backup.
10. Migrationsassistent IMAP.
11. Anhangszentrale und Malwareadapter.
12. Schlanke Entwurfskollaboration.
13. S/MIME-Kern und Interoperabilitaetsphase.
14. Microsoft-365-Migration ueber Graph.

Jeder Schritt ist einzeln deploybar und hat einen eigenen Rueckrollpunkt. Das Entfernen
alter Klartexte ist der einzige bewusst nicht unmittelbar rueckrollbare Schritt und setzt
einen bestandenen Restore-Drill voraus.

## 14. Tests und Verifikation

### 14.1 Autorisierung

- Matrix fuer alle Rechte, Profile, Benutzer- und Gruppenkombinationen.
- Konto- und Ordnervererbung.
- Owner-/Admin-Vollzugriff.
- SQL-Scoping vor Pagination und Aggregation.
- Route-/Job-Policy-Vollstaendigkeit.
- WebSocket-Filterung und Cross-Workspace-RLS.

### 14.2 Verschluesselung

- Known-Answer- und Roundtrip-Tests.
- Manipulierte AAD, Ciphertexte, Keys und Chunks.
- Workspace- und Objektvertauschung.
- Key- und Search-Key-Rotation.
- Recovery auf leerer Testinstanz.
- Keine Betreffzeilen, Bodies, RFC822-Payloads, Anhangsinhalte, Kommentare oder
  Revisionsinhalte im Klartext in DB-Dump, Attachment-Storage, Logs und Events.

### 14.3 Migration

- IMAP-Verbindungsabbruch, UIDVALIDITY-Wechsel und Wiederaufnahme.
- Graph Paging, Delta, OAuth-Ablauf und `Retry-After`.
- Idempotente Wiederholung und Worker-Lease-Uebernahme.
- Gleiche UID, exaktes Duplikat und Message-ID-Konflikt.
- Keine Vacation-/Workflow-/KI-/Tracking-Nebenwirkung.
- Abschlussbericht stimmt mit persistiertem Ergebnis ueberein.

### 14.4 S/MIME

- Signieren, Verifizieren, Verschluesseln und Entschluesseln.
- Outlook-, Thunderbird-, OpenSSL- und PKI.js-Fixtures.
- Falsche Adresse, unbekannte CA, Ablauf, Widerruf und unbekannter Widerrufsstatus.
- Fehlendes Empfaengerzertifikat blockiert atomar.
- Sign-then-encrypt und eigene Entschluesselbarkeit der Gesendet-Kopie.

### 14.5 Anhaenge

- ACL-Wechsel waehrend Vorschau und Download.
- Pfadtraversal, MIME-Taeuschung, grosse Dateien und fehlerhafte Chunks.
- Malwarestatus und Quarantaene.
- Wiederverwendung ohne Dateiduplikat und korrekter Garbage-Collect.
- PGP-/S/MIME-Anhaenge und kein unverschluesselter Cache.

### 14.6 Kollaboration

- Lock acquire, heartbeat, expiry und Admin-Takeover.
- Gleichzeitige Saves liefern genau einen Erfolg und einen 409.
- Share an Benutzer und Gruppe.
- Share ohne Senderecht.
- Kommentare, Feedbackstatus, Revisionen und Events.
- Versand trotz offenem Feedback, sofern normale Versand-ACL erfuellt ist.

### 14.7 Repository-Gates

- `pnpm run lint`
- `pnpm test`
- `pnpm run test:mail`
- `pnpm run test:mail:coverage`
- `pnpm run build`
- Server-Compose-Smoke und migrationsspezifische Integrationstests

## 15. Observability und Betrieb

Diagnostik und Metriken zeigen ohne personenbezogene Inhalte:

- ACL-Denials und unklassifizierte Policies
- Key-Versionen, Rotation und Recovery-Drill-Alter
- Backfill- und Reindex-Fortschritt
- Integritaetsfehler und verwaiste Content-Objekte
- Migration-Leases, Retries, Fehlerraten und Provider-Limits
- Zertifikatsablauf und Widerrufsstatus
- Malware-Warteschlange und Scannerzustand
- Lock-Alter und Takeover-Anzahl

Alerts muessen Workspace-spezifisch sein und duerfen keine tenant-uebergreifenden
Sicherheitszustaende offenlegen.

## 16. Beta-Gates

Die Funktionen gelten erst als beta-tauglich, wenn:

- keine Mailroute und kein Mailjob unklassifiziert ist,
- ACL-Isolation fuer Benutzer, Gruppen, Konten, Ordner und Workspaces bestanden ist,
- ein DB-Dump und der Attachment-Storage keine Betreffzeilen, Bodies, RFC822-Payloads,
  Anhangsinhalte, Kommentare oder Revisionsinhalte im Klartext enthalten,
- Recovery-Paket und Backup einen Restore auf einer leeren Instanz ermoeglichen,
- ein Import nach Prozessabbruch ohne Duplikate fortgesetzt wird,
- Attachment-Downloads und Events nach ACL-Wechsel sofort gesperrt sind,
- S/MIME mit Outlook und Thunderbird interoperabel ist,
- stale Draft Saves keine neueren Revisionen ueberschreiben,
- alle Repository-Gates und Compose-Smokes gruen sind.

## 17. Explizit ausserhalb des Umfangs

- Mailhosting, MX, Mailbox-Provisionierung und Providerbetrieb
- lokaler Exchange und EWS
- Provider-zu-Provider-Mailmigration
- Cloud-Speicher-Anbindungen
- formale menschliche Freigabe oder Versandblockade
- gleichzeitiges kollaboratives Live-Editing
- oeffentliche Entwurfs- oder Anhangslinks
- Likes, Streams oder soziale Feed-Funktionen
- Zero-Knowledge-Verschluesselung
- sofortige Funktionsparitaet der Desktop-/Einzelplatzedition

## 18. Abhaengigkeiten zwischen den Teilprojekten

```text
ACL und Policy-Manifest
  -> Content Store und Blindindex
      -> IMAP-Migration
      -> Anhangszentrale
      -> S/MIME
      -> Entwurfskollaboration
      -> Microsoft-365-Migration

Run-/Checkpoint-Grundlage
  -> Content-Backfill
  -> IMAP-Migration
  -> Such-Reindex
  -> Microsoft-365-Migration

Conversation Locks
  -> Entwurfskollaboration
```

Die spaetere Implementierungsplanung muss diese Reihenfolge respektieren. Feature-PRs,
die ihre eigene ACL, Klartextablage oder eigene Retry-Logik einfuehren, entsprechen nicht
diesem Design.
