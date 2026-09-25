# Abgleich der Codex-Befunde (PR #192) mit dem Audit-Register

**Stand:** automatisch erzeugt aus den Triage-Ergebnissen und der Commit-Historie seit dem Merge `37c5d02`.

Codex hat 110 Einträge hinterlassen (Anhang A 82, B 17, C 11), viele davon Duplikate untereinander. Jeder Eintrag wurde auf dem Stand nach dem Merge gegen den Code und gegen unser Register geprüft. „Erledigt (Register)“ heißt: derselbe Pfad war durch einen früheren Commit dieses PRs bereits geschlossen, das wurde im Code nachvollzogen.

| Status | Anzahl |
|---|---:|
| BEHOBEN | 78 |
| erledigt (Register) | 30 |
| By-Design | 2 |

| Codex-ID | Titel | Triage | Register | Status | Commits | Hinweis |
|---|---|---|---|---|---|---|
| C-A1 | Desktop viewers can schedule workflows that execute privileged code | Teilweise (Rest behoben) | A7-01, A9-13 | BEHOBEN | `aa968e7` | G1: Workflow- und Wissensbasis-Bearbeitung auf dem Desktop nur Owner/Admin; revidiert F-A7-01. Autor-Recheck beim Cron-Feuern bräuchte eine Migration (nicht umgesetzt). |
| C-A2 | Read-only desktop mailbox delegates can schedule or retry outbound mail | Neu, bestätigt | – | BEHOBEN | `24afc01` `4959809` `0771bd8` | Explizite rw-Stufen an allen mutierenden Kanälen; geplanter Versand prüft vor SMTP das Schreibrecht des Planenden (G6). |
| C-A3 | Desktop workflow HTTP redirects and DNS changes bypass the destination guard | Neu, bestätigt | – | BEHOBEN | `22d080d` `dde1661` |  |
| C-A4 | Desktop users can open or save attachments from unauthorized mailboxes | Duplikat, bereits behoben | A7b-06 | erledigt (Register) | – |  |
| C-A5 | Ordinary desktop users can export installation-wide data | Duplikat, bereits behoben | A7b-01, A7-04 | erledigt (Register) | – |  |
| C-A6 | Any logged-in desktop profile can delete another mailbox account | Duplikat, bereits behoben | A7-03 | erledigt (Register) | – |  |
| C-A7 | Automatic DOCX indexing can exhaust desktop or server memory | Teilweise (Rest behoben) | A5-04, A13A14-03, A7b-12 | BEHOBEN | `69ed919` `d1e85a2` | G7: DOCX im Worker mit 512-MB-Heap und Timeout; Server markiert vor dem Parse. PDF bleibt im Hauptprozess. |
| C-A8 | Previewing a crafted mail backup can exhaust desktop memory | Neu, bestätigt | – | BEHOBEN | `85fb167` |  |
| C-A9 | Windows server path parsing can bypass attachment ownership checks | Neu, bestätigt | – | BEHOBEN | `fc497e8` |  |
| C-A10 | Ordinary desktop profiles can replace the installation database | Duplikat, bereits behoben | A7b-01, A7-04 | erledigt (Register) | – |  |
| C-A11 | CRM read-only users can create and modify returns | Neu, bestätigt | – | BEHOBEN | `26cedb9` |  |
| C-A12 | Desktop connection tests disclose another mailbox's saved credentials | Neu, bestätigt | A2a-01, A4-01 | BEHOBEN | `231b747` | Verbindungstests nur Owner/Admin (Vervollständigung von E16, auch in der UI). |
| C-A13 | Read-only desktop mailbox users can alter credentials and connection settings | Duplikat, bereits behoben | A7-03 | erledigt (Register) | – |  |
| C-A14 | Desktop message mutations and draft deletion bypass account permissions | Neu, bestätigt | – | BEHOBEN | `191f0f8` `f810c0c` `27a4755` | Objekt-IDs lösen ihr Konto auf, Unauflösbares nur Owner/Admin; Server-Parität N-cx-02. |
| C-A15 | Password changes leave existing server sessions renewable | Teilweise (Rest behoben) | A1-02 | BEHOBEN | `cb969f9` | Race zwischen Passwortwechsel und Refresh/Login/MFA geschlossen (Rest F-A1-02). |
| C-A16 | Restricted desktop users can redirect a stored AI API key | Neu, bestätigt | A4-02 | BEHOBEN | `f924088` | Parität zu F-A4-02: neuer Key bei Origin-/Anbieterwechsel. |
| C-A17 | Dashboard and follow-up bypass task assignment checks on reads and snoozing | Duplikat, bereits behoben | A10-03, A2b-02, A2b-03, A2b-04 | erledigt (Register) | – |  |
| C-A18 | Read-only workflow SQL accepts SELECT INTO writes | Neu, bestätigt | – | BEHOBEN | `8d2622d` `0401bbe` | Validator gehärtet (beide Editionen); mssql.query liest im Server-Dry-Run weiter live (G11, dokumentiert: nur db_datareader). |
| C-A19 | Ordinary users receive administrator-only automation-key metadata through events | Neu, bestätigt | – | BEHOBEN | `7e8c54f` `13d71fd` | Nicht-Mail-Ereignisse nur mit REST-Leserecht; Folge: CRM-Ereignisse nur mit crm.read (N-cx-03). |
| C-A20 | Workflow editors can disable or remove active protected automation | Neu, bestätigt | – | BEHOBEN | `4ca9a7b` | G2: aktive Seiteneffekt-/Kettenstopp-Workflows nur mit workflows.manage stilllegen. |
| C-A21 | Email HTML attachments can block automatic indexing and the application event loop | Duplikat, bereits behoben | A5-05, A13A14-01 | erledigt (Register) | – |  |
| C-A22 | Raw relay forwarding preserves From headers that were not authorized | Duplikat, bereits behoben | A3b-02 | erledigt (Register) | – |  |
| C-A23 | Desktop integrations buffer endpoint responses without a byte limit | Neu, bestätigt | – | BEHOBEN | `6f05799` `71e2d40` |  |
| C-A24 | Testing a compiled desktop workflow performs live mail actions | Neu, bestätigt | – | BEHOBEN | `27a4755` `a5060a8` |  |
| C-A25 | Unresolved desktop resource IDs bypass mailbox permissions | Teilweise (Rest behoben) | A7b-06, A7-03 | BEHOBEN | `27a4755` | Objekt-IDs lösen ihr Konto auf, Unauflösbares nur Owner/Admin; Server-Parität N-cx-02. |
| C-A26 | Restricted desktop users can export all data and replace the application database | Duplikat, bereits behoben | A7b-01, A7-04 | erledigt (Register) | – |  |
| C-A27 | Read-only mailbox users can edit credentials and send scheduled drafts | Teilweise (Rest behoben) | A7-03 | BEHOBEN | `24afc01` `0771bd8` | Explizite rw-Stufen an allen mutierenden Kanälen; geplanter Versand prüft vor SMTP das Schreibrecht des Planenden (G6). |
| C-A28 | Any desktop session can read and replace global OAuth application secrets | Duplikat, bereits behoben | N-ds-02, A7-08 | erledigt (Register) | – |  |
| C-A29 | Caller-supplied account scope bypasses existing template ownership | Neu, bestätigt | – | BEHOBEN | `27a4755` | Objekt-IDs lösen ihr Konto auf, Unauflösbares nur Owner/Admin; Server-Parität N-cx-02. |
| C-A30 | Sandboxed renderer can attach host files without a picker grant | Neu, plausibel | – | BEHOBEN | `cfaee8f` | G12: Grant-Register im Main-Prozess (Picker, Drag-and-drop über Preload, Entwurfs- und Weiterleitungspfade). |
| C-A31 | Mail mutation responses bypass attachment and reply-parent visibility | Neu, bestätigt | – | BEHOBEN | `edda382` |  |
| C-A32 | Customer and product update keys are interpolated into SQLite statements | Duplikat, bereits behoben | A10-02, A6-02, N-ds-01 | erledigt (Register) | – |  |
| C-A33 | A stale message-policy response can enable remote content in another email | Neu, bestätigt | – | BEHOBEN | `6c693e4` |  |
| C-A34 | Sender display names inject HTML into the reply composer | Duplikat, bereits behoben | A6-01, A11a-01, A11a-07 | erledigt (Register) | – |  |
| C-A35 | Users without workflow access receive protected metadata over WebSocket | Neu, bestätigt | – | BEHOBEN | `13d71fd` | Nicht-Mail-Ereignisse nur mit REST-Leserecht; Folge: CRM-Ereignisse nur mit crm.read (N-cx-03). |
| C-A36 | AI text transformation discloses customer data without CRM read permission | Neu, bestätigt | – | BEHOBEN | `43bc6e5` | G4: customerId ohne crm.read wird ignoriert. |
| C-A37 | Restricted desktop users can install rules that forward other mailboxes | Neu, bestätigt | A7-01 | BEHOBEN | `aa968e7` | G1: Workflow- und Wissensbasis-Bearbeitung auf dem Desktop nur Owner/Admin; revidiert F-A7-01. Autor-Recheck beim Cron-Feuern bräuchte eine Migration (nicht umgesetzt). |
| C-A38 | A crafted application link persistently replaces the browser's server connection | Duplikat, bereits behoben | A11b-04 | erledigt (Register) | – |  |
| C-A39 | Event streams bypass read restrictions on automation keys and workflow knowledge metadata | Neu, bestätigt | – | BEHOBEN | `13d71fd` | Nicht-Mail-Ereignisse nur mit REST-Leserecht; Folge: CRM-Ereignisse nur mit crm.read (N-cx-03). |
| C-A40 | Delegated mailbox managers can redirect saved credentials to another server | Duplikat, bereits behoben | A2a-01, A4-01 | erledigt (Register) | – |  |
| C-A41 | A stolen server session can remove or replace the enrolled MFA factor | Duplikat, bereits behoben | A1-06 | erledigt (Register) | – |  |
| C-A42 | Scheduled mail silently drops selected PGP encryption and signing | Duplikat, bereits behoben | A5-03 | erledigt (Register) | – |  |
| C-A43 | CRM CSV exports preserve spreadsheet formula syntax in user-controlled text | Duplikat, bereits behoben | A6-07 | erledigt (Register) | – |  |
| C-A44 | Read-only mailbox delegates can change account credentials, connection settings and message state | Teilweise (Rest behoben) | A7-03 | BEHOBEN | `0771bd8` | Explizite rw-Stufen an allen mutierenden Kanälen; Akteur-Revalidierung beim geplanten Versand: G6. |
| C-A45 | WebSocket events disclose workflow and automation metadata denied by HTTP routes | Neu, bestätigt | – | BEHOBEN | `13d71fd` | Nicht-Mail-Ereignisse nur mit REST-Leserecht; Folge: CRM-Ereignisse nur mit crm.read (N-cx-03). |
| C-A46 | A mailbox backlog can exhaust server memory during IMAP synchronization | Duplikat, bereits behoben | A5-08 | erledigt (Register) | – |  |
| C-A47 | Desktop workflow authoring and backfill/webhook triggers lack privileged authorization | Teilweise (Rest behoben) | A7-01, A9-13, N-ds-02 | BEHOBEN | `aa968e7` | G1: Workflow- und Wissensbasis-Bearbeitung auf dem Desktop nur Owner/Admin; revidiert F-A7-01. Autor-Recheck beim Cron-Feuern bräuchte eine Migration (nicht umgesetzt). |
| C-A48 | An already-used TOTP can complete another login challenge | Duplikat, bereits behoben | A1-12 | erledigt (Register) | – |  |
| C-A49 | Desktop object-ID operations bypass mailbox ownership checks | Teilweise (Rest behoben) | A7b-06, A7-03 | BEHOBEN | `27a4755` | Objekt-IDs lösen ihr Konto auf, Unauflösbares nur Owner/Admin; Server-Parität N-cx-02. |
| C-A50 | Deleting an account can erase another mailbox's attachments | Duplikat, bereits behoben | A7b-07 | erledigt (Register) | – |  |
| C-A51 | Unprivileged desktop users can redirect scanned mail to an external server | Neu, bestätigt | – | BEHOBEN | `5942070` | Parität zum Server: Rspamd-URL ändern und testen nur Owner/Admin. |
| C-A52 | Read-only desktop mailbox grants permit composing and sending mail | Teilweise (Rest behoben) | A7-03 | BEHOBEN | `24afc01` `0771bd8` | Explizite rw-Stufen an allen mutierenden Kanälen; geplanter Versand prüft vor SMTP das Schreibrecht des Planenden (G6). |
| C-A53 | Global OAuth and webhook secrets are readable and replaceable by ordinary desktop users | Teilweise (Rest behoben) | N-ds-02, A7-08 | BEHOBEN | `09417d0` | FireWebhookWorkflow per IPC nur Owner/Admin (Rest N-ds-02). |
| C-A54 | Optional LAN automation sends reusable API keys over plaintext HTTP | By-Design | – | By-Design | – | LAN-Automation ist Opt-in, Standard Loopback, nur Admin; TLS-Terminierung extern dokumentiert. |
| C-A55 | Backup verification evaluates restored database objects as administrator | Neu, bestätigt | – | BEHOBEN | `d63dcc4` `e7e466a` | G9: Restore/Drill als eingeschränkte Rolle; Metadatenprüfung nur echte Tabellen, pg_catalog-qualifiziert. |
| C-A56 | A valid embedded PGP block authenticates unrelated displayed content | Teilweise (Rest behoben) | A5-09, A7b-08 | BEHOBEN | `98c116c` |  |
| C-A57 | A user manager in another workspace can prevent an existing user's login | By-Design | – | By-Design | – | Ein zweiter Workspace lässt sich im Produkt nicht anlegen (LEARNINGS_AUTH). |
| C-A58 | Restricted mail delegation managers can revoke broader bindings | Neu, bestätigt | – | BEHOBEN | `1823c92` |  |
| C-A59 | Mail synchronization retains unbounded aggregate message data | Teilweise (Rest behoben) | A5-08 | BEHOBEN | `c4656f1` |  |
| C-A60 | Tracked relay mail can turn a display name into an unauthorized sender | Neu, bestätigt | – | BEHOBEN | `f6fba25` |  |
| C-A61 | Restore and restore-drill execute supplied dump SQL in superuser sessions | Neu, bestätigt | – | BEHOBEN | `d63dcc4` | G9: Restore/Drill als eingeschränkte Rolle; Metadatenprüfung nur echte Tabellen, pg_catalog-qualifiziert. |
| C-A62 | Inbound ID substrings can merge unrelated desktop conversations | Neu, bestätigt | – | BEHOBEN | `b3a25a2` `436afed` | Exakter Token-Vergleich (Desktop) und gemeinsame Plausibilitätsprüfung für Message-IDs in beiden Editionen. |
| C-A63 | Workflow graph compilation permits exponential synchronous traversal | Neu, bestätigt | – | BEHOBEN | `e3ad18d` |  |
| C-A64 | Workflow previews can perform live category changes and enqueue AI jobs | Neu, bestätigt | – | BEHOBEN | `5d7ddf5` | Server-Dry-Run fail-closed; mssql.query/jtl.order_context bewusst live (G11). |
| C-A65 | Desktop mail and whole-installation backup operations bypass authorization | Teilweise (Rest behoben) | A7b-01, A7-03, A7b-06 | BEHOBEN | `27a4755` | Objekt-IDs lösen ihr Konto auf, Unauflösbares nur Owner/Admin; Server-Parität N-cx-02. |
| C-A66 | SMTP connection tests lose the enabled TLS requirement | Teilweise (Rest behoben) | A7b-09, A4-03 | BEHOBEN | `f14a28f` | G10: optionales tls-Feld erzwingt STARTTLS im Ad-hoc-Test. |
| C-A67 | Colliding legacy account IDs disclose a different mailbox identity | Neu, bestätigt | – | BEHOBEN | `b512d03` |  |
| C-A68 | Unbounded SMTP responses can exhaust the server process | Teilweise (Rest behoben) | A4-06 | BEHOBEN | `5f0261b` `991cf68` |  |
| C-A69 | Message-less webhook workflows skip draft-target authorization | Neu, bestätigt | – | BEHOBEN | `68f3c76` |  |
| C-A70 | GDPR export exposes message snippets without content-read permission | Duplikat, bereits behoben | A2a-03 | erledigt (Register) | – |  |
| C-A71 | Default CID image expansion bypasses inbound message size limits | Neu, bestätigt | – | BEHOBEN | `f62764b` |  |
| C-A72 | Desktop administrators can assign themselves owner authority | Neu, bestätigt | A2b-05 | BEHOBEN | `35a7aa6` `77183bb` `56e1721` `5605170` `da53f3c` `ff4dd01` | G3: Owner-Verwaltung nur durch Owner (beide Editionen), Last-Owner-Schutz Desktop, Owner-Einladungen, Desktop-Sessions. |
| C-A73 | DMARC ingestion lacks a cumulative expanded-data budget | Teilweise (Rest behoben) | A3b-01, A3b-03 | BEHOBEN | `a62f6dd` | Ergänzt E13: Anhangs-, Entpack- und Record-Budget je Mail. |
| C-A74 | Failed logout leaves authenticated UI and refresh timer active | Duplikat, bereits behoben | A11b-07 | erledigt (Register) | – | Codex schlug „immer lokal abmelden“ vor; entschieden per E34 (lokal nur bei Erfolg oder 401). |
| C-A75 | Untrusted Authentication-Results headers can become verified mail-security state | Teilweise (Rest behoben) | A5-12 | BEHOBEN | `aee5a40` | G8: nur das oberste Authentication-Results-Feld zählt. |
| C-A76 | Workflow read-only MSSQL guards allow SELECT INTO writes | Neu, bestätigt | – | BEHOBEN | `8d2622d` `0401bbe` | Validator gehärtet (beide Editionen); mssql.query liest im Server-Dry-Run weiter live (G11, dokumentiert: nur db_datareader). |
| C-A77 | PGP decrypt operations permit unbounded compressed message expansion | Duplikat, bereits behoben | A13A14-05 | erledigt (Register) | – |  |
| C-A78 | Desktop mail IPC skips authorization for unresolved target objects | Teilweise (Rest behoben) | A7-03, A7b-06 | BEHOBEN | `27a4755` | Objekt-IDs lösen ihr Konto auf, Unauflösbares nur Owner/Admin; Server-Parität N-cx-02. |
| C-A79 | Compose operations use a reply parent without authorizing its account | Neu, bestätigt | – | BEHOBEN | `85a9204` | G5: Elternbezug nur mit Leserecht am Elternkonto, „erledigt“ nur mit rw. |
| C-A80 | POP3 size limits apply after an unbounded line is buffered | Teilweise (Rest behoben) | A4-06 | BEHOBEN | `2991cbb` `ae70574` |  |
| C-A81 | SMTP sending and connection probes accept unbounded server responses | Teilweise (Rest behoben) | A4-06 | BEHOBEN | `2991cbb` `5f0261b` `991cf68` |  |
| C-A82 | Small workflow graphs can exhaust synchronous API compilation | Neu, bestätigt | – | BEHOBEN | `e3ad18d` |  |
| C-B1 | A desktop viewer can schedule executable workflows without administrator rights | Teilweise (Rest behoben) | A7-01, A9-13 | BEHOBEN | `aa968e7` | G1: Workflow- und Wissensbasis-Bearbeitung auf dem Desktop nur Owner/Admin; revidiert F-A7-01. Autor-Recheck beim Cron-Feuern bräuchte eine Migration (nicht umgesetzt). |
| C-B2 | Desktop connection tests disclose stored mailbox credentials to a user-selected server | Neu, bestätigt | A2a-01, A4-01 | BEHOBEN | `231b747` | Verbindungstests nur Owner/Admin (Vervollständigung von E16, auch in der UI). |
| C-B3 | Password changes and administrative password resets leave existing sessions valid | Teilweise (Rest behoben) | A1-02 | BEHOBEN | `cb969f9` | Race zwischen Passwortwechsel und Refresh/Login/MFA geschlossen (Rest F-A1-02). |
| C-B4 | Desktop resource-scope gaps allow cross-account mail actions and account deletion | Teilweise (Rest behoben) | A7-03, A7b-06 | BEHOBEN | `27a4755` | Objekt-IDs lösen ihr Konto auf, Unauflösbares nur Owner/Admin; Server-Parität N-cx-02. |
| C-B5 | Workspace event replay bypasses the admin restriction on automation-key metadata | Neu, bestätigt | – | BEHOBEN | `13d71fd` | Nicht-Mail-Ereignisse nur mit REST-Leserecht; Folge: CRM-Ereignisse nur mit crm.read (N-cx-03). |
| C-B6 | Desktop workflow HTTP requests can follow redirects into blocked networks | Neu, bestätigt | – | BEHOBEN | `dde1661` |  |
| C-B7 | A stale message policy can enable external resources in a different, blocked email | Neu, bestätigt | – | BEHOBEN | `6c693e4` |  |
| C-B8 | Automatic DOCX indexing can exhaust the mail application's memory | Teilweise (Rest behoben) | A5-04, A13A14-03, A7b-12 | BEHOBEN | `69ed919` `d1e85a2` | G7: DOCX im Worker mit 512-MB-Heap und Timeout; Server markiert vor dem Parse. PDF bleibt im Hauptprozess. |
| C-B9 | Windows path separators bypass draft attachment authorization | Neu, bestätigt | – | BEHOBEN | `fc497e8` |  |
| C-B10 | Customer and product update keys become executable SQLite syntax | Duplikat, bereits behoben | A10-02, A6-02, N-ds-01 | erledigt (Register) | – |  |
| C-B11 | Restricted desktop users can export installation-wide data and replace the database | Duplikat, bereits behoben | A7b-01, A7-04 | erledigt (Register) | – |  |
| C-B12 | Backup inspection decompresses an unlimited manifest into Electron memory | Neu, bestätigt | – | BEHOBEN | `85fb167` |  |
| C-B13 | Dashboard and follow-up reveal tasks hidden by assignment permissions | Duplikat, bereits behoben | A10-03, A2b-02, A2b-03 | erledigt (Register) | – |  |
| C-B14 | Follow-up snooze can modify a task outside the caller's assignment | Duplikat, bereits behoben | A2b-04 | erledigt (Register) | – |  |
| C-B15 | Customer CSV exports preserve attacker-controlled spreadsheet formulas | Duplikat, bereits behoben | A6-07 | erledigt (Register) | – |  |
| C-B16 | Desktop agents can redirect global integrations and expose their secrets or mail | Teilweise (Rest behoben) | N-ds-02, A7-08, A4-02 | BEHOBEN | `5942070` `f924088` | KI-Key-Umleitung und Rspamd-URL wie Server behoben; eine pauschale Owner/Admin-Pflicht für KI- und Spam-Einstellungen wurde nicht umgesetzt (Rechteentzug ohne Freigabe). |
| C-B17 | Read-only mailbox access permits endpoint and OAuth credential changes | Teilweise (Rest behoben) | A7-03 | BEHOBEN | `c74dc75` |  |
| C-C1 | Follow-up and dashboard bypass private task permissions | Duplikat, bereits behoben | A10-03, A2b-02, A2b-03, A2b-04 | erledigt (Register) | – |  |
| C-C2 | CRM readers can alter returns when the exported returns port is wired | Neu, bestätigt | – | BEHOBEN | `26cedb9` |  |
| C-C3 | Incoming DOCX attachments can exhaust memory during automatic indexing | Teilweise (Rest behoben) | A5-04, A13A14-03, A7b-12 | BEHOBEN | `69ed919` `d1e85a2` | G7: DOCX im Worker mit 512-MB-Heap und Timeout; Server markiert vor dem Parse. PDF bleibt im Hauptprozess. |
| C-C4 | Allowed workflow endpoints can redirect desktop requests into private networks | Neu, bestätigt | – | BEHOBEN | `dde1661` |  |
| C-C5 | Large workflow HTTP responses can exhaust desktop memory | Neu, bestätigt | – | BEHOBEN | `71e2d40` |  |
| C-C6 | Customer patch keys let scoped automation clients read other SQLite data | Duplikat, bereits behoben | A10-02, A6-02, N-ds-01 | erledigt (Register) | – |  |
| C-C7 | Non-admin event subscribers receive protected automation-key metadata | Neu, bestätigt | – | BEHOBEN | `13d71fd` | Nicht-Mail-Ereignisse nur mit REST-Leserecht; Folge: CRM-Ereignisse nur mit crm.read (N-cx-03). |
| C-C8 | A stale policy response can load remote images for a blocked message | Neu, bestätigt | – | BEHOBEN | `6c693e4` |  |
| C-C9 | Mail mutation responses disclose protected attachment paths and reply-parent IDs | Neu, bestätigt | – | BEHOBEN | `edda382` |  |
| C-C10 | Mail-backup verification inflates the manifest without a memory limit | Neu, bestätigt | – | BEHOBEN | `85fb167` |  |
| C-C11 | Workflow dry-runs can execute data-changing SELECT INTO statements | Neu, bestätigt | – | BEHOBEN | `8d2622d` `0401bbe` | Validator gehärtet (beide Editionen); mssql.query liest im Server-Dry-Run weiter live (G11, dokumentiert: nur db_datareader). |
