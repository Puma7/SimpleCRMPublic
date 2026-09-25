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


## Noch nicht eingearbeitete Einzelprüfung 23

Quelle: workers/discovery-0023/output/result.json. Einträge: 17.

| Nr. | Worker-Kennung | Titel | Worker-Einstufung |

|---|---|---|---|

| 1 | authorization.desktop-workflow-execution | A desktop viewer can schedule executable workflows without administrator rights | medium |

| 2 | credential-disclosure.desktop-mail-test | Desktop connection tests disclose stored mailbox credentials to a user-selected server | medium |

| 3 | session-invalidation.password-change | Password changes and administrative password resets leave existing sessions valid | medium |

| 4 | authorization.desktop-mail-resource-ownership | Desktop resource-scope gaps allow cross-account mail actions and account deletion | medium |

| 5 | authorization.automation-key-events | Workspace event replay bypasses the admin restriction on automation-key metadata | low |

| 6 | ssrf.desktop-workflow-http | Desktop workflow HTTP requests can follow redirects into blocked networks | medium |

| 7 | privacy.remote-content-selection-race | A stale message policy can enable external resources in a different, blocked email | low |

| 8 | resource-exhaustion.docx-expansion | Automatic DOCX indexing can exhaust the mail application's memory | high |

| 9 | path-traversal.windows-draft-attachments | Windows path separators bypass draft attachment authorization | medium |

| 10 | sql-injection.desktop-automation-customer | Customer and product update keys become executable SQLite syntax | medium |

| 11 | authorization.desktop-full-backup | Restricted desktop users can export installation-wide data and replace the database | medium |

| 12 | resource-exhaustion.backup-manifest | Backup inspection decompresses an unlimited manifest into Electron memory | medium |

| 13 | authorization.task-read-surfaces | Dashboard and follow-up reveal tasks hidden by assignment permissions | low |

| 14 | authorization.task-snooze | Follow-up snooze can modify a task outside the caller's assignment | low |

| 15 | csv-injection.customer-export | Customer CSV exports preserve attacker-controlled spreadsheet formulas | low |

| 16 | authorization.desktop-global-integrations | Desktop agents can redirect global integrations and expose their secrets or mail | medium |

| 17 | authorization.desktop-mailbox-write-level | Read-only mailbox access permits endpoint and OAuth credential changes | medium |

### 1. A desktop viewer can schedule executable workflows without administrator rights

Worker-Kennung: authorization.desktop-workflow-execution.

**Status:** offen; keine Behauptung einer Behebung im PR.

**Gemeldete Einstufung:**

- **level**: medium
- **rationale**: High impact (application-process authority and accessible credentials/data), reduced likelihood because exploitation requires an authenticated local desktop session and ability to submit IPC; not remotely reachable by itself.

**Gemeldete Nachweissicherheit:**

- **level**: high
- **rationale**: Static source trace reaches automatic scheduling and native code sinks without a role guard. No runtime reproduction was performed.

**Beschreibung:**

An authenticated desktop agent or viewer can create, change, or import an enabled scheduled workflow. Its code nodes execute in the Electron main process even though manual workflow execution requires owner/admin rights.

**Quellorte des Ausgangsstands:** `electron/ipc/email.ts:564`, `electron/ipc/workflow.ts:135`, `electron/ipc/workflow.ts:186`, `electron/ipc/workflow.ts:505`, `electron/workflow/nodes/code-nodes.ts:9`

**Gemeldete Ursache:**

The renderer controls workflow graph/code, enabled state and cron expression through the preload allowlist. Create/update/import handlers register only `logger`; `registerIpcHandler` enforces roles only when `requireRole` is supplied. The account resolver deliberately skips email workflow mutations and all `workflow:` channels. The store keeps enabled state, graph and cron; `restartEmailWorkflowCrons` schedules the row and `runScheduledWorkflowFire` invokes a live graph without the creator's role. Registry dispatch reaches JavaScript with host objects or `spawnSync('python3', ['-c', code])`. Manual execution's owner/admin guard is never used by this path.

**Prüfmethode laut Worker:**

static source trace and counterevidence review

**Validierungszusammenfassung laut Worker:**

Confirmed real session required but agent/viewer roles accepted by create/update/import. `parseWorkflowImport` only requires version/name; schemas permit caller graph and schedule. Scheduled execution bypasses the guarded manual endpoint, passes no dry-run flag, and uses schedule direction, so inbound-condition gating does not stop it. Restore-version also changes executable content and restarts scheduling. Code-node warnings acknowledge trusted code but no backend role check enforces that trust.

**Grenzen laut Worker:**

- Requires desktop use with lower-trust application users. No remote attacker route claimed.
- Python requires a usable python3 executable. JavaScript code execution uses built-in Node vm with host JSON/Math/Date and is explicitly documented as not a security sandbox.
- Static validation only; no application code or exploit payload executed.

**Vorgeschlagene Korrektur, nicht als umgesetzt bestätigt:**

Require owner/admin authorization for every desktop workflow mutation/import/version-restore and security-setting mutation that can enable live execution. Bind scheduled execution to an authorized creator or privileged approval, and isolate code execution if lower-privilege workflow authors are supported.

**Vorgeschlagene Regressionstests, nicht als ausgeführt bestätigt:**

- For viewer and agent sessions, assert create/update/import/from-file/restore fail before workflow persistence or cron rescheduling.
- Assert authorized admin workflows still execute, and revoking creator authority prevents unauthorized scheduled code execution.

### 2. Desktop connection tests disclose stored mailbox credentials to a user-selected server

Worker-Kennung: credential-disclosure.desktop-mail-test.

**Status:** offen; keine Behauptung einer Behebung im PR.

**Gemeldete Einstufung:**

- **level**: medium
- **rationale**: High impact because external mailbox credentials are exposed; medium likelihood due to authenticated local desktop access and an attacker-controlled mail endpoint.

**Gemeldete Nachweissicherheit:**

- **level**: high
- **rationale**: Parent traced all three connection-test handlers, the scope skip, keychain/auth lookup and network authentication consumers.

**Beschreibung:**

An authenticated desktop user can test another mailbox against their own server without mailbox authorization. IMAP/POP3 reuse the stored password; SMTP can reuse a stored password or refreshed OAuth access token.

**Quellorte des Ausgangsstands:** `electron/ipc/ipc-account-scope.ts:37`, `electron/ipc/email.ts:417`, `electron/ipc/email.ts:1352`, `electron/ipc/email.ts:2704`

**Gemeldete Ursache:**

Connection-test IPC deliberately skips account-scope resolution, while each handler omits a role requirement. The caller selects account ID and network host. Empty credential fields cause the handler to read that account's secret from Keytar or obtain its OAuth token, then combine the secret with the caller's host/user/port. Mail clients authenticate to that host. Neither stored endpoint equality nor mailbox-management permission is checked.

**Prüfmethode laut Worker:**

static source trace

**Validierungszusammenfassung laut Worker:**

Validated baseline IMAP/POP3 path and independently traced the sibling SMTP path. The generic IPC wrapper requires a real session but skips account authorization for all three test channels. Their schemas permit arbitrary nonempty hosts and empty/omitted passwords. Each consumer authenticates using the retrieved secret; TLS only authenticates the attacker-selected endpoint and does not bind it to the stored mailbox.

**Grenzen laut Worker:**

- No connection was made and no actual secret was read.
- Requires a stored password or, for SMTP OAuth, a usable linked account token; local authenticated desktop session required.

**Vorgeschlagene Korrektur, nicht als umgesetzt bestätigt:**

Authorize account-management permission and mailbox access before reading a stored secret. Bind secret reuse to the stored destination and identity; require explicitly supplied credentials for any alternate destination. Apply the same invariant to IMAP, POP3, SMTP passwords and OAuth tokens.

**Vorgeschlagene Regressionstests, nicht als ausgeführt bestätigt:**

- Reject testing an inaccessible account before keychain or OAuth lookup.
- Changing host/user/port must not reuse a stored password/token without explicit authorized credential handling.
- Verify all three test protocols enforce the same checks.

### 3. Password changes and administrative password resets leave existing sessions valid

Worker-Kennung: session-invalidation.password-change.

**Status:** offen; keine Behauptung einer Behebung im PR.

**Gemeldete Einstufung:**

- **level**: medium
- **rationale**: High impact when an account session has been stolen; medium likelihood because prior possession of a valid token is required.

**Gemeldete Nachweissicherheit:**

- **level**: high
- **rationale**: Two independent reviewers and parent source validation found both password mutations omit revocation; access and refresh validation do not compare credential version.

**Beschreibung:**

Changing a server password or resetting it through user administration leaves existing access and refresh sessions valid. Someone holding a stolen refresh token can keep rotating it after the replacement password is set.

**Quellorte des Ausgangsstands:** `packages/server/src/db/postgres-auth-port.ts:251`, `packages/server/src/db/postgres-auth-port.ts:317`, `packages/server/src/db/postgres-auth-port.ts:679`, `packages/server/src/db/postgres-auth-port.ts:826`

**Gemeldete Ursache:**

Both self-service and administrative password changes update the user row but leave `refresh_tokens` unchanged. Access-token validation looks up its session and checks revocation, disablement and expiry, with no credential-generation comparison. Refresh rotation accepts the unchanged session, revokes only that rotated token and issues a new pair with a new expiry. Thus the new password never invalidates the old authentication authority.

**Prüfmethode laut Worker:**

static source trace, sibling mutation and migration review

**Validierungszusammenfassung laut Worker:**

Confirmed production wiring of Postgres auth port and principal validator. Both mutation routes return after password update/audit. Migrations contain no password-change revocation trigger. Logout, user deletion and disablement do invalidate or reject sessions, but neither password mutation invokes those controls.

**Grenzen laut Worker:**

- No runtime token replay attempted.
- Attacker must already possess a valid token. Current role/capabilities are reloaded; role downgrade bypass is not claimed.

**Vorgeschlagene Korrektur, nicht als umgesetzt bestätigt:**

Invalidate all of the affected user's refresh sessions in the same transaction as a password reset or change. If preserving the initiating session is desired for self-service changes, identify it explicitly and replace it after reauthentication. Coordinate refresh issuance and credential changes using a locked user row or credential version so concurrent refreshes cannot escape revocation. Verify that old access and refresh tokens fail after both mutation paths.

**Vorgeschlagene Regressionstests, nicht als ausgeführt bestätigt:**

- After self-service change and admin reset, verify all prior access and refresh tokens fail.
- Race refresh rotation against password change and verify a concurrently issued session cannot escape revocation.

### 4. Desktop resource-scope gaps allow cross-account mail actions and account deletion

Worker-Kennung: authorization.desktop-mail-resource-ownership.

**Status:** offen; keine Behauptung einer Behebung im PR.

**Gemeldete Einstufung:**

- **level**: medium
- **rationale**: Potentially high confidentiality/integrity impact, but authenticated local desktop context limits likelihood to medium. Bulk draft deletion is permanent, unlike soft-delete.

**Gemeldete Nachweissicherheit:**

- **level**: high
- **rationale**: Parent verified wrapper, schemas, six bulk operations and attachment consumers; ownership is never resolved for these inputs.

**Beschreibung:**

An authenticated desktop user can omit optional account scope to mutate or delete messages in inaccessible mailboxes, or use an attachment ID to save/open another mailbox's file. The IPC account resolver does not recognize these resource references. The bare numeric DeleteAccount payload is also unrecognized, permitting deletion of another mailbox, its attachment files and stored credentials.

**Quellorte des Ausgangsstands:** `electron/ipc/ipc-account-scope.ts:81`, `electron/ipc/register.ts:83`, `electron/ipc/email.ts:2099`, `electron/ipc/email.ts:2808`, `electron/email/email-store.ts:1567`, `electron/ipc/email.ts:408`, `electron/email/email-store.ts:523`

**Gemeldete Ursache:**

The wrapper calls account authorization only when the resolver returns an account ID. It understands individual `messageId` and `draftMessageId`, but neither `messageIds` arrays nor `attachmentId`. Bulk schemas permit omitted `accountId`, and the store's absent-account branches operate on IDs without owner predicates. Bulk local-draft deletion always uses IDs alone. Attachment save/open fetches the attachment row by ID and uses its path without resolving its message/account. This creates one fail-open resource-ownership boundary across these operations. DeleteAccount passes a bare positive integer, but the resolver's numeric-account set omits this channel; it returns undefined before the later object-id special case. Deletion proceeds without account authorization.

**Prüfmethode laut Worker:**

static source trace and sibling-operation review

**Validierungszusammenfassung laut Worker:**

Validated soft-delete, archive, spam, spam-status, done-state, permanent local-draft deletion, attachment save and native open. A valid session and positive IDs do not establish target mailbox permission. Explicit account scope can restrict some bulk writes, but it is optional and caller-controlled. Save-dialog confirmation and risky-extension warnings do not authorize mailbox ownership. Parent verified DeleteAccount's numeric schema and resolver early return, then the account/attachment/secret deletion helper. No account grant is required for this sibling operation.

**Grenzen laut Worker:**

- No actual messages or attachments accessed or modified.
- Requires authenticated desktop session and target numeric IDs; no unauthenticated network route asserted.

**Vorgeschlagene Korrektur, nicht als umgesetzt bestätigt:**

Resolve the owning message/account from every resource ID before use, validate every member of bulk lists, require read/write permissions appropriate to the operation, and fail closed for resource-bearing channels without an explicit authorization policy. Add DeleteAccount's numeric payload to mandatory account resolution and require privileged account-administration access before deletion.

**Vorgeschlagene Regressionstests, nicht als ausgeführt bestätigt:**

- Mixed-mailbox bulk lists must fail or filter unauthorized items atomically before writes.
- Omitting or spoofing accountId must never widen access.
- Saving/opening an inaccessible attachment and deleting its draft must fail before filesystem or database effects.
- Deny account deletion by a session with no grant and verify no attachment/keychain/database side effect occurs.

### 5. Workspace event replay bypasses the admin restriction on automation-key metadata

Worker-Kennung: authorization.automation-key-events.

**Status:** offen; keine Behauptung einer Behebung im PR.

**Gemeldete Einstufung:**

- **level**: low
- **rationale**: Same-workspace credential metadata disclosure; raw key and hash are not exposed.

**Gemeldete Nachweissicherheit:**

- **level**: high
- **rationale**: Publisher, persistent replay and event-filter fallthrough independently traced.

**Beschreibung:**

A non-admin workspace user can receive or replay API-key labels, scopes, IDs, creator IDs and revocation activity over the event WebSocket, although REST explicitly restricts this metadata to administrators.

**Quellorte des Ausgangsstands:** `packages/server/src/mail-access/async-policy-enforcer.ts:1110`, `packages/server/src/api/automation-routes.ts:183`, `packages/server/src/api/fastify-adapter.ts:233`

**Gemeldete Ursache:**

API-key mutations publish protected metadata in recognized workspace event types. Event delivery authenticates and scopes the subscriber's workspace, but the filter returns recognized types unchanged when they have no mail policy. Automation events also bypass the CRM reduction list. The REST administrator restriction is therefore absent from both live delivery and replay.

**Prüfmethode laut Worker:**

static source trace

**Validierungszusammenfassung laut Worker:**

Verified API-key event registration, publication, database persistence, workspace replay and common delivery filter. Both creation and revocation are exposed. Raw secrets are omitted and cross-workspace filtering remains effective; the issue is limited to the explicit admin-only metadata boundary.

**Grenzen laut Worker:**

- No event socket opened; historical events exist only after key operations.

**Vorgeschlagene Korrektur, nicht als umgesetzt bestätigt:**

Apply an explicit administrator policy to automation-key events before both live delivery and replay. Define authorization for other non-mail event families rather than treating membership in SERVER_EVENT_TYPES as sufficient authorization.

**Vorgeschlagene Regressionstests, nicht als ausgeführt bestätigt:**

- Verify non-admin live and replay subscribers receive neither automation_api_key.created nor automation_api_key.revoked; admins still receive both.

### 6. Desktop workflow HTTP requests can follow redirects into blocked networks

Worker-Kennung: ssrf.desktop-workflow-http.

**Status:** offen; keine Behauptung einer Behebung im PR.

**Gemeldete Einstufung:**

- **level**: medium
- **rationale**: Potentially high internal-service impact with medium likelihood: a live desktop workflow must use an allowlisted attacker-controlled or compromised endpoint. No particular vulnerable internal service is assumed.

**Gemeldete Nachweissicherheit:**

- **level**: high
- **rationale**: Initial check and unguarded fetch directly inspected. Dry-run claim from investigator was falsified and removed.

**Beschreibung:**

A live workflow request checks only the initial hostname and DNS answers, then uses ordinary fetch. An allowed endpoint can redirect into loopback/internal addresses, and connection DNS is not pinned to the checked address.

**Quellorte des Ausgangsstands:** `electron/workflow/http-request-guard.ts:7`, `electron/workflow/nodes/integration-nodes.ts:88`

**Gemeldete Ursache:**

`assertWorkflowHttpUrlAllowed` validates the initial URL and separately resolves its hostname, then discards the approved addresses. The live node calls global `fetch` without redirect handling or a transport pinned to those addresses. Redirect destinations and the connection-time DNS result never pass the guard, so an approved public URL can lead to a blocked network destination.

**Prüfmethode laut Worker:**

static source trace with counterevidence correction

**Validierungszusammenfassung laut Worker:**

Confirmed host allowlist/private-address checks apply only before fetch. Automatic schedules run live. Contrary to the investigator's original claim, integration-nodes.ts:96 honors dryRun and prevents fetch; the test endpoint is not an HTTP-fetch trigger. The server has a separate guarded/pinned implementation, so this finding is desktop-only.

**Grenzen laut Worker:**

- No outbound request or DNS experiment performed.
- Requires a live workflow targeting an allowed endpoint under attacker influence. Exact internal-service impact depends on desktop network placement.
- Dry-run still performs initial DNS validation but does not fetch.

**Vorgeschlagene Korrektur, nicht als umgesetzt bestätigt:**

Reuse the server's checked-address transport and redirect validation for every hop; pin the connected address, enforce a single deadline and stream a bounded response. Preserve the existing dry-run no-fetch behavior.

**Vorgeschlagene Regressionstests, nicht als ausgeführt bestätigt:**

- An allowlisted public endpoint redirecting to loopback/private addresses must be rejected.
- Changing DNS between guard and connection must not change the connected address.
- Dry runs must continue to perform no HTTP fetch.

### 7. A stale message policy can enable external resources in a different, blocked email

Worker-Kennung: privacy.remote-content-selection-race.

**Status:** offen; keine Behauptung einer Behebung im PR.

**Gemeldete Einstufung:**

- **level**: low
- **rationale**: Limited privacy disclosure with a narrow response-order and user-navigation prerequisite.

**Gemeldete Nachweissicherheit:**

- **level**: high
- **rationale**: React closure and shared boolean dataflow are directly visible; no runtime timing reproduction performed.

**Beschreibung:**

A late allow-remote response for a previously selected message can enable external images in a newly selected, blocked message when its HTML view is opened.

**Quellorte des Ausgangsstands:** `src/components/email/message-viewer.tsx:380`, `src/components/email/message-viewer.tsx:1575`

**Gemeldete Ursache:**

The effect captures both selectedMessage and messageId for A. Its stale-response guard compares those same captured values, so it cannot detect that the currently selected message is B. The response updates a component-wide loadRemoteImages boolean, without effect cleanup or message-bound state. The renderer reuses the viewer across selections; the shared flag both suppresses URL rewriting and selects an image-permitting CSP.

**Prüfmethode laut Worker:**

static asynchronous-state trace

**Validierungszusammenfassung laut Worker:**

Verified persistent MessageViewer without message-specific key, selection reset, closure capture, lack of cleanup/generation check and HTML toggle/frame consumer. Sequence A-allowed -> B-blocked -> B response -> late A response leaves B remotely enabled. Initial plaintext and sandbox/no-referrer reduce exposure, but do not stop permitted external image requests.

**Grenzen laut Worker:**

- Message A has a policy permitting remote content.
- The user selects B before A's asynchronous policy request finishes.
- A's response arrives after B's policy reset and blocked-policy response.
- The user opens B's HTML view.
- No browser execution or external request performed.

**Vorgeschlagene Korrektur, nicht als umgesetzt bestätigt:**

Bind policy state to messageId and discard results after effect cleanup or a request-generation change. Render remote content only when the policy state's messageId matches the current selection.

**Vorgeschlagene Regressionstests, nicht als ausgeführt bestätigt:**

- Use deferred policy responses: select permitted A, select blocked B, resolve B false, then A true, and open B's HTML view. Assert that B retains blocked-resource CSP and that its remote image URL is not activated. This test was not executed.

### 8. Automatic DOCX indexing can exhaust the mail application's memory

Worker-Kennung: resource-exhaustion.docx-expansion.

**Status:** offen; keine Behauptung einer Behebung im PR.

**Gemeldete Einstufung:**

- **level**: high
- **rationale**: High availability impact to the shared server/Electron process with high source-supported likelihood: synchronized external attachments are automatically indexed without user opening them. Deployment must synchronize a mailbox.

**Gemeldete Nachweissicherheit:**

- **level**: high
- **rationale**: Parent validated auto-queue callers, both extractors, locked Mammoth 1.12.0/JSZip 3.10.1 path, and yauzl metadata-versus-stream checks. No runtime bomb was executed.

**Beschreibung:**

A sender can deliver a compressed DOCX attachment that expands far beyond input limits during automatic indexing. Desktop has no expansion preflight; server preflight trusts ZIP-declared sizes, while the parser accumulates actual output before detecting a mismatch.

**Quellorte des Ausgangsstands:** `packages/server/src/mail-attachment-text.ts:109`, `electron/email/attachment-text-extract.ts:92`, `packages/server/src/mail-sync.ts:2066`, `electron/email/email-message-attachments-store.ts:159`

**Gemeldete Ursache:**

Inbound storage automatically queues extraction. The 15 MiB limit bounds compressed file bytes. Desktop invokes Mammoth directly; server walks ZIP metadata and sums attacker-declared `uncompressedSize`, without reading entry streams to verify actual output. Mammoth asks JSZip for a complete expanded buffer; JSZip collects output chunks and checks declared size only at end. `capAttachmentText` runs after extraction, and promise timeout does not cancel decompression. Therefore neither post-extraction text truncation nor metadata-only preflight bounds peak parser memory.

**Prüfmethode laut Worker:**

static caller-to-parser trace and installed locked dependency inspection

**Validierungszusammenfassung laut Worker:**

Verified both automatic extraction hooks and preflight. yauzl only compares stored-method sizes while enumerating; DEFLATE byte-count validation is in openReadStream, which this preflight never invokes. JSZip's output is accumulated before its end-time mismatch check. A valid compressed DOCX exceeds desktop expansion limits; forged declared sizes evade server metadata checks. No decompression or application execution was performed.

**Grenzen laut Worker:**

- Peak memory/CPU and exact crash threshold not measured.
- Requires delivery to a mailbox actually synchronized by the application; provider-side rejection could reduce exposure.
- Installed dependency source matched lockfile versions, but other deployments may differ.

**Vorgeschlagene Korrektur, nicht als umgesetzt bestätigt:**

Validate actual entry output through bounded streaming decompression before handing data to Mammoth, aborting immediately on byte or entry-budget violations. Apply the control to both editions. Run document parsing in a terminable worker/process with memory and time limits.

**Vorgeschlagene Regressionstests, nicht als ausgeführt bestätigt:**

- Reject a DEFLATE entry that underdeclares its size as soon as actual output exceeds a strict budget, without retaining large output.
- Run parsing in a terminable isolated worker and assert timeout terminates computation.
- Apply the same expansion invariant to desktop and server.

### 9. Windows path separators bypass draft attachment authorization

Worker-Kennung: path-traversal.windows-draft-attachments.

**Status:** offen; keine Behauptung einer Behebung im PR.

**Gemeldete Einstufung:**

- **level**: medium
- **rationale**: High confidentiality impact, but medium/unknown likelihood because Windows server deployment, send/draft permissions and knowledge of an existing storage path are required. Default Linux Compose does not satisfy the platform condition.

**Gemeldete Nachweissicherheit:**

- **level**: high
- **rationale**: Parent traced all three guards to native path resolution, file read and SMTP; standalone ntpath calculation confirmed normalization mismatch without application execution.

**Beschreibung:**

On a Windows-hosted server, a mail delegate can use backslash dot segments after an authorized draft-directory prefix to attach a known file elsewhere in the shared attachment root, bypassing its owning message's permissions.

**Quellorte des Ausgangsstands:** `packages/server/src/mail-access/http-policy-enforcer.ts:995`, `packages/server/src/mail-access/http-policy-enforcer.ts:1102`, `packages/server/src/mail-access/async-policy-enforcer.ts:929`, `packages/server/src/db/postgres-mail-read-ports.ts:4252`

**Gemeldete Ursache:**

Attachment strings are authorized before native path normalization. The draft-local exception accepts a slash-delimited prefix and rejects only literal slash-delimited `..` segments. Windows backslashes survive parsing but become separators at `path.resolve`, allowing traversal outside that specific draft/workspace. The remaining check only confines the resolved file to the shared attachment root, after which its bytes are included in outbound SMTP. Immediate send, approval and scheduled execution repeat the same exception.

**Prüfmethode laut Worker:**

static dataflow plus standalone Windows path-normalization calculation

**Validierungszusammenfassung laut Worker:**

Parent confirmed the guard accepts a path shaped `workspaceA/compose-drafts/12/..\..\..\workspaceB\secret.pdf`, and Windows normalization resolves it to workspaceB inside the shared root. Immediate and scheduled sender pass attachment paths to the same file-reading MIME builder. Regular owner checks, file caps and shared-root containment remain effective but do not enforce the draft boundary.

**Grenzen laut Worker:**

- This traversal requires Windows path semantics; backslashes do not traverse directories on the usual Linux deployment.
- No deployment operating system has been established, so this is not a claim that the deployed instance is exposed.
- The attacker still needs an authorized sendable draft and a known existing target path.
- Regular nonlocal attachment paths undergo ownership and attachment permission checks.
- The shared-root containment and file size checks remain effective.
- No filesystem target read, SMTP send, application execution or exploit request performed.

**Vorgeschlagene Korrektur, nicht als umgesetzt bestätigt:**

Use one canonical storage-key validator across immediate send, approval and scheduled execution. Reject backslashes and dot segments for slash-delimited storage keys, resolve the path before authorization, and verify that the resolved file remains within the specific draft directory. Prefer opaque attachment identifiers and server-owned upload records over caller-supplied filesystem paths. Add meaningful Windows-path regression coverage for all three entry paths.

**Vorgeschlagene Regressionstests, nicht als ausgeführt bestätigt:**

- Reject mixed-separator and dot-segment storage keys before authorization on all platforms.
- Test Windows immediate, approved and scheduled sends cannot leave the specific authorized draft directory.
- Require target attachment permission for any nonlocal canonical path.

### 10. Customer and product update keys become executable SQLite syntax

Worker-Kennung: sql-injection.desktop-automation-customer.

**Status:** offen; keine Behauptung einer Behebung im PR.

**Gemeldete Einstufung:**

- **level**: medium
- **rationale**: High database-confidentiality impact, constrained by a real local desktop session or a valid scoped key against the opt-in listener; medium severity.

**Gemeldete Nachweissicherheit:**

- **level**: high
- **rationale**: Complete static entrypoint-to-SQL-and-response trace and installed parameter-binder counterevidence review.

**Beschreibung:**

Unrestricted JSON property names are interpolated into customer and product UPDATE statements. Authenticated desktop users can reach both sinks through IPC; a write-scoped automation key can also reach customer updates and extract other database data through the returned customer field.

**Quellorte des Ausgangsstands:** `electron/sqlite-service.ts:2111`, `electron/automation/handlers.ts:123`, `electron/sqlite-service.ts:2282`, `electron/ipc/database.ts:159`, `electron/ipc/database.ts:252`, `shared/ipc/schemas.ts:340`, `shared/ipc/schemas.ts:570`

**Gemeldete Ursache:**

Values are bound but object property names are neither allowlisted nor quoted. The raw key is emitted on the SET line twice; a scalar subquery followed by a line comment removes the second occurrence and timestamp while leaving the next-line WHERE id parameter intact. Product updates independently use the same raw-key SQL construction. Their IPC schemas and customer IPC schemas use z.any(), and both handlers omit privileged roles, so no schema strips the injected key.

**Prüfmethode laut Worker:**

static source trace

**Validierungszusammenfassung laut Worker:**

Verified users.password_hash exists. A property shaped `name = (SELECT group_concat(password_hash) FROM users) --` yields one valid UPDATE, without stacked statements. better-sqlite3 binds only parameters present in SQL, so unused object properties do not reject this form. Actual keys, hashes, database or HTTP service were never accessed. Parent independently checked both IPC registrations, both z.any schemas and product SQL at2282-2302. Strict calendar-event input schemas block the same technique at that separate helper, so no calendar injection is claimed.

**Grenzen laut Worker:**

- No exploit request or SQL/application execution performed.
- Limited to desktop automation; the Fastify server is a separate implementation.

**Vorgeschlagene Korrektur, nicht als umgesetzt bestätigt:**

Allowlist customer and product update fields in the shared DB helpers and strict IPC/automation schemas. Construct SQL from fixed column mappings and bind all values.

**Vorgeschlagene Regressionstests, nicht als ausgeführt bestätigt:**

- With a write-only API key, assert unknown, comment, quote and SQL-expression property names are rejected before UPDATE.
- Assert legitimate customer updates work and authentication/hash tables cannot influence returned customer fields.
- Assert authenticated viewer/agent customer/product IPC rejects SQL-expression keys; permitted reads cannot return unrelated authentication data.
- Retain strict calendar-event schemas as a regression control.

### 11. Restricted desktop users can export installation-wide data and replace the database

Worker-Kennung: authorization.desktop-full-backup.

**Status:** offen; keine Behauptung einer Behebung im PR.

**Gemeldete Einstufung:**

- **level**: medium
- **rationale**: High confidentiality/integrity impact constrained by authenticated local desktop access and interactive/local-file prerequisites.

**Gemeldete Nachweissicherheit:**

- **level**: high
- **rationale**: Parent traced IPC, common authorization, complete exporter and complete restore implementation.

**Beschreibung:**

Mail backup IPC requires a session but no privileged role. An authenticated viewer or agent can export all SQLite data and attachments, or restore a replacement database containing attacker-chosen identities and roles. The separate GDPR export also discloses all accounts' message indexes, internal notes, workflow metadata and optional attachments without account filtering.

**Quellorte des Ausgangsstands:** `electron/ipc/email.ts:1132`, `electron/email/email-local-backup-export.ts:100`, `electron/email/email-local-restore.ts:366`, `electron/ipc/email.ts:2870`, `electron/email/email-gdpr-export.ts:90`

**Gemeldete Ursache:**

Full-installation backup handlers register only logger. Their payload has no mailbox account ID, so default account resolution supplies no secondary gate. Export copies the entire DB and attachment root; restore copies an imported database into the fixed live path and relaunches. GDPR export uses the same unprivileged installation-wide export pattern: no account filter reaches its SELECTs or attachment directory.

**Prüfmethode laut Worker:**

static source trace

**Validierungszusammenfassung laut Worker:**

Verified default real-session requirement, absent role/account gate, complete database copy, preview-token return, fixed phrase and live replacement/relaunch. Keytar is excluded and setup token redacted; user password hashes remain in the DB. Extraction limits, rollback and sync-busy checks mitigate malformed archives/accidents but not unauthorized maintenance. Parent full-read GDPR exporter confirmed all-account queries and whole attachment archive. Its redaction excludes keychain/raw mail, but not mailbox metadata, notes or attachments.

**Grenzen laut Worker:**

- No backup, export, database replacement or application restart performed.
- Requires desktop use with users whose application permissions are narrower than installation authority.

**Vorgeschlagene Korrektur, nicht als umgesetzt bestätigt:**

Require owner-level authorization for full restore and an explicit privileged role for full backup export/preview. Keep account-filtered exports separate and exclude authentication data. Gate the GDPR full-installation export as privileged or implement explicit per-account scope throughout its queries and attachment selection.

**Vorgeschlagene Regressionstests, nicht als ausgeführt bestätigt:**

- Assert viewer/agent cannot export, preview or restore full backups, including direct IPC calls.
- Assert owner restore still performs preview, confirmation, extraction limits and rollback; permitted export redacts intended secrets.
- A restricted GDPR export cannot include another account's message index, notes or attachment files.

### 12. Backup inspection decompresses an unlimited manifest into Electron memory

Worker-Kennung: resource-exhaustion.backup-manifest.

**Status:** offen; keine Behauptung einer Behebung im PR.

**Gemeldete Einstufung:**

- **level**: medium
- **rationale**: High process-availability impact with medium likelihood: a local archive must be selected or supplied by an authenticated desktop caller.

**Gemeldete Nachweissicherheit:**

- **level**: high
- **rationale**: Complete inspector/restore source review establishes unbounded buffering before later limits.

**Beschreibung:**

Verifying or previewing a supplied backup ZIP buffers its entire decompressed manifest before checking its type or applying restore extraction limits. A highly compressed large manifest can exhaust or stall the Electron main process before restoration is confirmed.

**Quellorte des Ausgangsstands:** `electron/email/email-local-backup.ts:23`, `electron/email/email-local-backup.ts:75`, `electron/email/email-local-restore.ts:199`

**Gemeldete Ursache:**

readZipEntryText appends every decompressed chunk, then allocates combined Buffer and UTF-8 string. inspectZipBackup invokes it without declared-size, actual-byte or entry-count limits; subsequent bounded extraction cannot undo this allocation.

**Prüfmethode laut Worker:**

static source trace

**Validierungszusammenfassung laut Worker:**

A valid declared huge manifest is enough; no ZIP size-field forgery is needed. Later extraction streams apply bounds and safe paths, but run only after this inspector. No compressed bomb was created or executed.

**Grenzen laut Worker:**

- Crash threshold and actual peak resources not measured.
- No direct unauthenticated network trigger established.

**Vorgeschlagene Korrektur, nicht als umgesetzt bestätigt:**

Set a small manifest-specific declared and actual decompressed-byte cap, abort the stream immediately at that cap, and bound inspector entry counts before parsing JSON.

**Vorgeschlagene Regressionstests, nicht als ausgeführt bestätigt:**

- Use a small configurable byte limit and harmless compressed fixture to verify inspection stops at the limit before buffering full content.
- Verify valid small manifests still work through verify, preview and restore, and later extraction limits remain enforced.

### 13. Dashboard and follow-up reveal tasks hidden by assignment permissions

Worker-Kennung: authorization.task-read-surfaces.

**Status:** offen; keine Behauptung einer Behebung im PR.

**Gemeldete Einstufung:**

- **level**: low
- **rationale**: Confidentiality boundary breach with straightforward authenticated reachability, downgraded for constrained same-workspace task metadata.

**Gemeldete Nachweissicherheit:**

- **level**: high
- **rationale**: Production wiring, sibling guarded task API and unguarded concrete queries independently inspected.

**Beschreibung:**

An ordinary server user with CRM read access can obtain other users' or groups' task details through dashboard and follow-up endpoints, although the primary task API filters those tasks by assignment.

**Quellorte des Ausgangsstands:** `packages/server/src/db/postgres-follow-up-port.ts:163`, `packages/server/src/db/postgres-dashboard-port.ts:129`, `packages/server/src/api/follow-up-routes.ts:35`, `packages/server/src/api/dashboard-routes.ts:41`

**Gemeldete Ursache:**

Main task authorization uses global/own/group assignment and viewer identity. Dashboard/follow-up ports accept workspace alone and run task queries without the assignment predicate; workspace RLS does not replace per-user visibility.

**Prüfmethode laut Worker:**

static source trace

**Validierungszusammenfassung laut Worker:**

Default wiring at server.ts650,701 and dispatch crm.read gate confirmed. Main get route passes viewer and query enforces taskVisibilityExpression; migration0019 documents the invariant. Follow-up response does not return selected description, so full description disclosure is not claimed. Workspace predicates remain effective. Follow-up accepts any nonempty queue string; an unrecognized queue skips date filters, allowing pagination through incomplete tasks.

**Grenzen laut Worker:**

- No HTTP or database request executed.
- No cross-workspace leak claimed.

**Vorgeschlagene Korrektur, nicht als umgesetzt bestätigt:**

Pass authenticated viewer through dashboard/follow-up ports and reuse assignment visibility for task lists, search, pagination and aggregate counts.

**Vorgeschlagene Regressionstests, nicht als ausgeführt bestätigt:**

- With users in different assignment groups, compare all dashboard/follow-up task lists/counts against main task visibility; deny private rows while retaining own/global/group-authorized tasks.

### 14. Follow-up snooze can modify a task outside the caller's assignment

Worker-Kennung: authorization.task-snooze.

**Status:** offen; keine Behauptung einer Behebung im PR.

**Gemeldete Einstufung:**

- **level**: low
- **rationale**: Same-workspace integrity/availability effect restricted to snooze metadata; authenticated CRM writer required.

**Gemeldete Nachweissicherheit:**

- **level**: high
- **rationale**: Direct static route-to-UPDATE trace and sibling task permission check.

**Beschreibung:**

A server user with CRM write access can snooze another user's or group's private task by ID, even though the normal task update API denies that same task.

**Quellorte des Ausgangsstands:** `packages/server/src/db/postgres-follow-up-port.ts:240`, `packages/server/src/api/follow-up-routes.ts:59`

**Gemeldete Ursache:**

The snooze route checks crm.write but sends no viewer to its port. UPDATE predicates use workspace and caller-supplied task ID only, omitting the assignment predicate enforced by primary task mutations.

**Prüfmethode laut Worker:**

static source trace

**Validierungszusammenfassung laut Worker:**

Compared full follow-up route/UPDATE with main task update's viewer-dependent predicate. Snooze body requires a parseable timestamp, but no task-level authorization. Workspace isolation and CRM write capability remain enforced.

**Grenzen laut Worker:**

- No task or HTTP service modified or invoked.
- Limited to same-workspace snooze state.

**Vorgeschlagene Korrektur, nicht als umgesetzt bestätigt:**

Pass viewer identity to snoozeTask and include task assignment visibility atomically in its UPDATE predicate.

**Vorgeschlagene Regressionstests, nicht als ausgeführt bestätigt:**

- A crm.write user cannot snooze another user's or inaccessible group's private task; own/group-authorized/global tasks remain writable.
- A crm.read-only principal remains denied.

### 15. Customer CSV exports preserve attacker-controlled spreadsheet formulas

Worker-Kennung: csv-injection.customer-export.

**Status:** offen; keine Behauptung einer Behebung im PR.

**Gemeldete Einstufung:**

- **level**: low
- **rationale**: Constrained stored-content injection requiring another user's export/open action and spreadsheet behavior; no RCE or exfiltration established.

**Gemeldete Nachweissicherheit:**

- **level**: medium
- **rationale**: Source-to-export chain confirmed; spreadsheet interpretation was not reproduced.

**Beschreibung:**

A CRM writer can store formula-prefixed customer text that is exported unchanged into CSV cells. Another reader who opens the export in a formula-evaluating spreadsheet can execute those formulas.

**Quellorte des Ausgangsstands:** `src/lib/electron-utils.ts:89`, `src/components/export-button.tsx:20`, `src/app/customers/page.tsx:318`

**Gemeldete Ursache:**

Customer validation treats names/company values as text with trim and length checks. The CSV serializer escapes delimiters/quotes/newlines only, so formula-leading text retains spreadsheet semantics at export.

**Prüfmethode laut Worker:**

static source trace

**Validierungszusammenfassung laut Worker:**

Verified customer text validation/storage, export collector, button forwarding and exact CSV escaping. CSV quoting is distinct from formula neutralization. Workspace permissions remain enforced; React rendering is not the execution sink.

**Grenzen laut Worker:**

- No spreadsheet, formula payload or application code executed.
- Spreadsheet version, prompts and external-resource policies determine consequences; RCE/credential theft/exfiltration not established.

**Vorgeschlagene Korrektur, nicht als umgesetzt bestätigt:**

Serialize untrusted CSV cell text with a documented formula-neutralization policy for leading =, +, -, @ and control-prefix cases, or export an XLSX format with explicit text cells.

**Vorgeschlagene Regressionstests, nicht als ausgeführt bestätigt:**

- Verify formula-prefixed customer values remain literal text in supported spreadsheet imports, including delimiter/quote/control-prefix cases.
- Preserve ordinary numeric/date export behavior intentionally.

### 16. Desktop agents can redirect global integrations and expose their secrets or mail

Worker-Kennung: authorization.desktop-global-integrations.

**Status:** offen; keine Behauptung einer Behebung im PR.

**Gemeldete Einstufung:**

- **level**: medium
- **rationale**: High confidentiality/integrity impact, downgraded for authenticated local desktop configuration access and configured-secret/incoming-mail prerequisites.

**Gemeldete Nachweissicherheit:**

- **level**: high
- **rationale**: Parent traced settings IPC, permissive schemas, persistence, Keytar pairing and actual fetch/body consumers.

**Beschreibung:**

Authenticated desktop users without mailbox grants can change global AI and Rspamd destinations and read/replace OAuth client secrets. A retained AI key can be sent to a chosen endpoint immediately; enabled Rspamd processing can forward other accounts' incoming message bytes.

**Quellorte des Ausgangsstands:** `electron/ipc/email.ts:1807`, `electron/ipc/email.ts:2340`, `electron/ipc/email.ts:2634`, `electron/ipc/email.ts:2881`, `electron/ipc/sync.ts:39`, `electron/email/email-openai.ts:26`, `electron/email/rspamd-client.ts:51`

**Gemeldete Ursache:**

Global integration handlers omit requireRole and have no account resource to authorize. Profile updates replace base_url while optional absent apiKey leaves Keytar unchanged; AI execution resolves that retained key against the changed destination. Mail-security settings similarly allow enabling any HTTP(S) Rspamd host before automatic processing. OAuth getters/setters and generic sync-info reads expose global client secrets. These operations share a missing privileged global-configuration boundary.

**Prüfmethode laut Worker:**

static source trace

**Validierungszusammenfassung laut Worker:**

Verified exact registered options and schemas, profile key retention, default-profile translation trigger, scanner enablement, and raw RFC822/body construction. Rspamd defaults off, but the same setter enables it. Normal AI responses hide keys, but fetch sends them to the changed origin. OAuth app secret disclosure does not by itself imply mailbox refresh-token theft. Source-backed sibling operations grouped by the same global-role boundary; no request or secret retrieval performed.

**Grenzen laut Worker:**

- Desktop-only; server integration guards are separate.
- Raw stored RFC822 includes attachments; when absent, scanner receives reconstructed headers/body only.
- No actual external service, keychain or mailbox accessed.

**Vorgeschlagene Korrektur, nicht als umgesetzt bestätigt:**

Require owner/admin on all global integration mutations and secret-reading IPC. Return only nonsecret OAuth metadata to ordinary users and allowlist readable Sync.GetInfo keys. Changing an integration origin should require explicit credential reassignment rather than silently forwarding a retained secret.

**Vorgeschlagene Regressionstests, nicht als ausgeführt bestätigt:**

- Deny agent/viewer AI profile, Rspamd and OAuth global mutations and OAuth-secret reads including generic sync-info aliases.
- Ensure authorized origin changes cannot reuse retained keys without explicit approval; translation and embedding use the approved origin.
- Verify ordinary mailbox users cannot enable or redirect automatic raw-message scanning.

### 17. Read-only mailbox access permits endpoint and OAuth credential changes

Worker-Kennung: authorization.desktop-mailbox-write-level.

**Status:** offen; keine Behauptung einer Behebung im PR.

**Gemeldete Einstufung:**

- **level**: medium
- **rationale**: High credential/confidentiality and account integrity impact with authenticated local mailbox-reader prerequisite.

**Gemeldete Nachweissicherheit:**

- **level**: high
- **rationale**: Parent confirmed permission ranks, default wrapper mode, correct resource resolution and credential-bearing live consumer.

**Beschreibung:**

Desktop account configuration and OAuth completion handlers accept the default read-only mailbox permission. A mailbox reader can alter credential-bearing destinations, retain existing secrets and trigger synchronization, or replace linked OAuth credentials.

**Quellorte des Ausgangsstands:** `electron/ipc/email.ts:360`, `electron/ipc/email.ts:2666`, `electron/ipc/email.ts:3104`, `electron/ipc/register.ts:49`, `electron/email/email-imap-sync.ts:336`

**Gemeldete Ursache:**

registerIpcHandler defaults accountAccess to ro. UpdateAccount and both OAuth finish handlers supply only logger, so a ro grant satisfies their correctly resolved account check. Mutations then replace account endpoints or credentials; omitted password retains Keytar material which subsequent synchronization sends to the altered destination.

**Prüfmethode laut Worker:**

static source trace

**Validierungszusammenfassung laut Worker:**

Verified ro=1 and rw=3 ranks, default ro, UpdateAccount payload and fixed-column persistence, retained passwords on omission, and sync's use of stored host with resolved password/token. Google/Microsoft provider exchanges still require valid codes; no provider bypass asserted. This differs from omitted-ID scope failures and arbitrary connection-test destination substitution.

**Grenzen laut Worker:**

- No credential, endpoint, account or provider changed.
- Only reviewed account configuration/OAuth mutations reported; other default-ro write handlers remain broader review work.

**Vorgeschlagene Korrektur, nicht als umgesetzt bestätigt:**

Require rw or a dedicated account-administration permission explicitly for account settings and OAuth linking; reserve credential/destination changes to authorized account administrators. Audit remaining mutating handlers for default-ro inheritance.

**Vorgeschlagene Regressionstests, nicht als ausgeführt bestätigt:**

- A ro mailbox user cannot alter IMAP/SMTP/POP3 destinations, passwords or OAuth linkage; an authorized administrator can.
- Denied changes must leave stored secrets and destination unchanged; ordinary permitted read/sync behavior remains scoped.

## Herkunft und KI-Autorenschaft

Die Ausgangsprüfungen wurden durch interne KI-Worker des Codex-Security-Plugins
erstellt. Der Scan-Kontext nennt gpt-6-astra mit Reasoning-Einstellung high;
das ist die gemeldete Scan-Konfiguration, kein Nachweis des exakten Builds jedes
Workers oder des schreibenden Hauptagenten.

OpenAI Codex hat diesen Anhang strukturiert, lokale Benutzerpfade entfernt und
die Aussagegrenzen ergänzt. Installierte CLI: codex-cli 0.155.0-alpha.16.4.
Exakte Modell-/Build-Kennung des Hauptagenten und Desktop-Agent-Version sind
nicht verifiziert. Keine menschliche Prüfung behauptet.
