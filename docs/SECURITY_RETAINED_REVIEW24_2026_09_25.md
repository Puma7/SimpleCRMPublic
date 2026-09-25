# Erhaltene Hinweise aus dem abgebrochenen Deep-Security-Scan

Stand: 25.09.2026, Abbruch um 17:19:58 Uhr MESZ.

**Unvollständiger, nicht freigegebener Ergebnisanhang.** Dies ist eine strukturierte
Übernahme vorhandener Worker-Ergebnisse, kein neuer Scan und kein kanonischer
Abschlussbericht. Angaben, Einstufungen und Validierungsbehauptungen stammen
aus den genannten Zwischenergebnissen. Sie wurden für diesen Anhang nicht erneut
reproduziert, nicht unabhängig bestätigt und nicht gegen den letzten PR-Stand
abgeglichen. Deshalb sind sie als offene Prüfhypothesen zu behandeln.

Anhang A enthält 82 Einträge der letzten abgeschlossenen Zusammenführung;
Anhang B und C enthalten zwei noch nicht eingearbeitete Einzelprüfungen mit
17 beziehungsweise 11 Einträgen. Dieses Dokument ist einer dieser drei Teile.
Diese Gruppen können dieselben Ursachen mehrfach enthalten. **Ihre Zeilenzahlen
dürfen nicht als Anzahl unterschiedlicher Sicherheitslücken addiert werden.**

Quellzeilen beziehen sich auf den Ausgangsstand und können im PR abweichen.
Tatsächlich implementierte Änderungen stehen im
[Hauptbericht](SECURITY_STABILITY_REVIEW_2026_09_25.md).

Übernommen werden Kennung, Titel, gemeldete Schwere/Sicherheit, Beschreibung,
Quellorte, Ursachenbeschreibung, Validierungszusammenfassung und deren Grenzen,
Gegenbelege, vorgeschlagene Korrektur und vorgeschlagene Regressionstests.
Verschachtelte interne Historien, doppelte Rohbelege, lokale Benutzerpfade und
Angriffsskripte werden nicht veröffentlicht. Originaldateien bleiben lokal
erhalten. Vorgeschlagene Tests sind keine ausgeführten Tests.

Eine weitere Untersuchung oder Wiederaufnahme benötigt einen neuen Auftrag
mit begrenztem Umfang. Es wurde keine automatische Fortsetzung eingerichtet.


## Noch nicht eingearbeitete Einzelprüfung 24

Quelle: workers/discovery-0024/output/result.json. Einträge: 11.

| Nr. | Worker-Kennung | Titel | Worker-Einstufung |

|---|---|---|---|

| 1 | broken-access-control.task-assignment | Follow-up and dashboard bypass private task permissions | low |

| 2 | missing-authorization.returns-write | CRM readers can alter returns when the exported returns port is wired | low |

| 3 | decompression-bomb.docx-indexing | Incoming DOCX attachments can exhaust memory during automatic indexing | high |

| 4 | ssrf.desktop-workflow-redirect | Allowed workflow endpoints can redirect desktop requests into private networks | low |

| 5 | resource-exhaustion.desktop-http-body | Large workflow HTTP responses can exhaust desktop memory | medium |

| 6 | sql-injection.automation-customer-columns | Customer patch keys let scoped automation clients read other SQLite data | medium |

| 7 | missing-authorization.automation-key-events | Non-admin event subscribers receive protected automation-key metadata | low |

| 8 | privacy.remote-content-policy-race | A stale policy response can load remote images for a blocked message | low |

| 9 | missing-redaction.mail-mutation-responses | Mail mutation responses disclose protected attachment paths and reply-parent IDs | low |

| 10 | resource-exhaustion.backup-manifest | Mail-backup verification inflates the manifest without a memory limit | low |

| 11 | improper-validation.mssql-readonly-query | Workflow dry-runs can execute data-changing SELECT INTO statements | low |

### 1. Follow-up and dashboard bypass private task permissions

Worker-Kennung: broken-access-control.task-assignment.

**Status:** offen; keine Behauptung einer Behebung im PR.

**Gemeldete Einstufung:**

- **level**: low
- **rationale**: Confidentiality and reminder-integrity impact is confined to authenticated users within one workspace; downgraded for same-tenant scope. No cross-workspace or administrative access established.

**Gemeldete Nachweissicherheit:**

- **level**: high
- **rationale**: Independently traced registered routes through production-wired ports, task visibility predicate, workspace-only RLS and concrete SELECT/UPDATE operations.

**Beschreibung:**

Workspace users can read task titles and customer/date metadata hidden by task assignment permissions. Users with crm.write can also snooze another user's inaccessible task through the follow-up endpoint.

**Quellorte des Ausgangsstands:** `packages/server/src/api/follow-up-routes.ts:46`, `packages/server/src/db/postgres-follow-up-port.ts:163`, `packages/server/src/db/postgres-follow-up-port.ts:240`, `packages/server/src/db/postgres-dashboard-port.ts:129`, `packages/server/src/api/dashboard-routes.ts:41`, `packages/server/src/db/postgres-follow-up-port.ts:38`, `packages/server/src/db/postgres-dashboard-port.ts:63`

**Gemeldete Ursache:**

Normal task operations carry a TaskViewer and enforce global/self/group assignment visibility. Follow-up and dashboard interfaces omit that viewer and query using workspace identity only. The same omission lets follow-up snooze update any task ID in the workspace; transaction userId does not supply assignment authorization because task RLS checks only workspace access.

**Prüfmethode laut Worker:**

independent static source trace

**Validierungszusammenfassung laut Worker:**

crm.read permits the two read routes. Follow-up accepts any nonempty queue; an unrecognized queue avoids date/snooze filtering and pagination enumerates all unfinished tasks. Dashboard returns up to 25. crm.write permits snooze, whose UPDATE lacks taskVisibilityExpression. server.ts:650,701 wires both real ports; ordinary task PATCH applies the missing predicate.

**Grenzen laut Worker:**

- Source-only validation; no application or database execution.
- Private task assignments and a lower-privilege same-workspace user are prerequisites.

**Vorgeschlagene Korrektur, nicht als umgesetzt bestätigt:**

Carry TaskViewer through all follow-up/dashboard task operations and reuse taskVisibilityExpression for reads, counts and snooze updates. Reject unsupported queue names.

**Vorgeschlagene Regressionstests, nicht als ausgeführt bestätigt:**

- A task assigned to another user/group remains absent from follow-up, dashboard and counts.
- Snooze of an inaccessible task fails without changing its timestamps.
- Global, self/group-visible tasks and administrator access remain functional.

### 2. CRM readers can alter returns when the exported returns port is wired

Worker-Kennung: missing-authorization.returns-write.

**Status:** offen; keine Behauptung einer Behebung im PR.

**Gemeldete Einstufung:**

- **level**: low
- **rationale**: Conditional, authenticated same-workspace integrity violation in exported composition; default startup is not affected and no payment execution is established.

**Gemeldete Nachweissicherheit:**

- **level**: high
- **rationale**: The conditional exported API boundary and database sink are source-proven; default startup is explicitly not exposed.

**Beschreibung:**

In a composition using the exported server API and returns port, a user with crm.read but without crm.write can create and alter returns. The current default server does not wire the returns port and returns 503.

**Quellorte des Ausgangsstands:** `packages/server/src/api/returns-routes.ts:203`, `packages/server/src/db/postgres-returns-port.ts:327`

**Gemeldete Ursache:**

The dispatcher requires crm.read for returns. Both create and update handlers accept any authenticated principal passing that gate, parse the body, and call database methods with workspaceId. Those methods execute under a system workspace role; they never enforce crm.write before inserting or updating return data.

**Prüfmethode laut Worker:**

independent static source trace

**Validierungszusammenfassung laut Worker:**

A role=user principal granted only crm.read passes the central gate. Valid POST/PATCH bodies reach the real returns port, whose transaction enforces workspace identity only. The sibling write guard does not run. Portal settings remain admin-only and do not cover these mutations. Parent startup validation shows default startup omits returns/returnReasons/returnsPortalSettings and returns 503. This is retained solely for the exported API/library composition, a valid caller-controlled boundary; it is not a default deployment vulnerability.

**Grenzen laut Worker:**

- No runtime reproduction or production deployment inspection.
- No cross-workspace access or financial transaction impact claimed.
- Default production reachability rejected: the returns port must be explicitly supplied by a consumer of the exported API.

**Vorgeschlagene Korrektur, nicht als umgesetzt bestätigt:**

Require rejectUnlessCrmWrite(principal) before both authenticated return mutations. Preserve the separate token-gated public portal behavior.

**Vorgeschlagene Regressionstests, nicht als ausgeführt bestätigt:**

- Verify a crm.read-only principal receives 403 on return POST and PATCH and the ports are not invoked.
- Verify crm.write and administrator principals retain access.

### 3. Incoming DOCX attachments can exhaust memory during automatic indexing

Worker-Kennung: decompression-bomb.docx-indexing.

**Status:** offen; keine Behauptung einer Behebung im PR.

**Gemeldete Einstufung:**

- **level**: high
- **rationale**: High availability impact through automatic ingestion of untrusted external mail. Both editions process archives in the application process, and forged metadata bypasses the server's apparent expansion limit.

**Gemeldete Nachweissicherheit:**

- **level**: high
- **rationale**: Independent static validation of sync enqueue, actual parser calls and locally installed Mammoth 1.12.0, JSZip 3.10.1 and yauzl 3.4.0 implementation; no runtime bomb executed.

**Beschreibung:**

An external sender can deliver a small highly compressed DOCX that expands without an effective byte limit during automatic text extraction, potentially terminating the server or Electron main process without the recipient opening it.

**Quellorte des Ausgangsstands:** `packages/server/src/mail-attachment-text.ts:109`, `electron/email/attachment-text-extract.ts:92`, `packages/server/src/mail-sync.ts:2066`, `electron/email/email-message-attachments-store.ts:160`

**Gemeldete Ursache:**

Sender-controlled DOCX bytes are automatically queued. The desktop calls Mammoth directly; the server first trusts central-directory uncompressedSize values. For deflated entries yauzl metadata enumeration does not inflate or verify actual output. Mammoth asks JSZip to accumulate full inflated entries; JSZip detects size mismatch only at end, after memory has already been consumed. The final text cap and promise timeout cannot bound or cancel that allocation.

**Prüfmethode laut Worker:**

independent static source and installed dependency trace

**Validierungszusammenfassung laut Worker:**

Both wrappers enforce a 15 MiB compressed-file cap and a 30-second noncancelling timeout. A deflated DOCX XML entry with forged-small declared size passes the server's 32 MiB metadata total check. yauzl:index.js:411-424 verifies sizes at enumeration only for stored entries; JSZip zipEntry.js:62-96 uses central values, then compressedObject.js checks only at stream end. StreamHelper retains all chunks before that point.

**Grenzen laut Worker:**

- No exploit input generated or executed; exact failure threshold depends on available memory and runtime.
- Mammoth/JSZip/yauzl behavior verified from installed versions and repository dependency context, not external advisories.

**Vorgeschlagene Korrektur, nicht als umgesetzt bestätigt:**

Enforce per-entry and aggregate limits on actual inflated bytes before passing DOCX contents to Mammoth; abort decompression at the limit. Use a killable resource-limited parser process for both editions.

**Vorgeschlagene Regressionstests, nicht als ausgeführt bestätigt:**

- Reject a safely bounded fixture whose actual deflate output exceeds its declared size before retaining more than the configured byte budget.
- Verify per-entry, aggregate and timeout termination limits in both desktop and server extractors.

### 4. Allowed workflow endpoints can redirect desktop requests into private networks

Worker-Kennung: ssrf.desktop-workflow-redirect.

**Status:** offen; keine Behauptung einer Behebung im PR.

**Gemeldete Einstufung:**

- **level**: low
- **rationale**: Requires influence over an already permitted endpoint and an executing desktop workflow; target-service impact is conditional and unproven. Direct private destinations are blocked, so this is a constrained bypass.

**Gemeldete Nachweissicherheit:**

- **level**: high
- **rationale**: Source shows initial-only validation, discarded DNS addresses and ordinary fetch with automatic redirects; no network reproduction performed.

**Beschreibung:**

A public endpoint permitted by a desktop workflow can redirect the application's request to a private or loopback destination. DNS validation is also separate from the actual fetch connection.

**Quellorte des Ausgangsstands:** `electron/workflow/nodes/integration-nodes.ts:104`, `electron/workflow/http-request-guard.ts:22`

**Gemeldete Ursache:**

The HTTP node validates only the starting URL and its current DNS answers. It then calls fetch independently, which can resolve DNS again and follow redirects without applying the same allowlist/private-address checks to the final destination.

**Prüfmethode laut Worker:**

independent static trace

**Validierungszusammenfassung laut Worker:**

Initial direct private URLs and private DNS answers are rejected, but the guard returns no validated addresses and fetch options contain neither a pinned transport nor manual/error redirect mode. Later response content is assigned to http.body. Server workflow and desktop automation-webhook implementations are separate and do not repair this caller.

**Grenzen laut Worker:**

- Requires configured allowlist and execution of the desktop HTTP node.
- No requests made; no particular local service compromise or returned-secret exfiltration established.

**Vorgeschlagene Korrektur, nicht als umgesetzt bestätigt:**

Use a transport that pins validated DNS addresses and disables automatic redirects. Revalidate and pin each supported redirect hop.

**Vorgeschlagene Regressionstests, nicht als ausgeführt bestätigt:**

- A redirect from an allowed public endpoint to loopback/private/disallowed hosts is rejected before connecting.
- Changing DNS answers between validation and connection cannot select an unvalidated address.

### 5. Large workflow HTTP responses can exhaust desktop memory

Worker-Kennung: resource-exhaustion.desktop-http-body.

**Status:** offen; keine Behauptung einer Behebung im PR.

**Gemeldete Einstufung:**

- **level**: medium
- **rationale**: Potential application-process availability loss, with medium likelihood because a configured executing workflow must contact an attacker-influenced permitted endpoint.

**Gemeldete Nachweissicherheit:**

- **level**: high
- **rationale**: The exact caller uses res.text() before slice; request timeout imposes no byte budget.

**Beschreibung:**

A permitted workflow endpoint can send a response that Electron buffers completely before truncating its stored output, allowing excessive memory consumption in the main process.

**Quellorte des Ausgangsstands:** `electron/workflow/nodes/integration-nodes.ts:110`

**Gemeldete Ursache:**

The node limits elapsed fetch time and final workflow output length, but it never bounds streamed response bytes. res.text() allocates the full response in the privileged desktop process before truncation.

**Prüfmethode laut Worker:**

independent static trace

**Validierungszusammenfassung laut Worker:**

The URL allowlist controls the initial destination, not response size. A permitted endpoint controls body size and encoding. The 30-second AbortSignal is a deadline, and slicing after res.text() cannot prevent prior allocation.

**Grenzen laut Worker:**

- No large response or application code executed.
- Exact process failure threshold depends on available memory and transfer rate.

**Vorgeschlagene Korrektur, nicht als umgesetzt bestätigt:**

Read the response incrementally with a strict decoded byte budget and cancel the response as soon as it exceeds the limit. Reuse the bounded server HTTP implementation where appropriate.

**Vorgeschlagene Regressionstests, nicht als ausgeführt bestätigt:**

- Oversized streamed responses stop at the byte cap before full allocation.
- Small responses still populate bounded http.body output.

### 6. Customer patch keys let scoped automation clients read other SQLite data

Worker-Kennung: sql-injection.automation-customer-columns.

**Status:** offen; keine Behauptung einer Behebung im PR.

**Gemeldete Einstufung:**

- **level**: medium
- **rationale**: High confidentiality impact across the local SQLite database, but exploitation requires the optional API to be enabled, a valid write-scoped credential and network/local API reachability. The default listener is loopback.

**Gemeldete Nachweissicherheit:**

- **level**: high
- **rationale**: Static trace verifies raw JSON keys reach SET syntax, SQLite readback returns the result, and installed better-sqlite3 named binding only consumes parameters present in the prepared statement.

**Beschreibung:**

An automation client with CRM write scope can inject SQL through customer JSON property names and copy mailbox or other database content into the returned customer record, bypassing separate API scopes.

**Quellorte des Ausgangsstands:** `electron/sqlite-service.ts:2113`, `electron/automation/handlers.ts:123`

**Gemeldete Ursache:**

PATCH forwards the parsed JSON object through CustomerService.update. updateCustomer excludes only id and jtl_kKunde, then inserts each remaining key directly into SQL as an assignment identifier and parameter name. A key can therefore alter SET syntax to use a subquery while SQL comments remove the generated assignment suffix. The subsequent bound WHERE and customer readback preserve a path from unauthorized SQLite reads to the response.

**Prüfmethode laut Worker:**

independent static source and native-binding review

**Validierungszusammenfassung laut Worker:**

The HTTP route enforces only write scope and does not use IPC schemas. The service has no column allowlist. The SQL contains a new line before its bound WHERE clause, allowing a malformed SET key to change an expression without requiring stacked statements. Native Binder::BindObject consumes only compiled named parameters, so extra JSON keys do not reject the statement. Customer creation uses fixed columns and deal updates use an explicit allowlist, which do not protect this update path.

**Grenzen laut Worker:**

- No SQL payload, application code or live API was executed.
- Requires an existing customer and valid restricted automation credential; no unauthenticated exposure claimed.

**Vorgeschlagene Korrektur, nicht als umgesetzt bestätigt:**

Map only a fixed allowlist of writable customer fields to trusted SQL identifiers and reject unknown keys before building the statement. Keep all values parameterized.

**Vorgeschlagene Regressionstests, nicht als ausgeführt bestätigt:**

- Malformed and unknown property names are rejected without executing SQL or modifying a customer.
- A write-only automation key cannot retrieve mailbox content through customer mutations.
- Normal allowed customer fields and custom-field updates remain supported.

### 7. Non-admin event subscribers receive protected automation-key metadata

Worker-Kennung: missing-authorization.automation-key-events.

**Status:** offen; keine Behauptung einer Behebung im PR.

**Gemeldete Einstufung:**

- **level**: low
- **rationale**: Same-workspace credential metadata disclosure; no raw API-key value or direct privilege escalation.

**Gemeldete Nachweissicherheit:**

- **level**: high
- **rationale**: Independent static trace of admin guard, publication payload, persisted replay and non-mail event pass-through.

**Beschreibung:**

Authenticated workspace users can receive automation-key labels, scopes and status through live WebSocket events and replay even though the equivalent HTTP metadata endpoints require an administrator.

**Quellorte des Ausgangsstands:** `packages/server/src/mail-access/async-policy-enforcer.ts:1110`, `packages/server/src/api/automation-routes.ts:183`, `packages/server/src/api/fastify-adapter.ts:350`

**Gemeldete Ursache:**

Automation-key mutations publish administrator-only metadata to the workspace event stream. The common filter enforces mail policies and reduces selected CRM payloads, but automation_api_key is neither category. Recognized event types without a mail policy are returned intact, including in persisted replay.

**Prüfmethode laut Worker:**

independent static source trace

**Validierungszusammenfassung laut Worker:**

HTTP list/detail guards prove the intended confidentiality boundary. Production wires the event and automation-key ports. WebSocket admission requires a current principal, not admin; same-workspace events pass through filterMailEventForPrincipal. automation_api_key.created/revoked are registered and excluded from CRM reduction and mail policies.

**Grenzen laut Worker:**

- No WebSocket session or runtime reproduction performed.
- Only retained creation/revocation events disclose the corresponding keys.

**Vorgeschlagene Korrektur, nicht als umgesetzt bestätigt:**

Apply an explicit owner/admin-only event policy to automation_api_key.created and automation_api_key.revoked for both live and replay delivery.

**Vorgeschlagene Regressionstests, nicht als ausgeführt bestätigt:**

- Non-admin live/replay subscribers receive neither automation-key event type.
- Administrator subscribers retain expected events; raw secrets remain absent.

### 8. A stale policy response can load remote images for a blocked message

Worker-Kennung: privacy.remote-content-policy-race.

**Status:** offen; keine Behauptung einer Behebung im PR.

**Gemeldete Einstufung:**

- **level**: low
- **rationale**: Limited privacy disclosure with timing and user-interaction prerequisites; script execution and mailbox-content disclosure are not established.

**Gemeldete Nachweissicherheit:**

- **level**: high
- **rationale**: Static React closure and state-consumer trace establishes a permitted out-of-order completion.

**Beschreibung:**

The shared message viewer can apply an earlier message's allowRemote result to the currently selected message. If the recipient displays its HTML, remote tracking images can load despite that message's blocking policy.

**Quellorte des Ausgangsstands:** `src/components/email/message-viewer.tsx:380`, `src/components/email/email-html-frame.tsx:22`

**Gemeldete Ursache:**

Asynchronous policy results update one component-wide boolean using a comparison against the same stale selectedMessage captured when the request started. The old request remains active after selection changes.

**Prüfmethode laut Worker:**

independent static source and state-lifetime review

**Validierungszusammenfassung laut Worker:**

Checked the selection reset, async effect, sanitizer, frame CSP and unkeyed parent component. The body-loading effect has cancellation, but the policy effect does not.

**Grenzen laut Worker:**

- No UI race reproduced at runtime.
- Exposure requires out-of-order requests and HTML display.

**Vorgeschlagene Korrektur, nicht als umgesetzt bestätigt:**

Cancel stale policy effects or attach policy state to its message ID and only apply it when that ID equals the current selected message. Gate HTML rendering on a policy result for that exact message.

**Vorgeschlagene Regressionstests, nicht als ausgeführt bestätigt:**

- Resolve A's allowed policy after switching to blocked B and after B's deny result; B must keep data-only CSP and blocked image URLs.
- Confirm normal explicit remote-content permission still works for the selected message.

### 9. Mail mutation responses disclose protected attachment paths and reply-parent IDs

Worker-Kennung: missing-redaction.mail-mutation-responses.

**Status:** offen; keine Behauptung einer Behebung im PR.

**Gemeldete Einstufung:**

- **level**: low
- **rationale**: Same-workspace metadata disclosure. Attachment bytes and hidden-message bodies remain separately protected.

**Gemeldete Nachweissicherheit:**

- **level**: high
- **rationale**: Independent source trace confirms the scoped HTTP wrapper, database RETURNING columns and fail-open mapper flags.

**Beschreibung:**

Draft edits and the related triage mutation responses apply only content-read redaction. They omit the independent attachment-read and reply-parent-visibility checks used by normal reads, disclosing filenames/storage paths and hidden parent IDs to scoped delegates.

**Quellorte des Ausgangsstands:** `packages/server/src/mail-access/http-policy-enforcer.ts:439`, `packages/server/src/db/postgres-mail-read-ports.ts:1327`, `packages/server/src/db/postgres-mail-read-ports.ts:5541`

**Gemeldete Ursache:**

HTTP mutation wrappers inject mailContentScope but no attachment or parent scope. Draft and triage ports return summary/detail columns including draft_attachment_paths_json and reply_parent_message_id. mapEmailMessageRow assumes missing independent flags represent unrestricted access.

**Prüfmethode laut Worker:**

independent static source trace with sibling-sink check

**Validierungszusammenfassung laut Worker:**

Confirmed GET/list independently calculate attachment and parent flags; mutations only calculate content_readable. Checked all four wrapper members and their RETURNING paths. Summary columns include both sensitive fields. Draft PATCH accepts an empty values object.

**Grenzen laut Worker:**

- No authenticated runtime requests performed.
- Requires independently restricted grants and stored metadata to disclose; not a cross-workspace break.

**Vorgeschlagene Korrektur, nicht als umgesetzt bestätigt:**

Resolve independent attachment-read and reply-parent visibility for every message-returning mutation. Prefer re-reading the updated message through the same scoped serializer/read path used by GET, or fail closed on absent visibility flags for restricted principals.

**Vorgeschlagene Regressionstests, nicht als ausgeführt bestätigt:**

- For draft.edit+content.read without attachment.read, compare GET and all supported mutation responses: attachment paths must remain null.
- For a visible child with a hidden cross-account reply parent, mutation responses must keep the parent ID null.
- Ensure authorized owners/admins and fully permitted delegates retain fields.

### 10. Mail-backup verification inflates the manifest without a memory limit

Worker-Kennung: resource-exhaustion.backup-manifest.

**Status:** offen; keine Behauptung einer Behebung im PR.

**Gemeldete Einstufung:**

- **level**: low
- **rationale**: High local availability impact but low likelihood because the recipient must select an attacker-supplied backup artifact. No automatic remote ingestion or persistent compromise is established.

**Gemeldete Nachweissicherheit:**

- **level**: high
- **rationale**: Complete static inspection of backup verification confirms unbounded stream accumulation before validation.

**Beschreibung:**

Selecting an untrusted mail-backup ZIP for verification can exhaust the desktop main process before restore approval: manifest.json is fully inflated, accumulated and converted to a string without a size limit.

**Quellorte des Ausgangsstands:** `electron/email/email-local-backup.ts:23`, `electron/email/email-local-backup.ts:75`

**Gemeldete Ursache:**

Backup preview trusts that manifest.json is small. readZipEntryText buffers every expanded byte without comparing the declared size to an application limit or enforcing an actual-byte limit.

**Prüfmethode laut Worker:**

independent static parser and caller review

**Validierungszusammenfassung laut Worker:**

Read the whole backup verifier and the restore inspection order. yauzl's size-equality validation does not cap a valid accurately declared large entry. Restore extraction budgets are reached only after manifest inspection.

**Grenzen laut Worker:**

- No oversized archive generated or executed.
- Actual crash threshold depends on process memory and archive size.

**Vorgeschlagene Korrektur, nicht als umgesetzt bestätigt:**

Reject oversized manifest entries before opening them, enforce a small actual-inflated-byte limit while streaming, destroy the stream/ZIP when exceeded, and bound archive entry count and inspection duration. Keep preview subject to the same resource limits as restore.

**Vorgeschlagene Regressionstests, nicht als ausgeführt bestätigt:**

- Verification and restore preview reject a declared oversized manifest before inflation.
- A stream exceeding the actual-byte cap is aborted even if archive metadata understates its size.
- Normal backups remain inspectable without invoking restore.

### 11. Workflow dry-runs can execute data-changing SELECT INTO statements

Worker-Kennung: improper-validation.mssql-readonly-query.

**Status:** offen; keine Behauptung einer Behebung im PR.

**Gemeldete Einstufung:**

- **level**: low
- **rationale**: Conditional integrity impact: requires delegated workflow editing/activation/run capabilities and an MSSQL account with CREATE TABLE and schema permissions. A truly read-only database credential prevents persistent table creation.

**Gemeldete Nachweissicherheit:**

- **level**: high
- **rationale**: Independent source trace confirms the accepted statement class, non-admin dry-run path, absent dry-run interception and direct SQL sink; deployment privileges remain unknown.

**Beschreibung:**

The shared MSSQL read-only validator accepts SELECT INTO, and MSSQL nodes execute during workflow dry-runs. A delegated workflow manager/editor with run permission can cause table creation and population using the configured database credential if that credential has the required SQL Server privileges.

**Quellorte des Ausgangsstands:** `packages/server/src/mssql-settings.ts:205`, `packages/server/src/api/workflow-routes.ts:548`, `packages/server/src/mssql-settings.ts:396`

**Gemeldete Ursache:**

The application treats a SELECT/WITH prefix and incomplete keyword denylist as proof that arbitrary T-SQL is read-only. SELECT INTO is a data-changing SELECT form. Since SQL nodes are assumed read-only, dry-runs call the real external database.

**Prüfmethode laut Worker:**

independent static source trace; no SQL executed

**Validierungszusammenfassung laut Worker:**

Read the full dry-run skip switch and route activation guards; SQL nodes are omitted and reach real execution. SELECT INTO lacks any forbidden token from the validator. Disabled workflows return early, which is included as a prerequisite.

**Grenzen laut Worker:**

- No database contacted and no statement executed.
- Configured SQL privileges and actual production delegation are unknown.
- Other T-SQL batch/DDL bypasses are not claimed.

**Vorgeschlagene Korrektur, nicht als umgesetzt bestätigt:**

Use a dedicated database credential with read-only grants as the security boundary. Parse and permit only a single supported read-only statement, explicitly excluding SELECT INTO; simulate SQL nodes or require an explicitly authorized external read during dry-run.

**Vorgeschlagene Regressionstests, nicht als ausgeführt bestätigt:**

- Reject data-changing SELECT INTO and mixed statements in both SQL node paths.
- Assert dry-run cannot cause external database writes even with a privileged test account.
- Retain valid single-statement read queries and enforce disabled-workflow behavior.

## Herkunft und KI-Autorenschaft

Die Ausgangsprüfungen wurden durch interne KI-Worker des Codex-Security-Plugins
erstellt. Der Scan-Kontext nennt gpt-6-astra mit Reasoning-Einstellung high;
das ist die gemeldete Scan-Konfiguration, kein Nachweis des exakten Builds jedes
Workers oder des schreibenden Hauptagenten.

OpenAI Codex hat diesen Anhang strukturiert, lokale Benutzerpfade entfernt und
die Aussagegrenzen ergänzt. Installierte CLI: codex-cli 0.155.0-alpha.16.4.
Exakte Modell-/Build-Kennung des Hauptagenten und Desktop-Agent-Version sind
nicht verifiziert. Keine menschliche Prüfung behauptet.
