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


## Letzte abgeschlossene Zusammenführung

Quelle: dedup/dedup-0018/output/result.json. Einträge: 82.

| Nr. | Worker-Kennung | Titel | Worker-Einstufung |

|---|---|---|---|

| 1 | missing-authorization.desktop-workflow-execution | Desktop viewers can schedule workflows that execute privileged code | medium |

| 2 | incorrect-authorization.desktop-scheduled-send | Read-only desktop mailbox delegates can schedule or retry outbound mail | low |

| 3 | ssrf.desktop-workflow-http | Desktop workflow HTTP redirects and DNS changes bypass the destination guard | medium |

| 4 | missing-authorization.desktop-attachment-id | Desktop users can open or save attachments from unauthorized mailboxes | medium |

| 5 | missing-authorization.desktop-global-export | Ordinary desktop users can export installation-wide data | medium |

| 6 | missing-authorization.desktop-account-deletion | Any logged-in desktop profile can delete another mailbox account | medium |

| 7 | resource-exhaustion.docx-text-extraction | Automatic DOCX indexing can exhaust desktop or server memory | high |

| 8 | resource-exhaustion.backup-manifest | Previewing a crafted mail backup can exhaust desktop memory | low |

| 9 | path-traversal.windows-compose-attachment-authorization | Windows server path parsing can bypass attachment ownership checks | medium |

| 10 | missing-authorization.desktop-global-restore | Ordinary desktop profiles can replace the installation database | medium |

| 11 | missing-authorization.crm-returns-write | CRM read-only users can create and modify returns | medium |

| 12 | missing-authorization.mail-connection-credentials | Desktop connection tests disclose another mailbox's saved credentials | medium |

| 13 | incorrect-authorization.desktop-mailbox-management | Read-only desktop mailbox users can alter credentials and connection settings | medium |

| 14 | idor.desktop-bulk-mail | Desktop message mutations and draft deletion bypass account permissions | low |

| 15 | session-management.password-recovery | Password changes leave existing server sessions renewable | medium |

| 16 | missing-authorization.desktop-ai-credentials | Restricted desktop users can redirect a stored AI API key | medium |

| 17 | missing-authorization.task-assignment | Dashboard and follow-up bypass task assignment checks on reads and snoozing | medium |

| 18 | insufficient-validation.mssql-readonly-query | Read-only workflow SQL accepts SELECT INTO writes | low |

| 19 | missing-authorization.automation-key-events | Ordinary users receive administrator-only automation-key metadata through events | low |

| 20 | incorrect-authorization.workflow-state-transition | Workflow editors can disable or remove active protected automation | medium |

| 21 | regular-expression-denial-of-service.html-text-extraction | Email HTML attachments can block automatic indexing and the application event loop | high |

| 22 | sender-identity.duplicate-from-relay | Raw relay forwarding preserves From headers that were not authorized | low |

| 23 | uncontrolled-resource-consumption.desktop-response-bodies | Desktop integrations buffer endpoint responses without a byte limit | low |

| 24 | authorization.compiled-workflow-dry-run | Testing a compiled desktop workflow performs live mail actions | medium |

| 25 | authorization.desktop-mail-resource-resolution | Unresolved desktop resource IDs bypass mailbox permissions | medium |

| 26 | authorization.desktop-global-export-restore | Restricted desktop users can export all data and replace the application database | medium |

| 27 | authorization.desktop-read-only-mutations | Read-only mailbox users can edit credentials and send scheduled drafts | medium |

| 28 | authorization.desktop-global-oauth | Any desktop session can read and replace global OAuth application secrets | low |

| 29 | authorization.desktop-template-ownership | Caller-supplied account scope bypasses existing template ownership | low |

| 30 | confused-deputy.desktop-compose-files | Sandboxed renderer can attach host files without a picker grant | low |

| 31 | authorization.mail-mutation-response-metadata | Mail mutation responses bypass attachment and reply-parent visibility | low |

| 32 | sql-injection.desktop-update-identifiers | Customer and product update keys are interpolated into SQLite statements | medium |

| 33 | privacy.mail-remote-policy-race | A stale message-policy response can enable remote content in another email | low |

| 34 | html-injection.mail-reply-greeting | Sender display names inject HTML into the reply composer | medium |

| 35 | authorization.workflow-event-disclosure | Users without workflow access receive protected metadata over WebSocket | low |

| 36 | authorization.ai-customer-context | AI text transformation discloses customer data without CRM read permission | low |

| 37 | authorization.desktop-global-workflows | Restricted desktop users can install rules that forward other mailboxes | medium |

| 38 | configuration.browser-endpoint-poisoning | A crafted application link persistently replaces the browser's server connection | low |

| 39 | missing-authorization.nonmail-events | Event streams bypass read restrictions on automation keys and workflow knowledge metadata | low |

| 40 | credential-exposure.mutable-mail-endpoint | Delegated mailbox managers can redirect saved credentials to another server | medium |

| 41 | authentication.mfa-change-without-reauthentication | A stolen server session can remove or replace the enrolled MFA factor | low |

| 42 | encryption.scheduled-mail-policy-loss | Scheduled mail silently drops selected PGP encryption and signing | medium |

| 43 | injection.csv-formula | CRM CSV exports preserve spreadsheet formula syntax in user-controlled text | low |

| 44 | authorization.desktop-readonly-mutations | Read-only mailbox delegates can change account credentials, connection settings and message state | medium |

| 45 | missing-authorization.server-event-metadata | WebSocket events disclose workflow and automation metadata denied by HTTP routes | low |

| 46 | resource-exhaustion.imap-batch-buffering | A mailbox backlog can exhaust server memory during IMAP synchronization | medium |

| 47 | authorization.desktop-workflow-authoring | Desktop workflow authoring and backfill/webhook triggers lack privileged authorization | medium |

| 48 | authentication.totp-replay | An already-used TOTP can complete another login challenge | low |

| 49 | authorization.desktop-object-account-scope | Desktop object-ID operations bypass mailbox ownership checks | medium |

| 50 | data-isolation.attachment-cleanup-identifier | Deleting an account can erase another mailbox's attachments | low |

| 51 | authorization.desktop-rspamd-endpoint | Unprivileged desktop users can redirect scanned mail to an external server | medium |

| 52 | authorization.desktop-readonly-mail-write | Read-only desktop mailbox grants permit composing and sending mail | medium |

| 53 | authorization.desktop-global-secret-settings | Global OAuth and webhook secrets are readable and replaceable by ordinary desktop users | low |

| 54 | transport.desktop-automation-cleartext | Optional LAN automation sends reusable API keys over plaintext HTTP | low |

| 55 | privilege-boundary.restore-verification | Backup verification evaluates restored database objects as administrator | low |

| 56 | signature.pgp-display-binding | A valid embedded PGP block authenticates unrelated displayed content | medium |

| 57 | authentication.cross-workspace-email-collision | A user manager in another workspace can prevent an existing user's login | low |

| 58 | authorization.mail-delegation-existing-scope | Restricted mail delegation managers can revoke broader bindings | low |

| 59 | resource.mail-sync-batch-buffering | Mail synchronization retains unbounded aggregate message data | medium |

| 60 | authorization.relay-display-name-reserialization | Tracked relay mail can turn a display name into an unauthorized sender | low |

| 61 | privilege.restore-session-superuser | Restore and restore-drill execute supplied dump SQL in superuser sessions | medium |

| 62 | integrity.desktop-thread-reference-substring | Inbound ID substrings can merge unrelated desktop conversations | low |

| 63 | resource.workflow-graph-path-expansion | Workflow graph compilation permits exponential synchronous traversal | medium |

| 64 | improper-authorization | Workflow previews can perform live category changes and enqueue AI jobs | medium |

| 65 | missing-authorization.desktop-mail-secondary-resources | Desktop mail and whole-installation backup operations bypass authorization | medium |

| 66 | cleartext-credentials.smtp-test-tls-downgrade | SMTP connection tests lose the enabled TLS requirement | medium |

| 67 | incorrect-authorization.mail-account-id-namespace | Colliding legacy account IDs disclose a different mailbox identity | low |

| 68 | resource-exhaustion.smtp-continuation-response | Unbounded SMTP responses can exhaust the server process | low |

| 69 | authorization.webhook-workflow-draft-mutation | Message-less webhook workflows skip draft-target authorization | low |

| 70 | missing-authorization.server-export-content | GDPR export exposes message snippets without content-read permission | low |

| 71 | resource-exhaustion.mime-cid-expansion | Default CID image expansion bypasses inbound message size limits | medium |

| 72 | privilege-escalation.desktop-admin-owner | Desktop administrators can assign themselves owner authority | medium |

| 73 | resource-exhaustion.dmarc-cumulative-decompression | DMARC ingestion lacks a cumulative expanded-data budget | medium |

| 74 | session-invalidation.browser-logout-error | Failed logout leaves authenticated UI and refresh timer active | low |

| 75 | authentication-bypass.untrusted-mail-auth-results | Untrusted Authentication-Results headers can become verified mail-security state | low |

| 76 | sql-authorization.read-only-select-into | Workflow read-only MSSQL guards allow SELECT INTO writes | low |

| 77 | decompression.pgp-message-expansion | PGP decrypt operations permit unbounded compressed message expansion | low |

| 78 | authorization.desktop-mail-target-resolution | Desktop mail IPC skips authorization for unresolved target objects | medium |

| 79 | authorization.desktop-reply-parent | Compose operations use a reply parent without authorizing its account | low |

| 80 | resource-exhaustion.pop3-line-buffer | POP3 size limits apply after an unbounded line is buffered | low |

| 81 | resource-exhaustion.mail-response-buffers | SMTP sending and connection probes accept unbounded server responses | low |

| 82 | resource-exhaustion.workflow-graph-paths | Small workflow graphs can exhaust synchronous API compilation | medium |

### 1. Desktop viewers can schedule workflows that execute privileged code

Worker-Kennung: missing-authorization.desktop-workflow-execution.

**Status:** offen; keine Behauptung einer Behebung im PR.

**Gemeldete Einstufung:**

- **level**: medium
- **rationale**: High potential impact, but medium likelihood: requires a lower-privilege desktop application account and access to its renderer IPC on a shared installation. This is not an unauthenticated or server-side RCE; Python additionally requires python3.

**Gemeldete Nachweissicherheit:**

- **level**: high
- **rationale**: Source traces exposed IPC through persistent cron registration and registry dispatch to JavaScript/Python code consumers; no runtime exploit was executed.

**Beschreibung:**

An authenticated desktop viewer or agent can create, update or import an enabled workflow containing a cron trigger and JavaScript or Python code. Saved graphs are scheduled without the author principal and bypass the owner/admin gate on manual execution. JavaScript receives host-realm objects in node:vm; Python runs with the Electron process's OS privileges where python3 is installed.

**Quellorte des Ausgangsstands:** `electron/preload.ts:60`, `electron/ipc/email.ts:564`, `electron/ipc/email.ts:589`, `electron/ipc/workflow.ts:135`, `electron/email/email-imap-services.ts:275`, `electron/email/email-workflow-engine.ts:574`, `electron/workflow/runtime.ts:147`, `electron/workflow/nodes/code-nodes.ts:70`, `electron/workflow/nodes/code-nodes.ts:13`, `electron/ipc/workflow.ts:64`, `electron/ipc/email.ts:579`, `electron/ipc/email.ts:604`, `electron/ipc/register.ts:72`, `electron/email/email-imap-services.ts:276`, `electron/ipc/workflow.ts:63`, `electron/ipc/email.ts:566`, `electron/email/email-workflow-engine.ts:599`, `electron/workflow/nodes/code-nodes.ts:77`, `electron/workflow/nodes/code-nodes.ts:11`, `electron/ipc/workflow.ts:137`, `electron/email/email-workflow-store.ts:106`, `electron/email/email-workflow-engine.ts:600`, `electron/ipc/email.ts:588`, `electron/ipc/workflow.ts:187`, `electron/ipc/workflow.ts:506`, `electron/ipc/email.ts:605`, `electron/workflow/nodes/code-nodes.ts:12`, `electron/ipc/workflow.ts:146`, `electron/email/email-workflow-store.ts:151`, `electron/workflow/runtime.ts:145`, `electron/ipc/workflow.ts:65`, `electron/ipc/email.ts:565`, `electron/ipc/workflow.ts:505`, `electron/email/email-workflow-store.ts:148`, `electron/workflow/nodes/code-nodes.ts:75`, `electron/workflow/runtime.ts:146`, `electron/ipc/email.ts:590`, `electron/email/email-workflow-store.ts:150`, `electron/workflow/nodes/code-nodes.ts:74`, `electron/ipc/workflow.ts:507`, `electron/workflow/nodes/code-nodes.ts:78`, `electron/ipc/workflow.ts:201`, `electron/ipc/workflow.ts:52`, `electron/ipc/workflow.ts:186`, `electron/workflow/nodes/code-nodes.ts:9`, `electron/email/email-workflow-engine.ts:598`, `electron/ipc/workflow.ts:143`, `electron/ipc/workflow.ts:199`, `electron/ipc/email.ts:580`, `shared/ipc/email-schemas.ts:1514`, `electron/ipc/register.ts:51`

**Gemeldete Ursache:**

`CreateWorkflow`, `UpdateWorkflow` and `ImportWorkflowBundle` register with authentication alone. They accept caller-controlled graph/code and schedule settings and restart cron jobs. The scheduler passes those saved graphs to the registry without the actor identity; code nodes execute them. The explicit owner/admin control on `ExecuteWorkflowNow` is absent from these equivalent execution paths. New workflows are enabled by default, workflow-authoring channels explicitly skip account scope, and automatic graph execution defaults to non-dry-run. The second review specifically traces host JSON/Math/Date constructors as the JavaScript authority crossing.

The new source explicitly distinguishes unauthorized authoring from inbound code interpolation, confirms a scheduled graph needs no mail message, and limits the code-execution sinks to desktop (server rejects code nodes). Keep unapproved imports disabled.

Assigned dedup-0005 source: Additional enumerated activation subpaths are workflow:import-bundle-from-file (workflow.ts:187-215) and workflow:restore-version (workflow.ts:506-520), alongside create/update and bundle import. A schedule without an account requires no mailbox grant. TestWorkflowOnMessage's forced dry-run is not the proven scheduled code-execution route.

Assigned dedup-0007 source: The assigned source confirms preserved approved author AND graph revision must be checked on schedule/execution; a demoted/revoked author or changed unapproved revision must not execute. The context distinguishes unconditional JavaScript registration from conditional python3 availability, trusted-code design from a promised sandbox, and no plugin installation or preexisting disk control. The source's historical investigator high-severity assessment remains attributed in its provenance; its final Standard finding and retained aggregate are medium.

Assigned dedup-0010 synthesis: Desktop UI explicitly enables edit/manage/run for !serverClientMode and describes desktop full local control; lower-trust app-role isolation remains deployment-dependent. Historical investigator high severity and final medium severity stay attributed. Real sessions/manual execution gates/test dry-run do not protect scheduled activation.

Assigned dedup-0011 synthesis: Same enabled scheduled graph path from session-only create/update into host JavaScript/Python execution. JavaScript host Date constructor and python3-dependent subprocess remain distinct sinks within the established complete trusted-code-authoring/activation remediation; no mailbox message or preexisting OS authority required.

Assigned dedup-0012 synthesis: Same unauthorised desktop code-graph create/update/import activation through cron. Existing all-authoring-path author/revision approval and automatic execution rechecks cover the incoming instances. Preserve host JavaScript exposure, conditional python3 and app-role rather than OS-user isolation.

Assigned dedup-0013 synthesis: Identical session-only executable graph create/update/import/restore and enabled cron activation to JavaScript host-realm or optional python3 execution. Retained authoring/activation controls and approved-author/revision rechecks cover all incoming paths. Desktop role-trust uncertainty remains; independent inbound forwarding/backfill/webhook identities are preserved.

Assigned dedup-0014 synthesis: Same session-only executable graph create/update/import/file-import/version-restore and cron activation. Existing trusted authoring/activation and author/revision reauthorization cover all incoming paths. Preserve JavaScript host objects, optional python3, real session and unresolved desktop role trust.

Assigned dedup-0015 synthesis: Same session-only executable graph CRUD/import and cron activation reaching JavaScript host objects/optional python3. Existing trusted authoring/activation plus approved author/revision rechecks cover all incoming paths.

Assigned dedup-0016 synthesis: Same executable graph authoring/import/restore and automatic cron activation, bypassing manual owner/admin execution. Existing trusted authoring/activation and approved-author/revision rechecks cover all reported paths, including JavaScript host objects and conditional python3.

Assigned dedup-0017 synthesis: Same session-only code-graph create/update/import/file-import/version-restore and cron activation. Retained trusted author/revision authorization at persistence and execution subsumes all; preserve JavaScript host authority and optional Python.

**Prüfmethode laut Worker:**

Source-reported validation preserved; dedup-0013 performs supplied-artifact semantic reduction only

**Validierungszusammenfassung laut Worker:**

First source review: The parent verified the session/role wrapper, payload schema, persisted graph, cron callback, runtime dispatch and both code sinks. Existing real-session enforcement, dry-run tests and manual owner/admin gating do not apply to the cron path. `MAIL_AUTH_THREAT_MODEL.md:5-7` explicitly describes application profile/role/account separation; its OS/disk-access exclusion does not grant a renderer-only viewer host execution.

Second source review: Verified schema acceptance of graphJson/cronExpr, default enabled graph storage, enabled cron selection, scheduler calling runScheduledWorkflowFire, execution_mode graph, dryRun default false and registry execution. Account resolution deliberately skips workflow authoring channels. Manual execution's admin gate does not run on cron firing.

Assigned source 374fcd79-f6b4-4fe0-9fa9-bf807f27f7a9:1: Parent traced the real schema/IPC wrapper, enabled workflow store, cron installation, scheduled trigger, graph executor and Python/VM sinks. A schedule-triggered graph requires no mail message. Code is not interpolated from inbound content; the attack is unauthorized authoring.

Assigned source 61ab0f3d-38ae-4587-a421-de63347b1639:4: Verified import/create/update activation, enabled-store selection, cron callback and graph dispatch into executable nodes. Genuine sessions are enforced, but no owner/admin recheck reaches the scheduled path. TestWorkflowOnMessage forces dryRun and is not the proven code-execution path.

Assigned source adae8751-0a17-49fc-a285-f8a4574c7953:2: Traced persisted graph/cron input into scheduler, scheduled executor and graph runtime. Direct ExecuteWorkflowNow requires owner/admin at electron/ipc/workflow.ts:63-70, but this check is absent from creation/update/import and automatic execution. Python requires installed python3; JavaScript host objects are also passed into vm. No exploit was executed.

Assigned source 1134688b-c6f4-4ad3-aedd-9b4e4922ecc7:3: Verified CreateWorkflow schema accepts graphJson, cronExpr and enabled; the store preserves them and cron schedules enabled rows. runScheduledWorkflowFire calls the executor with schedule direction and no dryRun; createWorkflowContext defaults false. Graph parsing accepts registry nodes, and runtime executes code.javascript or code.python. Host Date.constructor provides the host Function constructor and process access; Python directly uses spawnSync where installed. Update/import and restoring a graph into a scheduled workflow share the missing role control.

Assigned dedup-0010 source 1, source-reported static validation: Verified default real-session protection, permissive graph/cron mutation, enabled stored workflow selection and live schedule dispatch through workflow-executor.ts:53-69/runtime.ts:147-162. The inbound condition gate only applies inbound direction; dryRun defaults false at context.ts:141. The privileged manual route is bypassed by the scheduler. Code-node descriptions warn trusted code only, so the failure is authorization to install code, not an alleged sandbox promise.

Assigned dedup-0011 source-reported offline static validation: Traced permitted preload invocation, payload schema, default auth guard, graph persistence, cron setup and scheduled graph dispatch to the JavaScript/Python implementation. Manual execution is admin-gated but is not called by the scheduler. The supplied host Date object exposes its host Function constructor; the Python node directly invokes python3. No exploit executed.

Assigned dedup-0012 source-reported static validation: Verified automatic activation through create/update/import, enabled cron selection, runScheduledWorkflowFire and graph execution with no dryRun/actor. Manual execute's owner/admin gate is not used. Code nodes are registered and accept stored configuration; Date and other host objects in vm permit outer-realm execution, while Python directly invokes a subprocess.

Assigned dedup-0013 source-reported static validation: Verified schemas accept graphJson/cronExpr/enabled, storage defaults enabled and graph mode, cron consumes enabled rows, schedule execution omits dryRun, and registry dispatch executes code.javascript. Host-realm Date in the VM gives access to its host Function constructor; Python provides a second explicit OS execution sink when installed. Updates, JSON/file imports and restoration feed the same active graph path. Direct test runs force dryRun but cron does not.

**Grenzen laut Worker:**

- No application or exploit executed.
- Single-user desktop deployments without lower-trust app accounts do not expose this privilege boundary.
- No claim of protection against an attacker already controlling the OS account.
- No exploit or application code executed; production use of multiple local roles is unknown.
- Python is an additional execution sink only where python3 is installed.
- Static validation only; no runtime reproduction.
- Local user role isolation must matter in the deployment; if all desktop users are fully OS-trusted, host-execution impact adds no new OS authority.
- Python requires a local python3 executable. JavaScript nodes explicitly disclaim hostile-code sandboxing.
- No code executed, application launched, or source changed.
- dedup-0005 assigned source confidence medium reflects unresolved desktop trust assumptions, whereas prior aggregate confidence high reflects the static path. Both are preserved. Host execution is a new application authority only where agent/viewer users are less trusted than the Electron OS identity; not OS-user privilege escalation.
- No application or exploit execution; deployment assumptions unresolved.
- Offline static proof only; no VM or process execution.
- Actual OS resources reachable are bounded by Electron's OS user permissions.
- Desktop application account boundary, not a server tenant or unauthenticated mail-sender exploit.
- Python branch requires python3; JavaScript branch has independent host-realm exposure.
- Desktop UI says full local control; deployments intentionally trusting every local application user have reduced incremental impact.
- Desktop UI explicitly enables edit/manage/run for !serverClientMode and describes desktop full local control; lower-trust app-role isolation remains deployment-dependent. Historical investigator high severity and final medium severity stay attributed. Real sessions/manual execution gates/test dry-run do not protect scheduled activation.
- No application code or exploit executed.
- Production deployment and local role use remain unspecified.
- Same enabled scheduled graph path from session-only create/update into host JavaScript/Python execution. JavaScript host Date constructor and python3-dependent subprocess remain distinct sinks within the established complete trusted-code-authoring/activation remediation; no mailbox message or preexisting OS authority required.
- No runtime exploit or process started; actual nonadmin desktop use and python3 availability unverified.
- No application code or exploit was executed.
- Requires local authenticated agent/viewer; no email-author-only or unauthenticated remote path established.
- Python sink depends on python3 availability; JavaScript path does not.
- No application code or PoC executed.
- Requires authenticated desktop IPC.
- Python availability is host-dependent.

**Gegenbelege laut Worker:**

- Requires an authenticated local renderer session; unauthenticated IPC is rejected.
- JavaScript/Python are documented trusted-code features; the defect is who can persist and schedule those features.
- A caller already possessing the app user's arbitrary OS execution would gain no new authority; the reported boundary is lower-role renderer/application access.
- Manual live execution is owner/admin gated.
- Code node dry runs skip execution, but scheduled execution is live.
- Node descriptions correctly warn they are not sandboxes; they do not restrict authors.
- Python requires python3 on PATH; JavaScript VM exposes host objects and is explicitly not isolated.
- Server rejects code nodes; desktop-only.
- ExecuteWorkflowNow owner/admin and TestWorkflowOnMessage dryRun do not apply to cron
- Python requires python3 installed; JavaScript does not
- Trusted admin execution intentional; vulnerable grant to agent/viewer
- Real authenticated profile required.
- Direct execute-now is owner/admin protected and test-on-message forces dry-run; cron does neither.
- Code node descriptions explicitly warn of trusted-code/full OS access; this is an author-authorization failure, not a claim that VM was promised secure.
- Python installation conditional; JavaScript is registered unconditionally.
- No plugin installation or preexisting disk control is assumed.
- Unauthenticated sessions rejected by IPC; local app session required.
- Manual execute is admin-gated and test-on-message forces dry run, but cron uses neither route.
- Trusted administrator-authored code is intentional; finding concerns lower-role activation.
- Single OS-user/no disk-protection model limits impact claims to app/renderer boundary.
- Real authentication required; this is not remote unauthenticated execution.
- Code schema does not interpolate ordinary mail text into code.
- Host operators or users already possessing equivalent OS execution gain no new authority; finding concerns the application-role boundary.
- No production deployment or runtime reproduction supplied.

**Vorgeschlagene Korrektur, nicht als umgesetzt bestätigt:**

Require owner/admin or equivalent trusted-code administration for all executable workflow creation, changes, enablement, imports, restores and automatic trigger activation. Keep unapproved imports disabled. Bind execution to an authorized author or explicit administrator approval and revalidate before firing, including revocation. If less-trusted authoring is supported, prohibit privileged code nodes or use real OS isolation. Cover file-based bundle import and version restore explicitly, as well as account-free cron schedules. Revalidate the approved graph revision as well as the author: a subsequently changed unapproved revision must not inherit approval.

**Vorgeschlagene Regressionstests, nicht als ausgeführt bestätigt:**

- Viewer/agent create, update and import of executable scheduled workflows must be denied.
- Cron execution must reject workflows whose initiating authority is absent or revoked; authorized owner workflows must continue working.
- Agent/viewer create and update of code-bearing or scheduled workflows must fail before persistence and cron reload.
- Owner/admin-created schedules continue to execute; revoking an author must not leave unauthorized schedules active.
- Agent/viewer cannot save/import/enable a scheduled code graph.
- Cron refuses a workflow whose trusted-author approval is absent or revoked.
- Owner-approved non-code and code workflows retain their intended behavior.
- Agent/viewer cannot activate a scheduled executable workflow via any mutation/import/restore path.
- Owner/admin activation works and dry-run continues to skip code execution.
- Exercise the real public handler with the least privileged caller and confirm the sensitive operation is denied.
- Retain successful authorized operations and the effective existing guard cases.
- A non-admin cannot persist or enable JS/Python code via create/update/import/restore or schedule it indirectly.
- Revoked/demoted author or changed unapproved revision cannot execute in background.
- Authorized declarative workflows and admin code workflows retain intended behavior.
- As agent/viewer, reject executable workflow create/update/import/restore/schedule changes before persistence or cron registration.
- Confirm owner/admin workflows still execute and a revoked author's queued authority is not silently retained.
- Test scheduled execution separately from ExecuteWorkflowNow and forced dry-run.
- Verify the described operation is denied to an authenticated user without the required role/mailbox grant.
- Verify explicitly authorized operations continue to work.
- Agent/viewer cannot activate executable code graphs through create, update or either import path.
- Manual and cron execution enforce the same authority.
- Nonadmin workflow templates cannot indirectly introduce code/plugin nodes.
- Agent/viewer cannot create or activate an executable scheduled graph, update an existing graph, import either bundle form, or restore an active version.
- Owner/admin scheduling still works; dry-run test endpoints never execute code.
- Test all mutating workflow IPC channels against the same authorization policy.
- Assert lower-role users cannot persist or activate executable graphs through any writer; assert direct and scheduled paths apply the same privilege policy.
- Non-admin create/update/import/restore cannot activate executable or privileged workflows.
- Cron activation and execution enforce current privileged author/approver authority.
- Safe test capability remains distinct from host execution.
- Reject scheduled executable CRUD/import for restricted users.
- Owner/admin execution follows explicit policy.
- Privilege changes prevent untrusted executable graphs running.
- A viewer cannot activate or modify a scheduled graph containing code.javascript, code.python or privileged plugins.
- Create/update/import/file-import/version-restore and scheduled execution must all enforce the same trusted-code authorization.
- Agent/viewer attempts to create/import/update/restore code-bearing scheduled workflows must fail.
- Confirm scheduled execution cannot bypass the same policy used for manual execution.

### 2. Read-only desktop mailbox delegates can schedule or retry outbound mail

Worker-Kennung: incorrect-authorization.desktop-scheduled-send.

**Status:** offen; keine Behauptung einer Behebung im PR.

**Gemeldete Einstufung:**

- **level**: low
- **rationale**: Medium integrity impact and medium likelihood: confined to a mailbox the authenticated local user can already read, requires configured SMTP and running desktop background services.

**Gemeldete Nachweissicherheit:**

- **level**: high
- **rationale**: Independent static comparison confirms ro scheduling, actorless worker and SMTP sink; no email was sent.

**Beschreibung:**

A desktop user with only ro mailbox access can create/edit a draft, schedule it with outbound approval, or retry it for immediate transmission. The background processor sends through that mailbox's credentials without carrying or rechecking the initiating user's write authority, bypassing the rw gate on direct send.

**Quellorte des Ausgangsstands:** `electron/ipc/email.ts:676`, `electron/ipc/email.ts:733`, `electron/ipc/register.ts:51`, `electron/ipc/email.ts:950`, `electron/email/email-scheduled-send.ts:74`, `electron/email/email-compose-send.ts:570`, `electron/ipc/email.ts:1327`, `electron/ipc/email.ts:961`, `electron/ipc/email.ts:1003`, `electron/ipc/email.ts:1342`, `electron/email/email-scheduled-send.ts:70`, `electron/ipc/email.ts:678`, `electron/ipc/email.ts:699`, `electron/email/email-message-features.ts:15`, `electron/email/email-imap-services.ts:229`, `electron/email/email-compose-send.ts:571`, `electron/ipc/register.ts:49`, `electron/ipc/email.ts:1002`, `electron/ipc/email.ts:1345`, `electron/email/email-scheduled-send.ts:72`, `electron/email/email-compose-send.ts:569`

**Gemeldete Ursache:**

Draft creation, editing and scheduling use `registerIpcHandler`'s default `ro` access. Scheduling stamps outbound approval and a due time. `processDueScheduledSends` later reloads the draft and calls the sender without the initiating identity, so the `rw` gate present on direct `SendCompose` is never reached. RetryScheduledSendDraft is another affected entrypoint: it clears scheduled-send metadata and sets the due time to now under the same default ro registration. A 30-second service timer consumes due drafts.

Assigned dedup-0014 synthesis: Same correctly scoped read-only draft creation/edit, scheduling/retry and actorless deferred SMTP. Existing write/send gates and delivery-time actor reauthorization cover all paths. Incoming medium severity/high impact differs from previous low/medium; both remain attributed.

**Prüfmethode laut Worker:**

Source-reported independent static reviews; reducer performed semantic comparison only

**Validierungszusammenfassung laut Worker:**

First source review: Account lookup restricts the attack to an accessible mailbox, but account-access rank explicitly permits ro for these handlers. The worker passes that mailbox's draft into `sendComposeDraft`; draft/account matching, recipient validation, outbound workflow review and duplicate-send protection enforce content/lifecycle rules, not permission to send.

Second source review: Independently checked draft creation/update, schedule/retry registrations, numeric and object account resolution, shared ro default, complete due worker, due SQL and 30-second service timer. sendComposeDraft checks draft/account consistency, recipient format and outbound workflows but has no account-grant principal. A valid ordinary new draft and SMTP-configured mailbox suffice when outbound content rules allow it.

**Grenzen laut Worker:**

- Requires a configured sending mailbox and active background services.
- No runtime or mail delivery test.
- Desktop app profiles share OS storage; this reports application permission enforcement only.
- No mail sent and no runtime test.
- No grant still blocks these correctly resolved mailbox paths; this finding requires ro access.
- Outbound workflow blocks, valid recipients, mailbox configuration, app service lifetime and due-state checks remain effective.

**Gegenbelege laut Worker:**

Keine Angabe.

**Vorgeschlagene Korrektur, nicht als umgesetzt bestätigt:**

Require mailbox write/send authority for draft creation/editing, scheduling, approval and retry. Persist an authorized initiating actor or explicit service capability and revalidate effective send permission before transmission, including revocation between queueing and execution. Preserve recipient, draft/account, outbound-workflow, due-state and duplicate-send controls.

**Vorgeschlagene Regressionstests, nicht als ausgeführt bestätigt:**

- A ro delegate cannot schedule, retry or approve delivery of a draft.
- Direct and scheduled send share the same mailbox send-permission decision.
- A ro account cannot create/edit/schedule/retry mail, while rw users can.
- Revoking write permission before a due send prevents transmission; content-policy blocks still apply.
- A read-only user cannot create/update outbound drafts or schedule/retry delivery.
- Revoking send access after scheduling prevents delivery, while an authorized writer's allowed message still sends.

### 3. Desktop workflow HTTP redirects and DNS changes bypass the destination guard

Worker-Kennung: ssrf.desktop-workflow-http.

**Status:** offen; keine Behauptung einer Behebung im PR.

**Gemeldete Einstufung:**

- **level**: medium
- **rationale**: The assigned Standard source rates this medium: Potentially high network confidentiality/integrity impact, but exploitation requires a configured workflow and attacker influence over an allowed endpoint or its DNS. Actual impact depends on reachable local services; localhost and conditional exposure warrant medium. The established aggregate rated it low: Internal HTTP interaction is established, but sensitive service impact and exfiltration depend on deployment and downstream workflow configuration. Likelihood is medium because a real workflow must contact an attacker-influenced allowlisted endpoint. Both assessments are preserved and unresolved; this reducer performed no new validation.

**Gemeldete Nachweissicherheit:**

- **level**: high
- **rationale**: Both source reviewers and parent verified preflight followed by native unpinned fetch without redirect controls; no network was contacted.

**Beschreibung:**

An attacker-influenced already allowlisted endpoint can redirect a live desktop http.request workflow to a private or off-allowlist destination; cross-host 307/308 redirects can retain POST bodies. The guard discards validated addresses, leaving a second DNS resolution unbound to its check. An inbound sender can select an existing open redirect only when configured URL interpolation permits it. The response enters http.body after full reading and an 8,000-character output slice; attacker disclosure requires a downstream consumer. The assigned source also confirms initial private/off-list targets and empty allowlists fail closed, and that the server's pinned transport is outside this desktop instance.

**Quellorte des Ausgangsstands:** `electron/workflow/http-request-guard.ts:7`, `electron/workflow/nodes/integration-nodes.ts:89`, `electron/workflow/nodes/integration-nodes.ts:88`, `electron/workflow/nodes/integration-nodes.ts:104`, `electron/workflow/http-request-guard.ts:21`, `packages/core/src/workflow/schema/integration.ts:84`, `electron/workflow/nodes/integration-nodes.ts:85`, `electron/workflow/http-request-guard.ts:1`, `shared/workflow-http-allowlist.ts:86`, `electron/ipc/workflow.ts:53`, `electron/workflow/http-request-guard.ts:6`, `electron/workflow/nodes/integration-nodes.ts:97`, `shared/workflow-http-allowlist.ts:105`, `shared/workflow-http-allowlist.ts:107`, `electron/workflow/http-request-guard.ts:11`, `electron/workflow/runtime.ts:147`, `electron/workflow/nodes/integration-nodes.ts:83`, `electron/workflow/runtime.ts:146`, `electron/workflow/nodes/integration-nodes.ts:82`, `shared/workflow-http-allowlist.ts:94`, `shared/workflow-http-allowlist.ts:98`, `electron/workflow/nodes/integration-nodes.ts:91`, `electron/workflow/runtime.ts:161`, `electron/ipc/workflow.ts:65`

**Gemeldete Ursache:**

`assertWorkflowHttpUrlAllowed` validates the initial URL and resolves public IPs, then discards them. `http.request` independently fetches the original URL with default redirect handling. Neither redirected destinations nor the address used by the eventual socket are bound to the successful check. The active main/IPC/executor/runtime/registry chain uses this node, not the stronger server or desktop-webhook transport. Interpolation occurs before validation and is not itself an independent bypass. For DNS-only rebinding, fetch-time resolution must change; HTTPS also requires successful TLS verification, while HTTP avoids that certificate prerequisite.

The assigned source again constrains initial URLs to a nonempty allowlist and GET/POST, with no demonstrated sensitive private service or extraction workflow. Its medium impact/medium likelihood assessment is preserved alongside earlier unknown/medium impact and low/medium likelihood assessments.

Additional source: The node calls assertWorkflowHttpUrlAllowed once, then invokes global fetch without redirect restrictions or a pinned lookup. An external responder controls Location, which fetch follows without reusing the host/private-address policy. The preflight DNS lookup also returns no connection-bound address, leaving lookup/connect rebinding at the same network-control boundary.

Assigned dedup-0005 source: The incoming review again distinguishes the allowed endpoint/DNS controller from a workflow author, the empty-allowlist and dry-run controls, and the separately pinned server/desktop-webhook transports. No concrete sensitive internal service or attacker receipt of response bytes is established.

Assigned dedup-0008 source: The attacker can control or compromise an already-contacted allowlisted endpoint without being a workflow author. Keep GET/POST, nonempty allowlist, effective initial private-address rejection and dry-run early return as counterevidence. Actual private-service consequences and response exfiltration remain environment/downstream dependent; no network reproduction is established.

Assigned dedup-0009 source: Destination validation is a one-time preflight separated from the actual fetch. Fetch's default redirect handling follows the server's Location values without re-entering the allowlist/private-address guard. Keep allowed-endpoint control distinct from workflow authoring; initial private-address/empty-allowlist rejection, GET/POST restrictions, dry-run and deadline remain effective.

Assigned dedup-0009 source: The DNS check and socket connection are separate resolutions. Approved addresses are discarded, allowing the later resolver answer to differ from the security decision. DNS-only rebinding survives a redirect-only fix. Incoming low severity/high confidence is preserved alongside the prior medium overall rating. Resolver caching/timing and, for HTTPS, successful certificate verification remain prerequisites.

Assigned dedup-0010 synthesis: Incoming final low severity/medium impact/medium likelihood remains alongside retained medium. GET/POST, empty-allowlist rejection, dry-run and timeout remain effective. Incoming recommends both runtimes but reports guarded/pinned server counterevidence; no new server vulnerability inferred.

Assigned dedup-0011 synthesis: Same initial-only desktop allowlist/DNS validation followed by ordinary fetch, retaining redirect and fresh-DNS destination substitution. Control of an already-allowed endpoint suffices; trusted-code authoring is not assumed. Sensitive internal service and downstream disclosure remain conditional. Separate pinned server transport is counterevidence, not a new server finding.

Assigned dedup-0012 synthesis: Same initial-only desktop http.request guard and unpinned fetch. Retained fix covers both redirect validation and DNS connection binding; redirect-only remediation is insufficient. Preserve configured allowlist, endpoint/DNS control, GET/POST, dry-run, server guarded-transport counterevidence and conditional downstream disclosure.

Assigned dedup-0013 synthesis: Same initial-only desktop http.request allowlist/DNS guard followed by automatic redirects and unpinned fetch. Complete retained remediation validates every hop and pins approved addresses, including 307/308 POST forwarding. Preserve configured endpoint control, GET/POST, dry-run and server guarded-transport counterevidence; downstream exfiltration remains conditional.

Assigned dedup-0014 synthesis: Same initial-only desktop URL/DNS check followed by unpinned automatic-redirect fetch. Existing per-hop validation and connection pinning cover both. Redirect-only remediation insufficient; response allocation remains separate. Preserve allowlisted endpoint/DNS control, GET/POST, dry-run and conditional internal impact.

Assigned dedup-0015 synthesis: Same initial-only desktop HTTP URL/DNS validation followed by unpinned automatic redirects. Complete remediation validates every hop and pins connections; redirect-only fixes leave DNS substitution. Preserve 307/308 POST bodies, allowlist, GET/POST, dry-run and conditional internal impact/downstream disclosure.

Assigned dedup-0016 synthesis: Same desktop http.request initial-only destination guard and unpinned native fetch. The retained all-hop allowlist/public-address validation and connection pinning cover this redirect/DNS instance. Existing GET/POST, cross-host body, downstream disclosure and separate response-size limitations remain.

Assigned dedup-0017 synthesis: Same initial desktop HTTP check disconnected from redirect/DNS transport. Pin every validated connection and check every redirect; preserve POST 307/308 body forwarding, TLS and downstream disclosure prerequisites.

**Prüfmethode laut Worker:**

Source-reported validation preserved; dedup-0013 performs supplied-artifact semantic reduction only

**Validierungszusammenfassung laut Worker:**

Previous aggregate (dec8d119-8830-4aed-98ba-e0c75791dc98:2, d604098d-2334-464f-accc-2550fface16c:3): First source review: The node calls the guard before native fetch but supplies no redirect policy, pinned lookup or revalidation. Initial private destinations and empty allowlists fail closed, and dry-run returns before fetch. The server's separate pinned guarded transport is not affected by this desktop path. URL interpolation before validation can make an existing open redirect selectable by inbound data, but that workflow configuration is an additional prerequisite.

Second source review: Reviewed complete desktop integration node, URL guard, shared allowlist and runtime interpolation. Private direct URLs and empty allowlists are rejected; no wrapper replaces this global fetch. Server workflow and desktop webhook transports explicitly use pinned/manual redirect handling, which is not called by this node.

Assigned worker 8 (d185d3ef-8bf7-4adb-8a2e-6d8e1566900e:8): Confirmed main -> workflow IPC/executor -> runtime -> registry -> integration node is active. Interpolation precedes initial validation, so it is not a separate bypass. Initial allowlist/private-IP checks and GET/POST restriction are effective only for the first URL. No redirect callback, manual redirect mode or pinned transport is supplied. Server webhook/HTTP code has stronger guards but is not used by this desktop node.

Assigned source 374fcd79-f6b4-4fe0-9fa9-bf807f27f7a9:2: Parent independently read the initial host allowlist and DNS guard and the raw fetch options. Neither redirect:'manual' nor a pinned dispatcher is supplied. Response text is placed in http.body for subsequent nodes. Server's separate guarded/pinned transport provides counterevidence against extending the finding to server mode.

Assigned source 40e94555-7994-4e03-8422-151a4cc8752f:3: Verified enabled registered http.request node reads global allowlist, checks original URL/DNS, then directly fetches with GET/POST and timeout only. The response is read into workflow variables. An endpoint-controlled redirect changes the destination after the sole validation.

Assigned source 61ab0f3d-38ae-4587-a421-de63347b1639:3: Confirmed registered http.request node uses this boolean guard and ordinary global fetch. Initial private/literal/DNS targets and empty allowlists are rejected, but no guard runs for redirect hops and no checked IP is bound to the connection. The separately protected server transport does not protect this desktop node.

Assigned source adae8751-0a17-49fc-a285-f8a4574c7953:3: Inspected the full allowlist and DNS guard plus live http.request consumer. Empty allowlists and direct private URLs are rejected; no redirect policy/pinned transport is supplied. Server pinned-webhook controls are separate and not called by this desktop node.

Assigned source a72abecd-f31f-4abc-bacb-afd48bf1085c:2: Confirmed the normal integration node uses plain fetch without redirect:'manual' or pinned connection. Dry-run returns before the sink and initial private/allowlist checks are effective. Server workflow HTTP instead uses guardedFetch and createPinnedFetch, so the report is desktop-specific.

Assigned source 705c5481-2d05-4afc-bc67-518d631d7500:2: Parent inspected complete desktop guard and HTTP node. Empty allowlists fail closed, initial private addresses are rejected, only GET/POST and a timeout are allowed, and dry runs skip fetch. None validates actual redirected hops. The server equivalent calls guardedFetch with manual redirects and pinned addresses, which the desktop node does not use.

Assigned source 705c5481-2d05-4afc-bc67-518d631d7500:3: Parent inspected both consumers and contrasted server pinned-fetch. Initial checks are real, but there is no binding between their returned addresses and desktop fetch. This survives a redirect-only fix. No DNS service, rebinding input or network request was executed.

Assigned dedup-0010 source 0, source-reported static validation: Confirmed that live graph execution calls this node, private/loopback destinations are explicitly blocked by the initial guard, and the guarded URL reaches an independent global fetch that follows redirects. Dry-run returns before fetching, and an empty allowlist fails closed; neither protects live calls to an allowed remote endpoint.

Assigned dedup-0011 source-reported offline static validation: Verified the complete desktop guard and http.request implementation. A public endpoint returning a redirect is sufficient and does not require the attacker to author trusted code. The 30-second timeout is a duration bound, not a destination control. The hardened server uses a distinct pinned redirect-validating transport and is not affected by this path.

Assigned dedup-0012 source-reported static validation: Verified actual graph dispatch and the registered desktop http.request node, its initial host/private-IP checks, and the separate unguarded fetch. Compared server implementation, which uses guardedFetch plus createPinnedFetch, to avoid incorrectly reporting both editions.

Assigned dedup-0013 source-reported static validation: Confirmed the desktop registry registers http.request, accepts only GET/POST, checks initial URL/DNS, and fetches only outside dry-run. No redirect option or subsequent hop validation exists. Server pinned-fetch/guardedFetch controls are separate and not imported by this desktop node.

**Grenzen laut Worker:**

- No live DNS or redirect reproduction.
- No specific internal service compromise or credential theft established.
- Response exfiltration requires an appropriate downstream workflow operation.
- No DNS, HTTP request, redirect or runtime reproduction performed.
- Specific internal service consequences depend on the desktop network and configured workflow successors.
- Source assessment difference retained: the first review rates impact unknown and likelihood medium; the second rates impact medium and likelihood low, including POST-body forwarding. Both assign overall low severity; the reducer has not resolved deployment-dependent consequences.
- No network, DNS rebinding or internal request executed.
- No automatic exfiltration path shown; local automation separately requires authentication.
- Manual execution is privileged, but attacker is endpoint operator distinct from author.
- Latest assigned worker also reports medium potential impact/low likelihood with overall low severity; prior unknown/medium impact and medium/low likelihood assessments remain attributed in sourceAssessments. No deployment consequence is resolved by this reduction.
- Static validation only; no runtime reproduction.
- No live network test. Internal-service impact and response exfiltration depend on installation and downstream workflow use.
- The additional source explicitly rates potential internal-request impact medium and likelihood medium, while the existing aggregate retains unknown impact and earlier low/medium likelihood assessments. No sensitive private service, attacker receipt of response bytes, or production exploitation is established.
- Requires a controlled endpoint/redirect or DNS within the configured allowlist.
- No DNS queries, network request or private service access performed.
- Concrete sensitive internal service and data exfiltration destination are deployment-dependent.
- dedup-0005 assigned source rates impact medium and likelihood medium; earlier unknown/medium impact and low/medium likelihood assessments remain attributed without resolution.
- No application or exploit execution; deployment assumptions unresolved.
- No network requests or rebinding experiment performed.
- Enabled HTTP workflow and attacker-influenced contacted host required; internal-service impact depends on host environment.
- No application execution, live requests or deployed configuration inspection.
- Keep allowed-endpoint control distinct from workflow authoring; initial private-address/empty-allowlist rejection, GET/POST restrictions, dry-run and deadline remain effective.
- DNS-only rebinding survives a redirect-only fix. Incoming low severity/high confidence is preserved alongside the prior medium overall rating. Resolver caching/timing and, for HTTPS, successful certificate verification remain prerequisites.
- No HTTP requests or application execution; no actual internal service/deployment confirmed.
- The server implementation uses a different guarded/pinned fetch path.
- Incoming final low severity/medium impact/medium likelihood remains alongside retained medium. GET/POST, empty-allowlist rejection, dry-run and timeout remain effective. Incoming recommends both runtimes but reports guarded/pinned server counterevidence; no new server vulnerability inferred.
- No application execution, exploit inputs or network testing.
- Impact prerequisites: Enabled desktop HTTP workflow using an attacker-controlled or compromised allowed public endpoint; a reachable internal service is required for material impact.
- Same initial-only desktop allowlist/DNS validation followed by ordinary fetch, retaining redirect and fresh-DNS destination substitution. Control of an already-allowed endpoint suffices; trusted-code authoring is not assumed. Sensitive internal service and downstream disclosure remain conditional. Separate pinned server transport is counterevidence, not a new server finding.
- No demonstrated internal target or live exploit; severity depends on local network services.
- No network test performed.
- Requires an enabled HTTP workflow using an attacker-influenced allowed endpoint.
- Unconditional response exfiltration, metadata credential theft or internal-service compromise is not established.
- No live redirect or DNS-rebinding test; no production exposure assumed.
- Reading response data out to the attacker requires a later workflow action or another observation path; the internal request itself is established.
- No network or runtime test.
- No specific internal service or concrete secret exposure established.
- No runtime or external network testing. DNS rebinding is an additional consequence of the same unbound validation, not dynamically reproduced.

**Gegenbelege laut Worker:**

- Requires an allowlisted endpoint response under attacker influence; an arbitrary unapproved initial host is blocked.
- Only GET/POST are permitted and timeout is 30 seconds.
- Retrieving a response into workflow variables does not itself prove it is returned to the external attacker.
- Initial URL requires a nonempty allowlist and passes private-address checks.
- Only GET/POST and a timeout allowed.
- Requires attacker control of contacted approved endpoint/DNS or an open redirect; no remote workflow-authoring assumption.
- No sensitive private service or extraction workflow has been demonstrated.
- Empty/invalid allowlist fails closed, initial URL must be HTTP(S) and pass public address checks.
- Dry-run skips network; methods limited GET/POST and 30-second timeout.
- Workflow author need not be attacker; attacker controls the authorized remote endpoint.
- Server edition has separate pinned-fetch/redirect controls; finding is desktop-specific.
- empty allowlist/direct private URL blocked
- requires configured workflow reaching attacker endpoint
- other pinned server transport is not used here
- Initial URL and DNS check work
- Dry-run returns before fetch
- Method allowlist and timeout do not constrain redirect host
- Server uses pinned guardedFetch
- Requires enabled workflow contacting attacker-controlled endpoint
- The allowlist is empty by default and blocks initial private/reserved hosts.
- An attacker must control a service/DNS under a configured allowed host or a suitable redirect endpoint.
- Server edition uses a different guarded/pinned request path; this finding applies to desktop.
- 30-second timeout and an 8000-character returned body limit constrain duration/output, but not destination.
- Empty allowlists fail closed; initial private addresses are rejected; only GET/POST are supported; requests time out after 30 seconds.
- No proof of a deployed workflow or reachable sensitive internal service was supplied.

**Vorgeschlagene Korrektur, nicht als umgesetzt bestätigt:**

Use one guarded desktop HTTP transport that pins every actual connection to validated public addresses and rejects redirects or processes them manually with the same scheme/host/IP/allowlist checks at every hop. Preserve TLS hostname verification, bound redirect count, share one overall deadline, and prevent cross-host 307/308 request-body forwarding outside policy. Retain the earlier streaming response-byte recommendation, but separately remediate all clients in uncontrolled-resource-consumption.desktop-response-bodies; fixing destination validation alone does not bound response allocation.

**Vorgeschlagene Regressionstests, nicht als ausgeführt bestätigt:**

- Desktop node rejects private and off-allowlist redirects.
- Desktop socket uses only addresses that passed validation, including after redirects.
- Allowed public URL redirecting to loopback/private/unapproved hosts must be rejected.
- A DNS change after validation must not alter the connected address.
- Cross-host 307/308 redirects must not forward request bodies outside policy.
- Redirects from allowed hosts to off-list, loopback and private addresses fail before connection.
- DNS changes between check and connect cannot select unchecked IPs.
- Allowed public requests work with bounded redirect handling.
- Allowed endpoint redirect to loopback/private/unlisted host is rejected before connection.
- DNS cannot resolve differently between validation and connect.
- Approved public redirect succeeds within the same timeout/size budget.
- A redirect from an allowed public endpoint to loopback/private/unlisted host must perform no second request.
- Changing DNS between validation and connect must not reach an unvalidated address.
- Desktop HTTP node must reject redirect from allowed public host to loopback/private/off-list host.
- Ensure the actual connection uses the validated address despite subsequent DNS changes.
- Exercise the real public handler with the least privileged caller and confirm the sensitive operation is denied.
- Retain successful authorized operations and the effective existing guard cases.
- Reject public-to-loopback/private and off-allowlist redirects, including method-preserving POST redirects.
- Ensure DNS changes after preflight cannot change the connected address.
- An allowed public endpoint redirecting to loopback, private IP or an unlisted host must never cause that connection.
- Simulate public then private DNS answers and assert the connection uses only the validated public address.
- Redirect an allowed endpoint to loopback/private/non-allowlisted hosts and assert no connection occurs.
- Check 307/308 POST redirects and changed DNS answers between validation and connection.
- Ensure valid public hops still work within a bounded redirect count.
- Add a regression test for the stated boundary that verifies the prohibited effect is rejected before the sensitive operation.
- An allowed endpoint redirecting to loopback/private/unlisted hosts is rejected before the follow-up connection.
- DNS changes between validation and connection cannot change the socket destination.
- Desktop and server request paths enforce the same destination rules.
- An allowlisted public endpoint redirecting to loopback, private or off-allowlist hosts must cause no request to that target.
- A 307/308 redirect must not forward POST data before validating its destination.
- DNS rebinding between validation and connection must not change the connected address.
- Verify an allowed endpoint redirecting to private/nonallowlisted addresses is rejected before the next connection.
- Verify the connection uses the validated address even if subsequent DNS differs.
- Allowed public endpoint redirecting to loopback, private IPv4/IPv6, link-local or an unlisted host is denied at every hop.
- Validated DNS address remains pinned through connection while preserving TLS hostname verification.
- Use a public-looking allowlisted endpoint returning a redirect to loopback/private IPv4 and IPv6, and assert no second connection occurs.
- Change DNS answers between validation and connection and verify the transport connects only to validated addresses.
- Reject redirects to loopback/private/unlisted hosts.
- Revalidate each allowed redirect and pin approved addresses.
- Apply one deadline and response-byte cap.
- An allowed endpoint redirecting to 127.0.0.1, link-local, private IPv4/IPv6 or a nonallowlisted hostname must be blocked before connection.
- Changing DNS after validation must not change the connected address.
- An allowed host redirecting to loopback/private/off-list targets is rejected before connection.
- A DNS change between validation and connection cannot redirect the socket away from the validated address.

### 4. Desktop users can open or save attachments from unauthorized mailboxes

Worker-Kennung: missing-authorization.desktop-attachment-id.

**Status:** offen; keine Behauptung einer Behebung im PR.

**Gemeldete Einstufung:**

- **level**: medium
- **rationale**: High confidentiality impact for protected attachments, with medium likelihood because an authenticated local profile and an existing attachment ID are required; no remote unauthenticated exposure.

**Gemeldete Nachweissicherheit:**

- **level**: high
- **rationale**: Parent traced schema, preload allowlist, account resolver, global row lookup and copy/open sinks; no files were opened or copied.

**Beschreibung:**

The attachment save/open IPC handlers accept an attachment ID but never resolve it to an owning mailbox. A logged-in user can select an attachment belonging to a mailbox they cannot read and open it or save a copy.

**Quellorte des Ausgangsstands:** `electron/preload.ts:60`, `electron/ipc/ipc-account-scope.ts:82`, `electron/email/email-message-attachments-store.ts:38`, `electron/ipc/email.ts:2808`, `electron/auth/account-access.ts:7`, `electron/ipc/email.ts:2810`, `electron/ipc/email.ts:2841`, `electron/email/email-message-attachments-store.ts:39`, `electron/ipc/ipc-account-scope.ts:121`, `electron/ipc/email.ts:2830`, `electron/ipc/ipc-account-scope.ts:77`, `electron/ipc/register.ts:89`, `electron/email/email-message-attachments-store.ts:37`, `shared/ipc/email-schemas.ts:1741`, `electron/ipc/email.ts:2832`, `electron/email/email-message-attachments-store.ts:26`, `electron/ipc/email.ts:2809`, `electron/ipc/email.ts:2840`, `electron/ipc/ipc-account-scope.ts:91`, `electron/ipc/register.ts:80`

**Gemeldete Ursache:**

`SaveAttachmentToDisk` and `OpenAttachmentPath` register with authentication alone and pass `attachmentId` to a global SQLite lookup. The central account resolver never maps attachment IDs through their message to an account, so it returns undefined and the wrapper omits the mailbox check. The handlers then copy/open the stored file.

Assigned dedup-0008 source: ListMessageAttachments's message-scoped authorization is not consulted for direct save/open. Native save interaction and risky-file confirmation constrain the attack but do not authorize the reader. Reject missing attachment/message/account links and a forged accountId override before any copy or open.

Assigned dedup-0009 source: Both attachment-ID handlers rely on generic IPC authorization, whose object resolver handles accountId/messageId but not attachmentId. The store returns a global row and the handlers expose its file. Preserve source alias metadata, native save/open interaction, risky-file warnings and independently scoped listing. This host ref belongs here only; the incoming broader resource bundle retains its own distinct ref.

Assigned dedup-0015 synthesis: Same attachmentId save/open lacking authoritative message/account read authorization. Existing parent resolution and fail-closed read check cover both; native dialog, risky-file prompt and authorized message listing are not ownership checks.

**Prüfmethode laut Worker:**

Source-reported static validation preserved; dedup-0009 performed supplied-artifact semantic comparison only

**Validierungszusammenfassung laut Worker:**

First source review: The positive-integer payload schema and preload channel list allow these calls. The attachment row contains message_id, but neither handler uses it for authorization. `ListMessageAttachments` is protected through its bare message-ID resolution; that does not constrain a direct save/open call. Save-dialog confirmation and risky-extension confirmation do not verify mailbox access.

Second source review: Independently traced both IPC handlers, resolver and getAttachmentById. The attachment-list channel resolves its message account, but callers can invoke save/open directly with numeric IDs. The save dialog and executable confirmation are unrelated to mailbox ownership.

Assigned source a72abecd-f31f-4abc-bacb-afd48bf1085c:3: Confirmed global SELECT by attachment ID, absent attachment scope branch, session-only registrations and actual copy/open sinks. Native save dialog and risky-file confirmation constrain interaction but do not authenticate an account-authorized reader.

Assigned source 705c5481-2d05-4afc-bc67-518d631d7500:22: Parent traced both handlers, central resolver and ID-only lookup. Real login, risky-file confirmation and save-dialog selection remain effective, but none authorizes the mailbox. Listing attachments is separately scoped and does not protect guessed direct IDs.

**Grenzen laut Worker:**

- Authenticated local renderer interaction is required; save additionally requires a chosen destination.
- Application profile isolation only; documented OS-account file access remains outside this boundary.
- No runtime reproduction.
- No runtime reproduction or production deployment verification.
- Local legacy per-user account grants are distinct from server mail ACLs.
- Source severity disagreement retained: first review medium overall/high confidentiality impact; second low overall/medium impact. The retained medium assessment preserves the first source's protected-attachment impact; both original assessments remain attributed, without new validation.
- No runtime reproduction, application execution or production access.
- Source only; real deployment not inspected.
- Preserve source alias metadata, native save/open interaction, risky-file warnings and independently scoped listing. This host ref belongs here only; the incoming broader resource bundle retains its own distinct ref.
- No application execution or production testing.
- Requires a real authenticated desktop session and direct IPC access.
- Requires desktop session and valid/guessable integer attachment ID; production use of mailbox ACLs is unconfirmed.

**Gegenbelege laut Worker:**

- Real session required
- List attachments gated by message ID
- Save requires dialog which attacker can complete
- Risky-file confirmation is not authorization

**Vorgeschlagene Korrektur, nicht als umgesetzt bestätigt:**

Resolve each attachment to its message and mailbox, authorize the caller's read access, and only then open/copy it. Fail closed when a protected resource cannot be resolved. Do not let a caller-supplied accountId override the attachment's authoritative parent account.

**Vorgeschlagene Regressionstests, nicht als ausgeführt bestätigt:**

- A user without the attachment's mailbox grant cannot save or open it by ID.
- A permitted reader can still save/open attachments; missing identifiers fail closed.
- Saving/opening an attachment from an ungranted account must fail before dialog or filesystem access.
- Authorized attachment read remains functional.
- Users without target mailbox access cannot open or save its attachment.
- A forged accountId cannot override the account belonging to attachmentId.
- Exercise authorization.desktop-attachment-owner with an unauthorized actor or bounded-input regression and assert no protected sink executes.
- Both direct operations reject unauthorized parent mailbox.
- Authorized read succeeds.
- Supplying forged accountId cannot substitute for stored attachment ownership.
- A user authorized for mailbox A cannot save/open an attachment belonging to B.
- Nonexistent attachment IDs fail closed; owner/admin and authorized account access remain functional.

### 5. Ordinary desktop users can export installation-wide data

Worker-Kennung: missing-authorization.desktop-global-export.

**Status:** offen; keine Behauptung einer Behebung im PR.

**Gemeldete Einstufung:**

- **level**: medium
- **rationale**: High bulk confidentiality impact but medium likelihood: an authenticated local application profile and interactive save destination are required. dedup-0016 rates GDPR-only export low with medium impact; the broader full-backup assessment remains and both ratings are attributed.

**Gemeldete Nachweissicherheit:**

- **level**: high
- **rationale**: Full exporter and IPC policy were reviewed; all queries and attachment directory archive are unscoped. No archive was generated.

**Beschreibung:**

Any authenticated desktop profile can invoke installation-wide GDPR export or full local backup without owner/admin or mailbox authorization. GDPR export includes account metadata, message subjects/snippets, internal notes and optional attachments; the backup copies the full SQLite database and attachment tree, including stored mail bodies, CRM records and local user password hashes. Backup redaction removes only the one-time setup-token row. OS keytar secrets are not copied.

**Quellorte des Ausgangsstands:** `electron/ipc/email.ts:2870`, `electron/email/email-gdpr-export.ts:88`, `electron/email/email-gdpr-export.ts:121`, `electron/email/email-gdpr-export.ts:152`, `electron/auth/account-access.ts:7`, `electron/ipc/email.ts:1132`, `electron/email/email-local-backup-export.ts:100`, `electron/email/email-gdpr-export.ts:103`, `electron/email/email-gdpr-export.ts:151`, `electron/auth/setup-token.ts:75`, `electron/email/email-gdpr-export.ts:90`, `electron/ipc/register.ts:49`, `electron/ipc/email.ts:1133`, `electron/ipc/email.ts:2871`, `electron/email/email-local-backup-export.ts:98`, `electron/ipc/register.ts:72`, `electron/ipc/ipc-account-scope.ts:99`, `electron/ipc/ipc-account-scope.ts:37`, `electron/email/email-local-backup-export.ts:99`, `electron/email/email-gdpr-export.ts:123`, `electron/email/email-gdpr-export.ts:48`, `electron/ipc/ipc-account-scope.ts:35`

**Gemeldete Ursache:**

The `EmailGdprExport` handler has only the default real-session requirement; the channel explicitly skips account resolution. It calls `exportEmailGdprPackage` without an actor. The exporter runs all-account queries and archives the entire attachment directory, so application mailbox grants are never consulted. The sibling `ExportLocalMailBackup` handler has the same authentication-only registration and calls a full database/attachment archive writer. These share the global-export authorization invariant and owner/admin remediation.

Assigned dedup-0007 source: The assigned source preserves the choice of an authorized data-subject request for scoped GDPR export, requiring consistent parent-message/note/attachment authorization. Native output selection and archive caps do not grant access. Keytar credentials remain outside the backup and only the setup token is redacted; previous confirmed local authentication-hash inclusion remains intact. The source's historical baseline high-severity statement is retained in provenance; its final Standard and retained aggregate ratings are medium.

Assigned dedup-0014 synthesis: Same installation-wide GDPR/full-backup export authorization. Existing privileged global export or consistently actor-scoped GDPR queries/files covers both incoming findings, including narrower GDPR alias. Preserve native dialog, 4GiB attachment cap, setup-token redaction, keytar exclusion and full-backup auth hashes.

Assigned dedup-0015 synthesis: Same session-only whole-installation backup/GDPR export. Existing privileged global export or complete actor-scoped GDPR queries and files cover both plus narrower GDPR source. Preserve backup authentication hashes, keytar/setup-token exclusions, GDPR snippets/notes/attachments, native dialog and caps.

Assigned dedup-0016 synthesis: Same globally unscoped authenticated GDPR exporter, already covered by the retained installation-wide GDPR and backup export finding. Owner/admin restriction or complete principal-filtered authorized export closes this subset; full backup requirements remain.

**Prüfmethode laut Worker:**

Source-reported static validation preserved; dedup-0007 performed supplied-artifact semantic reduction only

**Validierungszusammenfassung laut Worker:**

First source review: The preload allowlist includes the export channel and its schema accepts only optional export flags. The exporter has no principal parameter or role check. Secret redaction excludes passwords/keytar but still exports confidential mailbox data. The save dialog selects a destination, not an authorization scope. `docs/MAIL_AUTH_THREAT_MODEL.md:5-7` describes profile/account separation even though direct OS-file access is excluded. Full-backup source confirms a raw database copy with only setup-token redaction; OS keytar contents are not exported. Both export endpoints were verified.

Second source review: Independently inspected the full exporter and generic IPC wrapper. Native save confirmation, exclusion of keychain secrets and a 4-GiB attachment cap do not enforce mailbox authorization. Local legacy account grants normally deny users without a matching account row. Independently reviewed both complete backup modules, generic IPC wrapper and setup-token redaction. Backup redaction deletes only the one-time setup-token sync row; auth-store retains password_hash in the copied database. Native save interaction and 8-GiB attachment cap do not authorize the exporting user.

Assigned source adae8751-0a17-49fc-a285-f8a4574c7953:9: Independently read both export implementations and IPC registrations. Native save dialogs select a destination but do not authorize access to other mailboxes. Keytar contents and setup token are excluded, but stored mail/CRM bodies remain in full SQLite backup; GDPR export independently includes metadata/notes/attachments.

Assigned source 1134688b-c6f4-4ad3-aedd-9b4e4922ecc7:5: Backup helper selects an output path via native dialog and copies userData/database.sqlite plus all email attachments. GDPR exporter queries all accounts/messages/notes and archives all attachments unless explicitly skipped. Neither downstream helper checks caller authority.

**Grenzen laut Worker:**

- Local authenticated profile and interactive save confirmation required.
- No disk-protection claim or live export test.
- GDPR export alone contains index/snippets rather than raw message bodies; full backup contains the complete SQLite database, excluding OS keytar material.
- No runtime reproduction.
- Keytar passwords/API keys are excluded; local user password hashes remain in the complete SQLite copy.
- The second source's older severity/impact wording says passwords and raw RFC822 messages are excluded, while its current summary and validation explicitly include local password_hash records in full backup. Preserve that distinction: keytar plaintext secrets are excluded, but database authentication hashes are included; no broader raw-message-format claim is added.
- No runtime reproduction; local OS account compromise is outside the claimed attacker model.
- No export performed; static validation only.
- No application execution or production testing.
- Requires a real authenticated desktop session and direct IPC access.
- Desktop mailbox-role isolation must be a relied-upon boundary; an attacker already controlling the OS data directory has no new file-access privilege.

**Gegenbelege laut Worker:**

- Native save dialog interaction required; no silent remote export asserted.
- Backup redacts one-time setup token; Keytar-held passwords are outside the archive.
- GDPR message fields are limited rather than full bodies; notes and attachments still disclosed.
- Archive size caps constrain size, not account authority.
- OS filesystem compromise not assumed: exposure occurs through the application.
- OS keytar credentials are not included.
- The user must select a local save destination; attachments may be omitted by option or rejected above 4 GiB.
- Same-OS operators who already can read these files gain no new OS privilege; affected boundary is restricted app users.

**Vorgeschlagene Korrektur, nicht als umgesetzt bestätigt:**

Require owner/admin for both installation-wide GDPR export and full local backup. If delegated scoped exports are supported, pass the actor and filter every account/message/note/attachment against effective permissions; generate an authorized subset and redact authentication records rather than copying the whole database. Keep setup-token redaction and keytar exclusion as independent safeguards. A scoped GDPR alternative must also establish any data-subject-request authority before selecting authorized parent messages, notes and files.

**Vorgeschlagene Regressionstests, nicht als ausgeführt bestätigt:**

- Ordinary profiles cannot request a global export.
- If delegated exports are supported, denied-mailbox metadata, notes and attachments are all absent.
- An agent/viewer with no mailbox grants cannot export global mail data.
- A scoped export must omit inaccessible accounts, notes, metadata and attachment bytes.
- Agent/viewer without an administrator role cannot invoke local backup; verify the export never exposes unauthorized mailbox records or authentication hashes.
- Exercise real IPC payload shapes with an authenticated no-access or read-only user and assert no sensitive service call/data mutation occurs.
- Verify each bulk member is authorized, including mixed-mailbox selections.
- Restricted profile cannot produce global backup or export ungranted account rows/files.
- Scoped GDPR export contains only authorized parent messages and related notes/attachments.
- Authorized administrator backup retains required redaction.
- Assert a lower-role user denied mailbox access cannot export that mailbox's metadata, notes, or attachment bytes.
- Verify viewers and ungranted users cannot create a global export.
- For scoped export assert every query and attachment is limited to the actor's authorized mailbox set.
- Full backup requires administrative export permission.
- GDPR export filters all record types and attachment paths to authorized accounts.
- Denied callers cannot produce partial archives.
- Agent/viewer without global export authority cannot export other accounts' data or attachment files.
- Any per-account export excludes unauthorized notes, workflow-run references, metadata and attachments.
- Owner/admin export still excludes passwords/keytar values and retains the size cap.
- A user without global export permission cannot obtain an archive containing another mailbox's messages, notes or attachments.
- A permitted scoped export includes only authorized accounts, including when attachments are enabled.

### 6. Any logged-in desktop profile can delete another mailbox account

Worker-Kennung: missing-authorization.desktop-account-deletion.

**Status:** offen; keine Behauptung einer Behebung im PR.

**Gemeldete Einstufung:**

- **level**: medium
- **rationale**: High destructive impact to another mailbox configuration/data but medium likelihood: requires a lower-trust authenticated local desktop profile. No remote or unauthenticated access asserted.

**Gemeldete Nachweissicherheit:**

- **level**: high
- **rationale**: Parent verified actual numeric schema, handler options, resolver branch ordering and destructive service calls; nothing was deleted.

**Beschreibung:**

The desktop account-deletion IPC accepts a numeric account ID, but its account-scope resolver only handles deletion's object form. It therefore skips mailbox authorization and deletes the selected account, attachments and stored credentials without requiring owner/admin.

**Quellorte des Ausgangsstands:** `shared/ipc/email-schemas.ts:197`, `electron/ipc/email.ts:408`, `electron/ipc/ipc-account-scope.ts:82`, `electron/email/email-store.ts:523`, `electron/ipc/ipc-account-scope.ts:103`, `electron/ipc/ipc-account-scope.ts:77`, `electron/ipc/ipc-account-scope.ts:99`, `electron/ipc/email.ts:409`, `shared/ipc/email-schemas.ts:199`

**Gemeldete Ursache:**

`DeleteAccount`'s schema and handler use a bare positive integer. The generic resolver's numeric branch only recognizes explicitly listed account/message channels and otherwise returns undefined; its later delete-account object case is unreachable for this payload. With no requireRole and no resolved account, authentication is the only gate before `deleteEmailAccountRecord` destroys the selected mailbox resources.

Assigned dedup-0009 source: The handler/schema use a number while the authorization resolver handles deletion only as an object with id. Numeric dispatch exits without an account ID, disabling the access check. Correct numeric scope alone is insufficient with default ro. No destructive operation was performed. The account/message directory collision is a separate issue surviving proper authorization.

Assigned dedup-0015 synthesis: Same bare numeric DeleteAccount schema bypasses object.id resolver before account/files/Keytar deletion. Existing numeric resolution plus management permission covers it; ro is insufficient. Independent account/message attachment directory collision survives.

**Prüfmethode laut Worker:**

Source-reported static validation preserved; dedup-0009 performed supplied-artifact semantic comparison only

**Validierungszusammenfassung laut Worker:**

First source review: The delete channel is preload-allowlisted and requires a real session. Schema accepts the numeric ID; the resolver returns no account for it, so the wrapper's canAccessLocalAccount call is skipped. The handler and service contain no compensating role/account check. The service removes attachments and keytar references and deletes the account row.

Second source review: Independently checked the positive-integer schema, complete resolver, registration and deleteEmailAccountRecord. The sink purges account attachment files and password/OAuth keychain entries before deleting the account row. No second authorization check exists.

Assigned source 705c5481-2d05-4afc-bc67-518d631d7500:23: Parent verified numeric registration and the full resolver sets; email:delete-account is absent from bare-account channels. The sink has no actor context. Fixing resolution alone is insufficient because the shared default is ro, whereas deletion requires administrative authority.

**Grenzen laut Worker:**

- Application-level profile boundary only; direct OS-account control is excluded.
- No deletion or runtime reproduction performed.
- No runtime reproduction or production deployment verification.
- Local legacy per-user account grants are distinct from server mail ACLs.
- Source only; real deployment not inspected.
- Correct numeric scope alone is insufficient with default ro. No destructive operation was performed. The account/message directory collision is a separate issue surviving proper authorization.
- No application execution or production testing.
- Requires a real authenticated desktop session and direct IPC access.

**Gegenbelege laut Worker:**

Keine Angabe.

**Vorgeschlagene Korrektur, nicht als umgesetzt bestätigt:**

Resolve DeleteAccount's actual bare numeric payload to its authoritative account and require owner/admin or explicit mailbox-management authority before attachment purge, keytar deletion or account DELETE. Read-only grants must not authorize deletion. Fail closed if the target cannot be resolved.

**Vorgeschlagene Regressionstests, nicht als ausgeführt bestätigt:**

- A viewer/agent cannot delete an unassigned mailbox by numeric ID.
- Authorization tests exercise the exact schema payload shape and ensure scope resolution cannot silently disappear.
- Agent/viewer deletion of an ungranted account must fail before any purge or credential deletion.
- Read-only grants cannot delete mailboxes.
- Authorized management deletion retains intended behavior.
- Exercise authorization.desktop-account-delete with an unauthorized actor or bounded-input regression and assert no protected sink executes.
- Actual numeric delete payload is denied without management authority.
- Denied delete leaves mailbox, files and Keytar unchanged.
- Explicitly authorized delete succeeds.

### 7. Automatic DOCX indexing can exhaust desktop or server memory

Worker-Kennung: resource-exhaustion.docx-text-extraction.

**Status:** offen; keine Behauptung einer Behebung im PR.

**Gemeldete Einstufung:**

- **level**: high
- **rationale**: Preserves the assigned worker's high assessment for unauthenticated automatic mail-triggered memory exhaustion in desktop/shared server processes. The previous aggregate assessed medium severity/medium impact for the same source-supported mechanism; that assessment remains explicitly attributed and unresolved. Delivery/synchronization and sufficient expansion are prerequisites; no crash threshold was measured. dedup-0016's Standard source rates desktop-only availability low and server availability medium, both high confidence; these narrower assessments remain attributed without resolving the earlier aggregate high versus medium difference.

**Gemeldete Nachweissicherheit:**

- **level**: high
- **rationale**: Both sources report static tracing of automatic product entrypoints and installed Mammoth 1.12.0/JSZip 3.10.1 behavior; prior source additionally identifies yauzl 3.4.0. Neither source executed a malicious archive or verified deployed packaging. Reducer has performed no new validation. dedup-0006's incoming server-specific assessment is medium confidence because the malformed-archive behavior was source-traced but not reproduced; incoming desktop assessment is high. These separate assessments remain preserved.

**Beschreibung:**

An externally delivered DOCX under the 15 MiB compressed-file limit is indexed without a user opening it. Desktop calls Mammoth directly; server preflight checks at most 2,048 entries, encryption and 32 MiB of attacker-declared ZIP expansion but never measures actual deflated output. A needed XML part such as document.xml can understate its size and reach Mammoth/JSZip, which retains inflated chunks before rejecting a final size mismatch. The shared process can suffer memory exhaustion or termination before error handling. The desktop instance also accepts accurately declared high-expansion archives because it has no expansion preflight; the server instance specifically bypasses declared-size limits. Both instances require separate implementation fixes. The assigned source confirms automatic extraction and the installed Mammoth 1.12.0/JSZip 3.10.1 full-entry allocation path without measuring a crash threshold.

**Quellorte des Ausgangsstands:** `packages/server/src/mail-sync.ts:2066`, `electron/email/attachment-text-extract.ts:91`, `packages/server/src/mail-attachment-text.ts:106`, `packages/server/src/mail-attachment-text.ts:131`, `node_modules/.pnpm/yauzl@3.4.0/node_modules/yauzl/index.js:411`, `node_modules/.pnpm/mammoth@1.12.0/node_modules/mammoth/lib/zipfile.js:8`, `node_modules/.pnpm/jszip@3.10.1/node_modules/jszip/lib/stream/StreamHelper.js:79`, `node_modules/.pnpm/jszip@3.10.1/node_modules/jszip/lib/compressedObject.js:29`, `packages/server/src/mail-attachment-text.ts:68`, `packages/server/src/mail-attachment-text.ts:109`, `packages/server/src/mail-attachment-text.ts:137`, `node_modules/mammoth/lib/zipfile.js:8`, `node_modules/.pnpm/mammoth@1.12.0/node_modules/jszip/lib/compressedObject.js:30`, `node_modules/.pnpm/mammoth@1.12.0/node_modules/jszip/lib/stream/StreamHelper.js:79`, `electron/email/attachment-text-extract.ts:92`, `electron/email/email-message-attachments-store.ts:159`, `electron/email/attachment-text-extract.ts:118`, `electron/email/attachment-text-extract.ts:51`, `node_modules/yauzl/index.js:411`, `node_modules/.pnpm/jszip@3.10.1/node_modules/jszip/lib/compressedObject.js:30`, `packages/server/src/mail-attachment-text.ts:118`, `packages/core/src/email/attachment-text.ts:5`, `packages/server/src/mail-attachment-text.ts:175`, `packages/server/src/server.ts:454`, `electron/email/email-sync-post-process.ts:67`, `electron/email/attachment-text-extract.ts:113`, `electron/email/attachment-text-extract.ts:74`, `electron/email/attachment-text-extract.ts:117`, `packages/server/src/mail-attachment-text.ts:108`, `node_modules/mammoth/lib/zipfile.js:1`, `node_modules/.pnpm/jszip@3.10.1/node_modules/jszip/lib/compressedObject.js:24`, `node_modules/.pnpm/jszip@3.10.1/node_modules/jszip/lib/stream/DataLengthProbe.js:16`, `node_modules/.pnpm/jszip@3.10.1/node_modules/jszip/lib/stream/StreamHelper.js:70`, `node_modules/yauzl/index.js:405`, `node_modules/yauzl/index.js:585`, `electron/email/email-sync-post-process.ts:65`, `packages/server/src/mail-sync.ts:2062`, `packages/core/src/email/attachment-text.ts:3`, `electron/email/email-sync-post-process.ts:53`, `electron/email/email-message-attachments-store.ts:268`, `electron/email/attachment-text-extract.ts:88`, `electron/email/attachment-text-extract.ts:120`, `electron/email/email-message-attachments-store.ts:135`, `packages/core/src/email/attachment-text.ts:1`, `packages/server/src/mail-attachment-text.ts:181`, `packages/server/src/mail-attachment-text.ts:90`, `packages/server/src/mail-sync.ts:2058`, `node_modules/.pnpm/jszip@3.10.1/node_modules/jszip/lib/compressedObject.js:20`, `node_modules/.pnpm/jszip@3.10.1/node_modules/jszip/lib/stream/StreamHelper.js:65`, `electron/email/attachment-text-extract.ts:1`, `packages/server/src/mail-attachment-text.ts:135`, `electron/email/email-message-attachments-store.ts:160`

**Gemeldete Ursache:**

The source-file limit applies to compressed DOCX bytes. Automatic extraction then calls `mammoth.extractRawText`, whose ZIP reader requests fully materialized JSZip entries. The server's preflight reads entry metadata only; deflated output is not measured there. JSZip retains output chunks and checks declared-size mismatch at stream end, while the 30-second promise timeout cannot cancel parsing. The eventual text truncation happens after allocation. Deflated-entry enumeration does not exercise yauzl.openReadStream actual-byte checks. The original compressed archive is reopened by Mammoth; metadata validation is therefore not a bounded validated representation. Desktop has no equivalent preflight. Per-entry and aggregate actual-output limits must precede JSZip chunk retention; the post-extraction text cap is also too late.

Assigned dedup-0008 source: The incoming source independently retains stored-entry-only Yauzl enumeration consistency versus unchecked DEFLATE output; Mammoth reopens compressed data and JSZip accumulates chunks before its end mismatch check. Automatic sync and backfill may retry after a crash. The final Standard assessment is medium severity/high confidence/medium likelihood, while its historical investigator and earlier aggregate include high ratings. Preserve all as source assessments without resolving the unmeasured crash threshold or deployment behavior.

Assigned dedup-0010 synthesis: Incoming final medium severity/high confidence remains alongside prior high/medium assessments. Preserve 15MiB compressed input, 500000-character output, server 32MiB/2048 metadata-only checks, serialization and non-cancelling 30s timeout. Both runtime instances require actual expansion bounds; no crash threshold resolved.

Assigned dedup-0011 synthesis: Same established desktop automatic DOCX instance: normal attachment persistence queues direct Mammoth/JSZip allocation before text cap; non-cancelling timeout and compressed-file cap are insufficient. Incoming server preflight counterevidence concerns declared 32MiB/2048-entry limits and this source expressly scopes itself to desktop. It neither resolves nor rejects the retained server actual-inflation/forged-metadata proof. Incoming medium severity/medium confidence remain alongside prior high and medium assessments; both runtime instances require their stated fixes.

Assigned dedup-0014 synthesis: Same desktop direct Mammoth and server declared-ZIP-size-only preflight followed by original-archive JSZip materialization. Existing actual per-entry/aggregate budgets and bounded validated parser input must cover both. Incoming medium/high likelihood and prior high/medium assessments retained; no measured crash threshold.

Assigned dedup-0015 synthesis: Same automatic desktop Mammoth/JSZip expansion before final text cap with non-cancelling timeout. Existing actual-output budgets and terminable parsing cover desktop. Incoming source treats server declared-size preflight as effective for its scenario; earlier server forged-metadata proof remains preserved without resolution.

Assigned dedup-0016 synthesis: Desktop direct Mammoth extraction is already an explicit independently required instance of the established DOCX finding. Enforce actual expansion limits and terminable isolation on desktop; the incoming accurate-metadata high-expansion subcase does not require defeating the server preflight.

Assigned dedup-0016 synthesis: Server metadata-only ZIP preflight is already an explicit independently required instance of the established DOCX finding. Actual DEFLATE output limits before materialization, parsing the validated representation and terminable isolation cover it. Fixing desktop alone does not close this server instance.

Assigned dedup-0017 synthesis: Same established desktop direct-Mammoth and server metadata-only DOCX instances. Both need actual-inflation limits and bounded parser consumption. Source medium assessment is retained beside historical differing ratings.

**Prüfmethode laut Worker:**

Source-reported validation preserved; dedup-0011 performed supplied-artifact semantic reduction only

**Validierungszusammenfassung laut Worker:**

Previous aggregate (dec8d119-8830-4aed-98ba-e0c75791dc98:6): Both extractors select DOCX by extension/content type and cap compressed input at 15MiB; the server adds 2048 entries/32MiB declared expansion, but no actual-byte read during validation. Local Mammoth->JSZip source shows uncapped chunk accumulation before end-of-stream size mismatch. Yauzl's stronger actual-byte check is confined to openReadStream and is not exercised by the metadata-only preflight. Queue concurrency one and catch/mark-as-tried do not cap one parse; timeout does not terminate it.

Assigned worker 6 (d185d3ef-8bf7-4adb-8a2e-6d8e1566900e:6): Independently inspected Yauzl enumeration (equality only for stored entries), absent openReadStream preflight, Mammoth 1.12.0 full uint8array reads and JSZip 3.10.1 accumulation preceding end-size check, matching lockfile. 2,048-entry/encryption checks do not measure actual deflated output. Timeout does not cancel parsing.

Assigned source adae8751-0a17-49fc-a285-f8a4574c7953:11: Verified automatic sync persistence -> extraction queue, file-size checks, direct Mammoth call, and installed Mammoth/JSZip buffering implementation matching lockfile versions. Serialized parsing limits concurrency but not one archive's expansion; the 30-second wrapper cannot cancel it. No malicious archive or runtime harness executed.

Assigned source adae8751-0a17-49fc-a285-f8a4574c7953:12: Verified metadata-only preflight, original-buffer Mammoth call, automatic sync/backfill invocation, Yauzl checks only stored compression size during enumeration, and installed JSZip's end-only size comparison. Honest oversized archives are blocked; a forged DEFLATE member is not stream-counted before the downstream allocation. Malformed-archive reproduction remains unperformed, lowering confidence.

Assigned source a72abecd-f31f-4abc-bacb-afd48bf1085c:9: Independently verified authored extraction, automatic sync/backfill wiring and installed Mammoth/JSZip/yauzl source. Yauzl's early consistency check only covers stored entries; deflated-byte checks would require opening streams, which preflight does not do. JSZip accumulates output before its end size check. No crafted archive, parser execution or crash measurement performed.

Assigned dedup-0010 source 12, source-reported static validation: Desktop sync post-process persists attachments (email-sync-post-process.ts:67-84) and queues extraction (email-message-attachments-store.ts:160-165); server mail-sync.ts:2066-2080 queues the sibling. Attachment input <=15MiB and output <=500000 characters, serialization and 30s timeout exist. Timeout explicitly cannot cancel parser (desktop:51-69; server:68-87). Server limit32MiB/2048 entries counts metadata only; yauzl3.4.0 index.js:412-422 checks compressed/uncompressed consistency during enumeration only for stored entries, not deflated entries. JSZip subsequently accumulates actual inflation before its end-of-stream mismatch check. Mammoth external files disabled; no arbitrary file-read claim.

Assigned dedup-0011 source-reported offline static validation: Traced inbound attachment persistence through the serialized extraction queue and desktop parser. Inspected installed Mammoth zipfile.js showing member.async('uint8array') and decoding. A valid highly compressed XML part can exceed available memory before text truncation. The timeout explicitly leaves the underlying parser running. Server counterpart has a 32MiB declared-expansion/2048-entry preflight, so this finding is scoped to desktop.

**Grenzen laut Worker:**

- No live memory-exhaustion experiment; magnitude and process termination threshold depend on deployment memory.
- External gateway filtering may prevent delivery but no such deployment control was supplied.
- Installed dependency versions matched pnpm-lock.yaml; this is a product integration finding, not a claim of a published advisory.
- No archive created or processed; exact threshold/timing unmeasured.
- Dependencies read from local installation; deployment packaging not executed.
- Severity disagreement retained: prior aggregate/source assigns medium overall severity and medium availability impact; assigned worker assigns high overall severity and high impact. High is retained as a supplied assessment, not a new reducer validation; exact memory/crash threshold and production packaging remain unknown.
- No resource-exhaustion input executed; bounded isolated runtime regression remains necessary.
- dedup-0006 preserves two distinct supplied proof tuples within this pre-existing combined identity: desktop direct Mammoth extraction (medium severity, high confidence, medium impact/high likelihood), and server forged ZIP metadata preflight (medium severity, medium confidence, high impact/medium likelihood). The earlier high severity/high confidence assessment remains attributed, not newly validated. Honest oversized server archives are rejected; malformed DEFLATE reproduction remains unperformed.
- No runtime/production execution or network access.
- No runtime archive/crash/memory measurement; exact threshold unknown.
- The incoming source independently retains stored-entry-only Yauzl enumeration consistency versus unchecked DEFLATE output; Mammoth reopens compressed data and JSZip accumulates chunks before its end mismatch check. Automatic sync and backfill may retry after a crash. The final Standard assessment is medium severity/high confidence/medium likelihood, while its historical investigator and earlier aggregate include high ratings. Preserve all as source assessments without resolving the unmeasured crash threshold or deployment behavior.
- Enabled mailbox sync/indexing and accepted DOCX attachment required.
- Exact failure threshold depends on memory and provider filters.
- No attack input generated, application executed or crash measured.
- Incoming final medium severity/high confidence remains alongside prior high/medium assessments. Preserve 15MiB compressed input, 500000-character output, server 32MiB/2048 metadata-only checks, serialization and non-cancelling 30s timeout. Both runtime instances require actual expansion bounds; no crash threshold resolved.
- No application execution, exploit inputs or network testing.
- Impact prerequisites: Normal desktop mail sync and attachment indexing; no user opening the attachment or privileged workflow is needed.
- Same established desktop automatic DOCX instance: normal attachment persistence queues direct Mammoth/JSZip allocation before text cap; non-cancelling timeout and compressed-file cap are insufficient. Incoming server preflight counterevidence concerns declared 32MiB/2048-entry limits and this source expressly scopes itself to desktop. It neither resolves nor rejects the retained server actual-inflation/forged-metadata proof. Incoming medium severity/medium confidence remain alongside prior high and medium assessments; both runtime instances require their stated fixes.
- No application execution or production testing.
- Same automatic desktop Mammoth/JSZip expansion before final text cap with non-cancelling timeout. Existing actual-output budgets and terminable parsing cover desktop. Incoming source treats server declared-size preflight as effective for its scenario; earlier server forged-metadata proof remains preserved without resolution.
- No runtime malformed-document test; precise failure threshold depends on desktop memory.
- No malformed archive was executed and no production resource limit was measured.
- Impact depends on synchronized mailbox delivery and process/container memory limits; dependency versions were inspected locally, not checked online.

**Gegenbelege laut Worker:**

- 2048 entries,32MiB declared size, encrypted-entry checks present
- Yauzl only enum not decompression
- JSZip detects mismatch after allocating
- Compressed input cap and final-text cap too late
- Timeout rejects promise but does not abort
- Serialization doesn't bound one expansion
- Desktop no preflight
- 15 MiB compressed file cap and serialized queue limit ordinary load.
- The 30-second timeout does not cancel underlying parsing.
- No attachment-opening action is needed, but mail delivery/sync must succeed.
- 15 MiB compressed input cap, 2048 entry cap, 32 MiB declared size cap and serialized queue constrain ordinary inputs.
- withTimeout explicitly cannot cancel the parser; capAttachmentText runs after parse.
- JSZip ultimately rejects mismatched size but only after expansion.

**Vorgeschlagene Korrektur, nicht als umgesetzt bestätigt:**

Enforce actual decompressed-byte and per-entry/aggregate limits through bounded entry streams before materialization, and ensure document parsing consumes that validated representation rather than independently reopening unchecked compressed data. Apply equivalent controls to desktop and server. Run parsing in a killable worker/process with memory and wall-clock limits and terminate underlying work on timeout; declared ZIP metadata, compressed-input limits, queue concurrency and a non-cancelling Promise timeout are insufficient. Treat desktop direct extraction and server metadata-only preflight as independent required instances; completing only one does not close the established combined finding.

**Vorgeschlagene Regressionstests, nicht als ausgeführt bestätigt:**

- Reject DOCX entries that exceed actual expansion limits, including metadata/output length disagreement, before buffering the full output.
- Time or memory limit must terminate the parser and allow subsequent indexing without orphaned work.
- Forged small declared size cannot exceed actual expansion budget.
- Near-limit valid documents work and timeouts terminate parsing.
- Use bounded compressed fixtures that exceed a small test expansion budget and assert rejection before passing bytes to the document/JSON parser.
- Verify abort terminates underlying work and ordinary valid documents/backups still work.
- Forged small ZIP size declarations cannot allow actual expanded bytes beyond the parser budget.
- Timeout terminates parser work, and one malicious DOCX cannot terminate the main/API process.
- Highly compressed DOCX stays within actual decompression budget on both runtimes.
- Deflated XML with understated central-directory size is rejected before large accumulation.
- Timeout terminates the parser and releases memory, not just the awaiting promise.
- Add a regression test for the stated boundary that verifies the prohibited effect is rejected before the sensitive operation.
- Honest oversized expansion rejected before accumulation.
- Falsely small deflated metadata rejected at actual byte limit.
- Timeout terminates parser work; later extraction remains usable.
- Oversized expanded DOCX rejected before materialization; timeout terminates worker; valid small documents index.
- A small compressed DOCX whose actual output exceeds the limit while metadata understates size must stop before accumulating excess output.
- Normal DOCX indexing and declared-size/entry-count rejection must remain functional.
- Desktop must apply the same actual-output limits as server and reject high-expansion DOCX even when declared ZIP sizes are accurate.
- A small controlled DOCX with understated output size is rejected while streaming before exceeding the configured actual-byte cap.
- Parser timeout terminates worker and releases memory rather than leaving detached work.

### 8. Previewing a crafted mail backup can exhaust desktop memory

Worker-Kennung: resource-exhaustion.backup-manifest.

**Status:** offen; keine Behauptung einer Behebung im PR.

**Gemeldete Einstufung:**

- **level**: low
- **rationale**: Medium availability impact with low likelihood: a local user must select an attacker-supplied backup for verification/preview; this is not automatic remote exposure.

**Gemeldete Nachweissicherheit:**

- **level**: high
- **rationale**: Parent reviewed complete inspection helper and preview ordering; no archive was generated or opened.

**Beschreibung:**

Verification, preview and restore decompress and buffer manifest.json in Electron main before manifest validity and bounded extraction checks. A locally readable attacker-supplied ZIP can exhaust memory even during verify/preview; valid manifest semantics or a valid database are not needed to reach the allocation sink.

**Quellorte des Ausgangsstands:** `electron/email/email-local-restore.ts:184`, `electron/email/email-local-backup.ts:74`, `electron/email/email-local-backup.ts:23`, `electron/email/email-local-restore.ts:198`, `electron/email/email-local-restore.ts:308`, `electron/email/email-local-backup.ts:75`, `electron/email/email-local-backup.ts:150`, `electron/email/email-local-restore.ts:199`, `electron/email/email-local-backup.ts:138`, `electron/email/email-local-backup.ts:63`, `electron/email/email-local-backup.ts:22`, `electron/email/email-local-backup.ts:61`, `electron/email/email-local-restore.ts:37`, `electron/email/email-local-restore.ts:321`, `electron/email/email-local-restore.ts:191`, `electron/ipc/email.ts:1140`, `electron/ipc/email.ts:1132`

**Gemeldete Ursache:**

`inspectZipBackup` invokes `readZipEntryText` for an archive's manifest before checking manifest type or database presence. That helper accumulates every decompressed chunk and then concatenates/decodes/JSON-parses it. No small manifest limit or actual-byte counter is applied; the bounded restore extractor runs only after inspection returns.

The new source strengthens the pre-validity framing: invalid JSON/type and absence of a valid database do not prevent reaching the allocation sink. lazyEntries bounds concurrent enumeration, not a single manifest's bytes. Buffer concatenation and string conversion add allocations. A local selected archive or authenticated IPC-supplied readable path is required.

Assigned dedup-0008 source: An accurately declared oversized manifest is sufficient; malformed ZIP size metadata is not required. Verification or preview reaches allocation before restore confirmation and before JSON/type/database validity. Both honestly oversized and understated size cases must stop before concatenation/decoding/JSON parsing; preserve selected/readable-local-archive prerequisites.

Assigned dedup-0009 source: The inspection helper reads the full decompressed manifest before validating its content. Restore extractor limits are applied only after this separate unbounded inspection. Retain invalid JSON/no-valid-database trigger, selected or IPC-readable archive prerequisites, and reject duplicate manifests as the incoming remediation additionally requests.

Assigned dedup-0010 synthesis: Incoming medium likelihood remains alongside retained low. Both honestly oversized and understated manifests need bounds before concat/decode/JSON. Explicit selected-file framing does not supersede prior authenticated IPC-readable-path framing.

Assigned dedup-0011 synthesis: Same uncapped manifest stream buffering during verification and restore preview before type validation or bounded extraction. User-selected untrusted ZIP is the reported framing; no valid restore or manifest JSON required to reach allocation. Incoming medium confidence remains alongside retained high; low overall severity unchanged.

Assigned dedup-0012 synthesis: Same unbounded decompressed manifest buffering before validity checks and bounded restore extraction. Declared and actual byte caps plus inspection entry limits cover verify, preview and restore. Selected-archive framing does not supersede authenticated IPC-readable-path framing; invalid manifest or database semantics need not stop allocation.

Assigned dedup-0014 synthesis: Same uncapped manifest buffering before validity and bounded restore extraction. Existing declared/actual-byte and enumeration limits cover verification/preview/restore; honestly declared oversized manifest suffices. Selection/IPC-readable path, invalid JSON, no valid database and duplicate-entry subcases retained.

**Prüfmethode laut Worker:**

Source-reported validation preserved; dedup-0012 performs supplied-artifact semantic reduction only

**Validierungszusammenfassung laut Worker:**

Verification, preview and restore all call the inspection helper. Yauzl checks ZIP declared/actual consistency but does not impose an application memory cap for a legitimately declared large manifest. The later extraction byte/entry guards cannot protect inspection. Restore confirmation is not needed for the verify/preview path.

Assigned source 374fcd79-f6b4-4fe0-9fa9-bf807f27f7a9:8: Parent read the full inspector and ordering in both preview and restore. lazyEntries limits concurrent entry enumeration, not bytes in one entry. Invalid manifest JSON/type is rejected only after decompression and allocation; no valid database or manifest semantics are needed to reach the memory sink.

Assigned source adae8751-0a17-49fc-a285-f8a4574c7953:10: Inspected complete backup reader, verification caller and restore-preview call order. Actual restore stream limits run only after inspectZipBackup. Yauzl enforces consistency with declared size, but the manifest reader accepts an arbitrarily large honestly declared size; no corruption bypass is necessary.

Assigned source a72abecd-f31f-4abc-bacb-afd48bf1085c:5: Confirmed direct user-facing verification and restore-preview calls into this reader before extractZipToDirectory. A valid ZIP may accurately declare a huge manifest, so library size-consistency checks do not supply a cap. No malicious archive was generated or opened.

Assigned source 705c5481-2d05-4afc-bc67-518d631d7500:9: Parent inspected the complete ZIP inspector and read helper. Lazy ZIP enumeration does not bound an entry's expanded bytes; valid JSON is unnecessary to trigger allocation. Restore extraction limits and path checks do not protect verification. No malicious archive or parser execution was used.

Assigned dedup-0010 source 11, source-reported static validation: verifyLocalMailBackup selects a ZIP at email-local-backup.ts:150-159 and invokes inspection. Restore preview and restoration invoke the same inspector before bounded extraction (email-local-restore.ts:199-205,321-359). Existing 10000-entry/8GiB-entry/9GiB-total extraction limits and yauzl size consistency do not limit an honestly declared oversized manifest during inspection.

Assigned dedup-0011 source-reported offline static validation: Verified the complete inspection helper and both callers. Restore extraction separately caps entries/bytes, but preview calls inspectZipBackup first. lazyEntries limits enumeration concurrency, not manifest expansion. No malicious archive was created or executed.

Assigned dedup-0012 source-reported static validation: Verification invokes inspectZipBackup on the chosen file; manifest entry is read before type/schema checks. Preview/restore also inspect before extraction. Compression amplifies the unbounded buffer; an invalid manifest can exhaust resources before rejection.

**Grenzen laut Worker:**

- Requires selection of an untrusted local backup; ordinary self-created backups are not an attacker.
- No runtime ZIP or memory test.
- No traversal or code execution claimed.
- Static validation only; no runtime reproduction.
- Likelihood assessment differs: previous source low, assigned source medium, with both overall low severity. Assigned source explicitly includes authenticated IPC supplying a locally readable archive. All source assessments are retained.
- No resource-exhaustion input executed; bounded isolated runtime regression remains necessary.
- dedup-0006 assesses likelihood medium, while the retained surface uses the earlier low likelihood. Both retain low severity and require selection of a locally readable attacker-supplied archive. No corruption/declared-size inconsistency is required for the manifest allocation.
- No runtime reproduction, application execution or production access.
- dedup-0008 again rates manifest likelihood medium while the prior retained surface rates it low; both sources rate overall severity low. No runtime archive or memory experiment occurred.
- Source only; real deployment not inspected.
- Retain invalid JSON/no-valid-database trigger, selected or IPC-readable archive prerequisites, and reject duplicate manifests as the incoming remediation additionally requests.
- An operator must choose the supplied ZIP.
- No execution or crash observed.
- Incoming medium likelihood remains alongside retained low. Both honestly oversized and understated manifests need bounds before concat/decode/JSON. Explicit selected-file framing does not supersede prior authenticated IPC-readable-path framing.
- No application execution, exploit inputs or network testing.
- Impact prerequisites: Requires user selecting an untrusted ZIP for verification or preview in desktop mode.
- Same uncapped manifest stream buffering during verification and restore preview before type validation or bounded extraction. User-selected untrusted ZIP is the reported framing; no valid restore or manifest JSON required to reach allocation. Incoming medium confidence remains alongside retained high; low overall severity unchanged.
- Actual crash threshold depends on archive size and memory; source proof only.

**Gegenbelege laut Worker:**

- Extractor limits entries, declared sizes and actual bytes, but runs afterward.
- Archive must be locally readable and selected or supplied to IPC.
- No generated archive or runtime crash test performed.
- User file selection required
- Later extractor limits not applied
- Accurate large ZIP sizes do not trigger size mismatch rejection
- Try/catch not memory budget
- Native file choice or an existing local path is required.
- Bounded extraction and ZIP path containment remain effective for the later extraction phase.
- No archive generation, decompression or memory-exhaustion test performed.

**Vorgeschlagene Korrektur, nicht als umgesetzt bestätigt:**

Set a small manifest-specific declared and actual decompressed-byte cap before accumulating chunks, abort/destroy the stream on excess, and bound entry enumeration during inspection. Reject duplicate manifest entries during inspection.

**Vorgeschlagene Regressionstests, nicht als ausgeführt bestätigt:**

- Verification/preview rejects oversized manifests before buffering them fully.
- Normal small manifests and subsequent inspections continue working after a rejected archive.
- Oversized declared manifest is rejected without opening content stream.
- Compressed manifest crossing actual-byte cap stops early.
- Normal supported backups still inspect successfully.
- Use bounded compressed fixtures that exceed a small test expansion budget and assert rejection before passing bytes to the document/JSON parser.
- Verify abort terminates underlying work and ordinary valid documents/backups still work.
- Verify and preview reject a manifest over the configured byte cap without retaining its complete output.
- Ensure stream overflow aborts parsing even when ZIP metadata understates or accurately declares excessive size.
- Exercise resource-exhaustion.backup-manifest with an unauthorized actor or bounded-input regression and assert no protected sink executes.
- Verification and restore preview reject an oversized highly compressed manifest while bounding memory.
- Reject actual streamed expansion beyond cap even when archive metadata lies.
- Add a regression test for the stated boundary that verifies the prohibited effect is rejected before the sensitive operation.
- Reject a manifest exceeding the small byte cap during verification and preview without buffering the whole entry.
- Accept normal manifests and retain extraction path/size protections.
- Reject an oversized declared manifest without buffering it.
- Reject a streaming manifest that exceeds the byte limit, including malformed or compressed input.

### 9. Windows server path parsing can bypass attachment ownership checks

Worker-Kennung: path-traversal.windows-compose-attachment-authorization.

**Status:** offen; keine Behauptung einer Behebung im PR.

**Gemeldete Einstufung:**

- **level**: medium
- **rationale**: The assigned Standard source rates this medium: High confidentiality impact with medium/unknown likelihood: Windows hosting and a known stored attachment path are required; blind guessing is not established. The established aggregate rated it low: High potential confidentiality impact but low likelihood: native Windows server use is unestablished, documented Docker/Linux deployment is not affected, and attacker needs send/draft rights plus a known foreign storage path. Both assessments are preserved and unresolved; this reducer performed no new validation.

**Gemeldete Nachweissicherheit:**

- **level**: medium
- **rationale**: Parent verified both policy exceptions, permissive parser, platform-native path resolution and file sink; native Windows deployment and runtime reproduction are unverified. dedup-0016 reports high static confidence but no native Windows deployment or runtime verification; the established medium assessment is preserved. Assigned Standard source reports high confidence: Independent local source trace; no application execution or runtime reproduction. The established confidence remains; no reducer revalidation was performed.

**Beschreibung:**

On a natively running Windows API server, a caller with mail.send and mail.draft.edit can append backslash parent segments to an authorized draft prefix. Raw slash-only authorization treats it as a local upload, while native filesystem resolution can select another known attachment within the shared root for outbound mail. Immediate, approval/retry and scheduled paths are affected. The second review additionally reports a suspicious-download permission bypass using deterministic migrated attachment paths; the first describes suspicious-extension controls as still applying, so that subcase remains an explicitly preserved disagreement. The assigned source also frames a known path from prior access before revocation; its random upload/sync prefixes constrain blind discovery. The shared-root bound does not establish authorization to another mailbox or workspace's file.

**Quellorte des Ausgangsstands:** `packages/server/src/api/mail-routes.ts:4329`, `packages/server/src/mail-access/http-policy-enforcer.ts:989`, `packages/server/src/mail-access/async-policy-enforcer.ts:923`, `packages/server/src/db/postgres-mail-read-ports.ts:4252`, `packages/server/src/mail-compose-send.ts:1763`, `packages/server/src/mail-access/async-policy-enforcer.ts:929`, `packages/core/src/email/mail-rfc822-compose.ts:200`, `packages/server/src/sqlite-migration/attachment-copy.ts:71`, `packages/server/src/mail-access/http-policy-enforcer.ts:1102`, `packages/server/src/mail-compose-send.ts:1764`, `packages/server/src/mail-compose-send.ts:585`, `packages/server/src/mail-compose-send.ts:1787`, `packages/server/src/mail-access/http-policy-enforcer.ts:995`, `packages/server/src/mail-compose-send.ts:1786`, `packages/server/src/mail-access/http-policy-enforcer.ts:983`, `packages/server/src/mail-access/http-policy-enforcer.ts:1097`, `packages/server/src/mail-access/async-policy-enforcer.ts:925`, `packages/server/src/api/mail-routes.ts:4036`, `packages/server/src/mail-compose-send.ts:508`, `packages/server/src/mail-access/http-policy-enforcer.ts:1095`, `packages/server/src/mail-compose-send.ts:1750`, `packages/server/src/api/mail-routes.ts:1041`, `packages/server/src/mail-access/http-policy-enforcer.ts:978`, `packages/server/src/mail-access/async-policy-enforcer.ts:912`, `packages/server/src/mail-compose-send.ts:343`, `packages/server/src/db/postgres-mail-read-ports.ts:4248`, `packages/server/src/mail-compose-send.ts:1745`, `packages/server/src/mail-access/http-policy-enforcer.ts:934`, `packages/server/src/db/postgres-mail-read-ports.ts:4240`, `packages/server/src/mail-compose-send.ts:1735`, `packages/core/src/email/mail-rfc822-compose.ts:191`, `packages/server/src/mail-compose-send.ts:583`, `packages/server/src/mail-access/async-policy-enforcer.ts:908`, `packages/server/src/mail-access/http-policy-enforcer.ts:1078`, `packages/server/src/mail-compose-attachments.ts:42`

**Gemeldete Ursache:**

Attachment authorization grants a draft-local exception using a raw forward-slash prefix and `split('/')` traversal test. Windows filesystem resolution later recognizes backslash parent components and normalizes them outside the authorized draft. The sender confines only to the global attachment root, so it does not restore the skipped mailbox ownership check. The scheduled-send enforcer repeats this mismatch. The HTTP scheduled/approval check at http-policy-enforcer.ts:1102-1104 repeats the exception. Migrated paths use workspace/email-attachments/legacyMessageId/legacyAttachmentId-sanitizedFilename, unlike random fresh-upload paths; a permitted metadata reader may derive a migrated target without learning a fresh random storage key.

Assigned dedup-0009 source: Authorization checks raw POSIX separators, but the filesystem sink applies platform-native path normalization; the checked draft folder and actual file may differ. Incoming high confidence remains alongside retained medium; Windows native server, known target path, own draft/send rights and SMTP required. 25/50 MiB and file controls remain. Earlier suspicious-download applicability disagreement is preserved, not resolved.

Assigned dedup-0012 synthesis: Same slash-only draft-local authorization versus Windows-native resolution across immediate, approval and scheduled sending. Shared portable key parsing, exact draft containment and owner checks cover all paths. Preserve known/derivable path and native Windows prerequisites, Linux counterevidence, incoming high versus retained medium confidence and unresolved suspicious-download disagreement.

Assigned dedup-0014 synthesis: Same raw slash-only draft-local exception versus Windows-native resolution across immediate, retry/approval and async sending. Canonical storage-key/owner authorization and exact draft containment cover all. Preserve native Windows, known path, draft/send grants, Linux counterevidence and unresolved suspicious-download applicability.

Assigned dedup-0015 synthesis: Same raw slash-only draft-local exemption versus Windows-native filesystem interpretation in immediate, approval/retry and scheduled sending. Existing canonical key parser, exact draft containment and attachment-owner checks cover all. Preserve native Windows/known path/send-edit rights, randomized and migrated paths, Linux counterevidence and suspicious-download disagreement. New source reports only pure read-only GetFullPath corroboration, not a live exploit.

Assigned dedup-0016 synthesis: Same raw slash-based draft-local exemption versus Windows-native resolution in immediate and scheduled/approval sending. Canonical portable keys, exact draft containment and owner authorization cover all incoming instances. Keep native Windows/known filename/send-edit prerequisites, Linux counterevidence and prior suspicious-download disagreement.

Assigned dedup-0017 synthesis: Same Windows slash-only draft-local carve-out versus native backslash resolution on immediate/deferred sends. Canonical ownership/path policy in each affected check subsumes source. Known path, shared root, Linux non-reachability and suspicious-download disagreement retained; potential cross-workspace impact remains conditional.

**Prüfmethode laut Worker:**

Source-reported validation preserved; dedup-0012 performs supplied-artifact semantic reduction only

**Validierungszusammenfassung laut Worker:**

First source review: The parent confirmed path strings retain backslashes, both enforcers skip attachment lookup for raw draft-prefixed paths without slash-delimited parent tokens, and resolveAttachmentStoragePath uses native node:path. Files outside the global root remain blocked. Linux treats these backslashes as filename characters, so this is conditional Windows behavior; no native server deployment is asserted.

Second source review: Independently reviewed immediate send, approval/retry/scheduled authorization, path normalizer, native resolve/relative helper and compose file-to-MIME-to-SMTP sink. Fresh filenames have random prefixes and normal metadata omits storagePath; imported paths are deterministic from source IDs/filename, enabling a concrete suspicious-download bypass for permitted metadata readers.

Assigned source 705c5481-2d05-4afc-bc67-518d631d7500:20: Parent traced direct send, draft approval and scheduled job sibling guards. A path shaped ownWorkspace/compose-drafts/ownDraft/..\..\..\otherWorkspace\knownFile passes raw prefix and split('/') check yet resolves inside the shared root outside the authorized draft on Windows. File/type/25MiB and50MiB caps remain; ordinary owner lookup is skipped. Linux Docker treats backslash literally and is not affected by this variant. Requires Windows native server, own draft edit/send authority, configured SMTP and known foreign storage path; no platform/runtime exploit executed.

Assigned dedup-0012 source-reported static validation: Parent verified all three exemptions, string-only path normalization, native shared-root resolution and compose attachment sink. On Windows, backslash parents survive the ACL check but are interpreted by native resolution.

**Grenzen laut Worker:**

- Native Windows API deployment required and not established.
- Attacker must know an existing unauthorized attachment path and have authorized draft-edit/send rights.
- No live file read or outbound mail test.
- File-size, suspicious-extension and recipient/draft checks still apply.
- No application execution, network request or production validation.
- Requires native Windows server, mail.send and mail.draft.edit on a usable draft, a known/derivable target path and valid outbound account. Linux Docker treats backslashes as filename characters. Other-account fresh attachment access requires prior knowledge; no unauthenticated enumeration or arbitrary filesystem escape claimed.
- Unresolved source difference: first review says suspicious-extension checks still apply; second explicitly reports bypass of suspicious_download through the draft-local exemption, with deterministic migrated filenames available to permitted metadata readers. Reducer neither validates nor rejects either statement.
- Source impact ratings differ (high in the first report, medium in the second); both retain low overall severity and medium confidence because native Windows deployment and target-path prerequisites are unverified.
- Incoming high confidence remains alongside retained medium; Windows native server, known target path, own draft/send rights and SMTP required. 25/50 MiB and file controls remain. Earlier suspicious-download applicability disagreement is preserved, not resolved.
- Native Windows server use is unconfirmed; documented production is Linux Docker.
- No path payload executed or files read.
- No application execution or production testing.
- No actual Windows server deployment established; conditional supported Node runtime path.
- No file content read, network connection, application execution or exploit payload submitted.
- Same raw slash-only draft-local exemption versus Windows-native filesystem interpretation in immediate, approval/retry and scheduled sending. Existing canonical key parser, exact draft containment and attachment-owner checks cover all. Preserve native Windows/known path/send-edit rights, randomized and migrated paths, Linux counterevidence and suspicious-download disagreement. New source reports only pure read-only GetFullPath corroboration, not a live exploit.
- No native Windows server or live send tested; actual deployed platform is unknown.

**Gegenbelege laut Worker:**

- Linux treats these backslashes literally; no ordinary Linux bypass claimed.
- Outside-root files, nonexistent/nonfile paths and size violations remain blocked.
- Attacker must know another valid stored attachment path; upload names are randomized.
- Nonlocal ordinary paths check attachment ownership and suspicious-download rights.
- Not a demonstrated POSIX/Linux exploit; default Compose is Linux.
- The attacker still needs mail.send and mail.draft.edit on their own draft, working SMTP and a valid existing target filename.
- Random filenames limit guessing. A previously known path or separately validated mutation response can supply it.
- Files outside global attachmentsRoot remain blocked; per-file/total size caps remain.

**Vorgeschlagene Korrektur, nicht als umgesetzt bestätigt:**

Use one canonical portable storage-key parser for authorization and I/O. Reject backslashes/dot segments or canonicalize with the same filesystem semantics and confine the draft-local exception to the exact authorized draft directory. Apply this to immediate send, approval/retry, persisted scheduled paths and async execution; resolve canonical owners and enforce attachment-read and applicable suspicious-download authority for all nonlocal paths. Prefer server-issued attachment IDs.

**Vorgeschlagene Regressionstests, nicht als ausgeführt bestätigt:**

- Windows separator variants cannot escape an authorized draft directory through the draft-local exception.
- Immediate and scheduled paths authorize each nonlocal attachment against its owning message.
- Using Windows path semantics, reject backslash traversal in immediate/approval/scheduled paths, while valid current-draft uploads remain allowed.
- On Windows, backslash traversal after an own-draft prefix must be rejected before file resolution.
- Legitimate draft uploads and authorized existing attachments still send.
- On Windows path semantics, reject mixed-separator paths escaping the draft even when they remain inside attachmentsRoot.
- Verify every send/schedule/retry/approval path enforces attachment read and suspicious-download grants for nonlocal files.
- Retain legitimate newly uploaded draft attachment behavior on Windows and POSIX.
- Mixed-separator escapes rejected under win32 semantics for every route; legitimate draft uploads and authorized existing attachments still work.
- On Windows semantics, mixed-separator paths cannot leave an authorized draft directory under the draft-local exception.
- Canonical paths pointing to other accounts/workspaces require attachment-read and any suspicious-download permission.
- Immediate send, draft approval and scheduled jobs apply identical canonical authorization.
- On Windows and POSIX, mixed-separator parent paths must not leave the authorized draft directory or skip attachment permission checks.
- Immediate, approval and queued-send paths must reject the same noncanonical keys.
- Known legitimate own-draft uploads still send.
- Windows separator variants cannot escape an authorized draft directory.
- Previously known revoked attachment paths require current attachment.read permission.
- Legitimate draft uploads and authorized stored attachments send normally.

### 10. Ordinary desktop profiles can replace the installation database

Worker-Kennung: missing-authorization.desktop-global-restore.

**Status:** offen; keine Behauptung einer Behebung im PR.

**Gemeldete Einstufung:**

- **level**: medium
- **rationale**: High installation-wide integrity/availability impact with medium likelihood: requires an authenticated local profile and an accessible valid backup; no remote unauthenticated or OS-level attacker is assumed.

**Gemeldete Nachweissicherheit:**

- **level**: high
- **rationale**: Parent verified handler registration, preview/confirmation flow and global replacement consumer; no restore was run.

**Beschreibung:**

A non-admin logged-in desktop profile can preview and execute a local backup restore. The restore replaces the full SQLite database and attachment directory and restarts the app without checking owner/admin authority.

**Quellorte des Ausgangsstands:** `electron/ipc/email.ts:1153`, `electron/email/email-local-restore.ts:308`, `electron/email/email-local-restore.ts:357`, `electron/ipc/email.ts:1154`, `electron/ipc/register.ts:72`, `electron/email/email-local-restore.ts:321`, `electron/email/email-local-restore.ts:376`, `electron/ipc/email.ts:1151`, `electron/email/email-local-restore.ts:317`

**Gemeldete Ursache:**

The preview and restore IPC handlers require a real session but no owner/admin role. The same caller can obtain the preview token and supply the confirmation phrase, which establish freshness and intent rather than authorization. `restoreLocalMailBackup` receives no principal, then closes and replaces shared database/attachment resources for every profile.

Assigned dedup-0014 synthesis: Same unprivileged desktop restore preview/apply replacing installation database/authentication/attachments. Existing administrator authorization at both stages covers auth-record replacement. Preserve compatible ZIP, preview token/phrase, idle-sync, rollback and owner versus owner/admin policy uncertainty.

Assigned dedup-0015 synthesis: Same unrestricted global backup preview/apply replaces SQLite including users/roles plus attachments. Existing privileged authorization at both stages and actor/file-bound token reauthorization cover it; owner-only versus owner/admin policy remains unresolved. Format, phrase, freshness and rollback do not authorize.

**Prüfmethode laut Worker:**

static authorization and resource-consumer trace

**Validierungszusammenfassung laut Worker:**

Both channels are preload-allowlisted with schema-controlled input but no role gate or applicable account target. Restore enforces manifest, token, confirmation phrase, active-sync exclusion and rollback safeguards, yet none authorizes installation-wide replacement. Contrast server maintenance reset's owner check and desktop privileged user-management gates.

**Grenzen laut Worker:**

- Needs a valid locally accessible backup and an authenticated non-admin profile.
- No archive creation, restore, relaunch or destructive operation performed.
- Application profile boundary only; direct OS data-directory control is excluded.
- No application execution or production testing.
- Requires a real authenticated desktop session and direct IPC access.

**Gegenbelege laut Worker:**

Keine Angabe.

**Vorgeschlagene Korrektur, nicht als umgesetzt bestätigt:**

Require a real owner/admin session for global backup preview/restore and enforce authorization again at execution. Keep archive validation, freshness and rollback controls as separate safeguards. Bind preview to the authenticated actor and recheck authority immediately before replacement; validate backup schema before stopping services.

**Vorgeschlagene Regressionstests, nicht als ausgeführt bestätigt:**

- Viewer/agent profiles are denied global restore before database or filesystem changes.
- Owner/admin restore still enforces preview freshness and confirmation requirements.
- Verify nonadministrators cannot preview or execute installation-wide restore even with a valid token and phrase.
- Verify authorized restore rejects incompatible databases and preserves rollback behavior.
- Non-owner preview/execute denied before processing.
- Execution reauthorizes actor and binds token to session/file.
- Valid owner restore preserves extraction and rollback safeguards.

### 11. CRM read-only users can create and modify returns

Worker-Kennung: missing-authorization.crm-returns-write.

**Status:** offen; keine Behauptung einer Behebung im PR.

**Gemeldete Einstufung:**

- **level**: medium
- **rationale**: The assigned Standard source rates this medium: Medium integrity impact with high likelihood for a read-only workspace user: direct authenticated API requests bypass the intended write grant. No financial payment or cross-workspace compromise is established. The established aggregate rated it low: Same-workspace integrity violation with medium impact and constrained insider likelihood; no money transfer, cross-tenant write or administrative access is established. Both assessments are preserved and unresolved; this reducer performed no new validation.

**Gemeldete Nachweissicherheit:**

- **level**: high
- **rationale**: Independent static trace confirms the central read gate, omitted per-route write guard, distinct capabilities, system-role database consumer and workspace-only RLS.

**Beschreibung:**

When ServerApiPorts.returns is supplied, a server user with crm.read but no crm.write can create returns and update same-workspace status, outcome and notes through POST /api/v1/returns and PATCH /api/v1/returns/:id. The assigned scan reports default startup omits this port and returns 503; earlier reachability wording and all source uncertainty remain preserved. The assigned source rates severity medium and describes ordinary read-only reachability; this does not establish that the optional returns port is supplied in the default runtime.

**Quellorte des Ausgangsstands:** `packages/server/src/api/returns-routes.ts:230`, `packages/server/src/api/returns-routes.ts:203`, `packages/server/src/api/server-api.ts:157`, `packages/server/src/db/postgres-returns-port.ts:86`, `packages/server/src/db/postgres-returns-port.ts:327`, `packages/server/src/api/server-api.ts:154`, `packages/server/src/api/returns-routes.ts:225`, `packages/server/src/db/postgres-returns-port.ts:312`, `packages/server/src/db/postgres-returns-port.ts:316`, `shared/user-capabilities.ts:78`, `packages/server/src/db/postgres-returns-port.ts:315`, `packages/server/src/api/http.ts:81`, `packages/server/src/api/server-api.ts:158`, `packages/server/src/db/postgres-returns-port.ts:310`, `packages/server/src/db/postgres-returns-port.ts:87`, `packages/server/src/db/postgres-returns-port.ts:317`, `packages/server/src/db/postgres-returns-port.ts:259`

**Gemeldete Ursache:**

`createServerApi` requires only `crm.read` for CRM paths. The two returns mutation handlers parse caller input after `requirePrincipal` and invoke database ports without `rejectUnlessCrmWrite`. Those ports execute as `system` and write the parsed fields; workspace RLS limits tenancy but has no caller capability to enforce.

The assigned source explicitly frames the exported API/library integration: ServerApiPorts.returns must be supplied; it reports default server startup has no returns binding and otherwise returns 503. This strengthens the previously retained optional-port precondition but is not reducer verification of deployment.

Assigned dedup-0005 source: The assigned source independently repeats the configured-port boundary, including a supported readonly capability preset, system-role persistence, allowlisted status/outcome/notes and no monetary-refund or cross-workspace claim.

Assigned dedup-0011 synthesis: Same optional returns POST/PATCH mutations under crm.read with system-role persistence and absent crm.write. Bundled startServer leaves the port unwired (503); a consumer-provided ReturnsApiPort is required. Preserve public portal token/CAPTCHA policy independently.

Assigned dedup-0013 synthesis: Identical returns POST/PATCH missing crm.write before workspace-system persistence. The retained two-handler fix covers create and status/outcome/notes updates. Preserve optional ReturnsApiPort/default-startup 503 prerequisite: incoming registered-route reachability does not resolve wiring. Incoming medium severity/high likelihood remains attributed beside prior low severity.

Assigned dedup-0014 synthesis: Same optional returns POST/PATCH lacking crm.write before workspace-system persistence. Two-handler capability fix covers all. Preserve optional exported port/default factory 503 and earlier contradictory reachability wording.

Assigned dedup-0015 synthesis: Same returns POST/PATCH missing crm.write after central crm.read, with system-role workspace persistence. Existing two-handler write guard covers creation/status/outcome/notes. Incoming general route reachability does not resolve optional-port/default-503 evidence. Public portal and RLS controls remain separate.

Assigned dedup-0017 synthesis: Same optional returns POST/PATCH write-capability omission. Enforcing crm.write in both retained handlers subsumes source; preserve standard-startup 503, conditional wiring, workspace boundary and no payment execution.

**Prüfmethode laut Worker:**

Source-reported validation preserved; dedup-0013 performs supplied-artifact semantic reduction only

**Validierungszusammenfassung laut Worker:**

Verified POST and PATCH dispatch, parser allowlists, central CRM read check, independent crm.read/crm.write grant expansion and final Kysely writes. Reviewed workspace-context and returns migration: RLS confines rows to workspace, not CRM role. Portal settings are admin-gated and are a separate operation.

Assigned source 374fcd79-f6b4-4fe0-9fa9-bf807f27f7a9:5: Parent independently traced both mutation handlers, exported API assembly and PostgreSQL writes. Searches plus direct server.ts inspection found no default returns binding. Kept as an implemented public API/library boundary with explicit optional-port prerequisite, rather than a default-production exploit.

Assigned source 61ab0f3d-38ae-4587-a421-de63347b1639:0: Confirmed the supported readonly group passes the central gate, neither POST nor PATCH checks write permission, and the database port performs the requested write. RLS isolates workspaces but does not restore the missing capability check. A follow-up caller search found the exported factory in db/index.ts:12 but no wiring in default server.ts, so the default startup's ports.returns guard returns 503; a caller-provided returns port is an explicit prerequisite.

Assigned source adae8751-0a17-49fc-a285-f8a4574c7953:0: Confirmed POST/PATCH dispatch to the two handlers and inspected the complete port, capability helper and returns RLS migration. No downstream capability gate exists. Workspace filtering and portal administrator checks prevent broader claims but do not stop same-workspace writes.

Assigned dedup-0011 source-reported offline static validation: Verified the returns path is in the CRM route inventory, read capability does not expand to write, mutation handlers call the port directly and the concrete database writes run as system. Strongest counterevidence: returns is an optional ServerApiPorts integration absent from bundled startServer; without that integration these routes return 503.

Assigned dedup-0013 source-reported static validation: Confirmed that readonly group grants do not expand upward to crm.write; both mutation routes pass the CRM read gate and invoke workspace-scoped inserts/updates. Database transaction context has no user capability check. Authentication, workspace filtering and validation remain effective but do not prevent this vertical permission bypass.

**Grenzen laut Worker:**

- No runtime reproduction or production configuration was used.
- Changing status to refunded changes CRM records; actual payment execution is not established.
- Cross-worker reachability uncertainty retained without revalidation: worker dec8d119-8830-4aed-98ba-e0c75791dc98 threat-model trust boundary states the shipped server factory does not wire returns ports (server.ts:619-746), making current returns operations unavailable. This finding's source reports reachable returns handlers/ports. Exploitation requires ports.returns to be configured; the reducer cannot resolve these conflicting source claims or reject the validated finding.
- Static validation only; no runtime reproduction.
- Assigned scan explicitly reports absent default returns wiring and low likelihood, corroborating prior threat-model caveats; previous finding describes medium likelihood. This reduction preserves the implemented optional-port boundary and all earlier assessments, without inspecting code or rejecting the finding.
- No runtime reproduction or deployment verification.
- The change affects return records; payment execution is not established.
- Default shipped server startup does not construct ReturnsApiPort; exposure requires a caller to configure the exported API with that port.
- dedup-0005 assessment difference: assigned source confidence is medium and likelihood low because default returns-port wiring is absent; retained aggregate confidence high and earlier likelihood medium describe the same conditional implementation. All assessments are preserved; no deployment reachability was resolved.
- No runtime test was executed; actual assigned user capabilities are deployment-dependent.
- dedup-0006 describes the registered returns handlers as reachable for crm.read and does not establish default production port wiring. Earlier configured-port/503 caveats remain authoritative uncertainty in this aggregate; no repository or deployment inspection was performed to resolve them.
- No live execution.
- Requires a consumer to wire ReturnsApiPort; no bundled production wiring was found.
- Same optional returns POST/PATCH mutations under crm.read with system-role persistence and absent crm.write. Bundled startServer leaves the port unwired (503); a consumer-provided ReturnsApiPort is required. Preserve public portal token/CAPTCHA policy independently.
- No application execution or live HTTP reproduction.
- No cross-workspace impact or actual refund execution is claimed.
- dedup-0013 medium severity/high-likelihood and standard dispatcher claim does not establish configured ReturnsApiPort. Prior default-startup 503 and optional-integration precondition remain unresolved.
- No application execution or production test.
- No evidence of automatic financial transfers from a status change.
- Same returns POST/PATCH missing crm.write after central crm.read, with system-role workspace persistence. Existing two-handler write guard covers creation/status/outcome/notes. Incoming general route reachability does not resolve optional-port/default-503 evidence. Public portal and RLS controls remain separate.

**Gegenbelege laut Worker:**

- Without ports.returns handlers return 503 before writing.
- Workspace comes from authenticated identity and SQL constrains it.
- Body allowlists constrain fields but not write permission.

**Vorgeschlagene Korrektur, nicht als umgesetzt bestätigt:**

Enforce rejectUnlessCrmWrite(principal) before parsing or calling persistence in both returns mutation handlers. Test the exported API with a supplied returns port, preserving workspace scoping and absent-port unavailability. Preserve public returns-portal token/CAPTCHA controls independently of these authenticated mutation gates.

**Vorgeschlagene Regressionstests, nicht als ausgeführt bestätigt:**

- POST and PATCH with crm.read only must return 403 without port calls.
- Authorized crm.write users must retain access and remain workspace-scoped.
- crm.read-only cannot create or update returns when port is supplied.
- crm.write can mutate only its workspace.
- Absent port remains unavailable.
- Assert CRM read-only users receive 403 for both POST and PATCH without database mutation.
- Assert crm.write users retain both operations and cross-workspace records remain inaccessible.
- Verify a crm.read-only user receives 403 for create and update and no port is called.
- Verify crm.write and administrator users can mutate returns in their own workspace.
- Verify crm.read-only principals receive 403 for returns POST/PATCH while crm.write principals succeed.
- Verify public portal routes retain their independent token and CAPTCHA controls.
- Assert readonly users receive 403 for POST returns and PATCH return status/outcome/notes, with no database mutation.
- Assert crm.write and admin users retain create/update access and read-only GET remains allowed.
- With a returns port configured, assert a crm.read-only member receives 403 for POST and PATCH while crm.write succeeds.
- A crm.read-only principal receives 403 for POST and PATCH and leaves data unchanged.
- A crm.write principal and authorized admin can still create and update returns.
- Public portal behavior and workspace isolation remain unchanged.
- With a wired returns port, verify crm.read-only POST and PATCH return 403 without storage calls.
- Verify crm.write and admin principals retain legitimate mutation access.
- Read-only principal receives 403 for both mutations and the port is not called.
- Write-enabled principal can perform valid mutations; public portal behavior retains its separate token gate.

### 12. Desktop connection tests disclose another mailbox's saved credentials

Worker-Kennung: missing-authorization.mail-connection-credentials.

**Status:** offen; keine Behauptung einer Behebung im PR.

**Gemeldete Einstufung:**

- **level**: medium
- **rationale**: High confidentiality impact from mailbox credential theft, with medium likelihood because an authenticated local application session and stored credentials are required.

**Gemeldete Nachweissicherheit:**

- **level**: high
- **rationale**: Independent source trace confirms explicit account-scope skips, keychain/token retrieval, caller-controlled destinations and network authentication sinks; no live credential was accessed.

**Beschreibung:**

An authenticated desktop agent/viewer can select another mailbox's account ID and send its saved password or OAuth access token to a caller-controlled mail server through the IMAP, SMTP or POP3 connection-test IPC handlers. The assigned source confirms SMTP can reuse OAuth tokens through IMAP-auth resolution as well as password fallbacks; TLS to a caller-selected valid endpoint does not bind the credential to its approved service.

**Quellorte des Ausgangsstands:** `electron/ipc/ipc-account-scope.ts:33`, `electron/ipc/email.ts:1367`, `electron/ipc/email.ts:1391`, `electron/email/email-smtp.ts:19`, `electron/ipc/email.ts:431`, `electron/ipc/email.ts:2711`, `electron/auth/account-access.ts:20`, `electron/ipc/email.ts:1352`, `electron/ipc/ipc-account-scope.ts:34`, `electron/email/email-smtp.ts:16`, `electron/ipc/email.ts:429`, `electron/email/email-imap-sync.ts:410`, `electron/ipc/email.ts:2706`, `electron/email/email-pop3-sync.ts:222`, `electron/ipc/register.ts:78`, `electron/ipc/ipc-account-scope.ts:19`, `electron/ipc/register.ts:72`, `electron/ipc/email.ts:482`, `electron/email/email-smtp.ts:18`, `electron/ipc/ipc-account-scope.ts:35`, `electron/ipc/ipc-account-scope.ts:1`, `electron/ipc/register.ts:60`, `electron/ipc/email.ts:417`, `electron/ipc/email.ts:2704`, `electron/ipc/ipc-account-scope.ts:37`, `electron/ipc/email.ts:1399`, `electron/ipc/ipc-account-scope.ts:99`, `electron/email/email-imap-sync.ts:414`, `electron/email/email-pop3-sync.ts:223`, `electron/email/email-keytar.ts:22`, `electron/ipc/ipc-account-scope.ts:106`, `electron/ipc/email.ts:1366`, `electron/ipc/email.ts:2712`, `electron/ipc/register.ts:79`, `electron/ipc/register.ts:51`, `electron/ipc/ipc-account-scope.ts:17`

**Gemeldete Ursache:**

All three connection-test handlers register without role requirements and are explicitly excluded from account scoping. A caller supplies accountId and destination host. If no password is supplied, the handler fetches saved credentials, or SMTP resolves an OAuth access token, then authenticates to that supplied destination. Transport encryption authenticates the chosen attacker endpoint, not the mailbox's configured server.

The additional source independently identifies ImapFlow and Pop3Command consumers as well as SMTP. IMAP/POP3 establish saved-password paths; SMTP also resolves OAuth access tokens. Bind the approved user as well as destination when reusing a credential.

Assigned dedup-0007 source: The assigned source confirms SMTP smtpUseImapAuth may select either password or OAuth through resolveImapAuth, with SMTP-specific then IMAP-password fallback when applicable. OAuth usefulness remains limited by provider scope and token lifetime. The required fix covers host, port, TLS/transport and username, not merely mailbox grant checks.

Assigned dedup-0009 source: Connection tests deliberately skip account resolution, require no privileged role, and combine protected stored secrets with untrusted host/port/user values. IMAP/POP3 saved-password and SMTP password/OAuth paths preserved; own newly supplied secrets are legitimate tests. TLS at an attacker-owned endpoint does not prevent the credential recipient substitution.

Assigned dedup-0011 synthesis: All three existing desktop test instances: saved IMAP/POP3 password and SMTP password/OAuth authentication to caller-selected endpoints. Authorize stored-secret use and bind it to persisted approved coordinates; TLS at the selected attacker's endpoint is not recipient authorization.

Assigned dedup-0012 synthesis: Same SMTP/IMAP/POP3 stored-credential test instances. Retained management authorization and binding of saved credentials to approved host, port, transport and user cover every incoming sink. IMAP/POP3 password and SMTP password/OAuth paths and the local app-session boundary remain distinct.

Assigned dedup-0013 synthesis: Identical IMAP/POP3 saved-password and SMTP saved-password/OAuth tests using explicitly skipped account scope and caller-selected endpoints. Account-management authorization and binding stored credentials to approved host, port, transport and identity cover all instances; distinct server endpoint mutation and TLS-intent findings remain separate.

Assigned dedup-0014 synthesis: Same IMAP/SMTP/POP3 stored-secret tests with account checks skipped and caller endpoint overrides. Management authorization plus saved host/port/transport/user binding covers all password and SMTP OAuth sinks. TLS to attacker endpoint is not recipient authorization; persistent edit unnecessary.

Assigned dedup-0015 synthesis: Same skipped-account IMAP/POP3 saved-password and SMTP password/OAuth tests to caller endpoints. Existing management authorization and saved host/port/TLS/user binding cover all. OAuth proof is SMTP-only; TLS to attacker is not recipient authorization; fresh user credentials remain distinct.

Assigned dedup-0017 synthesis: Same three IMAP/POP3/SMTP saved-credential desktop tests. Retained account-management authorization and approved-destination binding cover every sink including SMTP OAuth. Server stored-settings tests remain outside this finding.

**Prüfmethode laut Worker:**

Source-reported validation preserved; dedup-0013 performs supplied-artifact semantic reduction only

**Validierungszusammenfassung laut Worker:**

Traced TestImap, TestSmtp and TestPop3 through registerIpcHandler, skip-scope policy, credential lookup and IMAP/SMTP/POP3 network clients. Real-session requirement exists but no mailbox grant or privileged role requirement. IMAP and POP3 password sinks and SMTP OAuth/password sinks are independently reachable.

Assigned source 374fcd79-f6b4-4fe0-9fa9-bf807f27f7a9:0: Verified the preload permits registered channels, the payload schemas accept account and destination fields, `registerIpcHandler` checks only the current session for these handlers, and SMTP/IMAP/POP3 clients authenticate with the retrieved secret. TLS does not prevent an attacker operating a server with a valid certificate from receiving authentication.

Assigned source adae8751-0a17-49fc-a285-f8a4574c7953:1: Independently verified positive accountId/blank password handling, lack of role/account checks, keytar reader and IMAP/SMTP/POP3 transport calls. The real-session gate is effective; it does not authorize access to the victim account. Attacker-owned valid TLS defeats no certificate rule.

Assigned source 1134688b-c6f4-4ad3-aedd-9b4e4922ecc7:0: Verified login creates a genuine profile session (electron/ipc/auth.ts:52-103); preload exposes whitelisted invoke (electron/preload.ts:61-67). Test schemas accept accountId and host overrides. registerIpcHandler has no required role for these handlers and skips mailbox checks because resolver explicitly excludes the channels. Keytar retrieval reaches IMAP/SMTP/POP3 authentication. docs/MAIL_AUTH_THREAT_MODEL.md:5-13 explicitly distinguishes profile ACL protection from excluded direct disk access.

Assigned source 705c5481-2d05-4afc-bc67-518d631d7500:11: Verified IMAP, SMTP and POP3 handlers and their transport sinks. SMTP can disclose OAuth access tokens through resolveImapAuth; IMAP/POP3 use the stored password. TLS does not prevent an attacker receiving authentication at its own legitimate TLS endpoint. New-account tests with caller-supplied secrets remain legitimate; only stored credential reuse crosses the boundary.

Assigned dedup-0011 source-reported offline static validation: Verified all three handler variants, the account-scope exemptions and the mail client sinks. SMTP can resolve an OAuth access token; IMAP/POP3 use saved passwords. TLS validates the chosen endpoint and does not prevent an attacker from owning it. Authentication is required and the secrets need not be returned in the IPC response.

Assigned dedup-0012 source-reported static validation: Checked schema acceptance of empty passwords and positive account IDs, preload channel availability, real-session requirement, skip-list behavior and all three protocol consumers. A nonadmin session with no access to the selected mailbox can cause its saved credential to leave the host through authentication.

Assigned dedup-0013 source-reported static validation: Confirmed IMAP and POP3 schemas allow an empty password and arbitrary nonempty host; SMTP permits omitted password. All handler registrations use only logger. Account ids need not be authorized. IMAP/POP3 use keytar fallback and SMTP also resolves stored OAuth authentication. TLS validates the chosen host, not whether it belongs to the stored account, so a valid attacker TLS endpoint still receives credentials.

**Grenzen laut Worker:**

- No production credential retrieval, network connection or runtime test.
- Requires local role separation and stored password or usable OAuth token; SMTP endpoint can present a valid certificate if TLS is used.
- No application or network execution.
- Requires an authenticated desktop session able to invoke IPC and a stored credential. IMAP/POP3 demonstrated password paths; SMTP also resolves OAuth tokens.
- No application or exploit execution; deployment assumptions unresolved.
- No application execution or network reproduction.
- OAuth token usefulness is constrained by its provider scopes and lifetime.
- No application or network execution. Desktop app role boundary; no OS privilege escalation claimed.
- IMAP/POP3 saved-password and SMTP password/OAuth paths preserved; own newly supplied secrets are legitimate tests. TLS at an attacker-owned endpoint does not prevent the credential recipient substitution.
- No application code or exploit executed.
- Production deployment and local role use remain unspecified.
- All three existing desktop test instances: saved IMAP/POP3 password and SMTP password/OAuth authentication to caller-selected endpoints. Authorize stored-secret use and bind it to persisted approved coordinates; TLS at the selected attacker's endpoint is not recipient authorization.
- No application execution or network reproduction; actual stored credential availability and deployed use of nonadmin desktop roles are unverified.
- Static validation only; no connections or credentials accessed.
- Requires a stored account secret and real desktop session; no unauthenticated web or server-edition exposure claimed.
- Requires access to a real authenticated desktop session and direct IPC invocation; not an unauthenticated network attack.
- OAuth exfiltration is established for SMTP only.
- No live test or real secrets accessed.

**Gegenbelege laut Worker:**

- Unauthenticated callers are denied by the central wrapper.
- Standalone legacy local account grants are distinct from server mail ACLs; this does not affect server test routes by implication.
- Caller-supplied own credentials alone create no secret theft; the report concerns server-side reuse of stored other-account secrets.
- Real authenticated local session required
- Valid TLS attacker endpoint remains viable
- Keytar protects at rest but handler retrieves secret
- Authentication is required; this is not a remote unauthenticated exploit.
- TLS validation does not protect a saved credential sent to an attacker-owned valid TLS endpoint.
- Server-edition connection tests contain destination-binding controls; this finding concerns desktop handlers only.
- No unauthenticated IPC access: a real desktop app session is required.
- TLS can protect transit but authenticates the destination chosen by the attacker, so it does not bind saved secrets to the configured provider.
- The documented desktop model is one OS user per installation with no disk protection; finding concerns the enforced app/renderer capability boundary only.
- IMAP/POP3 path established for stored passwords; OAuth access-token exposure established on SMTP only.

**Vorgeschlagene Korrektur, nicht als umgesetzt bestätigt:**

Authorize all three saved-credential connection tests as account/credential-management operations before retrieving secrets. Bind reused credentials to the stored approved server, port, transport and user; changed destinations require freshly supplied credentials or explicit privileged reauthorization. Keep legitimate tests using the caller's freshly supplied credentials distinct.

**Vorgeschlagene Regressionstests, nicht als ausgeführt bestätigt:**

- Unprivileged users cannot test another account or reuse its password/token.
- Changing host while reusing stored credentials is rejected unless an authorized credential-management path approves it.
- Tests using freshly supplied credentials preserve legitimate setup behavior.
- Reject all three test channels for users lacking target-account administrative permission.
- Ensure changing a host cannot reuse the saved password or OAuth token.
- Keep tests with explicitly supplied credentials distinct from saved-account tests.
- Exercise the real public handler with the least privileged caller and confirm the sensitive operation is denied.
- Retain successful authorized operations and the effective existing guard cases.
- A profile without a mailbox grant cannot trigger its saved credential lookup or any connection.
- Changing host/port/user while relying on a saved password or OAuth token is rejected or uses the stored destination.
- Cover IMAP, SMTP password, SMTP OAuth and POP3 variants.
- Verify the described operation is denied to an authenticated user without the required role/mailbox grant.
- Verify explicitly authorized operations continue to work.
- Agent/viewer without account access cannot test another account using stored credentials.
- Changing the destination host while selecting a saved account must not send its stored password or OAuth token.
- Authorized tests of the saved destination still work; new-account tests use only explicitly entered credentials.
- Deny agent/viewer connection tests for accounts outside their permitted administrative scope.
- When using saved credentials, ignore or reject request overrides for host, port, TLS and identity for all three protocols.
- Preserve explicit-credential ad-hoc tests without fetching stored passwords or OAuth tokens.
- Assert a user without account-administration authority cannot reuse its saved credentials.
- Assert replacing an endpoint cannot cause a saved password or OAuth token to be transmitted.
- A viewer without target-account permission cannot invoke saved-credential IMAP, SMTP or POP3 tests.
- Saved credentials are never sent to changed endpoints without authorized configuration change; tests with caller-provided credentials remain possible.
- An unassigned viewer cannot test another mailbox.
- Stored-secret tests ignore or reject alternate host/port/user/TLS values for IMAP, POP3 and SMTP.
- SMTP OAuth tests cannot direct a saved access token to a caller host.
- Unprivileged or unassigned account test attempts must fail before secret lookup.
- Changing host with blank password must not send stored credentials to that host.
- Unauthorized account IDs never trigger secret retrieval or network access for any of the three test operations.
- Changing a test destination cannot reuse stored credentials without appropriate management authorization.

### 13. Read-only desktop mailbox users can alter credentials and connection settings

Worker-Kennung: incorrect-authorization.desktop-mailbox-management.

**Status:** offen; keine Behauptung einer Behebung im PR.

**Gemeldete Einstufung:**

- **level**: medium
- **rationale**: High potential impact from mailbox credential/configuration takeover, with medium likelihood in local multi-user deployments.

**Gemeldete Nachweissicherheit:**

- **level**: high
- **rationale**: Independent static control/dataflow review; explicit prerequisites and mitigations retained. No application execution.

**Beschreibung:**

A desktop user with a read-only mailbox grant can replace stored passwords and alter IMAP/SMTP destinations and identity settings. A changed destination can receive the mailbox's retained credentials on subsequent use.

**Quellorte des Ausgangsstands:** `electron/ipc/register.ts:49`, `electron/ipc/email.ts:361`, `electron/ipc/email.ts:395`, `electron/auth/account-access.ts:20`

**Gemeldete Ursache:**

UpdateAccount resolves the correct account but supplies no accountAccess override or role requirement. registerIpcHandler defaults to ro, so read-only users pass. The handler then saves passwords and rewrites transport settings that should require mailbox-management authority.

**Prüfmethode laut Worker:**

independent static source trace

**Validierungszusammenfassung laut Worker:**

Independently checked default ro, accountId resolution, legacy grant ranking and UpdateAccount writes. Users without any grant are denied on this path; this finding specifically concerns read-only grants. Connection-test theft is separately reported because its skip-scope mechanism is different.

**Grenzen laut Worker:**

- No runtime reproduction or production deployment verification.
- Local legacy per-user account grants are distinct from server mail ACLs.

**Vorgeschlagene Korrektur, nicht als umgesetzt bestätigt:**

Require owner/admin or an explicit mailbox-management permission for endpoint, identity and credential changes; do not treat ordinary mailbox read/write as credential administration.

**Vorgeschlagene Regressionstests, nicht als ausgeführt bestätigt:**

- A ro-granted user cannot change mailbox hosts, credentials or identity.
- Tests must separately cover users with no grant, ro, send_only, rw and explicit management authority.

### 14. Desktop message mutations and draft deletion bypass account permissions

Worker-Kennung: idor.desktop-bulk-mail.

**Status:** offen; keine Behauptung einer Behebung im PR.

**Gemeldete Einstufung:**

- **level**: low
- **rationale**: Medium integrity/availability impact to other local mailboxes, with constrained local-user likelihood. Spam learning can also be altered; no remote IMAP permanent deletion is asserted.

**Gemeldete Nachweissicherheit:**

- **level**: high
- **rationale**: Static source confirms the described flow; no runtime reproduction. Platform/deployment and attacker prerequisites remain explicit.

**Beschreibung:**

An authenticated desktop user can omit optional accountId and mutate messages from inaccessible mailboxes by global numeric IDs. A related batch draft-delete path accepts only messageIds and similarly skips account authorization. Single DeleteComposeDraft also bypasses mailbox scope because its bare numeric message ID is absent from the resolver's message-ID channel set. Both draft deletion stores accept any uid < 0, including real POP3 messages, and permanently delete those local rows.

**Quellorte des Ausgangsstands:** `shared/ipc/email-schemas.ts:1138`, `electron/ipc/email.ts:2101`, `electron/ipc/ipc-account-scope.ts:121`, `electron/email/email-store.ts:1567`, `electron/email/email-store.ts:1677`, `electron/ipc/email.ts:2122`, `electron/email/email-store.ts:1580`, `electron/ipc/email.ts:2242`, `electron/email/email-store.ts:1945`, `electron/email/email-store.ts:1100`, `electron/ipc/ipc-account-scope.ts:91`, `electron/ipc/register.ts:83`, `electron/ipc/email.ts:2099`, `electron/email/email-store.ts:1944`, `electron/ipc/register.ts:89`, `shared/ipc/email-schemas.ts:1135`, `electron/ipc/email.ts:2100`, `electron/ipc/email.ts:2172`, `electron/email/email-store.ts:1657`, `electron/email/email-store.ts:1601`, `electron/ipc/email.ts:2146`, `electron/ipc/ipc-account-scope.ts:120`, `electron/ipc/register.ts:79`, `electron/email/email-store.ts:1094`, `electron/ipc/ipc-account-scope.ts:99`

**Gemeldete Ursache:**

Bulk IPC shapes carry messageIds arrays, but the resolver only recognizes scalar messageId/draftMessageId or account fields. Omission leaves accountId unresolved, so no grant is checked; store operations intentionally fall back to global-ID WHERE clauses. Even supplied accountId uses the default ro gate rather than mutation access. The same resolver also omits DeleteComposeDraft from numeric message-ID channels. Negative UID checks are not authorization and additionally admit received POP3 mail.

Assigned dedup-0010 synthesis: Incoming calls uid<0 draft-only, while established evidence includes received POP3 negative UIDs. Preserve both without resolving: require actual compose-draft identity plus mailbox/write authority. Batch 500-ID cap and parameterized SQL do not enforce ownership.

Assigned dedup-0015 synthesis: Same unresolved messageIds arrays/unrecognized numeric draft ID skip ACL before global SQLite mutation. Existing per-item authoritative write checks, constrained SQL and genuine-draft predicate cover all bulk state/spam-learning operations plus single/bulk permanent draft deletion and negative-UID POP3 mail. POP3 allocator -1000000 strengthens prior uid<0 proof; positive IMAP UID protection, max-500 and no remote-deletion claims preserved.

**Prüfmethode laut Worker:**

independent static source trace

**Validierungszusammenfassung laut Worker:**

Independently traced bulk soft-delete, archive, spam/status, done and compose-draft deletion handlers/schemas into their SQL stores. Optional accountId only constrains SQL if provided. A 500-ID limit controls batch size, not authorization; UID checks distinguish synced messages/local drafts, not owner. Parent independently checked positiveInt draft schema, complete numeric resolver and single/bulk deletion stores against POP3_UID_CEILING. Local POP3 messages can be permanently deleted; no remote POP3/IMAP deletion is claimed.

Assigned dedup-0010 source 2, source-reported static validation: Confirmed real authentication remains required, schemas cap batches at 500 positive IDs, and SQL uses placeholders. None binds IDs to an authorized mailbox. The storage layer performs no role/grant checks and grants no implicit ownership through negative draft uid. Verified affected bulk delete, soft-delete, archive, spam, spam-status and done operations, plus single draft delete.

**Grenzen laut Worker:**

- No application execution, network request or production validation.
- Requires a real local agent/viewer session and existing message IDs. No grant is needed when accountId is omitted; all affected IDs must belong to the same local SQLite store.
- Attacker needs a valid local session and target IDs, which are numeric local identifiers; no remote IPC reachability claimed.
- SQL injection rejected; this is object authorization.
- Incoming calls uid<0 draft-only, while established evidence includes received POP3 negative UIDs. Preserve both without resolving: require actual compose-draft identity plus mailbox/write authority. Batch 500-ID cap and parameterized SQL do not enforce ownership.
- Application-account boundary only; a person already controlling the OS profile can also manipulate its local files.
- No runtime test; attachmentId and other potentially unmapped channels were not fully validated and remain deferred.
- No application execution or production testing.
- Requires a real authenticated desktop session and direct IPC access.
- No proof of a remotely exposed desktop IPC transport; authenticated renderer access is required.

**Gegenbelege laut Worker:**

Keine Angabe.

**Vorgeschlagene Korrektur, nicht als umgesetzt bestätigt:**

Resolve every batch item to its authoritative account and require write permission for all items before any mutation; reject unauthorized/unresolved batches atomically. Treat caller accountId as a constraint, not authorization. Resolve each single draft ID to its mailbox and require write access. Restrict draft deletions to actual local compose drafts (including the POP3 UID boundary and draft marker), and preserve received POP3 records.

**Vorgeschlagene Regressionstests, nicht als ausgeführt bestätigt:**

- Reject batches containing unauthorized messages without partial mutations; check omitted and forged accountId as well as read-only grants.
- Single/bulk draft deletion denies ungranted mailbox IDs and never deletes a received POP3 record even for an authorized mailbox user.
- Reject foreign draft IDs for single and bulk permanent deletion.
- Reject mixed-authorized/unauthorized batches without partial changes.
- Exercise every bulk state operation with accountId omitted and forged accountId.
- As a user with no victim-account grant, call every affected bulk operation with omitted accountId and victim IDs; assert no rows change.
- Call single and bulk draft deletion across account boundaries and assert denial.
- Mix permitted and denied IDs and verify atomic rejection or an explicit safe per-item policy.
- Unauthorized mixed-account arrays and omitted accountId must fail without partial changes; authorized bulk updates still work.
- Cross-account and POP3 received IDs must remain intact; authorized genuine drafts delete correctly.
- All six bulk channels reject a batch containing another mailbox's IDs when accountId is omitted.
- Read-only grants cannot mutate messages; mixed authorized/unauthorized batches do not partially apply.
- Authorized bulk operations remain bounded and work across explicitly granted mailboxes.

### 15. Password changes leave existing server sessions renewable

Worker-Kennung: session-management.password-recovery.

**Status:** offen; keine Behauptung einer Behebung im PR.

**Gemeldete Einstufung:**

- **level**: medium
- **rationale**: High impact persistence of compromised account access with medium likelihood because prior session compromise is required.

**Gemeldete Nachweissicherheit:**

- **level**: high
- **rationale**: Static source confirms the described flow; no runtime reproduction. Platform/deployment and attacker prerequisites remain explicit.

**Beschreibung:**

Self-service password changes and administrator password resets replace the user hash without invalidating existing sessions. A holder of a separately compromised session can continue using accepted access credentials and rotate an old refresh token into fresh 30-day sessions without knowing the replacement password, while the account remains enabled and renewal precedes expiry. The assigned source distinguishes password replacement from role changes: current role/capability information is reloaded, and disabling/deleting users or revoking the relevant session still works.

**Quellorte des Ausgangsstands:** `packages/server/src/db/postgres-auth-port.ts:329`, `packages/server/src/db/postgres-auth-port.ts:251`, `packages/server/src/db/postgres-auth-port.ts:702`, `packages/server/src/db/postgres-auth-port.ts:791`, `packages/server/src/api/auth-routes.ts:583`, `packages/server/src/db/postgres-auth-port.ts:736`, `packages/server/src/db/postgres-auth-port.ts:790`, `packages/server/src/db/postgres-auth-port.ts:850`, `packages/server/src/db/postgres-auth-port.ts:317`, `packages/server/src/db/postgres-auth-port.ts:833`, `packages/server/src/api/auth-routes.ts:567`, `packages/server/src/db/postgres-auth-port.ts:749`, `packages/server/src/db/postgres-auth-port.ts:826`, `packages/server/src/api/auth-routes.ts:558`, `packages/server/src/api/auth-routes.ts:727`, `packages/server/src/db/postgres-auth-port.ts:784`, `packages/server/src/db/postgres-auth-port.ts:679`, `packages/server/src/db/postgres-auth-port.ts:331`, `packages/server/src/db/postgres-auth-port.ts:703`, `packages/server/src/db/postgres-auth-port.ts:849`, `packages/server/src/db/postgres-auth-port.ts:245`, `packages/server/src/db/postgres-auth-port.ts:299`, `packages/server/src/db/postgres-auth-port.ts:789`, `packages/server/src/api/auth-routes.ts:580`

**Gemeldete Ursache:**

Both changePassword and saveUser replace users.password_hash without revoking refresh_tokens or advancing an enforced credential epoch. Access-principal validation and refresh rotation check expiry, revocation and current account status/role, but not credential replacement. Rotation consumes only the presented token and issues a fresh 30-day session. Existing 15-minute access-token expiry, current-role revalidation and user deletion/disablement controls do not invalidate an independent surviving refresh session after a password-only update.

Additional source: Both password-change operations update users.password_hash but neither revokes refresh_tokens nor advances a credential version. Access resolution and refresh rotation only consult session revocation/expiry and user disablement. An old session therefore remains valid after the password has been replaced, and refresh creates another full-lived session.

Assigned dedup-0005 source: The additional source explicitly calls for consistent invalidation of live connections and preserving ordinary non-password profile edits. These supplement the existing access/refresh and concurrency requirements.

Assigned dedup-0008 source: An attacker must already hold an independent valid session and the user must remain enabled. Current password/users.manage gates protect initiating the password update; disable/delete, current-role checks and per-session logout remain effective but do not provide password-change all-session revocation. Renewal grants another 30-day session; no initial authentication bypass is asserted.

Assigned dedup-0009 source: Both password mutation paths update only the user record. Session authorization and refresh rotation continue trusting unrevoked refresh-token rows, and neither path compares session issuance to password replacement. Prior valid attacker session and enabled account remain required; this is recovery persistence, not initial authentication bypass.

Assigned dedup-0011 synthesis: Both existing server password replacement paths and unchanged refresh/access validation. Incoming low severity/medium confidence and low likelihood remain alongside higher retained assessments. Prior valid attacker session, still-enabled user and renewal before expiry required; logout/disable/delete do not perform password-change all-session invalidation.

Assigned dedup-0014 synthesis: Same self-service/admin password replacement without access/refresh invalidation. Existing atomic revocation/credential epoch and concurrency handling cover both. Low/medium source severity preserved; stolen independent valid session, enabled user and timely refresh remain required.

Assigned dedup-0015 synthesis: Same self/admin password updates leave existing access/refresh sessions valid and renewable. Existing atomic session revocation/credential epoch plus concurrency protection covers both. Independent previously compromised session, enabled account and timely refresh remain required; CSRF, disable/delete and per-session logout do not supply password-update invalidation.

Assigned dedup-0017 synthesis: Same self/admin password replacement without old refresh-session invalidation. Transactional credential generation across issuance/rotation subsumes source; preserve proposed generation binding for outstanding authentication challenges.

Assigned dedup-0017 synthesis: Source session-fixation label is an alias of index5: identical password mutations, refresh acceptance and fix. Retain both refs and source high versus medium confidence; no second instance established.

**Prüfmethode laut Worker:**

Source-reported validation preserved; dedup-0011 performed supplied-artifact semantic reduction only

**Validierungszusammenfassung laut Worker:**

Previous aggregate (d604098d-2334-464f-accc-2550fface16c:10): Independently inspected both password mutation branches, route success path, refresh route/rotation, token issuance and principal validator. No password-change invalidation/trigger found in source/migrations. Atomic rotation only consumes one presented token; deletion/disablement can revoke/block sessions but password replacement does neither.

Assigned worker 0 (d185d3ef-8bf7-4adb-8a2e-6d8e1566900e:0): Both password replacement paths return after updating users; no migration trigger revokes sessions. Surviving refresh rows satisfy rotation and yield new 30-day sessions. Delete and disable controls invalidate access, but password-only updates invoke neither. Role revalidation does not compensate.

Assigned source 40e94555-7994-4e03-8422-151a4cc8752f:5: Verified self-service and admin reset return without session invalidation; old access tokens still resolve and old refresh tokens rotate without the new password. Logout revokes only the supplied token, and source/migration searches found no compensating password-update revocation.

Assigned source 61ab0f3d-38ae-4587-a421-de63347b1639:1: Verified authenticated password-change and authorized user-reset routes call these mutations without subsequent session revocation. Existing session rows remain valid in both validators and can renew. Deletion and disabling do invalidate access, but password reset alone does not.

Assigned source adae8751-0a17-49fc-a285-f8a4574c7953:5: Independently inspected changePassword, admin saveUser, route post-processing, session resolution and atomic refresh rotation. No token invalidation is called after successful password replacement. Disabled/deleted users and logout are enforced; ordinary password change does not invoke those paths.

Assigned source a72abecd-f31f-4abc-bacb-afd48bf1085c:7: Read both password mutation paths, refresh and access validators, HTTP change-password/logout and current migration definitions. No password-change revocation trigger/epoch appeared. Disable/delete and per-session logout offer narrower controls, but changing a password alone does not end the prior attacker's access.

Assigned source 705c5481-2d05-4afc-bc67-518d631d7500:0: The password-change handler does not compensate for the port's missing revocation. Both self-change and administrator reset return success while pre-existing refresh rows remain valid; access requests and rotation accept those rows. Explicit logout/revocation, token expiry and disabled-user checks work, but password replacement invokes none of them.

Assigned dedup-0010 source 4, source-reported static validation: Confirmed the password route simply calls the auth port and audits success (auth-routes.ts:567-605), production wiring uses that port (server.ts:574-577), and Fastify installs its principal validator (fastify-adapter.ts:111-118). Logout and account disable/delete invalidate sessions, but password change/reset does not. Atomic refresh rotation prevents reuse races without linking sessions to credential changes.

Assigned dedup-0011 source-reported offline static validation: Verified both password mutation implementations and their route callers, refresh rotation and access-token principal validation. Deleting or disabling a user does prevent access, and logout revokes the supplied session, but password changes perform neither. Migration search found no password-change invalidation trigger. This is persistence after credential rotation, not initial account compromise.

**Grenzen laut Worker:**

- No application execution, network request or production validation.
- Attacker must possess an independent valid session before the legitimate user/admin replaces the compromised password. Account must remain enabled and attacker must renew before expiry. This is persistence after recovery, not initial authentication bypass.
- No live token replay or deployment testing.
- Static review only; no live reset/refresh test.
- The additional source confirms logout revokes only the supplied token. Random/hashed refresh credentials, atomic single-token consumption, current-role reload, disabled/deleted-user rejection and short access-token lifetime do not terminate other renewable sessions after password-only recovery. Current permissions still constrain the surviving session.
- Requires an attacker session acquired before the legitimate password reset; no authentication bypass from a new unauthenticated state.
- No live session reproduction performed.
- Assigned source again requires a pre-existing compromised valid session and still-enabled account; no initial login bypass or runtime test is established.
- No runtime reproduction; deployed grants and configurations unknown.
- No runtime/production execution or network access.
- Production exposure, tenancy and optional feature configuration remain unspecified.
- No live account or database was used.
- Prior valid attacker session and enabled account remain required; this is recovery persistence, not initial authentication bypass.
- Existing compromised session is required.
- No runtime/database exercise; live compromise or deployment not asserted.
- No application execution, exploit inputs or network testing.
- Impact prerequisites: A session was compromised before a victim/admin password change; victim expects the credential reset to remove continuing account access.
- Both existing server password replacement paths and unchanged refresh/access validation. Incoming low severity/medium confidence and low likelihood remain alongside higher retained assessments. Prior valid attacker session, still-enabled user and renewal before expiry required; logout/disable/delete do not perform password-change all-session invalidation.
- No live server or stolen-token reproduction was run.
- Requires a session compromised before password recovery; no initial authentication bypass is claimed.
- Requires a previously compromised session or login; no initial credential theft is asserted.
- No production test.
- A deliberately retained current user session can be supported, but other sessions need revocation.

**Gegenbelege laut Worker:**

- Prior compromise required; no initial login bypass.
- Tokens are random/hashed and refresh consumption is atomic; these do not invalidate other sessions.
- Disabled/deleted users are rejected and current roles/capabilities are reloaded.
- Short access-token lifetime does not bound a surviving renewable refresh session.
- Disable blocks while disabled
- Delete removes refresh tokens
- Logout revokes presented session and tied access token
- Current password or users.manage required
- No all-session revocation route/credential epoch found

**Vorgeschlagene Korrektur, nicht als umgesetzt bestätigt:**

Transactionally revoke all pre-existing affected-user sessions or advance an enforced credential epoch on every self-service/admin password replacement. Enforce that epoch or equivalent serialization across access validation, refresh rotation and concurrent old-credential login/session issuance so no in-flight operation creates a surviving session. Require fresh authentication, or explicitly reissue a session only for the verified password-change caller. Apply the same invalidation to existing live connections; ordinary profile edits without password replacement should not unexpectedly revoke sessions. Bind outstanding authentication challenges to the same credential generation when they can issue sessions.

**Vorgeschlagene Regressionstests, nicht als ausgeführt bestätigt:**

- Create two independent synthetic sessions, replace the password, and assert old access and refresh tokens are invalid, including concurrent rotation.
- Old access and refresh tokens fail after self-service change and administrator reset.
- Concurrent login/refresh cannot preserve old-credential sessions.
- Create two sessions, change/reset the password, and verify previous access and refresh tokens are rejected.
- Race refresh with reset and verify no pre-reset session survives.
- Verify role demotion and normal refresh behavior remain effective.
- After both self-service password change and administrative password reset, reject previously issued refresh and access tokens.
- Verify ordinary profile edits do not revoke sessions unexpectedly, and legitimate reauthentication succeeds.
- Cover the complete described request sequence using the actual authorization policy and persistent storage; verify protected state remains unchanged on rejection.
- Two-session test: password change and admin reset invalidate the other session's access and refresh tokens.
- Concurrent refresh cannot create a surviving replacement across password recovery.
- After self-change and admin reset, assert that old access and refresh tokens both fail.
- Verify any deliberately retained current session is newly issued and other sessions are revoked.
- After self-service change and administrative reset, reject old access and refresh tokens from other sessions.
- Confirm any retained current session is explicitly replaced after reauthentication.
- Test simultaneous refresh/login and password replacement cannot leave a stale-credential session valid.
- Add a regression test for the stated boundary that verifies the prohibited effect is rejected before the sensitive operation.
- Issue two sessions, change the password through each supported path, and verify both old access and refresh tokens fail while a newly authorized session succeeds.
- Two sessions: password change/reset invalidates the other session's access and refresh.
- Concurrent refresh cannot issue a session surviving the password reset transaction.
- Current session behavior is explicit and rotated if retained.
- Create two sessions, change/reset the password, and assert old refresh and access credentials are rejected.
- Race refresh rotation with password reset and assert no descendant pre-reset session remains valid.
- After self-service and admin password changes, an earlier separate refresh token returns 401.
- Earlier access tokens fail session validation immediately.
- A deliberately reissued current session works and concurrent refresh cannot escape revocation.
- Pre-change access/refresh tokens fail after self-service change and administrative reset.
- Any intentionally preserved current session is explicitly rotated.
- Logout, disabled-user and deletion revocation still work.

### 16. Restricted desktop users can redirect a stored AI API key

Worker-Kennung: missing-authorization.desktop-ai-credentials.

**Status:** offen; keine Behauptung einer Behebung im PR.

**Gemeldete Einstufung:**

- **level**: medium
- **rationale**: High confidentiality impact to a configured API key, with constrained authenticated local-user likelihood.

**Gemeldete Nachweissicherheit:**

- **level**: high
- **rationale**: Complete profile store and fetch consumer independently inspected; schema accepts caller-selected URLs and no administrator gate is present.

**Beschreibung:**

A signed-in desktop agent/viewer can modify an existing shared AI profile's base URL while retaining its Keytar key, make it default and invoke text translation. The privileged main process sends the existing API key as an Authorization bearer credential to the chosen endpoint.

**Quellorte des Ausgangsstands:** `electron/ipc/email.ts:1823`, `electron/ipc/email.ts:1844`, `electron/ipc/email.ts:1859`, `electron/email/email-ai-profiles.ts:256`, `electron/email/email-openai.ts:34`, `electron/ipc/email.ts:1952`, `shared/ipc/email-schemas.ts:1477`, `electron/email/email-ai-profiles.ts:182`, `electron/email/email-ai-profiles.ts:254`, `electron/ipc/email.ts:1951`, `electron/email/email-openai.ts:25`, `electron/email/email-ai-profiles.ts:183`, `electron/email/email-openai.ts:21`, `electron/email/email-openai.ts:68`, `electron/ipc/email.ts:1946`, `electron/ipc/email.ts:1824`, `electron/ipc/email.ts:1860`, `electron/email/email-ai-profiles.ts:190`, `electron/ipc/email.ts:1801`, `electron/ipc/email.ts:1928`, `electron/email/email-ai-profiles.ts:244`, `electron/email/email-openai.ts:20`

**Gemeldete Ursache:**

SaveAiProfile accepts global profile IDs and URLs under the generic session-only IPC registration. updateAiProfile changes base_url without changing keytar_account, and the key is replaced only when a nonempty apiKey is supplied. AI runtime resolves the retained key alongside the new URL.

Assigned source independently confirms the payload schema accepts baseUrl and optional apiKey, ListAiProfiles reveals usable IDs, and key getters otherwise expose configured status only. Main-process fetch bypasses renderer CSP; neither direct keytar access nor a mailbox grant is required.

Assigned dedup-0009 source: Endpoint editing is authorized by session alone and retains the keytar binding; both AI clients trust the changed endpoint with the protected key. Retain default-profile translation as immediate trigger, later content disclosure, profile mutation/deletion/default/key operations and legacy settings; no direct key-return or server-edition exposure is inferred.

Assigned dedup-0014 synthesis: Same AI profile URL edit retains Keytar key, default-profile translation sends it. Existing administrative settings and approved destination binding cover chat/embedding and legacy paths. No direct key return or server instance inferred.

Assigned dedup-0015 synthesis: Same unprivileged shared AI endpoint/default edit retains Keytar secret and translation sends bearer credential. Existing admin configuration and approved destination binding cover all. Translation needs no stored prompt; configured key/outgoing connectivity and later prompt redirection preserved.

**Prüfmethode laut Worker:**

Source-reported static validation preserved; dedup-0009 performed supplied-artifact semantic comparison only

**Validierungszusammenfassung laut Worker:**

Checked preload allowlist, IPC role/account resolver, SaveAiProfile schema/handler, complete profile persistence/runtime resolver and chat/embedding HTTP consumers. Listing exposes valid profile IDs. AiTransformText translate mode needs no stored prompt and uses the modified default. Provider presets do not constrain baseUrl. Keytar secrecy and renderer CSP do not stop main-process authenticated fetch.

Assigned source 374fcd79-f6b4-4fe0-9fa9-bf807f27f7a9:14: Independently traced permissive profile schema, default-auth handler, UPDATE preserving keytar_account, default-profile translation trigger, runtime key resolution and main-process fetch Authorization header.

Assigned source 705c5481-2d05-4afc-bc67-518d631d7500:14: Parent traced profile update, retained keytar_account, runtime key resolution and both outbound sinks. AiTransformText translation uses the default profile; a caller can make the edited profile default. Configured usable key and real desktop session required. No server-edition exposure or direct key-return IPC is claimed.

**Grenzen laut Worker:**

- No runtime execution or external endpoint contacted.
- Requires a stored usable API key, a real local session and a multi-user desktop trust boundary. Key permissions constrain downstream impact.
- Static validation only; no runtime reproduction.
- Retain default-profile translation as immediate trigger, later content disclosure, profile mutation/deletion/default/key operations and legacy settings; no direct key-return or server-edition exposure is inferred.
- No application execution or production testing.
- Requires a real authenticated desktop session and direct IPC access.

**Gegenbelege laut Worker:**

- A real desktop session and previously configured AI key are required.
- Key getters ordinarily expose only configured status; this path makes main transmit the retained key.
- Main-process fetch is not constrained by renderer CSP; no need to read keytar directly.
- No unauthenticated remote attacker path claimed.

**Vorgeschlagene Korrektur, nicht als umgesetzt bestätigt:**

Restrict shared AI credential and endpoint management to authorized administrators. Bind stored keys to approved destinations and clear/reconfirm the key when the destination changes. Apply the same rule to chat and embedding callers and legacy settings. Apply administration checks consistently to save/delete/default/key-clearing operations, not only profile creation.

**Vorgeschlagene Regressionstests, nicht als ausgeführt bestätigt:**

- Restricted users cannot change shared keyed profiles or their destination/default selection.
- Authorized endpoint changes require deliberate key rebinding; a captured fake transport must never receive the previous destination's credential.
- A restricted session cannot alter global AI destinations or default profile.
- Origin changes cannot silently reuse an existing key.
- Authorized unchanged-origin chat and embedding requests continue working.
- A nonadministrator cannot change a credential-bearing profile's endpoint or default status.
- An endpoint-origin change cannot cause the old API key to be sent.
- Test chat completion and embeddings using a controlled transport stub.
- Unprivileged endpoint changes rejected; changing endpoint must not silently reuse old secret.

### 17. Dashboard and follow-up bypass task assignment checks on reads and snoozing

Worker-Kennung: missing-authorization.task-assignment.

**Status:** offen; keine Behauptung einer Behebung im PR.

**Gemeldete Einstufung:**

- **level**: medium
- **rationale**: Retains the assigned worker's medium/high-likelihood assessment for restricted task-summary disclosure. The independently reachable snooze instance remains low severity (reversible state change requiring crm.write); prior aggregate assessed the combined issue low with medium confidentiality/integrity impact. All original assessments remain attributed.

**Gemeldete Nachweissicherheit:**

- **level**: high
- **rationale**: Source trace confirms reachable assignment creation, canonical visibility predicate, missing sibling predicates, response mapping and workspace-only RLS.

**Beschreibung:**

CRM readers can obtain otherwise hidden same-workspace user/group-assigned task metadata through dashboard/upcoming-tasks and follow-up/items; dashboard/stats and follow-up/queue-counts also include restricted tasks. Any nonempty unrecognized follow-up queue removes date/snooze restrictions and permits pagination through incomplete tasks. Separately, a CRM writer knowing a target ID can snooze an invisible task by workspace/ID and remove it from current/overdue follow-up queues. The established finding retains both distinct read and write instances. Descriptions are not directly returned; the incoming source also reports description-search match disclosure.

**Quellorte des Ausgangsstands:** `packages/server/src/db/postgres-core-crm-read-ports.ts:1647`, `packages/server/src/api/dashboard-routes.ts:41`, `packages/server/src/db/postgres-dashboard-port.ts:145`, `packages/server/src/api/follow-up-routes.ts:46`, `packages/server/src/db/postgres-follow-up-port.ts:163`, `packages/server/src/db/postgres-follow-up-port.ts:252`, `packages/server/src/migrations/0005_core_crm_schema.ts:157`, `packages/server/src/api/follow-up-routes.ts:59`, `packages/server/src/db/postgres-follow-up-port.ts:285`, `packages/server/src/db/postgres-dashboard-port.ts:63`, `packages/server/src/db/postgres-follow-up-port.ts:26`, `packages/server/src/api/follow-up-routes.ts:47`, `packages/server/src/db/postgres-follow-up-port.ts:298`, `packages/server/src/db/postgres-dashboard-port.ts:135`, `packages/server/src/db/postgres-core-crm-read-ports.ts:1652`, `packages/server/src/db/postgres-follow-up-port.ts:38`, `packages/server/src/db/postgres-follow-up-port.ts:245`, `packages/server/src/db/postgres-core-crm-read-ports.ts:770`, `packages/server/src/db/postgres-follow-up-port.ts:182`, `packages/server/src/db/postgres-dashboard-port.ts:129`, `packages/server/src/db/postgres-dashboard-port.ts:140`, `packages/server/src/db/postgres-core-crm-read-ports.ts:784`, `packages/server/src/api/follow-up-routes.ts:35`, `packages/server/src/db/postgres-follow-up-port.ts:240`, `packages/server/src/db/postgres-follow-up-port.ts:24`, `packages/server/src/migrations/0005_core_crm_schema.ts:145`, `packages/server/src/api/dashboard-routes.ts:30`, `packages/server/src/api/follow-up-routes.ts:30`, `packages/server/src/db/postgres-follow-up-port.ts:164`

**Gemeldete Ursache:**

Dashboard/follow-up APIs pass only the workspace instead of the TaskViewer required by the canonical task visibility predicate. Their independent task queries filter workspace/completion/time, not assignment_scope/user/group. Snooze likewise updates by workspace and ID only. RLS isolates workspaces rather than task assignees. Read ports omit the authenticated viewer from getUpcomingTasks/getStats/getItems/getQueueCounts; assignment filtering must precede selection, counts, filters, sorting and pagination. Snooze carries actorUserId only as transaction context, with no assignment predicate in its UPDATE. Its missing write authorization is independently reachable and cannot be repaired solely by filtering read responses.

Assigned dedup-0007 source: The assigned source repeats queue=all as the unrecognized nonempty queue that removes date filtering, production bindings at server.ts:650,701, workspace-only RLS and the mapper's exclusion of task descriptions. Its overall medium severity/medium impact/high likelihood and its investigator's medium snooze assessment remain attributed alongside the previous low snooze/combined assessments; no deployment or severity disagreement is resolved.

Assigned dedup-0009 source: Alternate task consumers bypass the shared assignment predicate and their port inputs omit viewer identity. Workspace RLS preserves tenant isolation but cannot enforce the missing user/group task restriction. Incoming low severity remains attributed alongside retained medium; unrecognized queue removes date restrictions, returned descriptions are excluded, workspace isolation and crm.write for snooze remain effective.

Assigned dedup-0010 synthesis: Incoming reports description search as a match oracle without direct description return. Apply assignment filtering before search/count/pagination and reject unknown queue values; queue=all bypasses date/snooze filters. Both incoming read and snooze ratings are low versus retained medium. Snooze requires crm.write and known hidden ID independently of any read leak.

Assigned dedup-0014 synthesis: Same task dashboard/follow-up views/counts and independent snooze missing assignment predicate. Existing viewer propagation and query/mutation predicates cover all. Unknown queue expands enumeration; no direct description return, previous search oracle retained. Incoming low versus prior medium severity remains attributed.

Assigned dedup-0017 synthesis: Same viewerless dashboard/follow-up reads/counts/search and separate snooze write. Every read/write requires viewer predicates and queue validation. Preserve disagreement: source names descriptions as disclosed; prior evidence limits direct response to metadata and description-search match inference. No reducer resolution.

**Prüfmethode laut Worker:**

Source-reported static validation preserved; dedup-0009 performed supplied-artifact semantic comparison only

**Validierungszusammenfassung laut Worker:**

Previous aggregate (d604098d-2334-464f-accc-2550fface16c:13): Checked ordinary task list/get viewer propagation and taskVisibilityExpression, task assignment parser/persistence, complete dashboard/follow-up routes and stores, task/user-group migrations and real server port wiring. Primary task operations enforce assignment visibility; sibling query result mapping exposes task metadata (description is selected internally but not returned). Snooze still requires crm.write. Workspace RLS prevents cross-workspace impact but cannot supply the missing viewer filter.

Assigned worker 2 (d185d3ef-8bf7-4adb-8a2e-6d8e1566900e:2): Production ports wired at server.ts:650,701. Normal predicate at postgres-core-crm-read-ports.ts:1652-1671 checks global/self/group assignments; both summary ports omit it. Task RLS only isolates workspace. crm.read, dashboard 25-row cap and no returned descriptions limit impact but do not authorize restricted summaries.

Assigned worker 3 (d185d3ef-8bf7-4adb-8a2e-6d8e1566900e:3): crm.write and valid timestamp enforced. SQL lacks user/group predicate, production port wired, future snoozed_until excludes tasks from today/overdue queues. Not arbitrary task-field write or cross-workspace access.

Assigned source adae8751-0a17-49fc-a285-f8a4574c7953:13: Read complete follow-up route/port and dashboard route/port, ordinary task route and taskVisibilityExpression, and assignment/RLS migrations. Ordinary list/get/update/delete apply viewer scope; these alternate views and snooze do not. Count endpoints also aggregate all workspace tasks. The follow-up mapper omits description, limiting the disclosed fields. Server registration routes these requests behind CRM read, with crm.write additionally required for snooze.

Assigned source 1134688b-c6f4-4ad3-aedd-9b4e4922ecc7:1: Verified production bindings at server.ts:650,701, central crm.read gate, follow-up/dashboard SQL, task visibility helper and workspace RLS. GET follow-up/items?queue=all lists incomplete tasks without date predicates; dashboard/upcoming-tasks independently returns task summaries. Follow-up queue-counts and dashboard/stats also aggregate unauthorized tasks. PATCH follow-up/tasks/:id/snooze checks crm.write but not assignment and can suppress another assignee's task from active queues.

Assigned source 705c5481-2d05-4afc-bc67-518d631d7500:10: Parent read the full follow-up route/port, dashboard query and normal task visibility expression. These ports are wired in production (server.ts:650,701). queue accepts any nonempty value; an unrecognized queue leaves all incomplete tasks available. Snooze requires crm.write, but not task visibility. Mapped list output does not expose description despite selecting it; the finding is limited to returned fields.

Assigned dedup-0010 source 9, source-reported static validation: Production wires dashboard/followUp at server.ts:650,701. Follow-up route:47-56 passes no viewer; normalizeQueue:94-97 accepts any nonempty string, so queue=all avoids date/snooze filters and pagination enumerates incomplete tasks. Dashboard getUpcomingTasks runs system context without viewer. Counts similarly include hidden tasks. Normal task list/get uses visibility, and migration0005:157-159 only checks workspace. Central crm.read gate remains effective.

Assigned dedup-0010 source 10, source-reported static validation: Validated PATCH follow-up/tasks/:id/snooze at follow-up-routes.ts:59-73 and port:240-263. Standard task update adds taskVisibilityExpression at postgres-core-crm-read-ports.ts:794. Task RLS is workspace-only, so role:user context is insufficient. A future snoozed_until suppresses tasks from current/overdue/week queues (follow-up port:182-204).

**Grenzen laut Worker:**

- No database/application execution.
- Requires tasks assigned to another user/group and an authenticated CRM reader; modification additionally requires crm.write.
- No task description/body disclosure asserted because the follow-up mapper omits it.
- No live data queried.
- No live mutation performed.
- Original severity assessments retained: previous combined finding low; assigned read finding medium; assigned snooze finding low. Read scope is task metadata/customer associations and counts, not descriptions/bodies; write scope is snoozed_until and modification timestamps, not arbitrary task fields.
- No runtime reproduction; restricted user/group task assignments must exist.
- dedup-0006 again assesses the complete task read/count/snooze issue low overall, high confidence, medium impact/medium likelihood. Earlier medium read-severity assessment remains attributed; no severity or reachability disagreement is resolved.
- No live server/database reproduction; actual tenant/user setup unknown.
- dedup-0007 final Standard assessment is medium severity, high confidence, medium impact/high likelihood; its retained investigator rates the independently reachable snooze medium. Earlier low snooze severity and lower combined likelihood are preserved without new validation.
- Source only; real deployment not inspected.
- Incoming low severity remains attributed alongside retained medium; unrecognized queue removes date restrictions, returned descriptions are excluded, workspace isolation and crm.write for snooze remain effective.
- Same-workspace crm.read required.
- Task description is not directly returned but is searchable as a match oracle.
- No runtime/database query performed.
- Same-workspace CRM writer and hidden task ID required.
- No runtime exercise or cross-tenant claim.
- Incoming reports description search as a match oracle without direct description return. Apply assignment filtering before search/count/pagination and reject unknown queue values; queue=all bypasses date/snooze filters. Both incoming read and snooze ratings are low versus retained medium. Snooze requires crm.write and known hidden ID independently of any read leak.

**Gegenbelege laut Worker:**

- Core task list/get/update and calendar-linked task consumers do enforce task assignment visibility.
- Snooze requires crm.write; a crm.read-only user cannot use that mutation.
- Workspace predicates and RLS prevent claimed cross-tenant effects.
- Description is selected internally but not returned by the follow-up mapper.

**Vorgeschlagene Korrektur, nicht als umgesetzt bestätigt:**

Require authenticated TaskViewer propagation through dashboard.getUpcomingTasks/getStats and followUp.getItems/getQueueCounts, applying the canonical global/self/member-group predicate before selection, counts, filtering, sorting and pagination. Separately require the same viewer-bound assignment predicate in followUp.snoozeTask's UPDATE, or route snoozing through the authorized normal task update. Fail consistently for invisible IDs and retain crm.read/crm.write, valid-timestamp, workspace, authorized-group and administrator behavior. Completion requires fixing every read/count and the independent write instance; repairing only one side does not remediate this finding. Validate recognized queue values and apply assignment filtering before description matching.

**Vorgeschlagene Regressionstests, nicht als ausgeführt bestätigt:**

- Readers cannot see other-user/group task metadata or counts through any sibling route.
- CRM writers cannot snooze tasks invisible to them; own/global/group-authorized tasks and admin access continue to work.
- All four endpoints hide/count only global, self and member-group tasks.
- Administrator visibility and authorized pagination remain correct.
- Other-user/unrelated-group snoozing fails unchanged.
- Own/global/authorized-group tasks remain writable.
- Create global, own-user, other-user and group tasks and compare ordinary tasks, follow-up and dashboard results for non-admin users.
- Verify a CRM writer outside the assigned user/group cannot snooze the task; authorized assignees and administrators retain access.
- A CRM reader outside a personal/group assignment sees no task metadata or counts in any alternate view.
- A CRM writer outside an assignment cannot snooze a known task ID, independently of read filtering.
- Assigned users, authorized group members and admins retain expected access.
- Exercise authorization.task-assignment-alternate-routes with an unauthorized actor or bounded-input regression and assert no protected sink executes.
- Private user/group assignments stay hidden from dashboard, each follow-up queue, counts and search for unauthorized readers.
- Global/self/own-group tasks remain visible and owners/admins retain intended access.
- A CRM writer cannot snooze another user's or foreign group's private task.
- Authorized global/self/own-group task snoozes still work.
- Compare every task view/count/mutation for global/self/group/inaccessible/admin assignments.
- Snooze predicate denies a private task even when caller has crm.write.
- Unknown queue values are rejected.

### 18. Read-only workflow SQL accepts SELECT INTO writes

Worker-Kennung: insufficient-validation.mssql-readonly-query.

**Status:** offen; keine Behauptung einer Behebung im PR.

**Gemeldete Einstufung:**

- **level**: low
- **rationale**: Medium database integrity/resource impact with constrained delegated-manager and write-capable SQL credential prerequisites.

**Gemeldete Nachweissicherheit:**

- **level**: medium
- **rationale**: Source validates the parser and caller-to-driver path; actual MSSQL grants and deployed configuration are unknown, and no SQL was executed.

**Beschreibung:**

The server's read-only MSSQL filter accepts SELECT ... INTO, which creates and populates a table using the configured connection. A non-admin user delegated workflows.manage can create an enabled MSSQL workflow and invoke its dry-run, which executes the query live. The boundary is bypassed when the configured SQL credential has the required CREATE TABLE/schema permissions.

**Quellorte des Ausgangsstands:** `packages/server/src/mssql-settings.ts:198`, `packages/server/src/mssql-settings.ts:389`, `packages/server/src/workflow-execution.ts:4159`, `packages/server/src/api/workflow-routes.ts:548`, `packages/core/src/workflow/schema/integration.ts:155`, `packages/server/src/api/workflow-routes.ts:961`, `packages/server/src/workflow-execution.ts:2044`, `packages/server/src/workflow-execution.ts:2403`, `packages/server/src/workflow-execution.ts:2511`, `packages/server/src/mssql-settings.ts:179`, `packages/server/src/workflow-execution.ts:4154`, `packages/server/src/api/workflow-routes.ts:962`, `packages/server/src/workflow-execution.ts:2038`, `packages/server/src/workflow-execution.ts:2399`

**Gemeldete Ursache:**

Read-only enforcement is a SELECT/WITH prefix plus incomplete keyword denylist. INTO is permitted, and the driver runs the accepted statement with the stored credential's privileges. The dry-run side-effect switch omits mssql.query, so it reaches the external database despite the live-run administrator gate.

Assigned dedup-0009 source: A keyword blacklist does not exclude SELECT INTO, and MSSQL nodes are absent from dryRunMutatingNodeResult so accepted queries execute during dry runs. Incoming high confidence versus retained medium is attributed without resolution. Both workflows.manage and workflows.run, enabled graph, configured integration and sufficient CREATE TABLE/schema rights are required; no SQL was executed.

**Prüfmethode laut Worker:**

Source-reported static validation preserved; dedup-0009 performed supplied-artifact semantic comparison only

**Validierungszusammenfassung laut Worker:**

Independently read the entire MSSQL settings/connection implementation, workflow SQL schema and execute consumer, dry-run switch and route gates. A harmless illustrative statement form, SELECT 1 AS value INTO dbo.new_table, passes the filter by inspection; no statement was run. Enabled side-effect workflow creation requires workflows.manage. Workflows.edit alone can save disabled graphs, but dryRun skips disabled graphs, so that narrower attacker claim was falsified. The module hierarchy gives managers run/edit rights. SQL is not interpolated from email content; this is not an email SQL-injection claim.

Assigned source 705c5481-2d05-4afc-bc67-518d631d7500:13: SELECT 1 AS x INTO dbo.audit_probe matches SELECT prefix and none of the denied keywords. The driver executes normalized SQL unchanged. Parent read complete dry-run suppression switch2511-2637 and found no MSSQL case. Live manual side-effect runs require admin; dry runs require workflows.run. Enabled graphs require workflows.manage; disabled graphs are skipped. Database read-only credentials prevent the write.

**Grenzen laut Worker:**

- Requires a non-admin delegated workflow manager, configured MSSQL connection and credential with CREATE TABLE and target-schema authority.
- A genuinely read-only SQL principal defeats the write outcome.
- No SQL server, application code or network was used. No DROP/UPDATE execution or arbitrary database administration claimed.
- No application, database, or example statement was executed.
- Actual SQL account privileges are unknown.
- Incoming high confidence versus retained medium is attributed without resolution. Both workflows.manage and workflows.run, enabled graph, configured integration and sufficient CREATE TABLE/schema rights are required; no SQL was executed.

**Gegenbelege laut Worker:**

Keine Angabe.

**Vorgeschlagene Korrektur, nicht als umgesetzt bestätigt:**

Enforce read-only SQL at the database principal as well as with a parsed single-statement allowlist that rejects SELECT INTO and non-read constructs. Stub external MSSQL operations in dry-run or apply equivalent explicit external-query authorization. Preserve the no-interpolation rule. Require the applicable workflows.manage and workflows.run grants, while retaining enabled-graph and live-run administrator controls.

**Vorgeschlagene Regressionstests, nicht als ausgeführt bestätigt:**

- SELECT INTO and multi-statement inputs are rejected before any driver call.
- Dry-run produces no external DB side effects; read-only integration credentials cannot create tables.
- Valid SELECT reads still function for authorized callers.

### 19. Ordinary users receive administrator-only automation-key metadata through events

Worker-Kennung: missing-authorization.automation-key-events.

**Status:** offen; keine Behauptung einer Behebung im PR.

**Gemeldete Einstufung:**

- **level**: low
- **rationale**: Limited same-workspace reconnaissance metadata; no secret or cross-workspace access.

**Gemeldete Nachweissicherheit:**

- **level**: high
- **rationale**: Created/revoked types are registered, absent from mail policy, and not CRM-reduced. Production wires event and automation ports. Live and replay share this filter; workspace checks and plaintext-key secrecy remain effective.

**Beschreibung:**

A workspace user denied automation-key HTTP access can obtain key labels, scopes, identifiers and administrator activity through live or replayed WebSocket events. Secret key material is not included.

**Quellorte des Ausgangsstands:** `packages/server/src/api/automation-routes.ts:190`, `packages/server/src/api/fastify-adapter.ts:239`, `packages/server/src/mail-access/async-policy-enforcer.ts:1110`, `packages/server/src/api/fastify-adapter.ts:350`, `packages/server/src/api/fastify-adapter.ts:373`, `packages/server/src/api/automation-routes.ts:42`

**Gemeldete Ursache:**

publishApiKey emits metadata protected by requireAdmin on HTTP. filterMailEventForPrincipal returns registered non-mail events unchanged; automation-key events enter this branch without role checks before socket transmission.

**Prüfmethode laut Worker:**

independent static source trace

**Validierungszusammenfassung laut Worker:**

Created/revoked types are registered, absent from mail policy, and not CRM-reduced. Production wires event and automation ports. Live and replay share this filter; workspace checks and plaintext-key secrecy remain effective.

**Grenzen laut Worker:**

- No WebSocket connection or database access performed.

**Vorgeschlagene Korrektur, nicht als umgesetzt bestätigt:**

Apply owner/admin authorization to automation-key events before generic non-mail pass-through on both live and replay delivery.

**Vorgeschlagene Regressionstests, nicht als ausgeführt bestätigt:**

- Ordinary users receive neither live nor replayed key metadata.
- Administrators retain expected events; workspace separation remains.

### 20. Workflow editors can disable or remove active protected automation

Worker-Kennung: incorrect-authorization.workflow-state-transition.

**Status:** offen; keine Behauptung einer Behebung im PR.

**Gemeldete Einstufung:**

- **level**: medium
- **rationale**: Direct suppression of manager-protected automation; effect depends on configured workflows, confined to workspace. Assigned source rates the same disabling instance low overall with medium impact/medium likelihood; the existing medium assessment and both source rationales are retained without new validation.

**Gemeldete Nachweissicherheit:**

- **level**: high
- **rationale**: PATCH requires edit whereas deletion requires manage. Explicit false overrides existing.enabled; concrete SQL maps that flag and only adds optimistic state conditions. Enabled-only runtime selection stops automation. Existing chain-stop/override/priority guards explicitly protect suppression. Disabled drafts intentionally remain editable. Restore no-op variant constrained to unkeyed workflows allowed by outbound graph guards.

**Beschreibung:**

An edit-only user can PATCH an active protected workflow to enabled:false. Manage guards evaluate the disabled proposed state and permit the write. Eligible active unkeyed side-effect graphs can similarly be replaced or restored to no-op graphs.

**Quellorte des Ausgangsstands:** `packages/server/src/api/workflow-routes.ts:418`, `packages/server/src/api/workflow-routes.ts:962`, `packages/server/src/api/workflow-routes.ts:998`, `packages/server/src/api/workflow-routes.ts:1161`, `packages/server/src/db/postgres-workflow-read-ports.ts:1095`, `packages/server/src/mail-inbound-workflow-enqueue.ts:53`, `packages/server/src/api/workflow-runtime-routes.ts:423`, `packages/server/src/api/workflow-routes.ts:413`, `packages/server/src/api/workflow-routes.ts:961`, `packages/server/src/db/postgres-workflow-read-ports.ts:741`, `packages/server/src/mail-inbound-workflow-enqueue.ts:51`

**Gemeldete Ursache:**

Authorization checks only proposed state. Disabled proposals return before both manage checks even when replacing protected active state. Harmless replacement/restored graphs likewise evade checking whether prior protected effects may be removed.

Assigned source confirms optimistic state predicates enforce consistency but not workflows.manage, and the outbound trap guard also skips disabled states. Preserve inactive draft editing. Configured spam/compliance workflow suppression is a narrower impact example; no cross-tenant or code-execution effect is asserted.

**Prüfmethode laut Worker:**

Source-reported static validation preserved; dedup-0003 performed semantic reduction only

**Validierungszusammenfassung laut Worker:**

PATCH requires edit whereas deletion requires manage. Explicit false overrides existing.enabled; concrete SQL maps that flag and only adds optimistic state conditions. Enabled-only runtime selection stops automation. Existing chain-stop/override/priority guards explicitly protect suppression. Disabled drafts intentionally remain editable. Restore no-op variant constrained to unkeyed workflows allowed by outbound graph guards.

Assigned source 374fcd79-f6b4-4fe0-9fa9-bf807f27f7a9:4: Parent verified route dispatch, both disabled-state early returns, production workflow port wiring at server.ts743, workspace-scoped update and enabled-only inbound selection. Expected-state predicates prevent races but do not require manage for this transition. The comments explicitly classify silencing spam/compliance automation as privileged.

**Grenzen laut Worker:**

- No workflow changed or executed; consequences depend on configured automation.
- Static validation only; no runtime reproduction.
- Assessment difference: previous source medium overall/high likelihood; assigned source low overall/medium likelihood. Both concern the same configured-workflow suppression; reducer does not decide deployment impact.

**Gegenbelege laut Worker:**

- Editing inactive drafts is intended and should remain possible.
- Workspace context and optimistic state comparisons remain effective.
- Outbound trap guard also skips disabled states.
- Impact depends what the active workflow enforces.

**Vorgeschlagene Korrektur, nicht als umgesetzt bestätigt:**

Authorize execution-affecting transitions against both stored and proposed states. Require manage to disable/remove/replace active protected automation, including restore, retaining editor access to disabled drafts and harmless metadata. Bind checked pre-state to writes.

**Vorgeschlagene Regressionstests, nicht als ausgeführt bestätigt:**

- Edit-only users cannot disable active side-effect/chain-stop/override workflows.
- No-op replacement/restore cannot remove protected effects; drafts remain editable.
- Concurrent pre-state changes reject stale authorization.
- Edit-only user cannot disable an active protected workflow or replace its graph with harmless content.
- Edit-only user can continue editing an inactive draft.
- Manage user can disable and change protected workflows without weakening optimistic concurrency.

### 21. Email HTML attachments can block automatic indexing and the application event loop

Worker-Kennung: regular-expression-denial-of-service.html-text-extraction.

**Status:** offen; keine Behauptung einer Behebung im PR.

**Gemeldete Einstufung:**

- **level**: high
- **rationale**: External unauthenticated email input can stall the shared server event loop and all users of that process; synchronized mailbox required.

**Gemeldete Nachweissicherheit:**

- **level**: high
- **rationale**: 15 MiB input allowance, sync queue, server/desktop backfill and common synchronous helper confirmed. Sum of suffix scans is quadratic. Serialized queue and 30-second timeout do not bound this CPU work. No benchmark; exact stall runtime-dependent.

**Beschreibung:**

An external sender can deliver an HTML attachment with repeated unterminated opening delimiters that cause quadratic rescanning in the shared text stripper. Automatic indexing runs it synchronously in server or Electron main; the timeout cannot interrupt it.

**Quellorte des Ausgangsstands:** `packages/server/src/mail-sync.ts:2066`, `packages/core/src/email/attachment-text.ts:5`, `packages/server/src/mail-attachment-text.ts:90`, `packages/core/src/email/parse-utils.ts:173`, `packages/server/src/mail-attachment-text.ts:192`, `electron/email/attachment-text-extract.ts:73`, `electron/email/email-message-attachments-store.ts:159`, `electron/email/attachment-text-extract.ts:118`, `electron/email/attachment-text-extract.ts:74`, `electron/email/attachment-text-extract.ts:117`, `electron/email/email-sync-post-process.ts:65`, `packages/server/src/mail-sync.ts:2062`, `packages/core/src/email/parse-utils.ts:168`, `packages/server/src/mail-attachment-text.ts:89`, `packages/core/src/email/attachment-text.ts:3`

**Gemeldete Ursache:**

Unanchored /<[^>]+>/g attempts at repeated opening delimiters without a closing delimiter rescan remaining suffixes. Output cap applies afterward. HTML branch executes before its promise reaches withTimeout, and timers cannot preempt synchronous JS.

Assigned dedup-0014 synthesis: Same shared synchronous quadratic HTML stripping reached automatically by desktop/server attachment indexing. Shared bounded linear parser plus terminable workers covers both. Preserve 15MiB input, later 500k cap, nonpreemptive timeout and unmeasured engine optimizations. Incoming medium confidence/severity versus prior high remains unresolved.

**Prüfmethode laut Worker:**

independent static source trace

**Validierungszusammenfassung laut Worker:**

15 MiB input allowance, sync queue, server/desktop backfill and common synchronous helper confirmed. Sum of suffix scans is quadratic. Serialized queue and 30-second timeout do not bound this CPU work. No benchmark; exact stall runtime-dependent.

**Grenzen laut Worker:**

- No malicious input, benchmark or live mail delivery executed.
- HTML-body fallback also calls helper, but body parser transformations not independently validated; attachment path suffices.

**Vorgeschlagene Korrektur, nicht als umgesetzt bestätigt:**

Use a linear-time HTML text extractor with bounded input processing and isolate document parsing in terminable workers with wall-clock and memory limits.

**Vorgeschlagene Regressionstests, nicht als ausgeführt bestätigt:**

- Repeated opening delimiters/unterminated tags complete within bounded budget.
- Timeout terminates processing without blocking API/Electron.
- Use a bounded regression/performance test for long malformed HTML with repeated opening brackets and assert near-linear scaling.
- Verify automatic attachment parsing cannot block the main process and worker timeouts terminate parsing.
- Adversarial unterminated tag inputs exhibit bounded near-linear work.
- Deadline actually terminates parser work and does not only reject caller promise.

### 22. Raw relay forwarding preserves From headers that were not authorized

Worker-Kennung: sender-identity.duplicate-from-relay.

**Status:** offen; keine Behauptung einer Behebung im PR.

**Gemeldete Einstufung:**

- **level**: low
- **rationale**: Restricted authenticated relay client and permissive downstream interpretation required; same configured relay authority, envelope sender remains bound. Limited sender-spoofing impact.

**Gemeldete Nachweissicherheit:**

- **level**: high
- **rationale**: Independent static trace through locally installed mailparser 3.9.14, route account matching, raw-header preservation and SMTP write. Actual recipient display/delivery not exercised.

**Beschreibung:**

An authenticated relay client can submit a plain-text message with a forbidden first From and allowed final From. The parser authorizes only the final value, while the raw forwarding path sends both headers. Downstream software accepting the malformed message can use an identity that the relay did not authorize.

**Quellorte des Ausgangsstands:** `packages/server/src/mail-parse.ts:126`, `packages/server/src/mail-parse.ts:162`, `node_modules/mailparser/lib/mail-parser.js:397`, `packages/server/src/relay-submission.ts:278`, `packages/server/src/relay-submission.ts:338`, `packages/server/src/relay-submission.ts:510`, `packages/server/src/relay-submission.ts:725`, `packages/server/src/relay-submission.ts:584`, `packages/server/src/mail-smtp-send.ts:153`, `packages/server/src/mail-smtp-send.ts:397`, `packages/server/src/relay-submission.ts:267`, `packages/server/src/relay-submission.ts:511`, `packages/server/src/mail-smtp-send.ts:403`, `packages/server/src/mail-smtp-send.ts:160`, `packages/server/src/relay-submission.ts:255`, `packages/server/src/relay-submission.ts:483`, `node_modules/mailparser/lib/mail-parser.js:400`, `packages/server/src/relay-submission.ts:571`

**Gemeldete Ursache:**

The credential sender check uses mailparser's collapsed final From value. Plain-text/untracked forwarding retains original From headers. Duplicate diagnostics do not reject the message, leaving two representations of the authorized identity.

Assigned dedup-0010 synthesis: Incoming specifies mailparser 3.9.14 last-value behavior despite a first-value comment. Untracked includes plain text or tracking not actually applied/policy-disabled. Preserve folded/mixed-case duplicate handling, non-UTF8 body bytes, authorized envelope and downstream-acceptance prerequisites. Tracked display-name reconstruction remains separate.

Assigned dedup-0014 synthesis: Same normalized-last-From authorization versus raw duplicate-header pass-through. Canonical single authorized sender or duplicate rejection covers it. Explicit tracking-off/nonmatching rules strengthen reachability without assuming plain text always disables tracking. Downstream acceptance conditional; tracked display-name reconstruction remains separate.

Assigned dedup-0017 synthesis: Same final parsed From authorization versus retained duplicate raw From on pass-through. Reject duplicates before normalization or canonically rebuild every affected path. Optional authenticated relay and downstream ambiguity preserved; tracked display-name reserialization separate.

**Prüfmethode laut Worker:**

Independent offline source/dependency review

**Validierungszusammenfassung laut Worker:**

Confirmed multiple header values are collected, From takes the final value, parsed address count is one, and account/envelope equality checks see that value. A plain-text message disables tracked reconstruction. stripSimplecrmHeaders removes only proprietary/Bcc headers, and smtpSend writes the bytes despite duplicate_From diagnostics. Strongest counterevidence: required authenticated TLS relay, bound envelope identity, tracked reconstruction, and possible downstream rejection.

Assigned dedup-0010 source 8, source-reported static validation: Verified installed mailparser3.9.14 mail-parser.js:408-432 uses value[value.length-1] for From (despite a misleading first-value comment). relay-submission.ts:510-520 forwards raw bytes through stripSimplecrmHeaders :725-743, which keeps both From fields. SMTP mail-smtp-send.ts:503-511 only dot-stuffs data. Tracked reconstruction eliminates this raw-duplicate variant and is reported separately because its defect/fix differ.

**Grenzen laut Worker:**

- No live relay or recipient behavior tested.
- Recipient-side identity interpretation is an explicit prerequisite.
- SMTP relay must be enabled and attacker must hold its credential.
- Downstream MTA may reject multiple/ambiguous From; no universal spoof delivery or envelope takeover claimed.
- Incoming specifies mailparser 3.9.14 last-value behavior despite a first-value comment. Untracked includes plain text or tracking not actually applied/policy-disabled. Preserve folded/mixed-case duplicate handling, non-UTF8 body bytes, authorized envelope and downstream-acceptance prerequisites. Tracked display-name reconstruction remains separate.

**Vorgeschlagene Korrektur, nicht als umgesetzt bestätigt:**

Reject duplicate top-level From/Sender headers before identity authorization and forwarding, or rebuild a single canonical authorized sender header on every raw path. Preserve account-bound envelope checks.

**Vorgeschlagene Regressionstests, nicht als ausgeführt bestätigt:**

- Both duplicate From orders fail before SMTP submission for plain-text, untracked and tracking-enabled inputs.
- A single authorized From still forwards; forbidden single From remains rejected.
- Untracked message with unauthorized first From and allowed final From must be rejected.
- Folded and mixed-case duplicate From fields must also be rejected; preserve non-UTF8 body bytes.
- Duplicate From rejected before parsing in tracked and untracked paths.
- Single authorized From retained; unauthorized envelope and multiple mailbox values remain denied.

### 23. Desktop integrations buffer endpoint responses without a byte limit

Worker-Kennung: uncontrolled-resource-consumption.desktop-response-bodies.

**Status:** offen; keine Behauptung einer Behebung im PR.

**Gemeldete Einstufung:**

- **level**: low
- **rationale**: High local availability impact but low likelihood: trusted configuration must select a malicious or compromised integration endpoint. No ordinary external sender control or shared-server impact established.

**Gemeldete Nachweissicherheit:**

- **level**: high
- **rationale**: All reported sibling sinks independently traced to full text/json body consumption in desktop main. No byte ceiling or bounded stream before parse; exact crash threshold not tested.

**Beschreibung:**

Desktop workflow HTTP, AI chat/embedding and optional Rspamd clients consume full response bodies before slicing outputs or selecting JSON fields. A compromised configured endpoint can send a very large response and exhaust Electron main-process memory within the existing timeout.

**Quellorte des Ausgangsstands:** `electron/workflow/nodes/integration-nodes.ts:85`, `electron/email/email-openai.ts:20`, `electron/email/rspamd-client.ts:22`, `electron/email/mail-security-pipeline.ts:49`, `electron/ipc/email.ts:1931`, `electron/workflow/nodes/integration-nodes.ts:88`

**Gemeldete Ursache:**

The clients use res.text()/res.json() directly. Workflow 8000-character and error 200-character caps, embedding selection and Rspamd 12-symbol cap occur after full allocation; elapsed deadlines do not bound bytes or synchronous JSON processing.

Assigned dedup-0017 synthesis: Exact desktop workflow res.text-before-slice instance already retained. Bounded streaming before allocation subsumes source. Other retained AI/Rspamd instances must still be fixed independently.

**Prüfmethode laut Worker:**

Independent offline source trace and sibling review

**Validierungszusammenfassung laut Worker:**

Confirmed workflow registration/execution, translation/chat IPC, embedding storage/query callers, and enabled Rspamd pipeline call. Includes workflow success/error, AI chat success/error, successful embedding, Rspamd success/error; excluded /stat connection test because it does not consume response body. Timeouts and catches do not prevent prior memory allocation. Local AI/Rspamd configuration is intentional and not an SSRF finding.

**Grenzen laut Worker:**

- No oversized response or memory benchmark executed.
- Attacker must control configured endpoint response; an email sender alone does not control Rspamd HTTP response size.
- Only Electron process affected by these particular sinks.

**Vorgeschlagene Korrektur, nicht als umgesetzt bestätigt:**

Use a shared streaming response reader with a strict decompressed-byte ceiling for success and error responses, abort/cancel at the limit before text/JSON allocation, and bound embedding dimensions and parsed result collections.

**Vorgeschlagene Regressionstests, nicht als ausgeführt bestätigt:**

- Oversized fixed-length, chunked and compressed success/error responses abort before exceeding budget at every listed client.
- Embedding dimensions and Rspamd collections are bounded.
- Normal responses and timeouts preserve existing behavior.
- Exercise oversized chunked and misleading Content-Length responses under a small configured cap.

### 24. Testing a compiled desktop workflow performs live mail actions

Worker-Kennung: authorization.compiled-workflow-dry-run.

**Status:** offen; keine Behauptung einer Behebung im PR.

**Gemeldete Einstufung:**

- **level**: medium
- **rationale**: High confidentiality/integrity impact with medium likelihood: authenticated desktop access, an enabled compiled workflow and a matching condition are required.

**Gemeldete Nachweissicherheit:**

- **level**: high
- **rationale**: Independent static source validation of entrypoint, guard, dataflow and sink; no application execution or network reproduction.

**Beschreibung:**

The workflow test channel forces dryRun=true, but compiled dispatch discards it and executes real archive/tag/hold or forward-copy effects. A session-only enabled compiled import with a matching rule can forward a selected message body, including another mailbox's body where the independently missing target-account check permits it; attachments are not forwarded by this helper.

**Quellorte des Ausgangsstands:** `electron/ipc/workflow.ts:51`, `electron/workflow/workflow-executor.ts:86`, `electron/workflow/compiled-fallback.ts:23`, `electron/email/email-workflow-engine.ts:129`, `electron/email/email-forward-copy.ts:68`, `electron/ipc/workflow.ts:52`, `electron/ipc/workflow.ts:135`, `electron/workflow/compiled-fallback.ts:24`, `electron/ipc/ipc-account-scope.ts:99`, `electron/workflow/compiled-fallback.ts:34`, `electron/email/email-workflow-engine.ts:128`, `electron/workflow/workflow-executor.ts:123`, `electron/email/email-workflow-engine.ts:154`, `electron/email/email-workflow-engine.ts:290`, `electron/workflow/compiled-fallback.ts:10`, `electron/email/email-workflow-engine.ts:122`, `electron/email/email-forward-copy.ts:30`

**Gemeldete Ursache:**

The test wrapper correctly forces dry-run. executeWorkflowForTrigger passes the flag into graph mode but omits it from runCompiledWorkflow. That fallback has no dry-run parameter and calls live inbound rule steps, including database mutations and SMTP forwarding.

Assigned dedup-0008 source: An ordinary session can import enabled compiled mode with a non-null {all:[]} predicate and test a target message. Migration preserves compiled mode; dedup permits the first forward (fresh workflow IDs); includeAttachments/runOutboundReview must be omitted or false. Forward-copy exposes the message body, not attachment bytes. Require target-mailbox authorization independently before context loading and enforce privileged import/execution policy; see authorization.desktop-mail-resource-resolution and authorization.desktop-global-workflows. Those complementary boundaries remain separate from preventing test side effects.

Assigned dedup-0009 source: The graph executor propagates dryRun, but compiled dispatch and its input type omit it. The test path reaches the ordinary compiled rules, while the account resolver skips its workflow-prefixed channel. Preserve enabled compiled mode, matching inbound predicate, default graph mode, selected target message and forwarding without attachments. Correct dry-run alone is not authority to read private message context.

Assigned dedup-0014 synthesis: Same compiled fallback drops hardcoded dryRun and performs mail writes/forwarding. Complete compiled simulation/rejection covers seen/archive/tag/category/link/hold and SMTP. Enabled matching compiled rule, import mode, dedup and false/omitted includeAttachments/runOutboundReview remain. Target-message authorization is separate.

**Prüfmethode laut Worker:**

Source-reported static validation preserved; dedup-0009 performed supplied-artifact semantic comparison only

**Validierungszusammenfassung laut Worker:**

Parent traced forced true through executeWorkflowNow to the compiled branch and live step switch. Import preserves compiled mode. Forwarding checks recipient format, dedup, account existence and unsupported optional features, but does not check dry-run or caller role. An explicit matching condition is needed; graph execution and compiled code nodes are not the demonstrated sinks.

Assigned source a72abecd-f31f-4abc-bacb-afd48bf1085c:1: Validated enabled-state enforcement, graph migration, predicate evaluation and forwarding helper. None blocks the path: import can enable a workflow, migration preserves compiled mode, a non-null all:[] predicate matches, and first forwarding is allowed by dedup. Attachment/review flags must be omitted or false because desktop forward-copy rejects those optional features.

Assigned source 705c5481-2d05-4afc-bc67-518d631d7500:4: Parent traced testWorkflowOnMessage -> executeWorkflowNow message load -> compiled branch -> runCompiledInboundRules -> direct actions, including forward_copy at email-workflow-engine.ts154-178. The workflow must be enabled and compiled, and inbound actions require a matching condition. Graph dry-run protections and manual IPC role checks do not cover this separate path.

**Grenzen laut Worker:**

- Static validation only; no runtime reproduction.
- No app or SMTP execution; no claim about actual deployed users.
- Requires a real desktop session, target message and a sending-capable target account; attachments are not exfiltrated by this helper.
- No application execution, live requests or deployed configuration inspection.
- Preserve enabled compiled mode, matching inbound predicate, default graph mode, selected target message and forwarding without attachments. Correct dry-run alone is not authority to read private message context.

**Gegenbelege laut Worker:**

- Manual execution requires owner/admin.
- Graph code nodes respect dryRun.
- Unconditional inbound rules skipped; explicit match required.
- Forward copy rejects includeAttachments/runOutboundReview=true; use ordinary supported forward without these options.
- Separate message account-authorization failure also exists, but loss of dry-run is independently harmful on an otherwise accessible mailbox.
- Real session required
- Graph branch correctly propagates dryRun
- Disabled workflows refused, import supports enabled=true
- Null unconditional predicates skipped, but {all:[]} matches
- Graph migration keeps execution_mode compiled
- Deduplication does not prevent first unauthorized forward; fresh workflow IDs

**Vorgeschlagene Korrektur, nicht als umgesetzt bestätigt:**

Propagate and enforce dry-run throughout compiled execution, preventing every database/network side effect; reject compiled preview until simulation is implemented. Independently authorize the actual target mailbox before loading test context and enforce privileged workflow import/execution policy. The mailbox-authorization finding remains separately tracked; dry-run alone must not be treated as permission to inspect another mailbox.

**Vorgeschlagene Regressionstests, nicht als ausgeführt bestätigt:**

- Compiled test returns simulated logs without changing any message state.
- Compiled forward-copy test never invokes SMTP.
- Graph and compiled preview honor the same nonmutating contract.
- Compiled workflow tests perform no SMTP send, tagging, archive or hold changes.
- A viewer without mailbox rights cannot test against that mailbox's message.
- Verify enabled compiled imports cannot evade owner/admin execution policy.
- Compiled tests must not mutate messages, send SMTP or enqueue live actions.
- A test against a message in an inaccessible account must be denied.
- Compiled test leaves database/mailbox and SMTP unchanged for each action type.
- Real compiled execution still requires the proper role and mailbox write/send capabilities.

### 25. Unresolved desktop resource IDs bypass mailbox permissions

Worker-Kennung: authorization.desktop-mail-resource-resolution.

**Status:** offen; keine Behauptung einer Behebung im PR.

**Gemeldete Einstufung:**

- **level**: medium
- **rationale**: High impact to mail confidentiality/integrity with medium likelihood: restricted authenticated desktop IPC access and target identifiers are required. Cross-account within one desktop installation, not remote unauthenticated access. dedup-0016 rates its narrower attachment/approval subset low with medium impact; this does not replace the broader established assessment.

**Gemeldete Nachweissicherheit:**

- **level**: high
- **rationale**: Independent static source validation of entrypoint, guard, dataflow and sink; no application execution or network reproduction.

**Beschreibung:**

Authenticated desktop users can bypass mailbox ACLs through unresolved attachment, account, draft, note and thread IDs, bulk message arrays and workflow-prefixed test/approval calls. Consequences include attachment and thread-body disclosure, private-message condition oracles, account/credential deletion, message/note/draft mutations and release of another mailbox's existing pending draft for scheduled sending. Explicit per-resource resolution and operation-specific permissions are both required; default ro is insufficient for mutations. Graph dry-run logs also expose body text through logic.loop despite ordinary side-effect simulation. The assigned source explicitly includes pending draft approval/dismissal: approval stamps the outbound-review bypass marker and schedules delivery, while pending-state and active-claim guards do not establish caller authority.

**Quellorte des Ausgangsstands:** `electron/ipc/ipc-account-scope.ts:81`, `electron/ipc/register.ts:78`, `electron/ipc/email.ts:2809`, `electron/email/email-message-attachments-store.ts:40`, `electron/ipc/email.ts:408`, `shared/ipc/email-schemas.ts:199`, `electron/email/email-store.ts:523`, `shared/ipc/email-schemas.ts:1138`, `electron/ipc/email.ts:2100`, `electron/email/email-store.ts:1567`, `electron/email/email-store.ts:1613`, `electron/email/email-store.ts:1681`, `electron/ipc/email.ts:1606`, `electron/email/email-crm-store.ts:285`, `electron/ipc/email.ts:2240`, `electron/email/email-store.ts:1940`, `electron/ipc/workflow.ts:51`, `electron/ipc/ipc-account-scope.ts:99`, `electron/workflow/workflow-executor.ts:131`, `electron/workflow/runtime.ts:136`, `electron/ipc/email.ts:2122`, `electron/email/email-store.ts:1580`, `electron/ipc/workflow.ts:286`, `electron/workflow/draft-approval-actions.ts:28`, `electron/workflow/draft-send-prep.ts:61`, `electron/workflow/draft-approval-actions.ts:69`, `shared/ipc/channels.ts:388`, `electron/ipc/email.ts:3023`, `electron/email/email-thread-aggregate.ts:128`, `electron/ipc/register.ts:80`, `electron/ipc/email.ts:2808`, `electron/ipc/workflow.ts:287`, `electron/workflow/draft-send-prep.ts:68`, `electron/email/email-store.ts:1945`, `electron/auth/account-access.ts:20`, `electron/ipc/email.ts:2830`, `electron/ipc/workflow.ts:302`, `electron/workflow/draft-approval-actions.ts:23`, `electron/email/email-scheduled-send.ts:75`, `electron/email/email-store.ts:1677`, `electron/email/email-message-attachments-store.ts:38`, `electron/ipc/email.ts:2101`, `electron/ipc/email.ts:2810`, `electron/ipc/email.ts:2841`, `electron/ipc/email.ts:3024`, `electron/ipc/email.ts:409`, `electron/ipc/register.ts:49`, `electron/ipc/ipc-account-scope.ts:91`, `electron/ipc/email.ts:2093`, `electron/email/email-message-attachments-store.ts:32`, `electron/email/email-scheduled-send.ts:50`, `electron/ipc/workflow.ts:288`, `electron/ipc/register.ts:82`, `electron/ipc/email.ts:1608`, `electron/ipc/email.ts:2099`, `electron/email/email-message-attachments-store.ts:39`, `electron/ipc/email.ts:2120`, `electron/email/email-store.ts:1585`, `electron/email/email-store.ts:1620`, `electron/email/email-store.ts:1662`, `electron/ipc/email.ts:2242`, `electron/ipc/ipc-account-scope.ts:53`, `electron/ipc/email.ts:2147`, `electron/ipc/email.ts:2173`, `electron/ipc/email.ts:2199`, `electron/ipc/email.ts:2217`, `electron/ipc/register.ts:83`, `electron/ipc/workflow.ts:52`, `electron/workflow/context.ts:33`, `electron/workflow/runtime.ts:232`, `electron/workflow/draft-approval-actions.ts:27`, `electron/workflow/draft-approval-actions.ts:57`, `electron/ipc/ipc-account-scope.ts:98`, `electron/ipc/email.ts:2831`, `electron/email/email-scheduled-send.ts:66`, `shared/ipc/email-schemas.ts:195`, `electron/ipc/email.ts:2132`, `electron/email/email-store.ts:1547`, `electron/ipc/workflow.ts:289`, `electron/workflow/draft-approval-actions.ts:1`, `electron/workflow/draft-send-prep.ts:31`

**Gemeldete Ursache:**

registerIpcHandler applies mailbox ACL only if resolveEmailChannelAccountId returns an account. That resolver understands a limited set of scalar/object forms, ignores arrays and attachment/note IDs, mismatches DeleteAccount's actual scalar schema, and ignores workflow-prefixed channels. The handlers then load or mutate global IDs without an independent ownership check.

Additional source: The registrar treats unresolved account scope as permission to proceed. Its heuristic recognizes only selected bare IDs and a few object fields. Attachment IDs, batch message IDs, numeric delete-account/delete-draft and workflow-prefixed approval IDs do not resolve, while the handlers omit explicit resource authorization. The stores and send preparation trust those IDs. Even when account scope resolves, the wrapper defaults to ro unless the mutation declares a stronger level.

Assigned dedup-0005 source: The narrower approval proof requires a known existing pending local draft and no active send claim. Approval clears the hold, arms immediate scheduled delivery and stamps the outbound-review bypass for that same stored content/recipients/attachments; dismissal independently mutates approval state. Read-only mailbox viewing can provide the draft ID, whereas an ungranted caller still needs a known eligible ID. SMTP/background prerequisites apply to actual transmission.

Assigned dedup-0007 source: The assigned account-delete proof specifically shows tests/mail/ipc-account-scope.test.ts:49-52 testing object.id although the production schema uses a bare positive integer; the early numeric resolver return prevents the later object.id branch. Thread IDs have random96-bit entropy, so this thread disclosure requires prior knowledge and does not establish guessing/enumeration. Bulk arrays are capped at 500 and optional accountId constrains SQL when supplied. Account deletion affects local files/configuration/credentials, with no claim of deleting remote-provider mail. Pending/claimed/hold/content safeguards remain independent of actor authorization.

Assigned dedup-0008 source: Approval's content-bound marker and immediate due time release only an existing eligible pending draft; runOutboundReview:false bypasses review for those existing fields. Dismissal is independently a metadata mutation. Preserve real-session, pending/local-draft, no-active-send-claim and SMTP/background prerequisites. Propagate the actual actor to the approval action; resolution alone with default ro remains insufficient.

Assigned dedup-0011 synthesis: Fully covered by this established broad finding's numeric account-delete, bulk-message, note-ID and attachment-ID instances. Resolve every authoritative parent and batch member before read/write/management checks. Regular single-message/unified-list controls and the user's attachment dialog do not protect these calls. Narrower established attachment/deletion/bulk identities are preserved; this source ref belongs here only.

Assigned dedup-0013 synthesis: All incoming attachment read, numeric account/single-draft deletion and six bulk mutation instances already fall within this established full resource-resolution finding. Explicit authoritative parent/batch resolution and operation-specific read/write/management controls subsume every incoming instance. Retain previous note/thread/test/approval/dismissal paths and narrower established identities. Assign the host ref here only; preserve received-POP3 negative-UID counterevidence beside incoming draft-only wording.

Assigned dedup-0014 synthesis: Same unresolved desktop resource mappings: account/draft numeric IDs, attachment/note/thread IDs, bulk arrays and workflow test context. Existing authoritative parent/batch resolution and read/write/management enforcement covers all. New concrete test read: logic.loop(sourceVariable=body_text) returns private message items in dry-run logs even with write/network suppression. Authorize before loading/evaluation/logging. Known random thread IDs, POP3 negative UID, approval/dismissal subcases retained.

Assigned dedup-0015 synthesis: Same workflow-prefixed draft approval/dismissal ignores caller and schedules existing pending draft with approval marker or clears state. Existing complete resource policy explicitly resolves draft owner, requires send/approval versus dismissal write authority and carries actor. Pending/local/unclaimed state and SMTP remain prerequisites; arbitrary new content/recipients not supplied by this route.

Assigned dedup-0016 synthesis: Both attachment-ID copy/open and workflow-prefixed draft approval/dismissal are explicit instances of this established complete resource-resolution finding. Its remediation requires authoritative parent resolution plus read, send/approval and dismissal-write permissions. The attachment-only identity is preserved separately; this combined source ref is assigned here once.

**Prüfmethode laut Worker:**

Source-reported validation preserved; dedup-0013 performs supplied-artifact semantic reduction only

**Validierungszusammenfassung laut Worker:**

Parent traced real schemas and common guard to attachment file copy/open, account credential/file deletion, six bulk mutation variants, note mutation, single-draft deletion and workflow message loading. Bulk SQL correctly constrains an explicitly supplied accountId, but omission is allowed and removes both checks. Workflow condition evaluation returns yes/no on private subject/body, independently of live side effects. Parent independently validated workflow-prefixed approval/dismissal, pending-state-only checks, review bypass stamping and scheduler arming. Direct thread lookup has no session/account predicate or body redaction; the generic resolver recognizes neither thread IDs nor workflow-prefixed approval channels.

Assigned source 40e94555-7994-4e03-8422-151a4cc8752f:4: Verified exposed channels accept each problematic payload shape and bypass account resolution. Attachment lookup copies/opens by ID, account deletion removes credentials and rows, optional account-less batch updates use global message IDs, and pending draft approval clears hold and queues sending through the draft's actual account.

Assigned source 61ab0f3d-38ae-4587-a421-de63347b1639:2: Confirmed real session is required but no target mailbox/send permission is checked. Pending/claim and local-draft checks constrain state, not user rights. The sender's account match is satisfied by its own stored account_id; the approval marker bypasses outbound review for the same draft content.

Assigned source adae8751-0a17-49fc-a285-f8a4574c7953:7: Independently verified actual numeric DeleteAccount schema versus object-only resolver branch; bulk message deletion without optional accountId; attachment save/open by attachmentId; thread reads returning m.* by known thread ID. The recognized single-message paths enforce scope, but unknown shapes fail open. Resource-type-specific authorization is the shared fix.

Assigned source 1134688b-c6f4-4ad3-aedd-9b4e4922ecc7:2: Confirmed registered numeric delete handler, positiveInt schema, early numeric return and lack of a role requirement. deleteEmailAccountRecord purges local attachment files, deletes stored credentials and removes the mailbox row. Existing test at tests/mail/ipc-account-scope.test.ts:49-52 supplies object.id rather than production numeric payload. Parent independently confirmed baseline full-file review of bulk, note, attachment and thread paths, and traced draft approval through prepareDraftForWorkflowSend into the scheduled SMTP sender. Original account deletion evidence is retained.

Assigned source a72abecd-f31f-4abc-bacb-afd48bf1085c:0: Confirmed both channels are allowed through the preload bridge and registered in the normal desktop IPC router. Neither registration supplies an accountScope or role. Pending-state, claimed-send and actual-draft checks constrain approval state but do not enforce access; owner/admin bypass in the normal account ACL demonstrates a distinct lower-privilege boundary.

Assigned dedup-0011 source-reported offline static validation: Verified positive-integer delete schema versus resolver branches, direct deletion including credentials, bulk SQL without account predicate when accountId omitted, global attachment lookup/copy/open, and note update/delete by ID. Regular single-message reads and unified lists do apply ownership controls; they do not protect these operations. Export dialog is confirmed by the initiating user, not an administrator.

Assigned dedup-0013 source-reported static validation: Confirmed schemas permit numeric delete-account/delete-compose-draft ids, attachmentId and bulk arrays with omitted accountId. The numeric branch returns undefined before the later delete-account object case, and attachment/array fields never resolve. Handlers are logger-only. Storage mutates by global ids; account deletion also removes Keytar secrets. Attachment listing is protected but direct save/open bypasses it. Native save-dialog interaction does not prevent a malicious signed-in user choosing a destination.

**Grenzen laut Worker:**

- Static validation only; no runtime reproduction.
- Conditional on local roles/account ACLs being relied upon. Runtime test not performed.
- The additional source emphasizes restricted local-role deployment as an unconfirmed prerequisite, native attachment-dialog interaction, and the existing pending-local-draft/no-active-send-claim prerequisites. Approval alone cannot choose arbitrary body or recipients; it releases existing pending content. Default ro remains insufficient for these mutations even after IDs resolve.
- Requires known pending draft ID; a read-only mailbox user can obtain it through ordinary viewing.
- Actual send requires configured SMTP and background processing; no mail sent.
- dedup-0005 preserves the incoming approval-only low severity/medium impact alongside the retained broader medium severity/high impact. Approval cannot choose arbitrary new content or recipients; dismissal remains an independently reachable mutation requiring write authority.
- No runtime reproduction; local OS account compromise is outside the claimed attacker model.
- Static analysis only; no destructive invocation performed.
- No application, SMTP service or production deployment executed.
- Requires shared desktop users with differing mailbox grants and, for sending, an existing pending draft plus configured sending account.
- No application code or exploit executed.
- Production deployment and local role use remain unspecified.
- Fully covered by this established broad finding's numeric account-delete, bulk-message, note-ID and attachment-ID instances. Resolve every authoritative parent and batch member before read/write/management checks. Regular single-message/unified-list controls and the user's attachment dialog do not protect these calls. Narrower established attachment/deletion/bulk identities are preserved; this source ref belongs here only.
- No live IPC, file copies, deletion or application execution performed.
- This is local mailbox separation, not server cross-workspace access.
- Attachment read is limited to stored attachment rows, not arbitrary filesystem paths.
- No application execution or production testing.
- Requires a real authenticated desktop session and direct IPC access.

**Gegenbelege laut Worker:**

- Real sessions required.
- GetMessage and ListMessageAttachments normally resolve actual mailbox and deny missing grants.
- Bulk arrays limited to 500 IDs and syncable/draft predicates; those are not ownership.
- Supplying another account on bulk operations does not bypass SQL; omit optional account instead.
- Attachment risk/save dialogs do not authorize mailbox access.
- Workflow dry-run reduces effects but still reads message and returns condition logs.
- Arbitrary target thread enumeration is not established. Draft approval requires pending/local state and no active send claim; these state guards do not check the actor's mailbox permission.
- Actual authenticated local session required; not a remote unauthenticated interface.
- Standard GetMessage/ListMessageAttachments/EML/raw-header and all-account list/search queries enforce scope.
- SQL is parameterized; stored attachment paths are used, not attacker path traversal.
- Attachment save uses native dialog and open warns on risky file extensions.
- Draft approval requires existing pending local draft and no active send claim; no arbitrary body/recipient selection through approval alone.
- Batch accountId, when provided, restricts relevant SQL; omission is allowed.
- Single-owner OS-equivalent use has no distinct mailbox attacker boundary.
- A real application login is required.
- No separate caller authorization exists in the store.
- Direct OS/disk access is not assumed; documented profile separation applies.
- Correcting numeric scope alone still leaves default ro insufficient for destructive action.
- Bulk schemas cap arrays at 500 and allow optional accountId; supplying it scopes operations, omitting it does not.
- Thread IDs use random96 bits: a known ID is required; guessing random IDs is not asserted.
- Most ordinary all-account list handlers pass actor scope; thread merge/split enforce roles.
- Attachment save/open needs native interaction; dangerous-extension confirmation is not account permission.
- Draft pending/claim/hold/content checks remain; none authorize the approving actor.
- Assigned source reports random96-bit thread IDs: a known thread identifier is required; enumeration or guessing is not established.
- Not unauthenticated: a real app session is required.
- Attachment save uses a local dialogue; opening risky file types requires explicit flag.
- Approve requires a pending local draft not already sending; recipient/content remain those of the stored draft.
- No claim that an attacker with equivalent OS access gains additional OS authority.

**Vorgeschlagene Korrektur, nicht als umgesetzt bestätigt:**

Use explicit per-channel resource policies that resolve every target's actual mailbox, including arrays and indirect IDs; deny unresolved resource-bearing calls. Enforce read for exposure, write/account-management for mutations, and authorize before loading workflow context or deleting anything. Resolve draft account and require approval/send authority for workflow approval and appropriate write authority for dismissal. For approval, require the appropriate send/approval grant even after mailbox resolution; preserve pending/local-draft and active-send-claim checks. Approval does not independently authorize arbitrary new recipients or message content. Carry the actual caller into approval/dismissal actions and reject absent draft/account links before mutation. Authorize the selected test message before loading body variables or evaluating/returning diagnostic logs, including logic.loop.

**Vorgeschlagene Regressionstests, nicht als ausgeführt bestätigt:**

- Run each affected handler through its real payload schema as a user without target grants; all must deny before storage/file/network access.
- Bulk mixed-account IDs cannot partially mutate unauthorized targets.
- Workflow tests cannot evaluate a hidden message.
- Keep valid scalar message read/list behavior working.
- Invoke every listed channel from a session denied the target mailbox and assert no file/SQL/send side effect.
- Test mixed-account arrays and omitted/falsely supplied accountId.
- Verify read-only mailbox users cannot mutate or approve sending, and legitimate send delegates can approve their own pending drafts.
- Deny approval/dismissal for absent and read-only mailbox grants.
- Allow appropriately authorized draft approval while retaining pending/claim and SMTP safeguards.
- Exercise real IPC payload shapes with an authenticated no-access or read-only user and assert no sensitive service call/data mutation occurs.
- Verify each bulk member is authorized, including mixed-mailbox selections.
- Invoke the actual wrapped numeric delete channel as an ungranted profile and assert no filesystem, Keytar or database mutation.
- Reject read-only delegates and permit only authorized deletion roles.
- Exercise real messageIds payloads without accountId, mixed-account arrays, numeric draft/note IDs, attachmentId and known victim threadId as an ungranted user; deny without mutations or content.
- Assert another account's pending draft cannot be approved/dismissed or scheduled by an ungranted/read-only profile, while authorized senders still work.
- An authenticated viewer without target-account access cannot approve or dismiss its draft; markers and scheduled_send_at remain unchanged.
- Read-only account access cannot approve transmission; an authorized sender can approve an actual pending draft.
- Verify the described operation is denied to an authenticated user without the required role/mailbox grant.
- Verify explicitly authorized operations continue to work.
- A user with no victim-mailbox grant cannot save/open its attachments, delete its account/draft, or perform any bulk mutation with omitted accountId.
- Mixed authorized/unauthorized messageIds must not mutate forbidden rows even when an authorized accountId is supplied.
- Every protected channel must fail closed when its resource mapping is absent; test both numeric and object payloads.
- For each bulk operation, assert a mixed permitted/denied batch is rejected atomically even without accountId and read-only grants cannot mutate records.
- Denied thread IDs return no message bodies; cross-account canonical/alias threads are filtered per message.
- Numeric account deletion rejects callers without the required account administration permission.
- Denied attachment IDs cannot be saved/opened, and denied note/draft IDs cannot be changed or deleted.
- An ungranted user cannot delete an account, bulk mutate its messages or save/open its attachments.
- A workflow dry-run cannot read/log an ungranted message.
- Mixed-account bulk IDs are each authorized; omission of accountId never disables authorization.
- Unassigned and read-only users cannot approve or dismiss target drafts.
- Authorized approvers can act on pending unclaimed drafts.
- Approval preserves outbound-state protections and records actor.
- A user with no grant to an attachment's account cannot save or open it.
- A user without the draft account's edit/send grant cannot approve or dismiss its draft, and no scheduled-send timestamp changes.
- Authorized resource access remains functional.
- A user without mailbox access cannot invoke any listed operation on its resources.
- Mixed permitted/forbidden ID lists fail atomically; omitted and spoofed accountId cannot bypass checks.
- Authorized attachment reads and authorized write operations continue to work.

### 26. Restricted desktop users can export all data and replace the application database

Worker-Kennung: authorization.desktop-global-export-restore.

**Status:** offen; keine Behauptung einer Behebung im PR.

**Gemeldete Einstufung:**

- **level**: medium
- **rationale**: High confidentiality/integrity impact with medium likelihood: authenticated desktop IPC and, for restore, a compatible local backup are required.

**Gemeldete Nachweissicherheit:**

- **level**: high
- **rationale**: Independent static source validation of entrypoint, guard, dataflow and sink; no application execution or network reproduction.

**Beschreibung:**

The full backup, GDPR export, preview and restore handlers require a session but no administrative role. A restricted user can export other mailboxes or restore a supplied SQLite database containing attacker-chosen users, roles and permissions.

**Quellorte des Ausgangsstands:** `electron/ipc/email.ts:1132`, `electron/email/email-local-backup-export.ts:99`, `electron/email/email-local-restore.ts:198`, `electron/email/email-local-restore.ts:226`, `electron/email/email-local-restore.ts:308`, `electron/email/email-local-restore.ts:373`, `electron/auth/auth-store.ts:92`, `electron/ipc/email.ts:2870`, `electron/email/email-gdpr-export.ts:89`, `electron/email/email-gdpr-export.ts:151`, `electron/ipc/register.ts:78`, `electron/ipc/register.ts:72`, `electron/email/email-local-backup-export.ts:101`, `electron/email/email-gdpr-export.ts:90`, `electron/email/email-local-restore.ts:366`, `electron/ipc/ipc-account-scope.ts:16`, `electron/email/email-gdpr-export.ts:153`, `electron/email/email-local-restore.ts:367`, `electron/ipc/email.ts:1164`, `electron/email/email-local-backup-export.ts:100`, `electron/email/email-local-restore.ts:376`, `electron/ipc/email.ts:2872`, `electron/email/email-gdpr-export.ts:121`, `electron/ipc/ipc-account-scope.ts:37`, `electron/email/email-gdpr-export.ts:103`, `electron/email/email-local-restore.ts:307`, `electron/email/email-local-restore.ts:368`, `electron/ipc/register.ts:51`, `electron/ipc/ipc-account-scope.ts:1`, `electron/ipc/email.ts:1131`, `electron/email/email-local-backup-export.ts:40`, `electron/email/email-local-backup.ts:117`, `electron/email/email-gdpr-export.ts:75`, `electron/email/email-local-restore.ts:184`

**Gemeldete Ursache:**

Global data operations register only the default session check and pass no actor/account restrictions to their consumers. Full backup copies the entire SQLite database and attachment root; GDPR export similarly selects all mailbox records. Restore accepts a caller-obtainable preview token and public phrase, replaces the same database used for local authentication, and relaunches.

Additional source: Global administrative operations use the optional-role IPC wrapper without requireRole and delegate to implementations with no actor/account scope. Existing preview/ZIP checks validate archive integrity rather than caller authority.

Assigned dedup-0008 source: Retain the source's owner/admin recommendation alongside the earlier owner-only restore recommendation without deciding product policy. Native output selection, caller-obtainable preview freshness/token and phrase, busy-sync guards, archive validation and rollback prove intent/integrity, not privileged authority. Keytar is excluded and setup token redacted; global database/attachment and auth-record scope remains.

Assigned dedup-0009 source: Global backup operations reuse the session-only IPC default despite bypassing all per-account storage controls. Format, freshness and confirmation checks protect user intent and data shape, but do not establish privileged authority. GDPR exports metadata/snippets/notes and optional attachments, not full bodies/keytar; full SQLite backup includes authentication state. Keytar exclusion, setup-token redaction, native dialogs, archive/preview/phrase/idle-sync/rollback controls remain. Owner-only versus owner/admin restore recommendations remain unresolved.

Assigned dedup-0011 synthesis: Same GDPR/full-backup exports and preview/apply restore scope. Full backup copies database.sqlite with only setup-token redaction; keytar remains excluded. Caller-owned preview freshness, phrase, bounded extraction and rollback do not authorize database/authentication/workflow replacement. Incoming owner/admin restore recommendation remains alongside prior owner-only recommendation without resolving product policy.

Assigned dedup-0014 synthesis: Same complete global GDPR/full-backup export and preview/apply restore bundle. Its existing complete privileged/scoped-operation remediation subsumes all incoming instances. Narrower established identities remain. Dialog, keytar exclusion, setup redaction, preview/phrase/idle-sync/archive/rollback controls do not authorize; owner-only versus owner/admin unresolved.

Assigned dedup-0017 synthesis: Same full backup/GDPR export/preview/restore paths. Administrative authorization on each and actor-filtered delegated export subsume source. Preserve native dialogs, archive/freshness/phrase/sync/rollback, setup-token redaction, keytar exclusion and database authorization-state replacement.

**Prüfmethode laut Worker:**

Source-reported validation preserved; dedup-0011 performed supplied-artifact semantic reduction only

**Validierungszusammenfassung laut Worker:**

Parent verified all four privileged handler registrations, global SQL/attachment export, raw DB copy, preview token issuance, restore checks and replacement, and login's user/role/password-hash query. Confirmation and file dialogs are user intent controls, not proof that this restricted application user may act on all accounts.

Assigned source 40e94555-7994-4e03-8422-151a4cc8752f:6: Verified export handlers, wrapper, full-database copy, global GDPR queries and restore replacement sink. Preview is exposed to the same authenticated caller. No owner/admin check exists along these paths.

Assigned source a72abecd-f31f-4abc-bacb-afd48bf1085c:4: Confirmed whole-DB backup copy, unfiltered GDPR SQL and archive root, and full restore file replacement. Preview freshness, confirmation phrase, busy-sync guard, redaction of setup token and exclusion of Keytar do not restrict the caller's role. This is an application-role bypass, not an isolation claim against processes already controlling the OS account.

Assigned source 705c5481-2d05-4afc-bc67-518d631d7500:7: Parent inspected export, restore IPC and actual copy/archive sinks. Keytar secrets and setup token are excluded from exports; message content, attachments and database authentication state remain. Restore requires a valid manifest, database, token, phrase and idle sync; the same low-role user can obtain and supply them. No restore was performed.

Assigned dedup-0011 source-reported offline static validation: Verified auth-only handler, explicit scope exemption, unrestricted export queries and complete attachment-root archive. Keytar contents/passwords are omitted, but mailbox content remains sensitive. The save dialog is user interaction rather than administrator authorization. Independently traced full-backup export and restore: their helpers receive no authenticated principal, the token binds a preview to file metadata rather than a privileged actor, and the phrase prevents accidental action rather than authenticating an administrator. Bounded extraction and rollback protect archive handling but do not authorize installation replacement.

**Grenzen laut Worker:**

- Static validation only; no runtime reproduction.
- Deployment/use of restricted desktop roles is unconfirmed.
- Static validation only.
- The additional source limits the boundary to installations relying on restricted desktop sessions. Full backup includes database and attachment state, excluding OS Keytar and redacting only the setup token; GDPR is metadata/internal notes/attachments rather than raw mail bodies. Native dialogs, preview freshness, phrase, sync exclusion, archive validation and rollback do not authorize global access. Prior source recommends owner-only restore; incoming source permits owner/admin. Preserve both without deciding product policy.
- Source role-policy difference preserved: retained source calls for owner-only database restore, whereas the assigned source recommends owner/admin. No deployment/product-policy decision was made by this reducer.
- No runtime reproduction, application execution or production access.
- dedup-0008 recommends owner/admin for restore; prior owner-only restore policy remains retained and unresolved.
- Source only; real deployment not inspected.
- GDPR exports metadata/snippets/notes and optional attachments, not full bodies/keytar; full SQLite backup includes authentication state. Keytar exclusion, setup-token redaction, native dialogs, archive/preview/phrase/idle-sync/rollback controls remain. Owner-only versus owner/admin restore recommendations remain unresolved.
- No application code or exploit executed.
- Production deployment and local role use remain unspecified.
- Same GDPR/full-backup exports and preview/apply restore scope. Full backup copies database.sqlite with only setup-token redaction; keytar remains excluded. Caller-owned preview freshness, phrase, bounded extraction and rollback do not authorize database/authentication/workflow replacement. Incoming owner/admin restore recommendation remains alongside prior owner-only recommendation without resolving product policy.

**Gegenbelege laut Worker:**

- Real session required.
- Restore requires compatible archive and application-readable path; busy sync may temporarily block.
- Keytar values are not directly archived; stored references, auth hashes and global SQLite configuration remain.
- Full export redacts one-time setup token, GDPR omits passwords; neither restricts mailbox scope.
- Native save dialog can be accepted by the same unauthorized user.
- Desktop maintenance reset separately requires owner.
- Export uses native save dialogs; interactive acceptance is required.
- Backup redacts one-time setup token and does not include OS Keytar credentials.
- GDPR output is metadata, internal notes and attachments; not a claim of raw-message bodies or credential export.
- Restore enforces preview freshness, confirmation phrase, sync exclusion, archive validation and rollback; ZIP traversal is not established.
- Electron trusts native owner code; the finding is limited to application-enforced restricted desktop sessions.
- Anonymous rejected
- Keytar excluded and setup token redacted
- Native dialogs not admin auth
- Preview token/freshness/phrase not role authorization
- Desktop only

**Vorgeschlagene Korrektur, nicht als umgesetzt bestätigt:**

Require owner/admin for whole-installation export and preview, and owner authority for database restore before reading or replacing data. If ordinary-user GDPR export is needed, filter every query and attachment to the authenticated actor's authorized accounts.

**Vorgeschlagene Regressionstests, nicht als ausgeführt bestätigt:**

- Agent/viewer cannot export another account through either exporter.
- Unauthorized backup preview/restore is rejected before archive reads or DB shutdown.
- Owner restore retains containment, staleness and recovery checks.
- Scoped GDPR export includes only authorized records and files.
- With a restricted local user denied mailbox B, verify backup/restore fail before filesystem operations and GDPR excludes B or fails.
- Verify owner/admin workflows retain preview/confirmation/ZIP safety protections.
- A viewer without mailbox grants cannot invoke full backup, preview/full restore, or unfiltered GDPR export.
- Denied operations do not open dialogs, write archives or mutate the database.
- Exercise authorization.desktop-global-backup with an unauthorized actor or bounded-input regression and assert no protected sink executes.
- Verify the described operation is denied to an authenticated user without the required role/mailbox grant.
- Verify explicitly authorized operations continue to work.
- Non-admin cannot invoke global GDPR/whole-database exports or restore even when directly calling IPC.
- Allowed exports contain only authorized data when not a global operator operation.
- Restore preview token/confirmation never substitutes for privilege checking.

### 27. Read-only mailbox users can edit credentials and send scheduled drafts

Worker-Kennung: authorization.desktop-read-only-mutations.

**Status:** offen; keine Behauptung einer Behebung im PR.

**Gemeldete Einstufung:**

- **level**: medium
- **rationale**: High integrity/confidentiality impact with medium likelihood: requires a real read-only mailbox grant; sending additionally requires working SMTP and allowed outbound content.

**Gemeldete Nachweissicherheit:**

- **level**: high
- **rationale**: Independent static source validation of entrypoint, guard, dataflow and sink; no application execution or network reproduction.

**Beschreibung:**

Several desktop mailbox mutation handlers use the default ro permission. A read-only user can alter account configuration/OAuth bindings, create or edit drafts, and schedule delivery despite direct SendCompose requiring rw. The assigned source confirms that broad standalone module capabilities are intentional, while the explicit mailbox ro/rw distinction remains an independently enforced boundary.

**Quellorte des Ausgangsstands:** `electron/ipc/email.ts:359`, `electron/ipc/email.ts:2666`, `electron/ipc/email.ts:3104`, `electron/ipc/email.ts:700`, `electron/ipc/register.ts:49`, `electron/ipc/email.ts:678`, `electron/ipc/email.ts:918`, `electron/email/email-scheduled-send.ts:51`, `electron/ipc/email.ts:1337`, `electron/ipc/email.ts:998`, `electron/auth/account-access.ts:13`, `electron/ipc/email.ts:676`, `electron/ipc/email.ts:950`, `electron/email/email-scheduled-send.ts:68`, `electron/ipc/email.ts:360`, `electron/ipc/email.ts:1346`, `electron/auth/account-access.ts:7`, `electron/ipc/email.ts:1003`, `electron/ipc/email.ts:395`, `electron/email/email-scheduled-send.ts:75`, `electron/ipc/email.ts:325`, `electron/ipc/email.ts:370`, `electron/ipc/email.ts:684`, `electron/email/email-scheduled-send.ts:57`, `electron/ipc/email.ts:1335`

**Gemeldete Ursache:**

The generic wrapper defaults accountAccess to ro, and configuration, draft-edit, OAuth-finish and scheduled-send handlers omit stronger requirements. ScheduleDraftSend also stamps outbound approval; the timer later sends the persisted draft without checking the initiating user's rights. This bypasses the explicit rw gate on direct sending.

Assigned dedup-0012 synthesis: Established combined finding covers UpdateAccount, ScheduleDraftSend and RetryScheduledSendDraft plus draft/OAuth siblings. Explicit per-channel write/send/account-management policy and deferred actor recheck subsume all incoming instances. Incoming low severity retained alongside prior medium; neither only-sending nor only-account-management remediation suffices.

**Prüfmethode laut Worker:**

Source-reported validation preserved; dedup-0012 performs supplied-artifact semantic reduction only

**Validierungszusammenfassung laut Worker:**

Parent traced the default permission/rank check, account mutation and OAuth handlers, draft creation/update, scheduling/approval and actual scheduled send. Target mailbox resolution is present for these paths, but asks only ro. The compose consumer binds draft to account and applies outbound checks; neither supplies the missing write/sending authority.

Assigned source adae8751-0a17-49fc-a285-f8a4574c7953:8: Independently traced create/update draft, ScheduleDraftSend, scheduled sender and account update. Explicit rw controls exist on direct SendCompose and SetAccountMailSettings but are not reused by these mutation paths. Send claims and outbound checks enforce content/concurrency rather than user authority.

Assigned dedup-0012 source-reported static validation: Verified message/account ID resolution and canAccessAccount rank comparison; schedule/retry writes feed the background sender with no actor parameter. UpdateAccount mutates passwords and server configuration with logger-only options.

**Grenzen laut Worker:**

- Static validation only; no runtime reproduction.
- No runtime reproduction; local OS account compromise is outside the claimed attacker model.
- No dynamic execution; actual nonadmin desktop deployments unconfirmed.

**Gegenbelege laut Worker:**

- Real session and target mailbox read grant are required for this family.
- Direct SendCompose correctly asks rw; mismatched draft/account rejected.
- SMTP/outbound approvals can block delivery but are not actor authorization.
- OAuth replacement requires a valid provider authorization code.
- Global credential tests and missing-resource resolution are independent findings.
- A valid app session and read grant are required.
- Outbound workflow/content checks may reject individual drafts, but are not send authorization.
- Direct SendCompose explicitly requires rw; SetAccountMailSettings also uses rw.
- This is separate from handlers that fail to resolve any target account.

**Vorgeschlagene Korrektur, nicht als umgesetzt bestätigt:**

Require explicit write/send or stronger account-management authority for every mutation; persist the authorized scheduling actor and revalidate their rights before delivery. Avoid defaulting mutation channels to read permission. Require an explicit classification for each mutation, including distinct credential/endpoint-management authority; read permission must never be an implicit mutation grant.

**Vorgeschlagene Regressionstests, nicht als ausgeführt bestätigt:**

- ro cannot alter account configuration or OAuth binding.
- ro cannot create/edit/schedule/retry delivery, while allowed readers can still read.
- Revoking sender rights before scheduled execution prevents delivery.
- Authorized sender workflow still succeeds.
- Exercise real IPC payload shapes with an authenticated no-access or read-only user and assert no sensitive service call/data mutation occurs.
- Verify each bulk member is authorized, including mixed-mailbox selections.
- ro users cannot schedule/retry drafts or modify account connection settings.
- send-only and rw grants authorize only intended operations; owner/admin behavior remains.
- A ro-only user cannot reconfigure an account, edit drafts or schedule sending.
- Authorized writers/senders continue to work.
- Revoking send permission before dispatch prevents the pending send.

### 28. Any desktop session can read and replace global OAuth application secrets

Worker-Kennung: authorization.desktop-global-oauth.

**Status:** offen; keine Behauptung einer Behebung im PR.

**Gemeldete Einstufung:**

- **level**: low
- **rationale**: Medium impact and medium likelihood: requires authenticated desktop IPC; client secrets alone do not grant mailbox access, while replacement disrupts provider token refresh.

**Gemeldete Nachweissicherheit:**

- **level**: high
- **rationale**: Independent static source validation of entrypoint, guard, dataflow and sink; no application execution or network reproduction.

**Beschreibung:**

Google and Microsoft OAuth application settings are exposed by authenticated IPC without an administrator check. A restricted desktop session can retrieve the configured client secrets or overwrite settings used by all provider mailboxes. The generic Sync.GetInfo IPC is an alternate unfiltered reader for the same secret-bearing sync_info keys.

**Quellorte des Ausgangsstands:** `electron/ipc/email.ts:2633`, `electron/ipc/email.ts:2880`, `electron/email/email-imap-auth.ts:49`, `electron/email/email-imap-auth.ts:17`, `electron/ipc/register.ts:78`, `electron/ipc/sync.ts:38`, `electron/sync-info-store.ts:1`

**Gemeldete Ursache:**

Global OAuth configuration handlers use only the ordinary session guard and getters serialize the secret.

**Prüfmethode laut Worker:**

static source trace

**Validierungszusammenfassung laut Worker:**

Traced both providers' getters/setters through registerIpcHandler to sync_info storage and token refresh consumers. No role gate or secret redaction occurs. Parent confirmed Sync.GetInfo accepts any nonempty key, has no role gate, and readSyncInfo delegates directly to getSyncInfo; generic SetInfo correctly requires owner/admin.

**Grenzen laut Worker:**

- Static validation only; no runtime reproduction.

**Gegenbelege laut Worker:**

- A real desktop session is required.
- Client IDs are public; the exposure claim concerns client secrets.
- Provider endpoints are fixed and a client secret alone is insufficient to access mailboxes.

**Vorgeschlagene Korrektur, nicht als umgesetzt bestätigt:**

Require explicit global mail-settings administration permission for both providers. Return a secret-present indicator rather than clientSecret, and preserve secrets server-side when settings are edited. Remove secret-bearing keys from generic Sync.GetInfo or apply a strict public-settings allowlist plus independent authorization.

**Vorgeschlagene Regressionstests, nicht als ausgeführt bestätigt:**

- A non-admin session cannot read or modify either provider configuration.
- Authorized reads do not return raw client secrets; authorized updates still permit token refresh.

### 29. Caller-supplied account scope bypasses existing template ownership

Worker-Kennung: authorization.desktop-template-ownership.

**Status:** offen; keine Behauptung einer Behebung im PR.

**Gemeldete Einstufung:**

- **level**: low
- **rationale**: Medium integrity impact with medium likelihood: requires a real desktop session and knowledge of a target record ID. No code execution or provider-secret disclosure is established.

**Gemeldete Nachweissicherheit:**

- **level**: high
- **rationale**: Independent static source validation of entrypoint, guard, dataflow and sink; no application execution or network reproduction.

**Beschreibung:**

SaveCannedResponse and SaveAiPrompt authorize the caller's submitted accountId, then update the separately supplied record ID without checking its current account. A user with access to account A can alter or move account B's template or prompt.

**Quellorte des Ausgangsstands:** `electron/ipc/ipc-account-scope.ts:81`, `electron/ipc/register.ts:78`, `electron/ipc/email.ts:1654`, `electron/ipc/email.ts:1698`, `electron/email/email-crm-store.ts:440`, `electron/email/email-crm-store.ts:533`, `shared/ipc/email-schemas.ts:1315`

**Gemeldete Ursache:**

Authorization trusts the requested destination account instead of resolving the current owner of the record being updated.

**Prüfmethode laut Worker:**

static source trace

**Validierungszusammenfassung laut Worker:**

Both schemas allow id plus optional accountId. The common resolver prioritizes accountId and the database UPDATE predicates only id; both writes can rewrite account_id.

**Grenzen laut Worker:**

- Static validation only; no runtime reproduction.

**Gegenbelege laut Worker:**

- Normal message schemas strip unknown accountId fields, so the bypass is not universal.
- Direct SendCompose checks draft/account consistency.
- No arbitrary execution from AI prompt text is claimed.

**Vorgeschlagene Korrektur, nicht als umgesetzt bestätigt:**

Resolve and authorize the existing record's owner before updates. Independently authorize destination changes and global scope, and constrain the write by verified ownership.

**Vorgeschlagene Regressionstests, nicht als ausgeführt bestätigt:**

- An account-A user cannot update/move a record owned by B by supplying A or omitting scope.
- Authorized updates and explicitly permitted moves succeed.

### 30. Sandboxed renderer can attach host files without a picker grant

Worker-Kennung: confused-deputy.desktop-compose-files.

**Status:** offen; keine Behauptung einer Behebung im PR.

**Gemeldete Einstufung:**

- **level**: low
- **rationale**: High potential confidentiality impact but low likelihood: requires a compromised authenticated send-capable renderer, a known readable file path, configured SMTP and permitted outbound send. No renderer compromise was established.

**Gemeldete Nachweissicherheit:**

- **level**: medium
- **rationale**: The IPC-to-file dataflow and sandbox boundary are explicit, but exploitation requires a separate renderer foothold not established in this scan.

**Beschreibung:**

SendCompose accepts renderer-supplied filesystem paths. The main process checks file type/size and passes paths to Nodemailer without verifying that the native picker authorized those files. A compromised send-capable renderer can transmit known readable host files.

**Quellorte des Ausgangsstands:** `shared/ipc/email-schemas.ts:1075`, `electron/main.js:364`, `electron/ipc/email.ts:1307`, `electron/email/email-compose-send.ts:513`, `electron/email/email-compose-send.ts:565`, `electron/email/email-smtp.ts:109`, `electron/ipc/email.ts:2554`, `electron/main.js:358`, `shared/ipc/email-schemas.ts:1070`, `electron/email/email-compose-send.ts:342`, `electron/email/email-compose-send.ts:460`, `electron/ipc/email.ts:2550`, `electron/email/email-smtp.ts:98`, `electron/ipc/email.ts:699`, `electron/email/email-scheduled-send.ts:70`

**Gemeldete Ursache:**

Raw path strings crossing the sandbox-to-main IPC boundary are treated as authority to read files.

Assigned dedup-0017 synthesis: Same immediate and persisted/scheduled raw attachmentPaths. Picker/import grants bound to sender/draft and checked on consumption subsume source. Preserve prior renderer compromise, known readable paths, rw sender and normal outbound controls.

**Prüfmethode laut Worker:**

static source trace

**Validierungszusammenfassung laut Worker:**

Traced sandbox configuration, SendCompose payload, rw guard, stat/size checks and Nodemailer attachment.path. Native picker yields raw paths and no retained authorization grant is checked.

**Grenzen laut Worker:**

- Static source validation only.
- No renderer foothold, exploit chain or runtime exfiltration was established.

**Gegenbelege laut Worker:**

- Direct send requires a real session, rw account permission and a matching draft/account.
- File must be readable, regular and within size limit; SMTP and outbound policy must allow send.
- A human with the same OS identity already has host access; the finding concerns compromised sandboxed renderer authority.
- No XSS or independent renderer-compromise path was found.

**Vorgeschlagene Korrektur, nicht als umgesetzt bestätigt:**

Have the main process issue opaque attachment handles after native selection, bind them to the session/draft, and resolve handles at send time. Apply equivalent authorization to persisted draft attachments.

**Vorgeschlagene Regressionstests, nicht als ausgeführt bestätigt:**

- An arbitrary path without an authorized main-process handle is rejected.
- A picker-selected file can be sent only from the bound session/draft.

### 31. Mail mutation responses bypass attachment and reply-parent visibility

Worker-Kennung: authorization.mail-mutation-response-metadata.

**Status:** offen; keine Behauptung einer Behebung im PR.

**Gemeldete Einstufung:**

- **level**: low
- **rationale**: Medium confidentiality impact and medium likelihood: requires a real same-workspace delegate with the relevant mutation grant and suitable stored metadata; attachment bytes remain separately protected.

**Gemeldete Nachweissicherheit:**

- **level**: high
- **rationale**: Independent static source validation of entrypoint, guard, dataflow and sink; no application execution or network reproduction.

**Beschreibung:**

Draft edits and customer-link/assignment/spam-status mutations return message metadata without applying the attachment-read and reply-parent visibility flags used by read routes. Delegates can obtain stored attachment paths or hidden parent IDs despite lacking those independent read grants. Attachment-path exposure requires content-read plus the applicable triage/draft-edit grant and omits mail.attachment.read; content-unreadable rows remain redacted. Paths alone disclose metadata, not bytes. The assigned source confirms that an empty update body reaches the same projection, although it may cancel scheduling; the caller already has draft.edit. Scheduled-send success-only responses are excluded.

**Quellorte des Ausgangsstands:** `packages/server/src/mail-access/http-policy-enforcer.ts:444`, `packages/server/src/mail-access/http-policy-enforcer.ts:715`, `packages/server/src/db/postgres-mail-read-ports.ts:1325`, `packages/server/src/db/postgres-mail-read-ports.ts:5545`, `packages/server/src/api/mail-routes.ts:1016`, `packages/server/src/api/mail-routes.ts:1038`, `packages/server/src/mail-access/policy-manifest.ts:367`, `packages/server/src/api/mail-routes.ts:3898`, `packages/server/src/mail-access/http-policy-enforcer.ts:703`, `packages/server/src/db/postgres-mail-read-ports.ts:198`, `packages/server/src/db/postgres-mail-read-ports.ts:2885`, `packages/server/src/db/postgres-mail-read-ports.ts:3084`, `packages/server/src/db/postgres-mail-read-ports.ts:2085`, `packages/server/src/api/mail-routes.ts:2462`, `packages/server/src/api/mail-routes.ts:2906`, `packages/server/src/api/mail-routes.ts:3146`, `packages/server/src/mail-access/http-policy-enforcer.ts:445`, `packages/server/src/mail-access/http-policy-enforcer.ts:708`, `packages/server/src/db/postgres-mail-read-ports.ts:1329`, `packages/server/src/db/postgres-mail-read-ports.ts:5547`, `packages/server/src/api/mail-routes.ts:3151`, `packages/server/src/mail-access/http-policy-enforcer.ts:439`, `packages/server/src/mail-access/http-policy-enforcer.ts:698`, `packages/server/src/db/postgres-mail-read-ports.ts:5541`, `packages/server/src/api/mail-routes.ts:3147`, `packages/server/src/mail-access/http-policy-enforcer.ts:480`, `packages/server/src/db/postgres-mail-read-ports.ts:1271`, `packages/server/src/db/postgres-mail-read-ports.ts:2079`, `packages/server/src/api/mail-routes.ts:2447`, `packages/server/src/mail-access/http-policy-enforcer.ts:435`, `packages/server/src/db/postgres-mail-read-ports.ts:1290`, `packages/server/src/db/postgres-mail-read-ports.ts:5520`, `packages/server/src/api/mail-routes.ts:1020`, `packages/server/src/api/mail-routes.ts:3148`, `packages/server/src/api/mail-routes.ts:3885`

**Gemeldete Ursache:**

Mutation response projection propagates contentScope only; the common mapper treats absent attachment_readable and reply_parent_visible flags as permission to return metadata.

Assigned dedup-0012 synthesis: Same four compose-draft/customer-link/assignment/spam-status mutation response projections missing attachment and reply-parent visibility. Shared conservative field authorization covers all. Preserve mutation/content-read prerequisites, metadata-only impact and empty compose PATCH scheduling side effects; no attachment bytes are established.

Assigned dedup-0016 synthesis: Same attachment visibility omission in compose-draft, customer-link, assignment and spam-status mutation responses. The retained independent content/attachment/reply-parent projection covers this narrower attachment subset. Preserve hidden-parent subcase and schedule/retry exclusion; attachment bytes require a distinct issue.

**Prüfmethode laut Worker:**

Source-reported validation preserved; dedup-0012 performs supplied-artifact semantic reduction only

**Validierungszusammenfassung laut Worker:**

Traced mail.draft.edit PATCH (including empty object), mutation wrapper, SQL returned columns, mapper, and HTTP sanitizer. Related linkCustomer, assign and setSpamStatus use the same incomplete projection. Read paths explicitly compute additional flags. Schedule/retry HTTP handlers discard their internal rows, falsifying that sibling claim.

Assigned dedup-0012 source-reported static validation: Compose update and sibling customer-link/assignment/spam-status all return fields with only content-read predicate. Independent attachment/related-message checks on GET are absent on mutation responses.

**Grenzen laut Worker:**

- Static validation only; no runtime reproduction.
- No dynamic API calls or deployment-specific grant configuration tested.

**Gegenbelege laut Worker:**

- The caller must be authorized to mutate the target message in its workspace.
- Attachment paths require content visibility but not the absent attachment flag; parent IDs require a non-null stored parent.
- This is metadata disclosure, not attachment byte access or arbitrary cross-tenant data access.
- Draft PATCH clears a pending schedule and updates bookkeeping; it is not side-effect-free.
- Schedule/retry HTTP routes return success only and are excluded.
- Target mutation and workspace authorization still apply.
- Attachment path disclosure requires content read; content_readable=false nulls it.
- No attachment bytes, foreign body or credential disclosure established.
- An empty compose PATCH can still clear schedule; it is not read-only.
- Triage or draft-edit permission on the target is still required.
- Content-unreadable rows redact paths.
- Queries constrain workspace_id and responses contain storage keys, not attachment bytes.
- No runtime request was executed.

**Vorgeschlagene Korrektur, nicht als umgesetzt bestätigt:**

Apply the same independent content, attachment and parent visibility projection to every mutation response, or return only mutation status/IDs. Default uncomputed visibility to deny for restricted actors.

**Vorgeschlagene Regressionstests, nicht als ausgeführt bestätigt:**

- Delegates with draft.edit/content.read but no attachment.read cannot obtain attachment paths via empty draft PATCH.
- Hidden reply-parent IDs remain null across draft edit, assignment, customer-link and spam-status responses.
- Authorized readers retain expected metadata, and schedule/retry responses stay minimal.
- Editor with content.read but no attachment.read receives null draft paths from all four mutations.
- Inaccessible reply-parent IDs remain null on mutations as on GET.
- For content-read plus triage without attachment-read, all four mutation responses return null attachment paths.
- Adding attachment-read restores legitimate metadata; removing content-read continues to redact content and paths.
- Draft mutation and GET redact the same fields for identical grants.
- Empty and nonempty updates cannot recover attachment paths without attachment.read.
- Authorized full-access callers retain necessary fields.

### 32. Customer and product update keys are interpolated into SQLite statements

Worker-Kennung: sql-injection.desktop-update-identifiers.

**Status:** offen; keine Behauptung einer Behebung im PR.

**Gemeldete Einstufung:**

- **level**: medium
- **rationale**: High data confidentiality/integrity impact with medium likelihood: requires authenticated desktop IPC or the opt-in automation API with a write-scoped credential.

**Gemeldete Nachweissicherheit:**

- **level**: high
- **rationale**: Independent static source validation; no application execution or network reproduction.

**Beschreibung:**

Desktop customer/product updates accept arbitrary object keys and interpolate them directly into SET clauses. The optional automation customer PATCH exposes the same sink to a write-scoped API key. SQL expressions in a key can read protected SQLite data into an ordinary CRM field or change the statement's update semantics. The assigned source confirms that the native named-parameter binder ignores unused object properties, so value binding does not reject the malicious field-name grammar. Customer HTTP needs the optional enabled listener and write-scoped key; product IPC remains an independent sink.

**Quellorte des Ausgangsstands:** `shared/ipc/schemas.ts:570`, `shared/ipc/schemas.ts:340`, `electron/ipc/database.ts:160`, `electron/ipc/database.ts:253`, `electron/automation/handlers.ts:123`, `electron/services/customer-service.ts:35`, `electron/sqlite-service.ts:2107`, `electron/sqlite-service.ts:2281`, `electron/sqlite-service.ts:2162`, `electron/sqlite-service.ts:2282`, `electron/sqlite-service.ts:2111`, `electron/sqlite-service.ts:2131`, `electron/sqlite-service.ts:1930`, `electron/sqlite-service.ts:2157`, `node_modules/better-sqlite3/src/util/binder.cpp:105`, `electron/sqlite-service.ts:2104`, `electron/ipc/database.ts:157`, `electron/ipc/database.ts:250`, `shared/ipc/schemas.ts:565`, `shared/ipc/schemas.ts:336`, `electron/automation/handlers.ts:118`, `electron/services/customer-service.ts:30`, `node_modules/better-sqlite3/src/util/binder.cpp:100`, `electron/sqlite-service.ts:1929`, `electron/database-schema.ts:480`, `electron/ipc/register.ts:51`, `electron/ipc/database.ts:158`

**Gemeldete Ursache:**

Values are bound but untrusted column-key strings are inserted into SQL grammar without an allowlist or identifier quoting.

Assigned dedup-0009 source: Customer/product update builders parameterize values but interpolate arbitrary caller-provided keys as SQL identifiers. IPC schemas use z.any and automation forwards parsed JSON unchanged. New source strengthens binding feasibility: better-sqlite3 12.11.2 iterates actual SQL parameters, ignoring unused object properties; a key's inline comment removes the generated suffix while the next-line route-ID WHERE remains. Customer update returns the copied scalar value without requiring automation read/email/workflow scope. Existing customer/value, authenticated caller or enabled write key required; no stacked statements, OS execution or keytar extraction asserted.

Assigned dedup-0012 synthesis: Same customer/product arbitrary-key SQL builders across authenticated IPC and write-scoped automation. Fixed persistence field mappings cover both independent builders and callers. Mail-to-notes scalar-read proof complements prior sync_info-to-name proof; unused-key binder behavior and next-line WHERE preserve single-statement feasibility. No stacked SQL, OS or keytar extraction inferred.

Assigned dedup-0014 synthesis: Same customer/product untrusted key interpolation into SQLite SET across authenticated IPC and optional automation. Fixed persistence identifier maps cover both builders. Preserve one statement, next-line WHERE, ignored extra better-sqlite3 bindings, customer readback, mail/auth hash disclosure and no stacked SQL/keytar/OS claim.

Assigned dedup-0015 synthesis: Same arbitrary customer/product keys interpolated into SQLite SET. Fixed mappings in both services cover both channels and prior automation alias. Incoming better-sqlite3 binder trace strengthens single-statement subquery framing: unused supplied keys do not defeat bindings and the next-line ID predicate can remain. No SQL was executed; allowlisted siblings are distinct.

Assigned dedup-0017 synthesis: Same customer/product dynamic identifier SQL stores and optional Automation customer PATCH. Fixed store-level field mapping and bound values subsume every caller. Installed binder permits single-statement subquery readback; no stacked query/extension/value injection required.

**Prüfmethode laut Worker:**

Source-reported validation preserved; dedup-0012 performs supplied-artifact semantic reduction only

**Validierungszusammenfassung laut Worker:**

Independently confirmed z.any customer/product IPC schemas, direct forwarding, automation write route/service, Object.keys SET interpolation and same SQLite connection. Scalar subqueries/comments can affect a single prepared UPDATE; stacked statements are not needed.

Assigned source 705c5481-2d05-4afc-bc67-518d631d7500:24: A customer JSON key shaped name = (SELECT value FROM sync_info WHERE key = 'email_google_oauth_client_secret') -- is placed on the single SET line; the generated assignment suffix and timestamp are commented out, while newline WHERE id=@id remains and is bound from the trusted route ID. The installed better-sqlite3 12.11.2 GetBindMap/BindObject iterates only SQL parameters, so unused supplied object properties are ignored. Update commits and returns getCustomerById. Existing customer and sensitive stored value needed for this example. Product update independently uses the same unsafe key interpolation with z.any IPC. Deals and tasks use explicit allowlists; calendar IPC uses strict schema and a separate atomic entry updater, so no equivalent exploit is asserted there.

Assigned dedup-0012 source-reported static validation: The customer SET list occupies one line and WHERE id=@id remains on the following line. An injected assignment with a scalar subquery and line comment can replace notes while the expected id remains bound. Updated customer is returned; no stacked statements are needed.

**Grenzen laut Worker:**

- Static validation only; no runtime reproduction.
- No example query, native driver, application, or network endpoint was executed.
- Installed dependency source is supporting evidence, not a comprehensive dependency audit.
- New source strengthens binding feasibility: better-sqlite3 12.11.2 iterates actual SQL parameters, ignoring unused object properties; a key's inline comment removes the generated suffix while the next-line route-ID WHERE remains. Customer update returns the copied scalar value without requiring automation read/email/workflow scope. Existing customer/value, authenticated caller or enabled write key required; no stacked statements, OS execution or keytar extraction asserted.
- Actual enabled automation deployments not established; source proof covers the shipped optional listener and desktop IPC.
- No application execution or production testing.
- Requires a real authenticated desktop session and direct IPC access.

**Gegenbelege laut Worker:**

- Authentication is required; automation is disabled by default and requires write scope.
- Parameter binding protects field values, not field keys.
- Single-statement preparation constrains stacked SQL, not expressions within the UPDATE.
- Calendar strict schema and task/deal allowlists prevent the corresponding sibling path.
- Automation authentication and write scope remain required.
- Ordinary values are bound; issue is field-name interpolation.
- better-sqlite3 binder.cpp iterates statement parameters and ignores unused object keys.
- Deal/task identifiers are allowlisted; calendar's strict current IPC schema blocks the analogous primitive.
- No SQL/DB/application execution or real data extraction performed.

**Vorgeschlagene Korrektur, nicht als umgesetzt bestätigt:**

Define strict allowed update fields at every public boundary and construct SQL only from a fixed mapping of those fields. Reject unknown keys; continue binding values. Apply the same allowlist to service callers. Enforce fixed field mappings within both customer and product persistence functions; build bindings only from accepted fields while preserving custom-field and zip updates.

**Vorgeschlagene Regressionstests, nicht als ausgeführt bestätigt:**

- Unknown or SQL-shaped property names are rejected before preparing customer/product updates.
- Write-scoped automation cannot access non-CRM tables through update keys.
- Normal allowed updates retain transaction and custom-field behavior.
- Reject SQL syntax in every update property name.
- Verify write-only automation keys cannot select mail data through a customer update.
- Preserve supported field/custom-field/zip updates and existing deal/task allowlists.
- Reject keys containing SQL syntax and all unknown field names for both update endpoints.
- Verify allowed updates and custom-field handling still work without exposing data from unrelated tables.
- Unknown/malformed field keys are rejected before query construction.
- Service-layer field allowlist applies even without IPC.
- Valid partial updates still bind values and cannot modify protected columns.
- Reject SQL metacharacters and all unknown customer/product keys before preparing SQL.
- Valid allowed-field updates still succeed; tests must exercise both channels.
- Unknown and SQL-shaped keys are rejected before statement preparation through all three entry paths.
- Ordinary permitted customer/product updates still succeed and cannot modify protected key columns.

### 33. A stale message-policy response can enable remote content in another email

Worker-Kennung: privacy.mail-remote-policy-race.

**Status:** offen; keine Behauptung einer Behebung im PR.

**Gemeldete Einstufung:**

- **level**: low
- **rationale**: Medium privacy impact and medium likelihood: requires out-of-order policy responses during message switching and opening the blocked message's HTML view.

**Gemeldete Nachweissicherheit:**

- **level**: high
- **rationale**: Independent static source validation; no application execution or network reproduction.

**Beschreibung:**

The reused mail viewer stores remote-content permission without binding it to the current message. A delayed allowed-policy response for message A, or completion of an awaited sender-approval request for A, can enable remote images in blocked message B after selection changes. HTML view must then be selected; no script execution or app-data disclosure is established.

**Quellorte des Ausgangsstands:** `src/components/email/message-viewer.tsx:357`, `src/components/email/message-viewer.tsx:380`, `src/components/email/message-viewer.tsx:437`, `src/components/email/message-viewer.tsx:1574`, `src/components/email/email-html-frame.tsx:21`, `src/components/email/message-viewer.tsx:1502`, `src/components/email/message-viewer.tsx:441`, `src/components/email/message-viewer.tsx:1575`, `src/components/email/email-html-frame.tsx:22`, `src/components/email/email-html-frame.tsx:35`, `src/components/email/mail-shell.tsx:394`, `src/components/email/message-viewer.tsx:1573`

**Gemeldete Ursache:**

Remote-content consent is component-wide state written by asynchronous operations without checking the current message identity. The policy effect compares captured values from the same old render and lacks cancellation; the sender-approval handler independently sets loadRemoteImages after its await without checking selection. The normal unkeyed viewer is reused across messages, so a reset does not prevent a stale result from authorizing the new message.

Assigned dedup-0012 synthesis: Same stale policy callback writing message-unbound remote permission. Retained complete fix binds permission consumption to the current message and guards both the policy callback and separately awaited sender-approval producer. Incoming narrower framing does not remove the latter. HTML-view interaction and IP/timing-only exposure remain.

**Prüfmethode laut Worker:**

Source-reported validation preserved; dedup-0012 performs supplied-artifact semantic reduction only

**Validierungszusammenfassung laut Worker:**

Independently read the reset, policy effect, captured-ID guard, sanitizer branch and iframe CSP selection. A late A allowRemote result overwrites B state; the normal reset does not cancel the pending effect.

Assigned source adae8751-0a17-49fc-a285-f8a4574c7953:15: Verified the normal shell keeps one unkeyed viewer, selection resets state, old policy responses lack cleanup and compare captured values, and loadRemoteImages controls both URL rewriting and the iframe's HTTP(S) image CSP. The same issue exists after awaited sender approval. DOMPurify, empty iframe sandbox and no-referrer remain effective against scripts/referrer leakage; they do not stop allowed images. HTML view resets and must be reselected, narrowing the scenario.

Assigned dedup-0012 source-reported static validation: Verified selection reset, absence of effect cancellation, stale closure check, current message HTML consumer and HTTP/S-enabled iframe CSP.

**Grenzen laut Worker:**

- Static validation only; no runtime reproduction.
- No runtime race reproduction. Desktop IPC may usually resolve quickly; server network requests can complete out of order. An outer policy may additionally block external images.
- dedup-0006 source rates confidence medium and image-tracking impact/likelihood low, versus prior high confidence and medium impact/likelihood. Both assign overall low severity. No request reordering was reproduced; desktop IPC may resolve quickly and an outer policy may block external images. Preserve prior image/font/media framing alongside the newer narrower image-only demonstrated framing.
- Source-validated race, not dynamically reproduced.

**Gegenbelege laut Worker:**

- Requires a previously remote-allowed message, delayed response and user switching to attacker HTML mail.
- HTML view must be shown; the default reset selects plain view.
- DOMPurify, empty iframe sandbox and no-referrer remain; no script execution or application data read claimed.
- Body-fetch effect has cancellation, but this policy effect does not.
- Selection normally resets HTML view and remote permission; user must display the new message as HTML.
- Sanitization, empty iframe sandbox and script restrictions remain effective.
- No referrer is sent by the frame; IP/timing still exposed to requested endpoint.

**Vorgeschlagene Korrektur, nicht als umgesetzt bestätigt:**

Bind remote-content permission to the message ID and ensure the renderer consumes an allow decision only for that same current message. Cancel/ignore obsolete policy requests using effect cleanup or a current-request generation token, and guard the awaited sender-approval update with the same identity invariant. Fix both producers: cancelling only the policy effect leaves stale sender-approval completion reachable.

**Vorgeschlagene Regressionstests, nicht als ausgeführt bestätigt:**

- Resolve blocked B policy before delayed allowed A and assert B resources remain blocked.
- Unmount/change selection before policy resolution and assert no stale state update.
- Use deferred promises: resolve B's blocked policy before A's allowed policy, then verify B's iframe remains blocked.
- Switch messages during sender approval and verify its completion cannot enable remote content on the new message.
- Resolve allowed policy for A after selecting blocked B; B must retain blocked HTML filtering and CSP.
- Current-message consent still enables remote resources.

### 34. Sender display names inject HTML into the reply composer

Worker-Kennung: html-injection.mail-reply-greeting.

**Status:** offen; keine Behauptung einer Behebung im PR.

**Gemeldete Einstufung:**

- **level**: medium
- **rationale**: The assigned Standard source rates this medium: Medium UI-integrity/privacy impact with high likelihood for a recipient who replies to an unlinked sender; ordinary mail input suffices. Script execution is not established under the shipped CSP. The established aggregate rated it low: Medium privacy/UI integrity impact and medium likelihood: an external sender must induce a reply using the sender-derived greeting. CSP prevents the unproven inline-script takeover scenario. Both assessments are preserved and unresolved; this reducer performed no new validation.

**Gemeldete Nachweissicherheit:**

- **level**: high
- **rationale**: Independent static source validation; no application execution or network reproduction.

**Beschreibung:**

Reply greetings interpolate the incoming sender display name without HTML escaping. A sender-controlled compose-zone marker can move subsequent markup into quotedHtml, which the composer renders with dangerouslySetInnerHTML without sanitization. Default CSP still permits injected remote images and inline styling. The assigned source narrows the normal trigger to Reply/Reply all without an AI initial reply and a selected sender-name greeting, such as an unlinked sender; no script, token or native-code execution is established.

**Quellorte des Ausgangsstands:** `src/components/email/compose-dialog.tsx:676`, `shared/compose-body.ts:28`, `src/components/email/compose-dialog.tsx:1991`, `shared/email-reply-greeting.ts:65`, `packages/core/src/email/parse-utils.ts:17`, `electron/security/content-security-policy.ts:27`, `docker/Caddyfile:6`, `shared/email-reply-greeting.ts:1`, `shared/compose-body.ts:1`, `src/components/email/compose-dialog.tsx:655`, `src/components/email/compose-dialog.tsx:1980`, `packages/core/src/email/parse-utils.ts:1`, `docker/Caddyfile:1`, `shared/compose-body.ts:170`, `packages/server/src/mail-parse.ts:154`

**Gemeldete Ursache:**

Plain sender data becomes trusted greeting HTML; untrusted marker text is then interpreted as trusted compose structure before an unsanitized HTML sink.

**Prüfmethode laut Worker:**

static source trace

**Validierungszusammenfassung laut Worker:**

Independently traced preserved sender name, buildReplyGreeting, raw replyGreetingPlainToHtml interpolation, buildReplyComposeHtml and splitEditorAndSignature, quote state and dangerouslySetInnerHTML. Production CSP allows images/styles so concrete tracking and UI markup injection remain despite script controls.

**Grenzen laut Worker:**

- Static validation only; no runtime reproduction.

**Gegenbelege laut Worker:**

- No JavaScript execution, renderer compromise or native-code execution established.
- Default CSP blocks inline script; no need to weaken CSP to observe image/privacy impact.
- Requires user reply/reply-all, no AI initial reply and sender-derived greeting rather than overriding trusted customer data.
- Normal quoted body uses escapeHtmlText; the bypass originates in greeting metadata, not raw body quoting.

**Vorgeschlagene Korrektur, nicht als umgesetzt bestätigt:**

Escape all plain-text greeting data before HTML construction. Treat zone markers as internal structure unavailable to sender data and sanitize every rendered zone, including quote/signature, before HTML sinks; maintain remote-resource consent.

**Vorgeschlagene Regressionstests, nicht als ausgeführt bestätigt:**

- HTML and compose marker text in sender names render literally and cannot create DOM elements or new zones.
- Starting a reply to blocked remote-content mail does not load sender-controlled resources.
- Normal trusted signatures and quoted plain text remain usable.
- Sender names containing angle brackets, quote markers, style markup and remote images remain inert text.
- Reply/all works for linked/unlinked customers and AI/non-AI initialization.
- Quoted text and signatures retain intended formatting without raw untrusted markup.

### 35. Users without workflow access receive protected metadata over WebSocket

Worker-Kennung: authorization.workflow-event-disclosure.

**Status:** offen; keine Behauptung einer Behebung im PR.

**Gemeldete Einstufung:**

- **level**: low
- **rationale**: Same-workspace metadata disclosure requires a valid account and relevant events. No mail body, knowledge chunk content or API key disclosure is established.

**Gemeldete Nachweissicherheit:**

- **level**: high
- **rationale**: Verified live/replay delivery, policy manifest omission, actual publisher payloads, and production port wiring; no runtime reproduction.

**Beschreibung:**

A signed-in server user without `workflows.view` can subscribe to `/api/v1/events` and receive knowledge-base names/descriptions, chunk titles/source paths, and workflow names/configuration metadata that their REST permissions deny.

**Quellorte des Ausgangsstands:** `packages/server/src/api/fastify-adapter.ts:233`, `packages/server/src/mail-access/async-policy-enforcer.ts:1110`, `packages/server/src/api/workflow-runtime-routes.ts:1920`, `packages/server/src/api/workflow-runtime-routes.ts:1992`, `packages/server/src/api/fastify-adapter.ts:366`, `packages/server/src/api/workflow-runtime-routes.ts:104`, `packages/server/src/api/workflow-routes.ts:1331`, `packages/server/src/mail-access/policy-manifest.ts:735`

**Gemeldete Ursache:**

`handleEventSocket` authenticates the subscriber and uses `filterMailEventForPrincipal` for delivery. That filter checks mail policies but passes recognized non-mail events unchanged. Workflow and knowledge event producers include descriptive metadata, while their REST reads require `workflows.view`; the event path never applies this module permission.

**Prüfmethode laut Worker:**

independent static trace

**Validierungszusammenfassung laut Worker:**

Production wiring installs the PostgreSQL event, knowledge-base and chunk ports. Publishers put metadata into server_events; live/replay paths deliver the same event through the pass-through branch without checking module capabilities.

**Grenzen laut Worker:**

- Actual sensitivity depends on metadata contents and the presence of workflow activity or retained events.

**Vorgeschlagene Korrektur, nicht als umgesetzt bestätigt:**

Authorize every non-mail event family against the corresponding module read capability before live or replay delivery; default-deny unmapped event types or reduce them to explicitly public invalidation fields.

**Vorgeschlagene Regressionstests, nicht als ausgeführt bestätigt:**

- Verify a user lacking workflows.view receives no workflow/knowledge descriptive payload in live and replay paths.
- Verify authorized subscribers and existing per-mail-resource filtering continue to work.

### 36. AI text transformation discloses customer data without CRM read permission

Worker-Kennung: authorization.ai-customer-context.

**Status:** offen; keine Behauptung einer Behebung im PR.

**Gemeldete Einstufung:**

- **level**: low
- **rationale**: Customer confidentiality within the same workspace is affected. Exploitation needs authentication plus an existing customer-placeholder prompt, or independent workflow management authority; deployment and configuration are unknown.

**Gemeldete Nachweissicherheit:**

- **level**: high
- **rationale**: Verified route input, concrete customer query, interpolation, provider call, workspace-only RLS and production wiring. No runtime reproduction.

**Beschreibung:**

A server user denied `crm.read` can supply `customerId` to AI text transformation and have the customer's name and email inserted into a provider prompt. A user with `workflows.manage` can create a suitable prompt and public endpoint to receive those values deterministically.

**Quellorte des Ausgangsstands:** `packages/server/src/api/workflow-routes.ts:890`, `packages/server/src/api/workflow-routes.ts:2204`, `packages/server/src/ai-classification.ts:1421`, `packages/server/src/ai-classification.ts:561`, `packages/server/src/ai-classification.ts:1826`, `packages/server/src/api/workflow-routes.ts:314`, `packages/server/src/ai-classification.ts:512`, `packages/server/src/migrations/0005_core_crm_schema.ts:157`, `packages/server/src/server.ts:630`

**Gemeldete Ursache:**

The compose transformation route authenticates the caller but does not authorize the optional customer reference. The port selects that customer by workspace and ID, fills stored prompt placeholders with CRM PII, and sends the resulting prompt to the configured provider. Workspace RLS does not enforce module capabilities, and workflows.manage does not imply crm.read.

**Prüfmethode laut Worker:**

independent static source trace

**Validierungszusammenfassung laut Worker:**

The real server wires aiTextTransform. Valid customerId input reaches selectAiTransformCustomer and prompt interpolation without a CRM capability check. A workflow manager can create a profile targeting an allowed public host, store an API key and create a prompt with customer placeholders, making provider-side disclosure deterministic.

**Grenzen laut Worker:**

- No dynamic test or production configuration evidence; use of customer templates and available AI budget are prerequisites.

**Vorgeschlagene Korrektur, nicht als umgesetzt bestätigt:**

When `customerId` is supplied, require `crm.read` before customer lookup or provider invocation; keep text-only transforms available under their existing policy.

**Vorgeschlagene Regressionstests, nicht als ausgeführt bestätigt:**

- Assert customer-context transform without crm.read returns 403 and performs no customer/provider call.
- Verify text-only transform remains functional without CRM access.
- Verify workflows.manage alone cannot disclose customer placeholders.

### 37. Restricted desktop users can install rules that forward other mailboxes

Worker-Kennung: authorization.desktop-global-workflows.

**Status:** offen; keine Behauptung einer Behebung im PR.

**Gemeldete Einstufung:**

- **level**: medium
- **rationale**: Potentially high mailbox confidentiality and sending impact, but requires a restricted-user desktop deployment contrary to single-user product guidance. No unauthenticated, server-edition or OS escalation claim.

**Gemeldete Nachweissicherheit:**

- **level**: high
- **rationale**: Static trace verified local session roles, omitted guards, global scope selection and body-to-SMTP flow; deployment and runtime behavior not tested.

**Beschreibung:**

Where local roles and account ACLs are used, a signed-in restricted user can create/import a global inbound workflow that forwards another account's future messages. Workflow mutation handlers omit management checks and automatic execution has no author/account authorization.

**Quellorte des Ausgangsstands:** `electron/ipc/email.ts:564`, `electron/email/email-workflow-store.ts:148`, `shared/mail-account-overrides.ts:52`, `electron/email/email-workflow-engine.ts:349`, `electron/workflow/nodes/email-nodes.ts:130`, `electron/email/email-forward-copy.ts:69`, `electron/auth/account-access.ts:20`, `electron/ipc/email.ts:588`, `electron/ipc/workflow.ts:135`, `electron/ipc/workflow.ts:187`, `electron/ipc/workflow.ts:234`, `electron/ipc/workflow.ts:502`, `electron/ipc/ipc-account-scope.ts:18`

**Gemeldete Ursache:**

Workflow create/update/delete/import/restore and global automation-setting handlers authenticate but do not require a management role. CRUD is excluded from mailbox resolution. Stored global rules are selected for each mailbox, and inbound execution carries no creator identity. A forwarding node therefore reads victim mail and sends it using victim account credentials to the rule's destination.

**Prüfmethode laut Worker:**

independent static source trace

**Validierungszusammenfassung laut Worker:**

Verified that a local agent/viewer session can reach exposed Email IPC, bypass the optional role/account checks, store an enabled account_id-null graph, and have normal inbound mail execute its forwarding node. runOnEveryInbound can satisfy the routing gate; no native code escape is required.

**Grenzen laut Worker:**

- Security boundary is conditional on supported restricted local users; no live reproduction or production confirmation.

**Vorgeschlagene Korrektur, nicht als umgesetzt bestätigt:**

Require owner/admin for global workflow mutation, imports, restores, deletion and automation settings. If delegated authors are intended, persist their mailbox scope and enforce it for every automatic effect and referenced resource.

**Vorgeschlagene Regressionstests, nicht als ausgeführt bestätigt:**

- Use a real restricted local session and verify global create/import/update/restore/settings return authorization errors.
- Verify an authorized rule cannot read or send outside its persisted author scope if delegation is supported.

### 38. A crafted application link persistently replaces the browser's server connection

Worker-Kennung: configuration.browser-endpoint-poisoning.

**Status:** offen; keine Behauptung einer Behebung im PR.

**Gemeldete Einstufung:**

- **level**: low
- **rationale**: Per-victim, reversible client availability impact requiring link navigation. No confirmed current-token theft, server compromise or cross-tenant access.

**Gemeldete Nachweissicherheit:**

- **level**: high
- **rationale**: Static URL parsing, persistence, setup activation, transport consumption and shipped CSP establish the effect; runtime reproduction was not performed.

**Beschreibung:**

Following a legitimate application URL containing an attacker-selected server query parameter overwrites an existing browser deployment configuration without confirmation. With the bundled web CSP, requests to an external destination fail and subsequent clean visits retain the broken endpoint.

**Quellorte des Ausgangsstands:** `src/services/transport/browser-deploy-config.ts:49`, `src/services/transport/browser-deploy-config.ts:228`, `src/components/setup/deploy-setup-gate.tsx:55`, `src/services/transport/renderer-transport.ts:131`, `docker/Caddyfile:6`, `src/app/login/page.tsx:845`

**Gemeldete Ursache:**

Browser bootstrap treats any recognized URL endpoint parameter as an authoritative persistent configuration update, including when a working configuration already exists. The same-origin build default is only a fallback.

**Prüfmethode laut Worker:**

independent static source trace

**Validierungszusammenfassung laut Worker:**

Verified query precedence, unconditional persistence, automatic activation and destination consumption. A syntactically valid external endpoint poisons configuration even though stock CSP blocks the request. Existing tests deliberately cover query selection; intentional bootstrap does not distinguish first setup from replacement of an existing trusted endpoint.

**Grenzen laut Worker:**

- Legacy refresh-token migration presents a separate unresolved conditional exfiltration candidate.
- No browser execution was performed.

**Vorgeschlagene Korrektur, nicht als umgesetzt bestätigt:**

Treat URL-provided endpoints as setup proposals. Require explicit confirmation before replacing an established endpoint, enforce same-origin endpoints in the server-hosted build where appropriate, and provide a browser-accessible connection reset.

**Vorgeschlagene Regressionstests, nicht als ausgeführt bestätigt:**

- Seed a working browser config, navigate to an application link with an external endpoint query, and assert no persistence/activation without explicit approval.
- Verify first-use server selection remains possible and same-origin browser deployments recover without clearing all site data.

### 39. Event streams bypass read restrictions on automation keys and workflow knowledge metadata

Worker-Kennung: missing-authorization.nonmail-events.

**Status:** offen; keine Behauptung einer Behebung im PR.

**Gemeldete Einstufung:**

- **level**: low
- **rationale**: Same-workspace disclosure of restricted credential and workflow knowledge metadata; no actual credential secret, full chunk content or cross-workspace access established.

**Gemeldete Nachweissicherheit:**

- **level**: high
- **rationale**: Publisher, explicit REST restriction, permissive event fallback and live/replay sink independently traced in current source; no runtime reproduction.

**Beschreibung:**

An authenticated non-admin in the same workspace can receive automation_api_key.created/revoked metadata through live WebSocket delivery or stored replay, although the corresponding REST reads explicitly require owner/admin. Payloads expose labels, privilege scopes and configuration state, not API key secrets. The same fallback exposes workflow knowledge-base names/descriptions and chunk titles/source paths to users without workflows.view; full chunk content is not included.

**Quellorte des Ausgangsstands:** `packages/server/src/mail-access/async-policy-enforcer.ts:1110`, `packages/server/src/api/automation-routes.ts:39`, `packages/server/src/api/automation-routes.ts:69`, `packages/server/src/api/automation-routes.ts:183`, `packages/server/src/api/fastify-adapter.ts:238`, `packages/server/src/api/fastify-adapter.ts:330`, `packages/server/src/api/fastify-adapter.ts:374`, `packages/server/src/db/postgres-event-port.ts:102`, `packages/server/src/api/workflow-runtime-routes.ts:104`, `packages/server/src/api/workflow-runtime-routes.ts:1920`, `packages/server/src/api/workflow-runtime-routes.ts:1985`, `packages/server/src/api/http.ts:97`

**Gemeldete Ursache:**

The shared delivery filter treats registered non-mail events as readable by every authenticated workspace principal, omitting the owner/admin gate enforced by the resource's REST handlers. This also omits workflows.view for workflow_knowledge_base.* and workflow_knowledge_chunk.* metadata.

**Prüfmethode laut Worker:**

independent static source trace

**Validierungszusammenfassung laut Worker:**

Independent source review confirmed authentication-only socket admission, workspace isolation, persistent replay and both automation-key event publishers. Neither the earlier filter branches nor mail-policy manifest applies an administrator check to these event types. Session revalidation protects revoked/disabled users but does not add this missing capability check. Parent also validated knowledge-base/chunk created, updated and deleted publishers against the GET workflows.view gate, mail-policy manifest and CRM reduction allowlist; none covers these events. AI profile metadata was falsified as a sibling because its REST reads intentionally allow all authenticated users.

**Grenzen laut Worker:**

- No runtime or deployment verification.
- Disclosure is limited to published metadata; no key secret, full record or last-use value established.

**Vorgeschlagene Korrektur, nicht als umgesetzt bestätigt:**

Apply explicit resource read authorization to non-mail events, including owner/admin gating for automation_api_key.created and automation_api_key.revoked, identically for live delivery and replay. Require workflows.view for workflow_knowledge_base.created/updated/deleted and workflow_knowledge_chunk.created/updated/deleted, or reduce payloads only where that meets the resource's intended visibility.

**Vorgeschlagene Regressionstests, nicht als ausgeführt bestätigt:**

- Non-admin subscriptions and replay never receive automation-key metadata; owner/admin subscriptions do.
- Keep workspace isolation, current-session validation and existing per-mail-event ACL checks.
- Principals without workflows.view receive no protected knowledge-base/chunk metadata through live or replay events; authorized workflow viewers retain notifications.
- AI profile metadata remains available to authenticated users as intended by its REST read policy.

### 40. Delegated mailbox managers can redirect saved credentials to another server

Worker-Kennung: credential-exposure.mutable-mail-endpoint.

**Status:** offen; keine Behauptung einer Behebung im PR.

**Gemeldete Einstufung:**

- **level**: medium
- **rationale**: High credential impact with medium likelihood: requires a specific delegated account-management grant and attacker endpoint; confidentiality expectations are supported by explicit saved-endpoint protections.

**Gemeldete Nachweissicherheit:**

- **level**: high
- **rationale**: Independently source-validated; no runtime reproduction or production assumptions.

**Beschreibung:**

Capture the managed mailbox's password or SMTP OAuth token; initiate server connections beyond the ad-hoc-test administrator boundary.

**Quellorte des Ausgangsstands:** `packages/server/src/mail-access/policy-manifest.ts:332`, `packages/server/src/api/mail-routes.ts:1484`, `packages/server/src/db/postgres-mail-read-ports.ts:5302`, `packages/server/src/db/postgres-mail-read-ports.ts:679`, `packages/server/src/api/mail-routes.ts:639`, `packages/server/src/mail-connection-test.ts:246`, `packages/server/src/mail-connection-test.ts:116`, `packages/server/src/mail-connection-test.ts:393`

**Gemeldete Ursache:**

Account PATCH permits `mail.account.manage` to change protocol coordinates while retaining old secret references. Stored-account tests intentionally trust saved coordinates and retrieve their secret; the two operations let a delegate move the secret's destination without the administrator gate applied to ad-hoc tests.

**Prüfmethode laut Worker:**

static source trace

**Validierungszusammenfassung laut Worker:**

Independently traced policy, update handler, patch conversion, secret preservation, saved-account resolution and IMAP LOGIN sink. Workspace RLS and account grant are effective, but do not constrain sensitive coordinate columns. SMTP and POP3 select saved coordinates similarly. Requires delegated management, not arbitrary user access.

**Grenzen laut Worker:**

- No runtime reproduction; deployed grants and configurations unknown.

**Vorgeschlagene Korrektur, nicht als umgesetzt bestätigt:**

Restrict changes to stored authentication destinations/identity/TLS to trusted administrators, or clear old credentials and require fresh credentials on destination changes; apply destination policy to all consumers.

**Vorgeschlagene Regressionstests, nicht als ausgeführt bestätigt:**

- Cover the complete described request sequence using the actual authorization policy and persistent storage; verify protected state remains unchanged on rejection.

### 41. A stolen server session can remove or replace the enrolled MFA factor

Worker-Kennung: authentication.mfa-change-without-reauthentication.

**Status:** offen; keine Behauptung einer Behebung im PR.

**Gemeldete Einstufung:**

- **level**: low
- **rationale**: Medium impact with medium likelihood because session compromise is prerequisite and password remains protected; no full account takeover claimed.

**Gemeldete Nachweissicherheit:**

- **level**: medium
- **rationale**: Independently source-validated; no runtime reproduction or production assumptions.

**Beschreibung:**

Permanent weakening of later authentication or replacement of the victim's factor, potentially blocking their next MFA login.

**Quellorte des Ausgangsstands:** `packages/server/src/api/auth-security-routes.ts:251`, `packages/server/src/api/auth-security-routes.ts:181`, `packages/server/src/auth/login-security-service.ts:371`, `packages/server/src/auth/login-security-service.ts:454`

**Gemeldete Ursache:**

Self-service MFA endpoints check the session's user ID, but never require fresh password or enrolled-factor proof. Setup issues a new secret to the same session, and confirmation validates that new secret rather than the old factor.

**Prüfmethode laut Worker:**

static source trace

**Validierungszusammenfassung laut Worker:**

Independently read all MFA setup/confirm/disable handlers and service consumers. Workspace and same-user checks stop targeting other users. The new TOTP check confirms possession only of the new session-issued secret. No password is disclosed or independently reset; the added impact is lasting factor removal/replacement after transient bearer theft.

**Grenzen laut Worker:**

- No runtime reproduction; deployed grants and configurations unknown.

**Vorgeschlagene Korrektur, nicht als umgesetzt bestätigt:**

Require purpose-bound recent reauthentication using current credentials/factor before self-service MFA removal or replacement; separate administrator recovery and revoke stale sessions after changes.

**Vorgeschlagene Regressionstests, nicht als ausgeführt bestätigt:**

- Cover the complete described request sequence using the actual authorization policy and persistent storage; verify protected state remains unchanged on rejection.

### 42. Scheduled mail silently drops selected PGP encryption and signing

Worker-Kennung: encryption.scheduled-mail-policy-loss.

**Status:** offen; keine Behauptung einer Behebung im PR.

**Gemeldete Einstufung:**

- **level**: medium
- **rationale**: Loss of explicitly requested message confidentiality and authenticity. Requires the user to choose scheduled delivery with PGP protection; mail transport/storage operators can see content that the sender expected to be end-to-end encrypted.

**Gemeldete Nachweissicherheit:**

- **level**: high
- **rationale**: UI, draft persistence, delayed requests and both conditional crypto consumers were traced in source; no message was sent.

**Beschreibung:**

Selecting PGP encryption/signing and then 'Später senden' saves an unprotected draft and schedules it without the protection flags. Both desktop and server delayed senders consequently send the original content without the selected PGP protection.

**Quellorte des Ausgangsstands:** `src/components/email/compose-dialog.tsx:2074`, `src/components/email/compose-dialog.tsx:1028`, `src/components/email/compose-dialog.tsx:2196`, `src/components/email/compose-dialog.tsx:1400`, `electron/email/email-scheduled-send.ts:75`, `electron/email/email-compose-send.ts:398`, `electron/email/email-compose-send.ts:575`, `packages/server/src/mail-scheduled-send.ts:172`, `packages/server/src/mail-compose-send.ts:373`

**Gemeldete Ursache:**

PGP intent exists only in compose component state and immediate-send arguments. Draft saving and scheduling do not persist or transmit it, and background senders default to no protection when those flags are absent.

**Prüfmethode laut Worker:**

static source trace

**Validierungszusammenfassung laut Worker:**

Verified selectable PGP options, enabled schedule button, prepareScheduledSend's date/persistence-only checks, plaintext UpdateComposeDraft payload and both delayed callers. Both final compose implementations condition PGP on request flags, so their direct-send safety checks do not execute for scheduled mail. SMTP TLS may protect transport hops but does not provide the selected PGP confidentiality from mail operators.

**Grenzen laut Worker:**

- No runtime or outbound mail test executed. User must schedule a PGP-selected message; no unauthorized access by intended recipients is claimed.

**Vorgeschlagene Korrektur, nicht als umgesetzt bestätigt:**

Preserve and enforce outbound protection intent across save/schedule/execution, with safe handling of signing credentials. Until supported, reject scheduling when PGP options are selected and explain the limitation without silently downgrading.

**Vorgeschlagene Regressionstests, nicht als ausgeführt bestätigt:**

- Schedule a message with encryption selected and verify the actual generated MIME is encrypted, or that scheduling fails explicitly before enqueue.
- Cover signing, encryption plus signing, attachments, both editions, restarts and draft reopening; never persist passphrases as plain draft fields.

### 43. CRM CSV exports preserve spreadsheet formula syntax in user-controlled text

Worker-Kennung: injection.csv-formula.

**Status:** offen; keine Behauptung einer Behebung im PR.

**Gemeldete Einstufung:**

- **level**: low
- **rationale**: Requires a writer-controlled field, another user's export and spreadsheet import with formula interpretation. Established impact is expression evaluation/deceptive output; automatic OS execution and unconditional exfiltration are not claimed.

**Gemeldete Nachweissicherheit:**

- **level**: high
- **rationale**: Complete serializer/export component and task persistence-to-export source chain inspected. Spreadsheet-specific behavior was not executed.

**Beschreibung:**

A CRM writer can store formula-prefixed task, customer or deal text that the CSV serializer exports without neutralization. A different user opening the CSV in formula-interpreting spreadsheet software can evaluate that content instead of displaying it as text. Customer-specific evidence follows name/company/notes through PostgreSQL, HTTP-to-renderer mapping and paginated customer export to the same encoder.

**Quellorte des Ausgangsstands:** `src/lib/electron-utils.ts:89`, `src/lib/electron-utils.ts:102`, `src/components/export-button.tsx:20`, `electron/sqlite-service.ts:3273`, `electron/sqlite-service.ts:3299`, `src/app/tasks/page.tsx:223`, `src/app/tasks/page.tsx:483`, `src/app/customers/page.tsx:498`, `src/app/deals/page.tsx:430`, `src/components/export-button.tsx:1`, `src/app/customers/page.tsx:300`, `packages/server/src/api/customer-routes.ts:355`, `packages/server/src/db/postgres-customer-port.ts:155`, `src/services/transport/channel-http-registry.ts:1092`, `src/services/data/localDataService.ts:6`, `src/app/customers/page.tsx:488`, `src/app/customers/page.tsx:311`, `src/app/customers/page.tsx:494`, `src/app/deals/page.tsx:426`, `src/app/tasks/page.tsx:479`, `src/lib/electron-utils.ts:75`

**Gemeldete Ursache:**

arrayToCSV treats syntactically escaped CSV text as safe spreadsheet cell content. It preserves formula-leading characters in attacker-controlled string fields rather than forcing text interpretation.

Assigned dedup-0013 synthesis: Same arrayToCSV formula-preserving encoder and victim spreadsheet interpretation. Central text-cell encoding covers task/customer/deal exports and this stronger customer mutation -> PostgreSQL -> HTTP/renderer mapping -> paginated export chain. Preserve writer and victim actions; no automatic OS execution or guaranteed exfiltration. Incoming medium impact/likelihood remain alongside prior low assessments.

Assigned dedup-0015 synthesis: Same customer/deal/task text exported through delimiter-only CSV serializer. Existing central inert-text handling with whitespace/control-prefix coverage subsumes source while preserving numbers and stored strings. Spreadsheet policy and export/open interaction constrain impact; JSON unaffected, no unconditional OS execution/exfiltration.

**Prüfmethode laut Worker:**

Source-reported validation preserved; dedup-0013 performs supplied-artifact semantic reduction only

**Validierungszusammenfassung laut Worker:**

Traced nonempty task-title validation and parameterized storage, task service/list mapping, ExportButton and the complete serializer/download code. A benign formula-like title '=1+1' is unchanged by those transformations. Customer/deal exports share this boundary. Browser download/JSON are not execution sinks; the additional interpretation requires the victim's spreadsheet import.

Assigned dedup-0013 source-reported static validation: Verified crm.write gating for customer creation/update, normal text normalization and database insertion, unchanged server-to-renderer mapping, raw paginated customer export, and formula-preserving CSV encoder. CSV quotes do not neutralize a leading equals formula. The attack crosses from another user's stored CRM data into a victim's spreadsheet; JSON exports and ordinary React rendering are not this sink.

**Grenzen laut Worker:**

- No CSV was generated or opened, no spreadsheet/formula execution, and no application tests were run.
- External network functions and other effects depend on spreadsheet settings/version and are not established here.
- No spreadsheet or application execution.
- Victim must choose CSV and open it with formula evaluation enabled.
- No claim of automatic command execution or network exfiltration.
- No application execution or production testing.

**Gegenbelege laut Worker:**

Keine Angabe.

**Vorgeschlagene Korrektur, nicht als umgesetzt bestätigt:**

Neutralize spreadsheet formula prefixes for text fields at the CSV export boundary, including relevant leading whitespace/control characters; retain numeric types and consider typed spreadsheet cells for exact data preservation. Apply centrally to all CSV exports while preserving stored CRM strings and legitimate numeric types.

**Vorgeschlagene Regressionstests, nicht als ausgeführt bestätigt:**

- Assert formula-leading text exports as literal text, including =, +, -, @ and leading control/whitespace cases.
- Retain delimiter/quote/newline escaping and legitimate negative-number behavior; cover task, customer and deal exports.
- Verify customer strings beginning with =, +, -, @ and relevant leading control characters remain literal text after export.
- Cover delimiter/quote/newline escaping and legitimate numeric values.
- Formula prefixes =,+,-,@ and leading whitespace/control variants render as text; numeric values and CSV quoting remain correct.

### 44. Read-only mailbox delegates can change account credentials, connection settings and message state

Worker-Kennung: authorization.desktop-readonly-mutations.

**Status:** offen; keine Behauptung einer Behebung im PR.

**Gemeldete Einstufung:**

- **level**: medium
- **rationale**: Substantial integrity/availability impact to a delegated mailbox; medium likelihood because an authenticated profile with a mailbox grant is required.

**Gemeldete Nachweissicherheit:**

- **level**: high
- **rationale**: Verified schema, resolver, access ranks, handler options and actual credential/SQL mutation paths.

**Beschreibung:**

The shared IPC wrapper defaults accountAccess to ro. UpdateAccount and SoftDeleteMessage resolve their account but do not override this default, so a read-only delegate can replace saved credentials/settings and alter message state.

**Quellorte des Ausgangsstands:** `electron/ipc/register.ts:49`, `electron/auth/account-access.ts:1`, `electron/ipc/email.ts:324`, `electron/email/email-store.ts:280`, `electron/ipc/email.ts:2093`, `electron/email/email-store.ts:1956`

**Gemeldete Ursache:**

Read permission is used as the default authorization level for write and account-management handlers.

**Prüfmethode laut Worker:**

independent static source trace

**Validierungszusammenfassung laut Worker:**

UpdateAccount schema accepts host/password changes (shared/ipc/email-schemas.ts162-198); object.id resolves account. Auth rank grants ro access, handler saves supplied IMAP/SMTP secrets and SQL persists settings (email-store.ts348-353). SoftDeleteMessage is a recognized message-ID channel and mutates mail state after the same ro gate.

**Grenzen laut Worker:**

- Static validation only.

**Gegenbelege laut Worker:**

- Profiles without a grant are denied on these correctly resolved paths.
- Owner/admin bypass is intentional; the defect affects ordinary ro delegates.
- Prepared SQL/whitelisted field names rule out SQL injection here.
- No credential transmission or mutation executed; downstream exfiltration through changed endpoints is not required for this claim.

**Vorgeschlagene Korrektur, nicht als umgesetzt bestätigt:**

Require an explicit authorization level on every mutating channel: rw for message mutations and a defined mailbox-management/admin permission for credentials and connection settings. Avoid a permissive read default for mutations.

**Vorgeschlagene Regressionstests, nicht als ausgeführt bestätigt:**

- Invoke actual wrapped channels with ro, send_only, rw and admin sessions; verify denied credential/settings/message mutations have no side effects.
- Verify authorized rw message updates and authorized mailbox management continue to work.

### 45. WebSocket events disclose workflow and automation metadata denied by HTTP routes

Worker-Kennung: missing-authorization.server-event-metadata.

**Status:** offen; keine Behauptung einer Behebung im PR.

**Gemeldete Einstufung:**

- **level**: low
- **rationale**: Same-workspace descriptive metadata exposure only; no secrets or full content. Reduced for limited impact and internal boundary.

**Gemeldete Nachweissicherheit:**

- **level**: high
- **rationale**: Independently traced live/replay delivery and concrete KB name/description, chunk title/sourcePath and key label/scopes publishers. Authentication/workspace checks hold; mail events are separately authorized and CRM reduced. The reported leak is descriptive metadata only, not key secrets, full graph or document bodies.

**Beschreibung:**

An authenticated same-workspace user lacking workflows.view or owner/admin authority receives protected workflow names/trigger/account associations, knowledge-base names/descriptions, chunk titles/source paths, and automation-key labels/scopes/revocation metadata through live or replayed WebSocket events. No plaintext key, full graph or document body disclosure is asserted.

**Quellorte des Ausgangsstands:** `packages/server/src/mail-access/async-policy-enforcer.ts:1110`, `packages/server/src/api/fastify-adapter.ts:239`, `packages/server/src/api/fastify-adapter.ts:330`, `packages/server/src/api/workflow-runtime-routes.ts:104`, `packages/server/src/api/workflow-runtime-routes.ts:1920`, `packages/server/src/api/workflow-runtime-routes.ts:1985`, `packages/server/src/api/automation-routes.ts:43`, `packages/server/src/api/automation-routes.ts:183`, `packages/server/src/db/postgres-event-port.ts:49`, `packages/server/src/db/postgres-event-port.ts:102`

**Gemeldete Ursache:**

The socket authenticates and restricts workspace, then sends each event through filterMailEventForPrincipal. Its no-mail-policy fallback returns every recognized event unchanged. Workflow/knowledge and automation-key events are recognized non-mail families with descriptive payloads, but their HTTP readers require workflows.view or admin.

**Prüfmethode laut Worker:**

static source trace and active counterevidence review

**Validierungszusammenfassung laut Worker:**

Independently traced live/replay delivery and concrete KB name/description, chunk title/sourcePath and key label/scopes publishers. Authentication/workspace checks hold; mail events are separately authorized and CRM reduced. The reported leak is descriptive metadata only, not key secrets, full graph or document bodies.

**Grenzen laut Worker:**

- No runtime/production execution or network access.
- Production exposure, tenancy and optional feature configuration remain unspecified.

**Gegenbelege laut Worker:**

- Authentication and workspace isolation enforced
- Mail events filtered
- CRM bodies minimized
- AI metadata HTTP intentionally session-accessible, excluded
- No secrets, graph or full body leak

**Vorgeschlagene Korrektur, nicht als umgesetzt bestätigt:**

Authorize every event family before both live and replay delivery: workflow read capability for workflow/knowledge events and admin for automation-key events; prefer minimal invalidations.

**Vorgeschlagene Regressionstests, nicht als ausgeführt bestätigt:**

- A user without workflows.view receives no protected workflow/knowledge metadata in live or replay events.
- A non-admin does not receive automation key labels/scopes; mail and workspace checks remain enforced.

### 46. A mailbox backlog can exhaust server memory during IMAP synchronization

Worker-Kennung: resource-exhaustion.imap-batch-buffering.

**Status:** offen; keine Behauptung einer Behebung im PR.

**Gemeldete Einstufung:**

- **level**: medium
- **rationale**: High impact with medium/unknown deployment likelihood or prerequisites. Enabled mail-sync worker; Configured IMAP account; Provider quotas and accumulation determine trigger volume

**Gemeldete Nachweissicherheit:**

- **level**: high
- **rationale**: Traced production handler and server worker wiring, full-source loop, later parse loop and delayed cursor writes. Sequential fetching, account locks and per-message oversized UID tracking do not release the accumulating buffers. A single mailbox suffices; volume/provider quotas and process limits determine exhaustion.

**Beschreibung:**

Server IMAP synchronization retains every fetched full message source before parsing and persistence. Many individually valid messages can exhaust the shared API process's memory; delayed cursor updates may cause the same backlog to be retried after a crash. The first-sync 2,000-message cap and 80 MiB per-message cap do not bound aggregate bytes, and incremental/full-inbox selection has no count cap.

**Quellorte des Ausgangsstands:** `packages/server/src/mail-sync.ts:587`, `packages/server/src/jobs/production-handlers.ts:255`, `packages/server/src/mail-sync.ts:335`, `packages/server/src/mail-sync.ts:538`, `packages/server/src/mail-sync.ts:615`, `packages/server/src/mail-sync.ts:698`, `packages/server/src/server.ts:420`, `packages/server/src/server.ts:1911`, `packages/core/src/email/inbound-message-size.ts:1`, `packages/server/src/mail-sync.ts:478`, `packages/server/src/mail-sync.ts:579`, `packages/server/src/mail-sync.ts:637`, `packages/server/src/mail-sync.ts:63`

**Gemeldete Ursache:**

syncImapFolder fetches each pending full RFC822 source into fetchedMessages and retains every buffer. Parsing/persistence begins only after the entire fetch loop finishes; progress is written after processing. The 80 MiB check applies per message and the initial count cap does not bound aggregate bytes; incremental/full inbox selection has no count cap.

Assigned dedup-0010 synthesis: Incoming confirms optional active IMAP worker, quotas/memory prerequisites, initial 2000-message default and 80MiB individual raw cap. Bound individual allocation and aggregate retention, checkpoint safe progress and prevent malformed/oversized message blocking. Server POP3 per-message processing does not fix separately retained desktop IMAP/POP3 attachments.

Assigned dedup-0017 synthesis: Exact server fetchedMessages full-source retention before processing/cursor persistence. Retained incremental or aggregate-byte-bounded processing covers initial/full/incremental modes. Desktop attachment-array instances stay distinct.

**Prüfmethode laut Worker:**

static source trace and active counterevidence review

**Validierungszusammenfassung laut Worker:**

Traced production handler and server worker wiring, full-source loop, later parse loop and delayed cursor writes. Sequential fetching, account locks and per-message oversized UID tracking do not release the accumulating buffers. A single mailbox suffices; volume/provider quotas and process limits determine exhaustion.

Assigned dedup-0010 source 16, source-reported static validation: Verified mail-sync.ts:531-717, raw size guard, production-handlers.ts:184-186,255-262 and server worker wiring at server.ts:422-444,1911-1918. Initial count defaults to 2000; incremental UID range is uncapped. POP3 processes individually and does not mitigate the separate IMAP implementation. Cursor/pending persistence at :698-713 occurs after the full batch, making repeat failure plausible.

**Grenzen laut Worker:**

- No runtime/production execution or network access.
- Production exposure, tenancy and optional feature configuration remain unspecified.
- Worker/IMAP synchronization must be enabled and run; Compose jobs are optional.
- Actual threshold depends on mailbox limits, message volume and memory.
- No runtime or production test performed.
- Incoming confirms optional active IMAP worker, quotas/memory prerequisites, initial 2000-message default and 80MiB individual raw cap. Bound individual allocation and aggregate retention, checkpoint safe progress and prevent malformed/oversized message blocking. Server POP3 per-message processing does not fix separately retained desktop IMAP/POP3 attachments.

**Gegenbelege laut Worker:**

- Initial count cap not aggregate-byte limit
- Sequential fetch retains buffers
- Account locks/concurrency don't bound single batch
- Oversized UID applies per message
- SMTP listener caps different path

**Vorgeschlagene Korrektur, nicht als umgesetzt bestätigt:**

Fetch, parse and persist incrementally or enforce both count and aggregate-byte budgets per batch; release buffers promptly and checkpoint cursor progress between bounded batches. Bound individual fetch allocation, preserve progress for malformed/oversized inputs, and cover initial/full-inbox and incremental modes; desktop attachment-array instances require separate fixes.

**Vorgeschlagene Regressionstests, nicht als ausgeführt bestätigt:**

- Many individually valid messages keep peak retained raw bytes within a configured budget.
- Incremental, first-sync and fullInbox modes persist progress between bounded batches.
- A large incremental backlog keeps retained memory within a fixed byte budget.
- Initial and full-inbox modes enforce the same budget.
- A failure resumes after committed progress without repeatedly accumulating the entire backlog.

### 47. Desktop workflow authoring and backfill/webhook triggers lack privileged authorization

Worker-Kennung: authorization.desktop-workflow-authoring.

**Status:** offen; keine Behauptung einer Behebung im PR.

**Gemeldete Einstufung:**

- **level**: medium
- **rationale**: High impact to local CRM data and host-account resources; conditional on lower-trust desktop application users and Python availability. Local deployment and absent OS-user isolation reduce likelihood to medium.

**Gemeldete Nachweissicherheit:**

- **level**: high
- **rationale**: Independent current-source dataflow and counterevidence review; deployment prerequisites explicitly retained; no runtime reproduction.

**Beschreibung:**

Desktop workflow create, update, import and restore operations accept any authenticated session. A viewer can activate a scheduled workflow whose Python node runs under the Electron host account, bypassing the owner/admin check on manual execution. Additional trigger paths: session-only backfill clears inbound applied markers and reruns existing enabled workflows across all message IDs; FireWebhookWorkflow secret is disclosed/replaced via global settings. These preserve execution authority beyond direct manual execution and authoring. Independently, session-only DeleteWorkflow permits unauthorized removal; creation/activation authorization alone does not close deletion.

**Quellorte des Ausgangsstands:** `electron/ipc/email.ts:566`, `electron/ipc/register.ts:72`, `electron/email/email-imap-services.ts:276`, `electron/email/email-workflow-engine.ts:600`, `electron/workflow/nodes/code-nodes.ts:77`, `electron/ipc/email.ts:590`, `electron/ipc/workflow.ts:135`, `electron/ipc/workflow.ts:234`, `electron/ipc/workflow.ts:505`, `electron/ipc/email.ts:2570`, `electron/ipc/email.ts:1065`, `electron/ipc/workflow.ts:186`, `electron/ipc/email.ts:564`, `electron/workflow/nodes/code-nodes.ts:9`

**Gemeldete Ursache:**

The IPC framework makes role checks opt-in. Workflow writes omit that option and persist executable graph/configuration and scheduling state; cron loads that state without an author check and dispatches code nodes with host-process authority. The source additionally reports that session-only BackfillInboundWorkflows clears inbound applied markers and reruns existing enabled rules across all message IDs, while FireWebhookWorkflow accepts a secret exposed/replaced by global settings. These are separate activation controls, even for a workflow authored by an authorized administrator.

Assigned dedup-0015 synthesis: Incoming source includes independently reachable unauthorized DeleteWorkflow as well as executable CRUD/import/restore/cron. This existing broader identity explicitly authorizes deletion as well as authoring, activation, backfill and webhook triggers; the narrower scheduled-code identity alone does not cover deletion. Preserve old retrigger/secret controls.

**Prüfmethode laut Worker:**

independent static source trace

**Validierungszusammenfassung laut Worker:**

Independently traced create/import, shared role guard, cron registration, schedule execution and Python dispatch. Real login, graph dry-run checks and owner/admin-only manual execution are effective but do not protect authoring and cron activation. Code fields are not interpolated from mail. Python requires python3; trusted JavaScript nodes are also explicitly non-sandboxed, but the finding does not depend on a VM escape.

**Grenzen laut Worker:**

- No application execution, live requests or deployed configuration inspection.
- No live exploit or application code execution.
- Risk depends on a deployment that relies on desktop roles to restrict a renderer user; a user already controlling the OS account gains no additional OS privilege.

**Gegenbelege laut Worker:**

Keine Angabe.

**Vorgeschlagene Korrektur, nicht als umgesetzt bestätigt:**

Enforce trusted-code authoring and activation authority on every desktop workflow mutation, import, version restoration and automation-security setting; authorize deletion separately. Prevent schedules from activating unauthorized configurations. Independently authorize BackfillInboundWorkflows and each affected mailbox before clearing applied markers or rerunning stored workflows. Protect webhook secret reads/changes and authorize FireWebhookWorkflow execution; authorization of an existing workflow's author alone does not authorize an arbitrary caller to retrigger it.

**Vorgeschlagene Regressionstests, nicht als ausgeführt bestätigt:**

- Deny low-role create/update/delete/import/file-import/version-restore and automation-setting changes.
- Ensure rejected configuration cannot be activated by cron.
- An agent/viewer session cannot create, update, import, delete or restore an executable workflow and cannot register a cron job.
- Owner/admin mutations remain functional; rejected imports do not modify workflow state.
- Direct execution and scheduled activation enforce the same authority boundary.

### 48. An already-used TOTP can complete another login challenge

Worker-Kennung: authentication.totp-replay.

**Status:** offen; keine Behauptung einer Behebung im PR.

**Gemeldete Einstufung:**

- **level**: low
- **rationale**: High account-access impact but low likelihood: attacker needs both the password and an observed previously used TOTP within the short acceptance window.

**Gemeldete Nachweissicherheit:**

- **level**: high
- **rationale**: Independent current-source dataflow and counterevidence review; deployment prerequisites explicitly retained; no runtime reproduction.

**Beschreibung:**

TOTP validation checks the time window but does not remember accepted counters. Consuming one MFA challenge leaves the same code usable for a different challenge issued after another password login.

**Quellorte des Ausgangsstands:** `packages/server/src/security/mfa-challenge.ts:26`, `packages/server/src/auth/login-security-service.ts:522`, `packages/server/src/security/totp.ts:19`, `packages/server/src/auth/login-security-service.ts:311`

**Gemeldete Ursache:**

Replay protection is attached to the random challenge token rather than the account's accepted TOTP timestep. The code validation helper is stateless and no caller records or atomically claims the matched counter.

**Prüfmethode laut Worker:**

independent static source trace

**Validierungszusammenfassung laut Worker:**

Parent verified the challenge nonce, verifyUserTotp, verifyTotpCode and successful token-issuance path. Reusing the identical challenge is blocked and attempts are capped; these controls do not share accepted-code state across challenges. Email MFA separately records consumed codes and is not implicated. Static source review only.

**Grenzen laut Worker:**

- No application execution, live requests or deployed configuration inspection.

**Vorgeschlagene Korrektur, nicht als umgesetzt bestätigt:**

Atomically claim a matched TOTP counter per account/authenticator before token issuance, rejecting counters already consumed across all challenges and replicas.

**Vorgeschlagene Regressionstests, nicht als ausgeführt bestätigt:**

- Two distinct challenges using the same valid TOTP must yield at most one authenticated session, including concurrent requests.

### 49. Desktop object-ID operations bypass mailbox ownership checks

Worker-Kennung: authorization.desktop-object-account-scope.

**Status:** offen; keine Behauptung einer Behebung im PR.

**Gemeldete Einstufung:**

- **level**: medium
- **rationale**: High cross-account confidentiality/integrity impact, constrained to authenticated desktop users; useful object ID or pending draft required for specific operations.

**Gemeldete Nachweissicherheit:**

- **level**: high
- **rationale**: Parent independently traced current source and counterevidence. No runtime reproduction.

**Beschreibung:**

Authenticated desktop users can bypass mailbox ownership checks through attachment IDs, account deletion, bulk/single draft actions, pending-draft approval/dismissal, thread lookups, internal-note/configuration IDs, and workflow knowledge-base IDs. These routes skip unresolved account checks and access globally stored objects, enabling cross-account disclosure, modification, deletion and sending. Global cross_account alias warnings can disclose usable thread IDs; the details query returns m.* without per-message readable-account filtering, without assuming UUID guessing.

**Quellorte des Ausgangsstands:** `electron/ipc/email.ts:2810`, `electron/ipc/email.ts:2832`, `electron/ipc/ipc-account-scope.ts:77`, `electron/email/email-message-attachments-store.ts:26`, `electron/ipc/email.ts:408`, `electron/email/email-store.ts:523`, `electron/ipc/email.ts:1608`, `electron/email/email-crm-store.ts:285`, `electron/ipc/email.ts:1663`, `electron/email/email-crm-store.ts:440`, `electron/email/email-crm-store.ts:533`, `electron/ipc/email.ts:2353`, `electron/email/email-spam-store.ts:95`, `electron/email/email-spam-store.ts:156`, `electron/ipc/email.ts:2101`, `electron/email/email-store.ts:1567`, `electron/email/email-store.ts:1677`, `electron/email/email-store.ts:1945`, `electron/ipc/workflow.ts:289`, `electron/workflow/draft-approval-actions.ts:23`, `electron/workflow/draft-send-prep.ts:69`, `electron/ipc/email.ts:3024`, `electron/email/email-thread-aggregate.ts:128`, `electron/email/email-thread-resolve.ts:5`, `electron/ipc/workflow.ts:414`, `electron/workflow/knowledge-base.ts:68`, `electron/workflow/knowledge-base.ts:84`, `electron/workflow/knowledge-base.ts:136`, `electron/ipc/workflow.ts:319`, `electron/ipc/ipc-account-scope.ts:91`, `electron/ipc/ipc-account-scope.ts:120`, `electron/ipc/register.ts:79`, `electron/ipc/email.ts:3020`, `electron/ipc/email.ts:3068`, `electron/email/email-thread-heuristics.ts:101`, `electron/email/email-thread-resolve.ts:1`

**Gemeldete Ursache:**

The generic IPC account resolver returns no account for unrecognized object identifiers and namespaces; the wrapper then skips account authorization. Handlers/stores trust supplied IDs or optional replacement scopes instead of resolving existing ownership. The supplied grouped operations explicitly include canonical/alias thread lookup and warnings, omitted-scope knowledge-base enumeration, direct document/chunk reads and saves, and ID-only create/update/delete/add/import/export. Canned/AI-prompt all-scope lists correctly return global rows only; no corresponding all-account listing leak is asserted. Existing-owner and destination/global authority must be checked separately.

Assigned dedup-0015 synthesis: Same unscoped thread canonical/alias query and global cross_account warning collection. Existing complete resource policy filters every returned message and alias/warning metadata by authenticated readable accounts. Warning-disclosed thread IDs strengthen reachability without assuming UUID guessing; scoped listing/privileged merge-split do not protect details.

**Prüfmethode laut Worker:**

independent static source trace

**Validierungszusammenfassung laut Worker:**

Parent traced both handlers, central resolver and ID-only lookup. Real login, risky-file confirmation and save-dialog selection remain effective, but none authorizes the mailbox. Listing attachments is separately scoped and does not protect guessed direct IDs. Account deletion and child-object mutations independently verified and grouped because they share the same unresolved-owner skip and remedy.

**Grenzen laut Worker:**

- Source only; real deployment not inspected.
- Known foreign/shared thread identifier required; arbitrary thread enumeration is not established. Earlier aggregate reports random96-bit thread IDs; numeric-ID observations do not generalize to threads.
- This indivisible source bundle overlaps established mail-ID and template findings but adds independently reachable knowledge/configuration operations. Output counts are not disjoint root-cause counts.
- No application execution or production testing.
- Requires a real authenticated desktop session and direct IPC access.

**Gegenbelege laut Worker:**

Keine Angabe.

**Vorgeschlagene Korrektur, nicht als umgesetzt bestätigt:**

Make protected IPC object resolution explicit and fail closed. Derive account ownership from every stored attachment/account/message/note/configuration object and authorize read/write/management against that owner before accessing it. Separately authorize scope transfers; filter collections by authenticated account scope. Include batch-message/draft IDs, thread aliases, workflow draft approval and knowledge-base namespaces; never treat unresolved scope as implicitly global. For workflow knowledge bases, authorize omitted-scope lists, direct document/chunk reads/writes and create/update/delete/add/import/export independently; numeric derived filenames and dialogs are not account authority. Preserve correct global-only canned/prompt listing behavior and constrain alias/warning collections to authorized messages.

**Vorgeschlagene Regressionstests, nicht als ausgeführt bestätigt:**

- Exercise authorization.desktop-attachment-owner with an unauthorized actor or bounded-input regression and assert no protected sink executes.
- Cross-account canonical and alias threads must return only authorized messages; warnings must not reveal inaccessible IDs.

### 50. Deleting an account can erase another mailbox's attachments

Worker-Kennung: data-isolation.attachment-cleanup-identifier.

**Status:** offen; keine Behauptung einer Behebung im PR.

**Gemeldete Einstufung:**

- **level**: low
- **rationale**: Cross-account file loss is real but requires an account/message ID collision and an account deletion; typically a privileged workflow once the separate authorization defect is fixed.

**Gemeldete Nachweissicherheit:**

- **level**: high
- **rationale**: Parent independently traced current source and counterevidence. No runtime reproduction.

**Beschreibung:**

Attachment files are stored in directories named by message ID, but account cleanup additionally removes a directory named by account ID. A numeric collision deletes an unrelated message's files. Independent account/message sequences permit account 2 to coexist with message 2 in account 1; deleting account 2 removes that surviving message directory while its row remains.

**Quellorte des Ausgangsstands:** `electron/email/email-message-attachments-store.ts:84`, `electron/email/email-store.ts:523`, `electron/email/email-message-attachments-store.ts:354`, `electron/email/email-message-attachments-store.ts:90`, `electron/email/email-message-attachments-store.ts:355`, `electron/database-schema.ts:274`, `electron/database-schema.ts:319`, `electron/ipc/email.ts:408`

**Gemeldete Ursache:**

Two independent numeric identifier namespaces are used interchangeably for the same filesystem path. The additional accountDir removal is not derived from the account-scoped attachment query.

Assigned dedup-0013 synthesis: Same accountId-derived recursive deletion in messageId attachment namespace. Removing that deletion and selecting only account-owned message directories subsumes both. Independent AUTOINCREMENT sequences allow account 2 to collide with message 2 in account 1. No direct ID control, traversal or inevitable permanent loss established; survives authorization repair and can occur during legitimate cleanup.

Assigned dedup-0014 synthesis: Same accountId directory removal inside messageId attachment namespace. Removing that deletion and limiting cleanup to proven owned messages covers incoming collision. Survives proper account-deletion authorization; legitimate deletion also triggers, no arbitrary traversal or inevitable permanent loss.

**Prüfmethode laut Worker:**

Source-reported validation preserved; dedup-0013 performs supplied-artifact semantic reduction only

**Validierungszusammenfassung laut Worker:**

Parent inspected storage layout and complete purge function plus caller. The initial join and row unlink are properly account-scoped. The later rm of attachmentsRoot/accountId is independent and can remove a surviving message's directory; no deployed collision was inspected.

Assigned dedup-0013 source-reported static validation: Verified account and message IDs use independent SQLite AUTOINCREMENT sequences. Account 2 can coexist with message 2 belonging to account 1; deleting account 2 removes the message-2 directory even though the row-scoped purge correctly selected only account-2 attachments. This is distinct from the missing account authorization: authorizing only the selected account would not repair the wrong resource selection.

**Grenzen laut Worker:**

- Source only; real deployment not inspected.
- No application execution.
- No claim that recoverable original messages are permanently lost.

**Gegenbelege laut Worker:**

- Collision required; IDs are not directly attacker-selected.
- Direct file-unlink query is correctly scoped to account.
- If deletion is restricted to globally privileged users this becomes functional data loss rather than independent privilege escalation; currently authenticated desktop users can reach it.
- No traversal, symlink or arbitrary file deletion outside the attachment namespace established.

**Vorgeschlagene Korrektur, nicht als umgesetzt bestätigt:**

Remove the accountId-derived recursive deletion; delete only directories proven to belong to the account's messages and preserve directories referenced by surviving messages. Verify attachment-root containment and preserve surviving-message files even when the deleted account has no attachments.

**Vorgeschlagene Regressionstests, nicht als ausgeführt bestätigt:**

- Exercise data-isolation.attachment-cleanup-identifier with an unauthorized actor or bounded-input regression and assert no protected sink executes.
- Use two accounts and an attachment-bearing message whose id equals the other account id; deleting that account must leave the unrelated attachment intact.
- Verify deletion removes only selected-account files and safely handles empty accounts.
- Delete account A while message ID A belongs to account B; B files remain.
- Only directories derived from proven owned messages are cleaned.

### 51. Unprivileged desktop users can redirect scanned mail to an external server

Worker-Kennung: authorization.desktop-rspamd-endpoint.

**Status:** offen; keine Behauptung einer Behebung im PR.

**Gemeldete Einstufung:**

- **level**: medium
- **rationale**: High potential confidentiality impact, constrained by authenticated local application access and configured accounts/integrations.

**Gemeldete Nachweissicherheit:**

- **level**: high
- **rationale**: Parent independently traced IPC registration, authorization and credential/data sink statically; no runtime execution.

**Beschreibung:**

A session-only global settings handler lets an ordinary desktop user enable Rspamd and set its URL. Subsequent inbound mail scanning posts the full message to that destination, including messages from accounts the user cannot read.

**Quellorte des Ausgangsstands:** `electron/ipc/ipc-account-scope.ts:1`, `electron/ipc/register.ts:60`, `electron/ipc/email.ts:2340`, `electron/email/mail-security-settings.ts:94`, `electron/email/mail-security-pipeline.ts:51`, `electron/email/rspamd-client.ts:41`

**Gemeldete Ursache:**

Global mail-security settings are writable without role/account checks, while the trusted inbound scanner uses them for all accounts.

**Prüfmethode laut Worker:**

independent static source trace

**Validierungszusammenfassung laut Worker:**

Parent checked the setter can both enable Rspamd and change URL. normalizeRspamdBaseUrl restricts only scheme/host syntax, not who controls the endpoint. The pipeline is called by inbound workflow processing at email-workflow-engine.ts345-346. Disabled-by-default is ineffective because the same caller can enable it. Server edition has separate administrator protection and is not claimed affected.

**Grenzen laut Worker:**

- No application or network execution. Desktop app role boundary; no OS privilege escalation claimed.

**Vorgeschlagene Korrektur, nicht als umgesetzt bestätigt:**

Restrict global scanner destination and enablement changes to an explicit administrator capability; validate destination changes and avoid giving mailbox-level users control over global egress.

**Vorgeschlagene Regressionstests, nicht als ausgeführt bestätigt:**

Nicht angegeben.

### 52. Read-only desktop mailbox grants permit composing and sending mail

Worker-Kennung: authorization.desktop-readonly-mail-write.

**Status:** offen; keine Behauptung einer Behebung im PR.

**Gemeldete Einstufung:**

- **level**: medium
- **rationale**: High account confidentiality/integrity impact; medium likelihood constrained to authenticated local users and configured integrations/mail accounts.

**Gemeldete Nachweissicherheit:**

- **level**: high
- **rationale**: Independent parent static source validation; no runtime execution.

**Beschreibung:**

Users granted only read access can create and edit arbitrary drafts, schedule or retry them, and cause the background sender to send using the mailbox credential. Many other mail mutations inherit the same insufficient access level. The source also enumerates account/credential settings, OAuth completion, message mutations, outbound validation, vacation tests and read-receipt responses; every listed operation needs its own permission classification. Cosmetic seen-state policy remains unresolved. Confirmed single-message paths include soft-delete/restore/archive/done/spam/spam-status with correctly resolved mailbox and insufficient ro.

**Quellorte des Ausgangsstands:** `electron/ipc/register.ts:49`, `electron/ipc/email.ts:678`, `electron/ipc/email.ts:733`, `electron/ipc/email.ts:950`, `electron/ipc/email.ts:1003`, `electron/email/email-scheduled-send.ts:66`, `electron/ipc/email.ts:2092`, `electron/ipc/email.ts:2258`, `electron/ipc/email.ts:2508`, `electron/auth/account-access.ts:13`, `electron/email/email-store.ts:1956`, `electron/email/email-store.ts:1688`, `electron/ipc/register.ts:83`, `electron/auth/account-access.ts:20`, `electron/email/email-store.ts:1965`, `electron/ipc/register.ts:56`, `electron/ipc/email.ts:2093`, `electron/ipc/email.ts:2259`, `electron/auth/account-access.ts:30`, `electron/ipc/register.ts:51`, `electron/auth/account-access.ts:1`, `electron/ipc/ipc-account-scope.ts:1`, `electron/ipc/email.ts:2087`, `electron/ipc/email.ts:699`

**Gemeldete Ursache:**

IPC registration defaults accountAccess to ro. Mutating/scheduling handlers omit an explicit stronger access requirement, and the background sender has no initiating-user authorization context.

Assigned dedup-0010 synthesis: Incoming concretely traces correctly resolved SoftDeleteMessage, RestoreMessage, SetMessageArchived, SetMessageDone, SetMessageSpam and SetMessageSpamStatus. No-grant users denied; ro permits reversible local state mutation, not claimed permanent IMAP deletion. Low final severity/impact and high likelihood plus historical medium rating remain beside broader medium. Cosmetic seen policy remains unresolved.

Assigned dedup-0014 synthesis: Same correctly resolved SoftDeleteMessage accepts ro instead of write. Established explicit operation permissions already include it. No-grant users denied. Incoming low severity/medium impact remains beside broad medium. Missing-ID and scheduled-send defects remain distinct.

Assigned dedup-0015 synthesis: Same correctly resolved SoftDeleteMessage/RestoreMessage inherit ro before shared state mutation. Existing broad ro-mutation identity explicitly requires rw for these exact single-message operations. Missing resource resolution, credential management and deferred sends remain separate required controls; ro/send_only provisioning remains unresolved.

Assigned dedup-0017 synthesis: Resolved-account SoftDeleteMessage and UpdateComposeDraft are established default-ro mutation instances. Explicit per-operation write policy subsumes both; ID resolution alone does not. Keep deferred-send and sibling mutation requirements.

**Prüfmethode laut Worker:**

independent static source trace

**Validierungszusammenfassung laut Worker:**

Parent traced ro rank check, arbitrary compose content, schedule approval/timestamp and background sendComposeDraft. Direct SendCompose explicitly requires rw at email.ts1348, demonstrating the bypass. Outbound workflow checks, valid recipients, transport availability and send locks still apply. Cosmetic seen-state policy is unresolved and is not the basis for this finding.

Assigned dedup-0010 source 3, source-reported static validation: Verified SoftDeleteMessage is in the numeric message resolver set and ro accounts pass its grant comparator. No further authorization exists in setMessageSoftDeleted. Restore/archive/done/spam siblings have the same options. No-grant users are denied on these singular paths; the defect is incorrect access level rather than missing account resolution.

**Grenzen laut Worker:**

- Soft deletion is locally reversible and is not an IMAP permanent-delete claim.
- Other mutation channels not fully traced remain coverage work.
- Incoming concretely traces correctly resolved SoftDeleteMessage, RestoreMessage, SetMessageArchived, SetMessageDone, SetMessageSpam and SetMessageSpamStatus. No-grant users denied; ro permits reversible local state mutation, not claimed permanent IMAP deletion. Low final severity/impact and high likelihood plus historical medium rating remain beside broader medium. Cosmetic seen policy remains unresolved.
- Local application role boundary, not protection against an attacker already controlling the OS profile.
- Other mutation registrations need the same permission audit; only source-traced operations are claimed.
- Assigned worker da079298-f725-4c84-91c6-eac2b54300b1 reports ro/send_only provisioning unresolved and deferred its own provisional account-settings issue. Other sources' retained ro message-mutation findings are not rejected.

**Gegenbelege laut Worker:**

Keine Angabe.

**Vorgeschlagene Korrektur, nicht als umgesetzt bestätigt:**

Set explicit write/send requirements for all mutation handlers, require send authority when scheduling or approving, and retain/revalidate user authority for deferred sends. Audit all listed sibling account mutations. Explicitly include the source's listed message/configuration/OAuth/outbound-validation/vacation-test/read-receipt siblings. Preserve the unresolved cosmetic seen-state distinction instead of treating every read-state change as a proven violation. Explicitly enforce write on SoftDeleteMessage, RestoreMessage, SetMessageArchived, SetMessageDone, SetMessageSpam and SetMessageSpamStatus; test ro and send_only separately.

**Vorgeschlagene Regressionstests, nicht als ausgeführt bestätigt:**

- Deny soft-delete/restore/archive/done/spam for ro grants while permitting genuine reads.
- Confirm rw delegates and owner/admin can perform the intended mutations.
- Verify send_only grants cannot authorize unrelated state mutations.
- Assert ro users cannot trash/restore/update messages while rw users can.
- Audit every mutating channel's required permission with deny-by-default policy.
- With an ro grant, assert soft delete and restore are denied and database state is unchanged.
- Verify the same operations succeed with rw, and audit all mutation registrations for an explicit write requirement.

### 53. Global OAuth and webhook secrets are readable and replaceable by ordinary desktop users

Worker-Kennung: authorization.desktop-global-secret-settings.

**Status:** offen; keine Behauptung einer Behebung im PR.

**Gemeldete Einstufung:**

- **level**: low
- **rationale**: Limited global integration-secret/configuration impact, constrained to local authenticated users; OAuth application secrets are not mailbox tokens.

**Gemeldete Nachweissicherheit:**

- **level**: high
- **rationale**: Independent static source trace; no runtime/network/database test. Deployment prerequisites explicitly stated.

**Beschreibung:**

Dedicated OAuth getters return configured client secrets, and arbitrary Sync.GetInfo can read the same global settings. Webhook settings also expose/replace their secret. These session-only routes bypass the administrator boundary used by generic settings writes.

**Quellorte des Ausgangsstands:** `electron/ipc/email.ts:2635`, `electron/ipc/email.ts:2882`, `electron/ipc/sync.ts:39`, `electron/email/email-imap-auth.ts:49`, `electron/ipc/email.ts:1087`, `electron/ipc/email.ts:1204`, `electron/sync-info-store.ts:1`, `electron/email/email-imap-auth.ts:10`, `electron/email/email-imap-auth.ts:69`, `electron/email/email-webhook.ts:32`, `electron/ipc/register.ts:51`, `electron/ipc/sync.ts:35`, `electron/sqlite-service.ts:1550`, `electron/ipc/email.ts:1062`, `electron/email/email-imap-auth.ts:1`

**Gemeldete Ursache:**

Dedicated global secret settings and generic setting reads lack privileged authorization or secret redaction.

Assigned dedup-0014 synthesis: Same dedicated OAuth/webhook and generic Sync.GetInfo secret reads. Global administration, redaction and public-key allowlist cover every getter, retaining existing write/activation subcases. Rotate exposed secrets; client secret alone is not mailbox token/password access.

Assigned dedup-0017 synthesis: Same Sync.GetInfo secret exposure already covered with dedicated OAuth/webhook getters. Public-setting allowlist, privileged reads and rotation close this credential acquisition chain. Preserve FireWebhookWorkflow, configured secret/enabled incoming workflow and independent HTTP Automation scope; explicit trigger capability is additional defense.

**Prüfmethode laut Worker:**

independent static source trace

**Validierungszusammenfassung laut Worker:**

Parent traced both OAuth settings stores and getters, arbitrary readSyncInfo passthrough, webhook getter/setter, and admin-only Sync.SetInfo. Keytar mailbox tokens are not returned. OAuth native-public-client deployments reduce client-secret value; possession alone does not imply mailbox access.

**Vorgeschlagene Korrektur, nicht als umgesetzt bestätigt:**

Return secret-presence flags to ordinary users, allowlist generic readable settings, and apply consistent integration-administration checks to all dedicated secret reads/writes. Rotate exposed shared secrets after fixing every generic and dedicated getter. Require explicit workflow-invocation capability alongside shared-secret validation; preserve the separate HTTP Automation workflows-scope gate.

**Vorgeschlagene Regressionstests, nicht als ausgeführt bestätigt:**

- Assert ordinary sessions cannot read OAuth/webhook secrets through either generic Sync.GetInfo or dedicated getters.
- Ensure legitimate nonsensitive settings and privileged secret updates still work.

### 54. Optional LAN automation sends reusable API keys over plaintext HTTP

Worker-Kennung: transport.desktop-automation-cleartext.

**Status:** offen; keine Behauptung einer Behebung im PR.

**Gemeldete Einstufung:**

- **level**: low
- **rationale**: Potential high scoped credential/data impact but low likelihood: explicit LAN opt-in and an on-path observer are required.

**Gemeldete Nachweissicherheit:**

- **level**: high
- **rationale**: Independent static source trace; no runtime/network/database test. Deployment prerequisites explicitly stated.

**Beschreibung:**

Enabling the supported LAN bind exposes a plain HTTP API using reusable bearer/X-API-Key authentication. An on-path observer can capture and replay that installation key within its scopes and read returned CRM/mail data.

**Quellorte des Ausgangsstands:** `electron/automation/settings.ts:25`, `electron/automation/server.ts:20`, `electron/automation/server.ts:44`, `electron/automation/auth.ts:26`

**Gemeldete Ursache:**

LAN mode changes only listener address; it supplies no authenticated encryption for reusable credentials or API data.

**Prüfmethode laut Worker:**

independent static source trace

**Validierungszusammenfassung laut Worker:**

Parent read complete server/settings/auth modules. Default disabled/loopback, administrator-only enablement, scoped random keys, timing-safe comparison and optional encrypted tunnels mitigate exposure; native supported LAN transport still sends keys without TLS.

**Vorgeschlagene Korrektur, nicht als umgesetzt bestätigt:**

Keep the native listener on loopback and require an authenticated TLS proxy/tunnel, or enforce TLS for LAN access.

**Vorgeschlagene Regressionstests, nicht als ausgeführt bestätigt:**

Nicht angegeben.

### 55. Backup verification evaluates restored database objects as administrator

Worker-Kennung: privilege-boundary.restore-verification.

**Status:** offen; keine Behauptung einer Behebung im PR.

**Gemeldete Einstufung:**

- **level**: low
- **rationale**: High database privilege impact but low likelihood: requires an attacker-controlled backup to be selected by an operator. Host-root impact is not established.

**Gemeldete Nachweissicherheit:**

- **level**: medium
- **rationale**: Independent static source trace; no runtime/network/database test. Deployment prerequisites explicitly stated.

**Beschreibung:**

Restore imports the dump as the restricted application role, then reconnects as administrator to count relations named by untrusted metadata. A crafted backup can name a restored view whose FROM invokes a SECURITY INVOKER function, causing verification to execute that function with database administrator privileges.

**Quellorte des Ausgangsstands:** `docker/backup-metadata.sh:358`, `docker/backup-metadata.sh:599`, `docker/backup-metadata.sh:669`, `docker/restore.sh:112`, `docker/restore.sh:145`, `docker/restore-drill.sh:122`, `docker/docker-compose.yml:199`

**Gemeldete Ursache:**

Identifier syntax/quoting protects SQL text but not the authority used to evaluate restored objects. Metadata controls the selected relation, and verification uses the admin connection rather than the restricted restore identity.

**Prüfmethode laut Worker:**

independent static source trace

**Validierungszusammenfassung laut Worker:**

Parent checked preflight accepts any valid identifier/numeric count, query_to_xml executes SELECT count(*) against that relation, and both production restore and drill reconnect using admin credentials after app-role import. A volatile set-returning function in a view FROM must be evaluated for the count; use of an unused SELECT output expression would be weaker. Checksums adjacent to an attacker-supplied archive do not authenticate it. Source-validated conditional path, no database execution; runtime confirmation remains a follow-up, not asserted as completed.

**Vorgeschlagene Korrektur, nicht als umgesetzt bestätigt:**

Never evaluate restored objects using the administrator identity. Verify expected ordinary tables under a restricted identity or isolated restore environment; validate relation type/inventory and authenticate backup provenance.

**Vorgeschlagene Regressionstests, nicht als ausgeführt bestätigt:**

Nicht angegeben.

### 56. A valid embedded PGP block authenticates unrelated displayed content

Worker-Kennung: signature.pgp-display-binding.

**Status:** offen; keine Behauptung einer Behebung im PR.

**Gemeldete Einstufung:**

- **level**: medium
- **rationale**: High authenticity/social-engineering impact with medium likelihood: replayed signed material, trusted peer and user-triggered verification required.

**Gemeldete Nachweissicherheit:**

- **level**: high
- **rationale**: Independent source dataflow and counterevidence verified; runtime and production prerequisites not tested.

**Beschreibung:**

Server verification checks an extracted clear-signed block but labels the whole stored message signed_valid. The viewer shows that badge above the original HTML alternative or original text, allowing unsigned content to inherit apparent trusted-signer authenticity.

**Quellorte des Ausgangsstands:** `packages/server/src/pgp/message-crypto-port.ts:850`, `packages/server/src/pgp/message-crypto-port.ts:140`, `packages/server/src/pgp/message-crypto-port.ts:167`, `packages/server/src/pgp/message-crypto-port.ts:804`, `src/components/email/message-viewer.tsx:1467`, `src/components/email/message-viewer.tsx:1575`, `src/components/email/message-viewer.tsx:407`, `packages/server/src/mail-parse.ts:146`, `packages/server/src/pgp/message-crypto-port.ts:835`, `packages/server/src/pgp/message-crypto-port.ts:790`, `packages/server/src/api/pgp-routes.ts:570`, `src/components/email/message-viewer.tsx:1420`, `src/components/email/message-viewer.tsx:764`, `src/components/email/message-viewer.tsx:1459`, `src/components/email/message-viewer.tsx:1570`

**Gemeldete Ursache:**

Signature verification discards content outside the first signed block and ignores the verified plaintext when setting/displaying a message-wide validity indicator.

Assigned dedup-0017 synthesis: Same first-clear-signed substring verification promoted to a global badge over unsigned surroundings/alternate HTML. Exact verified-plaintext presentation subsumes source; trusted/tofu peer, genuine signature and manual verification remain prerequisites.

**Prüfmethode laut Worker:**

independent static source trace

**Validierungszusammenfassung laut Worker:**

Parent traced independent MIME alternatives, signed-block extraction, verified signature and trusted-peer checks, message-wide update and original HTML rendering. Signature crypto works; a previously signed sample from a trusted/tofu peer and recipient-triggered mail.triage verification are required. Sanitization/sandboxing mitigate script execution, not authenticity confusion. Server port is wired when secret storage configured; no cryptographic runtime test performed.

**Vorgeschlagene Korrektur, nicht als umgesetzt bestätigt:**

Display exact verified plaintext in a distinct authenticated view. Never apply whole-message validity to unverified MIME alternatives or surrounding text; label them unsigned or reject a whole-body validity claim.

**Vorgeschlagene Regressionstests, nicht als ausgeführt bestätigt:**

Keine Angabe.

### 57. A user manager in another workspace can prevent an existing user's login

Worker-Kennung: authentication.cross-workspace-email-collision.

**Status:** offen; keine Behauptung einer Behebung im PR.

**Gemeldete Einstufung:**

- **level**: low
- **rationale**: Constrained login availability impact; requires cross-workspace user-management authority in a multi-workspace deployment.

**Gemeldete Nachweissicherheit:**

- **level**: high
- **rationale**: Independent source dataflow and counterevidence verified; runtime and production prerequisites not tested.

**Beschreibung:**

User creation enforces email uniqueness only within a workspace, but global login rejects an email when more than one user row matches. In a deployment with independently administered workspaces, a manager can register another workspace user's email and block that user's password login.

**Quellorte des Ausgangsstands:** `packages/server/src/db/postgres-auth-port.ts:482`, `packages/server/src/db/postgres-auth-port.ts:187`, `packages/server/src/db/postgres-auth-port.ts:1086`, `packages/server/src/api/auth-routes.ts:208`, `packages/server/src/api/auth-routes.ts:369`

**Gemeldete Ursache:**

Workspace-local identity uniqueness conflicts with a global email-only authentication lookup that fails closed on duplicates.

**Prüfmethode laut Worker:**

independent static source trace

**Validierungszusammenfassung laut Worker:**

Parent verified users.manage route binds creation to caller workspace, allows ordinary-user creation without target email confirmation, duplicate search remains workspace-local, and login returns null for2 matching rows. Database unique index0001_server_foundation.ts56 is also workspace-local. Existing sessions not shown revoked; this is login availability, not account takeover. Requires multiple independently administered workspaces sharing the login endpoint; actual deployment tenancy unanswered.

**Vorgeschlagene Korrektur, nicht als umgesetzt bestätigt:**

Bind login to an unambiguous workspace/tenant identifier or enforce an appropriate globally unique verified identity model. Ensure one workspace cannot invalidate another workspace's authentication through local user management.

**Vorgeschlagene Regressionstests, nicht als ausgeführt bestätigt:**

Nicht angegeben.

### 58. Restricted mail delegation managers can revoke broader bindings

Worker-Kennung: authorization.mail-delegation-existing-scope.

**Status:** offen; keine Behauptung einer Behebung im PR.

**Gemeldete Einstufung:**

- **level**: low
- **rationale**: Same-workspace constrained administrative integrity impact. Requires an already delegated manager with suitable held permissions.

**Gemeldete Nachweissicherheit:**

- **level**: high
- **rationale**: Both route variants, production wiring, old/proposed scope guards and full replacement were source-traced; no runtime exercise.

**Beschreibung:**

A non-admin delegation manager restricted to a mailbox subset can replace another ordinary user's broader binding with an explicit permitted subset, removing access the manager is not authorized to administer. The assigned source confirms that both PATCH and POST upsert reach the same destructive replacement; new grants stay within held authority, so the demonstrated effect is unauthorized revocation rather than grant expansion.

**Quellorte des Ausgangsstands:** `packages/server/src/mail-access/postgres-mail-delegation-port.ts:487`, `packages/server/src/mail-access/postgres-mail-delegation-port.ts:605`, `packages/server/src/api/mail-delegation-routes.ts:135`, `packages/server/src/api/mail-delegation-routes.ts:169`, `packages/server/src/mail-access/postgres-mail-delegation-port.ts:425`, `packages/server/src/api/mail-delegation-routes.ts:168`, `packages/server/src/mail-access/postgres-mail-delegation-port.ts:348`, `packages/server/src/mail-access/postgres-mail-delegation-port.ts:401`, `packages/server/src/mail-access/postgres-mail-delegation-port.ts:583`

**Gemeldete Ursache:**

Deletion and constraint-omitting updates check the current target scope, but an explicit constraints value is checked only against the proposed scope. The operation deletes/replaces the existing permission set and constraints, so its authority must cover the old state as well.

Assigned dedup-0015 synthesis: Same POST/PATCH explicit new constraints bypass old binding authorization, replacing permissions/constraints beyond category-restricted manager scope. Existing old-scope plus new-scope authorization subsumes it; require authority over each removed permission. Alternative victim grants, owner/admin target exclusion, workspace RLS and stronger DELETE/empty-replacement checks preserved.

Assigned dedup-0017 synthesis: Same explicit-constraint replacement skips existing binding authorization. Old-state and proposed-state authorization before complete permission/constraint replacement cover POST/PATCH. Unauthorized revocation, not broader attacker read access.

**Prüfmethode laut Worker:**

static source trace

**Validierungszusammenfassung laut Worker:**

POST and PATCH forward explicit constraints (api/mail-delegation-routes.ts:135-204), and production server.ts:622 wires the port. A manager holding metadata.read and delegation.manage restricted to tag sales can replace an ordinary user's unrestricted metadata.read with explicit sales constraints. Constraints subset checks allow the proposed scope; old scope is skipped. Direct deletion of the original binding is correctly denied at port:452-463, but deletion after narrowing succeeds. Workspace/resource checks, privileged-subject exclusion and locks remain effective.

**Grenzen laut Worker:**

- Requires preexisting constrained delegation authority.
- No cross-workspace escalation or extra permission grant asserted.
- No database runtime test.
- Victim must rely on the replaced binding for broader access; independent alternative grants may preserve some visibility.
- Does not target owner/admin subjects, which validateSubject rejects.

**Gegenbelege laut Worker:**

Keine Angabe.

**Vorgeschlagene Korrektur, nicht als umgesetzt bestätigt:**

Authorize modification of the current binding against the actor's management scope for every replacement, regardless of whether new constraints were supplied; separately validate proposed permissions and scope. Authorize every removed permission as well as existing constraints for all POST/PATCH replacements, including explicit new constraints, consistently with DELETE.

**Vorgeschlagene Regressionstests, nicht als ausgeführt bestätigt:**

- A sales-restricted manager cannot PATCH or POST-replace an unrestricted ordinary-user/group binding with explicit sales constraints.
- Direct delete and narrow-then-delete must both fail outside authority.
- Allow permitted changes within existing and proposed scope.
- Give manager category-X authority and victim an unrestricted binding; PATCH/POST with explicit category-X constraints must deny without altering victim access.
- Verify authorized changes inside manager scope still work and DELETE/empty replacement preserve equivalent checks.
- Scoped manager cannot narrow or replace an existing broader binding using explicit constraints.
- Equivalent POST upsert and PATCH fail without changing rows.
- Authorized within-scope replacement and administrator updates succeed.

### 59. Mail synchronization retains unbounded aggregate message data

Worker-Kennung: resource.mail-sync-batch-buffering.

**Status:** offen; keine Behauptung einer Behebung im PR.

**Gemeldete Einstufung:**

- **level**: medium
- **rationale**: High availability impact with medium likelihood: enabled IMAP sync, sufficient accepted mail volume and finite process memory are required. Provider quotas may reduce exposure.

**Gemeldete Nachweissicherheit:**

- **level**: high
- **rationale**: Source shows unbounded incremental UID selection and retained full-message buffers; production worker invokes this path. No runtime exhaustion test.

**Beschreibung:**

An external sender can accumulate individually acceptable messages in a synchronized mailbox. Synchronization retains every raw message buffer before processing any of them, allowing aggregate memory exhaustion in the server process. Desktop IMAP and POP3 similarly retain parsed attachment buffers until all new messages have been fetched, exposing the desktop main process to the same aggregate-memory failure.

**Quellorte des Ausgangsstands:** `packages/server/src/mail-sync.ts:538`, `packages/server/src/mail-sync.ts:587`, `packages/server/src/mail-sync.ts:615`, `electron/email/email-imap-sync.ts:229`, `electron/email/email-pop3-sync.ts:168`

**Gemeldete Ursache:**

The fetch loop obtains complete sources and appends each to fetchedMessages before the parse/persist loop begins. The 80MiB check limits each message only; incremental sync has no message count or aggregate byte budget. Progress is saved after processing, so an OOM can leave the same backlog for retry. Desktop IMAP email-imap-sync.ts:229-240 and POP3 email-pop3-sync.ts:168-178 append parsed attachments to newAfterSync and process only after each fetch loop (:264/:193).

**Prüfmethode laut Worker:**

static source trace

**Validierungszusammenfassung laut Worker:**

Verified mail-sync.ts:531-717, raw size guard, production-handlers.ts:184-186,255-262 and server worker wiring at server.ts:422-444,1911-1918. Initial count defaults to 2000; incremental UID range is uncapped. POP3 processes individually and does not mitigate the separate IMAP implementation. Cursor/pending persistence at :698-713 occurs after the full batch, making repeat failure plausible. Independently checked desktop attachment retention and post-process handoff: IMAP first-sync count2000/incremental uncapped (:142-157), POP3 UIDL list (:100-108), attachment arrays :229-240/:168-178 processed after loops. Desktop raw per-message caps and sequential fetching do not cap retained attachment bytes. Server POP3 raw loop remains separately bounded per message; no server POP3 aggregate-attachment variant asserted.

**Grenzen laut Worker:**

- Worker/IMAP synchronization must be enabled and run; Compose jobs are optional.
- Actual threshold depends on mailbox limits, message volume and memory.
- No runtime or production test performed.
- Desktop variants affect local application availability; server severity reflects shared API/job-process impact.

**Vorgeschlagene Korrektur, nicht als umgesetzt bestätigt:**

Fetch, parse, persist and release messages incrementally or in byte-bounded batches. Bound aggregate pending memory and individual fetch allocation, checkpoint successful progress safely, and ensure malformed/oversized messages cannot block advancement. Apply separately to server raw-source retention and desktop IMAP and POP3 newAfterSync attachment arrays; one fix alone leaves the others reachable.

**Vorgeschlagene Regressionstests, nicht als ausgeführt bestätigt:**

- A large incremental backlog keeps retained memory within a fixed byte budget.
- Initial and full-inbox modes enforce the same budget.
- A failure resumes after committed progress without repeatedly accumulating the entire backlog.
- Desktop IMAP and POP3 release attachment buffers during bounded post-processing batches.

### 60. Tracked relay mail can turn a display name into an unauthorized sender

Worker-Kennung: authorization.relay-display-name-reserialization.

**Status:** offen; keine Behauptung einer Behebung im PR.

**Gemeldete Einstufung:**

- **level**: low
- **rationale**: Optional relay and valid scoped credential are required; impact is limited to unauthorized header identities and depends on downstream acceptance. Envelope remains authorized.

**Gemeldete Nachweissicherheit:**

- **level**: high
- **rationale**: Source and installed mailparser/MIME composer behavior establish the representation mismatch; delivery interpretation not exercised.

**Beschreibung:**

A scoped relay client can submit one authorized From with an address-shaped comma-containing display name. Tracking reconstruction inserts that decoded name unquoted, and the composer splits it into an additional unauthorized From mailbox.

**Quellorte des Ausgangsstands:** `packages/server/src/relay-submission.ts:278`, `packages/server/src/relay-submission.ts:841`, `packages/server/src/relay-submission.ts:485`, `packages/core/src/email/mail-rfc822-compose.ts:250`

**Gemeldete Ursache:**

The relay validates parsed address objects then converts them to a mailbox-list string without quoting display names. The composer splits on unquoted commas before encoding each mailbox. For a display name such as 'other@example.test, Team' on the allowed address, the first address-shaped token is emitted as a separate mailbox.

**Prüfmethode laut Worker:**

static source and installed dependency review

**Validierungszusammenfassung laut Worker:**

Verified parsedAddressEntries and initial count/account match at relay-submission.ts:278-317; tracked branch :485-509 and unquoted helper :841-844. Composer splits commas at core mail-rfc822-compose.ts:256-270 before encodeSingleMailbox :273-309. Its angle-bracket fallback and ASCII quoting run after the destructive split, so they do not prevent this variant. SMTP raw-data writer does not repeat sender checks.

**Grenzen laut Worker:**

- SMTP relay must be enabled and attacker must hold its credential.
- Downstream MTA may reject multiple/ambiguous From; no universal spoof delivery or envelope takeover claimed.

**Vorgeschlagene Korrektur, nicht als umgesetzt bestätigt:**

Preserve structured address objects or quote/escape each display name before constructing any mailbox-list string. Reparse the emitted MIME and enforce exactly one authorized From address.

**Vorgeschlagene Regressionstests, nicht als ausgeführt bestätigt:**

- Tracked HTML with a quoted email-shaped comma display name must retain exactly the authorized address.
- Exercise commas, quotes, escapes and angle brackets in display names.

### 61. Restore and restore-drill execute supplied dump SQL in superuser sessions

Worker-Kennung: privilege.restore-session-superuser.

**Status:** offen; keine Behauptung einer Behebung im PR.

**Gemeldete Einstufung:**

- **level**: medium
- **rationale**: High database/DB-container impact with medium likelihood due to explicit operator consumption of an attacker-supplied backup. No unauthenticated endpoint or host escape.

**Gemeldete Nachweissicherheit:**

- **level**: high
- **rationale**: Verified Compose credentials, PostgreSQL bootstrap role and both restore commands; SET ROLE retains authenticated session identity. No malicious dump executed.

**Beschreibung:**

Compose authenticates dump restoration as the PostgreSQL maintenance superuser and relies on pg_restore --role=simplecrm_app for confinement. Dump SQL can reset that reversible role, including during a drill sharing the production cluster.

**Quellorte des Ausgangsstands:** `docker/docker-compose.yml:199`, `docker/docker-compose.yml:270`, `docker/restore.sh:112`, `docker/restore-drill.sh:118`

**Gemeldete Ursache:**

Restore connections authenticate as simplecrm_admin, the Compose POSTGRES_USER superuser. --role changes active role but not session_user; SQL in the consumed dump can reset the active role to the privileged login. A temporary database on the same cluster does not confine superuser operations.

**Prüfmethode laut Worker:**

static configuration/consumer trace

**Validierungszusammenfassung laut Worker:**

Compose:115-123 bootstraps simplecrm_admin; restore:203 and drill:274 use its credentials with PG_RESTORE_ROLE=simplecrm_app. restore.sh:112-115 and restore-drill.sh:122-125 execute the dump with that connection. Drill derives its DB URL from the same privileged URL (:105), creates a temporary DB (:118-119) and drops it later, but retains cluster authority. --no-owner, archive traversal checks and adjacent optional SHA256 manifests do not restrict dump SQL or authenticate maliciously replaced backups. No app/SQL execution.

**Grenzen laut Worker:**

- Operator must select and consume an attacker-supplied/replaced dump.
- Database superuser can affect cluster and database-container OS account; Docker-host escape not asserted.

**Vorgeschlagene Korrektur, nicht als umgesetzt bestätigt:**

Separate privileged database provisioning from dump execution. Authenticate pg_restore directly as a restricted login without privileged session identity/membership. Run drills on a disposable isolated PostgreSQL instance without production credentials or mounts, and authenticate backup provenance before production restore.

**Vorgeschlagene Regressionstests, nicht als ausgeführt bestätigt:**

- Dump execution session_user is a restricted restore login and cannot regain maintenance privileges.
- Drill has no credentials/connectivity permitting production-cluster changes.
- Integrity/provenance checks reject substituted backups before consuming SQL.

### 62. Inbound ID substrings can merge unrelated desktop conversations

Worker-Kennung: integrity.desktop-thread-reference-substring.

**Status:** offen; keine Behauptung einer Behebung im PR.

**Gemeldete Einstufung:**

- **level**: low
- **rationale**: Integrity impact limited to one configured desktop mailbox. Existing referenced threads and provider acceptance of short identifiers are required.

**Gemeldete Nachweissicherheit:**

- **level**: high
- **rationale**: Verified parser normalization, inbound post-processing, substring SQL and destructive merge; provider handling/runtime not exercised.

**Beschreibung:**

Desktop threading compares sender-controlled message identifiers with substrings of existing References headers. A short accepted identifier can match unrelated conversations and cause their existing messages and ticket assignments to be permanently merged.

**Quellorte des Ausgangsstands:** `electron/email/email-threading-jwz.ts:71`, `electron/email/email-threading-jwz.ts:127`

**Gemeldete Ursache:**

normId trims angle brackets and lowercases any nonempty value. collectRelatedIds includes inbound Message-ID/In-Reply-To/References. INSTR(..., ?) performs substring matching rather than exact normalized reference-token matching, then the merge rewrites all rows in every matched thread.

**Prüfmethode laut Worker:**

static source/dependency trace

**Validierungszusammenfassung laut Worker:**

Mailparser3.9.14 ensureMessageIDFormat :509-522 only wraps nonempty IDs, without syntax/minimum length validation. Desktop IMAP:184-191/POP3:126-133 pass headers into email-sync-post-process.ts:90, which threads before inbound workflows/security :109-120. Thread routine:73-81 matches substrings, :116-143 merges. Bound SQL parameters prevent SQL injection but not semantic overmatching. 64-reference cap does not cap matched existing threads. Server sibling uses exact normalized IDs and correspondent filtering; no server extension.

**Grenzen laut Worker:**

- Requires matching nonempty References on existing threaded messages in same account.
- Upstream provider may reject or normalize malformed short IDs.
- No real-database or runtime reproduction; current tests mock matching results.

**Vorgeschlagene Korrektur, nicht als umgesetzt bestätigt:**

Parse and normalize complete reference tokens and compare exact IDs. Reject malformed IDs and constrain merging by appropriate correspondent/account semantics rather than broad header matches.

**Vorgeschlagene Regressionstests, nicht als ausgeführt bestätigt:**

- Real SQLite fixtures with unrelated References containing common substrings must not merge for a short inbound ID.
- Exact legitimate reply chains still merge as intended and account boundaries remain enforced.

### 63. Workflow graph compilation permits exponential synchronous traversal

Worker-Kennung: resource.workflow-graph-path-expansion.

**Status:** offen; keine Behauptung einer Behebung im PR.

**Gemeldete Einstufung:**

- **level**: medium
- **rationale**: High shared-server availability impact with medium likelihood because workflows.edit is required. No live workflow execution or administrative management permission is needed.

**Gemeldete Nachweissicherheit:**

- **level**: high
- **rationale**: Source establishes repeated branch recurrence, route authorization and lack of work budget. No timing benchmark or malicious graph executed.

**Beschreibung:**

A delegated workflow editor can submit a compact outbound graph whose reconverging branches cause trap validation to revisit the same downstream nodes exponentially, blocking the server event loop.

**Quellorte des Ausgangsstands:** `packages/server/src/api/workflow-routes.ts:274`, `packages/server/src/api/workflow-routes.ts:1613`, `packages/core/src/workflow/graph-validate.ts:681`

**Gemeldete Ursache:**

findOutboundGraphTraps only tracks nodes visited along one path. It walks both yes/no targets independently even when they reconverge or are identical, without memoizing completed (node,holdPath) states or bounding visits. A chain of reconvergent branch nodes doubles recursive work per layer while input size grows linearly.

**Prüfmethode laut Worker:**

static algorithm and route trace

**Validierungszusammenfassung laut Worker:**

POST /api/v1/workflows/compile-graph uses workflows.edit, parses only object/version/nodes/edges and calls compileGraphToDefinition then findOutboundGraphTraps synchronously. Outbound trigger is required. Core compiler:201 only forks condition paths for different targets; same-target branch topology passes compile linearly but validator:703,705 visits it twice per layer. Seen set at validator:669 deduplicates issue output, not traversal. Path-local cycle detection stops cycles but not acyclic repeated paths. Fastify40MiB body cap does not bound exponential work from small graphs; live/admin/enable guards are not on this compile endpoint.

**Grenzen laut Worker:**

- Requires workflows.edit delegated to attacker.
- No runtime timing or process hang measured.
- Other graph entrypoints/helpers were not claimed exhaustively affected.

**Vorgeschlagene Korrektur, nicht als umgesetzt bestätigt:**

Use bounded graph analysis with memoization by relevant node/state and explicit cycle handling; deduplicate equivalent branch targets. Apply node/edge/visit/time budgets before compile/validation, and avoid expanding every path into rules without an output limit.

**Vorgeschlagene Regressionstests, nicht als ausgeführt bestätigt:**

- Reconvergent and identical-target branches scale with graph size, not path count.
- Cycle detection and hold/release correctness remain intact.
- Compile rejects graphs exceeding a deterministic work/output budget before blocking the event loop.

### 64. Workflow previews can perform live category changes and enqueue AI jobs

Worker-Kennung: improper-authorization.

**Status:** offen; keine Behauptung einer Behebung im PR.

**Gemeldete Einstufung:**

- **level**: medium
- **rationale**: Medium integrity/resource impact with an enabled affected workflow reachable by a workflow runner. A routine preview triggers the issue; current mailbox and downstream job ACLs still constrain effects.

**Gemeldete Nachweissicherheit:**

- **level**: high
- **rationale**: Parent independently verified the route, system transaction, complete dry-run switch, live dispatch and persistent category/job sinks; no runtime reproduction.

**Beschreibung:**

A non-admin allowed to run workflows and read a message can preview an enabled workflow containing the legacy set_category or ai.pick_canned node. Those nodes bypass the dry-run simulator and execute in a committing system transaction, allowing category changes without triage permission and real asynchronous jobs.

**Quellorte des Ausgangsstands:** `packages/server/src/workflow-execution.ts:950`, `packages/server/src/workflow-execution.ts:2035`, `packages/server/src/workflow-execution.ts:2190`, `packages/server/src/workflow-execution.ts:2511`, `packages/server/src/workflow-execution.ts:3700`, `packages/server/src/workflow-execution.ts:6635`, `packages/server/src/api/workflow-routes.ts:530`, `packages/server/src/mail-access/policy-manifest.ts:433`

**Gemeldete Ursache:**

The preview handler skips the admin side-effect guard when dryRun is true. The executor relies on a denylist of simulated node types; an unlisted type returns null and continues into live dispatch. It lists email.set_category but not its accepted set_category alias, and omits ai.pick_canned. The normal transaction commits category replacements and job insertions.

**Prüfmethode laut Worker:**

offline static source trace

**Validierungszusammenfassung laut Worker:**

Verified central mail.content.read and workflows.run gates, real dryRun wiring in server.ts:513-528/731-733, the enabled-workflow check, absence of triage enforcement in setWorkflowMessageCategoryPath, and category/job writes. Disabled workflows are skipped; workflows.edit cannot independently activate side-effect graphs. AI continuations preserve other ACL checks, so unrestricted sending is not claimed.

**Grenzen laut Worker:**

- No runtime reproduction.
- Requires an enabled workflow containing a reachable affected node.
- Full downstream AI effect depends on profile/template and actor permissions.

**Vorgeschlagene Korrektur, nicht als umgesetzt bestätigt:**

Normalize aliases before dispatch and fail closed during previews: run only explicitly pure nodes, simulate or reject all mutations, external calls and job creation. Use a rollback-only/read-only database boundary as additional protection.

**Vorgeschlagene Regressionstests, nicht als ausgeführt bestätigt:**

- Preview both category node spellings and assert category rows remain unchanged.
- Preview ai.pick_canned and assert no job/provider call or live continuation is created.

### 65. Desktop mail and whole-installation backup operations bypass authorization

Worker-Kennung: missing-authorization.desktop-mail-secondary-resources.

**Status:** offen; keine Behauptung einer Behebung im PR.

**Gemeldete Einstufung:**

- **level**: medium
- **rationale**: Unauthorized mailbox deletion, attachment disclosure and mail sending have high impact, constrained to an existing local app session and the documented single OS-user installation. Native export/copy dialogs require interaction.

**Gemeldete Nachweissicherheit:**

- **level**: high
- **rationale**: Independent static trace confirms resolver omissions, allowed payload forms and downstream global-ID operations. No OS-user isolation or remote unauthenticated exploit claimed.

**Beschreibung:**

Authenticated nonadmin desktop users can invoke attachment copy/open, numeric account deletion, pending-draft approval and global mail export without target mailbox authorization. The generic gate skips unresolved resource IDs and these handlers add no equivalent check. Whole-installation backup export, preview and restore also lack an owner/admin gate, allowing nonadmin profiles to export or replace the local database and attachments.

**Quellorte des Ausgangsstands:** `electron/ipc/ipc-account-scope.ts:99`, `electron/ipc/register.ts:80`, `electron/ipc/email.ts:409`, `electron/ipc/email.ts:2810`, `electron/ipc/workflow.ts:287`, `electron/workflow/draft-approval-actions.ts:25`, `electron/workflow/draft-send-prep.ts:70`, `electron/email/email-scheduled-send.ts:75`, `electron/ipc/email.ts:2870`, `electron/email/email-gdpr-export.ts:123`, `electron/ipc/email.ts:1133`, `electron/ipc/email.ts:1165`, `electron/email/email-local-backup-export.ts:100`, `electron/email/email-local-restore.ts:376`

**Gemeldete Ursache:**

The shared wrapper authorizes only successfully resolved account IDs. Numeric deletion returns before the object-specific branch; attachmentId is unrecognized; workflow-prefixed draft approval and global export skip resolution. The sinks operate globally by ID or export all mail data. Backup payloads resolve no account and set no privileged-role requirement.

**Prüfmethode laut Worker:**

independent offline static source trace

**Validierungszusammenfassung laut Worker:**

Parent verified wrapper/resolver control flow, attachment global lookup and copy, deletion payload, approval state-to-scheduler path and global archive contents. Same root control affects sibling attachment open/draft dismiss. Parent also independently verified backup IPC gates and full database/attachment export and replacement sinks.

**Grenzen laut Worker:**

- Desktop role usage is unconfirmed; no claim of OS-user isolation.

**Vorgeschlagene Korrektur, nicht als umgesetzt bestätigt:**

Define an exhaustive per-channel resource/action policy and fail closed on missing ownership resolution. Resolve attachment and draft IDs to their account; handle numeric delete correctly. Require appropriate send/admin/write access and scope or restrict whole-mail exports. Require owner/admin for whole-installation backup export, preview and restore.

**Vorgeschlagene Regressionstests, nicht als ausgeführt bestätigt:**

- Nonadmin without target account grant cannot copy/open its attachment, delete it, approve/dismiss its draft or export its data.
- Authorized resource operations and owner exports still work.
- Nonadmin profiles cannot export or restore whole-installation backups; owner operational archive checks remain.

### 66. SMTP connection tests lose the enabled TLS requirement

Worker-Kennung: cleartext-credentials.smtp-test-tls-downgrade.

**Status:** offen; keine Behauptung einer Behebung im PR.

**Gemeldete Einstufung:**

- **level**: medium
- **rationale**: High impact external mailbox credential theft with medium likelihood: requires control of the SMTP network conversation during an explicit-password administrator test. No attacker admin privileges are needed.

**Gemeldete Nachweissicherheit:**

- **level**: high
- **rationale**: Parent traced UI boolean conversion, HTTP mapping, explicit-credential resolution, optional upgrade and password AUTH. No traffic or secrets used.

**Beschreibung:**

When an administrator tests SMTP on port 587 with TLS enabled and an entered password, the UI sends secure=false. Server testing treats STARTTLS as optional and authenticates if the peer does not advertise it, allowing an on-path attacker to obtain the password by suppressing STARTTLS.

**Quellorte des Ausgangsstands:** `src/components/email/settings/smtp-panel.tsx:138`, `src/services/transport/channel-http-registry.ts:1925`, `packages/server/src/api/mail-routes.ts:5051`, `packages/server/src/mail-connection-test.ts:174`, `packages/server/src/mail-connection-test.ts:453`, `packages/server/src/mail-connection-test.ts:599`

**Gemeldete Ursache:**

One secure boolean conflates implicit TLS with a TLS requirement. The UI converts enabled TLS on port587 to false; the test server only upgrades when advertised, unlike the normal send path's required STARTTLS.

**Prüfmethode laut Worker:**

independent offline static source trace

**Validierungszusammenfassung laut Worker:**

Source proves false selects net.connect, EHLO without STARTTLS continues to AUTH PLAIN/LOGIN, and explicit password selects request tls. Normal mail-smtp-send101-102/137-143 separates implicit and required TLS and rejects missing upgrade.

**Grenzen laut Worker:**

- No live SMTP interception or runtime test.

**Vorgeschlagene Korrektur, nicht als umgesetzt bestätigt:**

Preserve separate require-TLS and implicit-TLS fields end to end. Require STARTTLS before authentication on non-465 connections when TLS is enabled, matching the regular sender.

**Vorgeschlagene Regressionstests, nicht als ausgeführt bestätigt:**

- TLS-enabled587 test rejects absent STARTTLS without sending AUTH.
- Implicit465 and verified STARTTLS587 tests still succeed.
- Stored account and explicit-password tests share clear TLS semantics.

### 67. Colliding legacy account IDs disclose a different mailbox identity

Worker-Kennung: incorrect-authorization.mail-account-id-namespace.

**Status:** offen; keine Behauptung einer Behebung im PR.

**Gemeldete Einstufung:**

- **level**: low
- **rationale**: Same-workspace name/address/ID disclosure only, conditioned on a migrated ID collision and restricted delegate. Secrets and configuration are redacted.

**Gemeldete Nachweissicherheit:**

- **level**: high
- **rationale**: Independent parent offline source trace confirms caller, control mismatch and consumer; no runtime reproduction.

**Beschreibung:**

GET account authorization compares the raw URL number as a PostgreSQL account ID, but the read port first interprets it as source_sqlite_id. If these namespaces collide across two accounts, a grant to one account can reveal the other's identity. The assigned source confirms parent-only redaction still exposes account name/address/IDs; credential and connection fields remain redacted.

**Quellorte des Ausgangsstands:** `packages/server/src/mail-access/http-policy-enforcer.ts:866`, `packages/server/src/mail-access/http-policy-enforcer.ts:742`, `packages/server/src/db/postgres-mail-read-ports.ts:519`, `packages/server/src/db/postgres-mail-read-ports.ts:5278`, `packages/server/src/db/postgres-mail-read-ports.ts:5409`, `packages/server/src/mail-access/http-policy-enforcer.ts:724`, `packages/server/src/mail-access/http-policy-enforcer.ts:854`, `packages/server/src/api/mail-routes.ts:1427`, `packages/server/src/db/postgres-mail-read-ports.ts:510`, `packages/server/src/db/postgres-mail-read-ports.ts:5396`

**Gemeldete Ursache:**

The account_parent_aware special case bypasses canonical resolution; authorization and consumption use different namespaces for the same integer.

**Prüfmethode laut Worker:**

independent offline static source trace

**Validierungszusammenfassung laut Worker:**

Parent verified raw account_visible ID, canonical scope comparison, source-ID-first SQL selection and redacted identity fields. Other canonical mail-account resolver ambiguity checks do not mediate this special branch.

**Grenzen laut Worker:**

- Actual migrated colliding account data unverified; no API calls.

**Vorgeschlagene Korrektur, nicht als umgesetzt bestätigt:**

Resolve public identifiers once to an unambiguous canonical account and use that same ID for authorization and data access. Reject conflicting legacy/canonical matches.

**Vorgeschlagene Regressionstests, nicht als ausgeführt bestätigt:**

- Create colliding canonical/legacy IDs; a grant to A must never return B.
- Parent-only visibility and legitimate legacy references still work.
- Colliding id/source_sqlite_id pairs cannot return an unauthorized account.
- Ambiguous IDs are rejected consistently.
- Parent-only child-grant reads still expose only authorized account identity.

### 68. Unbounded SMTP responses can exhaust the server process

Worker-Kennung: resource-exhaustion.smtp-continuation-response.

**Status:** offen; keine Behauptung einer Behebung im PR.

**Gemeldete Einstufung:**

- **level**: low
- **rationale**: Availability impact requires control of a configured SMTP endpoint or pre-STARTTLS network conversation during an ordinary test/send. Shared-process memory exhaustion is plausible; no unauthenticated inbound trigger alone or critical-service impact established.

**Gemeldete Nachweissicherheit:**

- **level**: high
- **rationale**: Independent parent offline source trace confirms caller, control mismatch and consumer; no runtime reproduction.

**Beschreibung:**

SMTP connection testing and normal relay sending retain continuation response lines without byte/count limits. A hostile SMTP peer can keep supplying lines before each per-line timeout, growing memory without a whole-response deadline.

**Quellorte des Ausgangsstands:** `packages/server/src/mail-connection-test.ts:539`, `packages/server/src/mail-connection-test.ts:740`, `packages/server/src/mail-connection-test.ts:673`, `packages/server/src/mail-smtp-send.ts:191`, `packages/server/src/mail-smtp-send.ts:519`, `packages/server/src/relay-submission.ts:584`

**Gemeldete Ursache:**

Both readSmtpResponse loops append every continuation line indefinitely; socket buffers also lack caps. Connect timeout is disabled on connection, and readLine deadlines restart per line.

**Prüfmethode laut Worker:**

independent offline static source trace

**Validierungszusammenfassung laut Worker:**

Parent verified both continuation loops, buffer accumulation, per-line timer cleanup, disabled connection timeout and relay send caller. No outer response bound established in reviewed clients/callers.

**Grenzen laut Worker:**

- No resource exhaustion executed; time/memory threshold depends on deployment.
- Finding concerns concrete SMTP retained lines, not generalized IMAP DoS.

**Vorgeschlagene Korrektur, nicht als umgesetzt bestätigt:**

Enforce maximum line length, total response bytes and continuation count plus a whole-operation deadline in both clients. Destroy the socket immediately on any limit.

**Vorgeschlagene Regressionstests, nicht als ausgeführt bestätigt:**

- Bound continuous valid continuation lines and oversized partial lines.
- Deadlines hold even if a line arrives just before every per-line timeout.
- Ordinary multiline SMTP responses still work.

### 69. Message-less webhook workflows skip draft-target authorization

Worker-Kennung: authorization.webhook-workflow-draft-mutation.

**Status:** offen; keine Behauptung einer Behebung im PR.

**Gemeldete Einstufung:**

- **level**: low
- **rationale**: Same-workspace integrity impact requires a real enabled user with the admin-protected webhook secret and a privileged operator's already-enabled graph with a reachable static draft target. Unauthorized sending and arbitrary payload-selected targets were falsified or not established.

**Gemeldete Nachweissicherheit:**

- **level**: high
- **rationale**: Independent source trace confirms job shape, early return, skipped explicit draft ACL, system-role sink and downstream sending restriction. Real deployment configuration/runtime were not tested.

**Beschreibung:**

A user-attributed webhook workflow without messageId returns from mail authorization before the send_draft target check. A preconfigured graph can mutate another mailbox's draft despite the initiating user's missing mail.draft.edit permission; later checks block unauthorized SMTP but do not undo the draft changes.

**Quellorte des Ausgangsstands:** `packages/server/src/api/workflow-routes.ts:640`, `packages/server/src/api/workflow-routes.ts:684`, `packages/server/src/mail-access/async-policy-enforcer.ts:175`, `packages/server/src/mail-access/async-policy-enforcer.ts:343`, `packages/server/src/mail-access/async-policy-enforcer.ts:750`, `packages/server/src/mail-access/async-policy-enforcer.ts:1407`, `packages/server/src/workflow-execution.ts:5758`, `packages/server/src/workflow-execution.ts:5820`, `packages/server/src/workflow-execution.ts:5846`, `packages/server/src/workflow-execution.ts:5865`, `packages/server/src/workflow-execution.ts:439`, `packages/server/src/workflow-execution.ts:2978`, `packages/server/src/mail-scheduled-send.ts:737`, `packages/server/src/api/settings-routes.ts:327`, `packages/server/src/api/workflow-routes.ts:961`, `packages/core/src/workflow/trigger-utils.ts:33`

**Gemeldete Ursache:**

Resource classification treats workflow.execute without a message as non_mail and returns before authorizing static send_draft targets. The graph may still select and mutate mail drafts, so message-less job shape is not proof of absence of mail side effects.

**Prüfmethode laut Worker:**

independent static source trace

**Validierungszusammenfassung laut Worker:**

Confirmed webhook queues actor-attributed execution without message/delayed IDs or manual-admin marker; resource resolver selects non_mail, skipping the explicit send_draft mail.draft.edit guard. Worker dispatch preserves actor context and executor uses a system transaction. sendWorkflowDraft accepts a static configured draft, clears hold/schedules in both review branches, and the default branch rewrites body/subject and approval state. Later scheduled-send checks reauthorize the actor before SMTP and do not roll back the committed mutation.

**Grenzen laut Worker:**

- No application, worker, database or network execution.
- Graph and delegated secret possession are necessary configuration prerequisites.

**Gegenbelege laut Worker:**

- Normal user requires webhook secret, readable/changeable only by admins.
- Enabled side-effect graph requires workflows.manage.
- No direct body-to-arbitrary draft.id dataflow established; finding uses preconfigured static target.
- Real current actor is reloaded; disabled/deleted actors rejected.
- Target is constrained to a same-workspace draft with negative UID.
- SMTP sending is subsequently permission-checked.

**Vorgeschlagene Korrektur, nicht als umgesetzt bestätigt:**

Run the send-draft target authorization for every user-attributed workflow.execute before the non_mail early return, alongside the existing create-draft account guard. Retain downstream SMTP reauthorization.

**Vorgeschlagene Regressionstests, nicht als ausgeführt bestätigt:**

- Queue message-less webhook workflow as a user without draft-edit permission and assert no draft or approval marker mutation.
- Cover both runOutboundReview values, absent/revoked grant, static and dynamic targets, and authorized invoker success.

### 70. GDPR export exposes message snippets without content-read permission

Worker-Kennung: missing-authorization.server-export-content.

**Status:** offen; keine Behauptung einer Behebung im PR.

**Gemeldete Einstufung:**

- **level**: low
- **rationale**: Limited body snippets are disclosed within an already export-authorized mail scope. A custom delegated permission configuration is required; full message bodies and unrestricted mailbox access are not established.

**Gemeldete Nachweissicherheit:**

- **level**: high
- **rationale**: Independent static caller/control/sink trace; no runtime reproduction.

**Beschreibung:**

A delegated server user granted mail.export for messages can receive their body-derived snippets in messages_index.jsonl even when mail.content.read is absent. The export applies row visibility but does not resolve or redact against the independent content permission.

**Quellorte des Ausgangsstands:** `packages/server/src/mail-access/policy-manifest.ts:358`, `packages/server/src/mail-access/postgres-mail-access-port.ts:159`, `packages/server/src/mail-access/http-policy-enforcer.ts:158`, `packages/server/src/mail-access/http-policy-enforcer.ts:640`, `packages/server/src/mail-gdpr-export.ts:378`, `packages/server/src/mail-gdpr-export.ts:399`, `packages/server/src/mail-parse.ts:165`, `packages/server/src/db/postgres-mail-read-ports.ts:5510`

**Gemeldete Ursache:**

The export route is authorized only by mail.export, and its wrapper resolves attachment scope but no content scope. appendMessageIndex selects and serializes snippet unchanged for every export-visible row.

**Prüfmethode laut Worker:**

static source trace

**Validierungszusammenfassung laut Worker:**

Verified policy manifest, exact-permission grant query, scoped port wrapper, export query and JSONL serialization. mail.export does not automatically imply content.read. Normal message lists separately resolve content scope and redact snippets, demonstrating the boundary. GDPR attachment, internal-note and sensitive-tracking controls remain separate and effective; this finding concerns body-derived snippets only.

**Grenzen laut Worker:**

- No runtime reproduction or application execution.

**Vorgeschlagene Korrektur, nicht als umgesetzt bestätigt:**

Resolve mail.content.read independently for exports, pass that scope into the exporter and redact snippets per row when content is not readable. Preserve export scope for row visibility and independent attachment/note permissions.

**Vorgeschlagene Regressionstests, nicht als ausgeführt bestätigt:**

- Export a message for a delegate with export but no content.read and assert snippet is absent/null.
- Test mixed scopes so only content-readable rows retain snippets and existing attachment/note restrictions remain enforced.

### 71. Default CID image expansion bypasses inbound message size limits

Worker-Kennung: resource-exhaustion.mime-cid-expansion.

**Status:** offen; keine Behauptung einer Behebung im PR.

**Gemeldete Einstufung:**

- **level**: medium
- **rationale**: Automatic processing of externally delivered mail can exhaust memory or hit oversized-string failures despite a bounded raw input. Established impact is availability; exact process failure behavior/deployment isolation is unknown.

**Gemeldete Nachweissicherheit:**

- **level**: high
- **rationale**: Current first-party parser options, installed/locked mailparser 3.9.14 default, base64 conversion and repeated replacement independently inspected; no exploit executed.

**Beschreibung:**

Default mailparser CID conversion replaces every matching HTML reference with the full image data URL. Automatic desktop IMAP, POP3 and recovery plus server parsing can allocate far beyond the bounded raw RFC822 input before parsing returns, without recipient opening.

**Quellorte des Ausgangsstands:** `electron/email/email-sync-post-process.ts:65`, `packages/server/src/mail-parse.ts:122`, `electron/email/email-imap-sync.ts:175`, `electron/email/email-pop3-sync.ts:118`, `node_modules/mailparser/lib/simple-parser.js:16`, `node_modules/mailparser/lib/simple-parser.js:85`, `node_modules/mailparser/lib/mail-parser.js:1090`

**Gemeldete Ursache:**

Raw RFC822 length is capped, but default parser options multiply inline attachment bytes by the number of CID references, with no aggregate expanded-HTML budget.

**Prüfmethode laut Worker:**

independent static source and local dependency trace

**Validierungszusammenfassung laut Worker:**

Verified desktop IMAP/POP3/recovery and server call simpleParser without keepCidLinks. Installed simple-parser defaults it false, generates complete image data URLs and mail-parser replaces every matching cid reference. Deduplicating CID identifiers does not deduplicate output occurrences. This expansion occurs before application attachment/text caps can inspect results. Catching a later error cannot undo allocation; exact uncaught-error handling is not assumed.

**Grenzen laut Worker:**

- Message must reach a configured mailbox or authenticated relay.
- No specific OOM/crash threshold measured.
- No network fetch or script-execution claim.

**Gegenbelege laut Worker:**

- Raw RFC cap enforced.
- CID collection deduplicated but replacements still multiply bytes.
- Only recognized image MIME types; sender can supply.
- No remote fetch/scripts/exact crash threshold claimed.

**Vorgeschlagene Korrektur, nicht als umgesetzt bestätigt:**

Use keepCidLinks with controlled attachment rendering in every desktop IMAP, POP3, recovery and server parser consumer. If expansion is required, enforce a total output-byte budget before replacement including repeated references. Raw input caps and unique-CID deduplication do not bound the expanded HTML.

**Vorgeschlagene Regressionstests, nicht als ausgeführt bestätigt:**

- Repeated references do not expand one image into unbounded duplicated HTML.
- Enforce aggregate image/output budget before allocating output; bounded failures leave parsing service usable.

### 72. Desktop administrators can assign themselves owner authority

Worker-Kennung: privilege-escalation.desktop-admin-owner.

**Status:** offen; keine Behauptung einer Behebung im PR.

**Gemeldete Einstufung:**

- **level**: medium
- **rationale**: Meaningful owner/admin boundary crossing with high destructive privilege gain, but restricted to already privileged desktop administrators; medium severity.

**Gemeldete Nachweissicherheit:**

- **level**: high
- **rationale**: Independent offline source trace of entry points, controls and consumers; no live exploit executed.

**Beschreibung:**

Auth.SaveUser allows an administrator to create or promote an owner without an actor-role check, bypassing owner-only operations after login.

**Quellorte des Ausgangsstands:** `electron/ipc/auth.ts:175`, `electron/auth/auth-store.ts:224`, `electron/ipc/auth.ts:64`, `electron/ipc/maintenance.ts:44`

**Gemeldete Ursache:**

SaveUser permits both owner/admin and passes payload directly to a store that accepts owner role and password replacement without considering acting user or target privilege.

**Prüfmethode laut Worker:**

independent static source trace

**Validierungszusammenfassung laut Worker:**

Verified SaveUser real-session role gate, UPDATE/INSERT role assignment, login role copy and explicit owner-only hard-reset gates. Fresh login supplies changed role. Existing admin capabilities and hard-reset confirmation reduce exposure but do not enforce owner privilege. This does not depend on unresolved concurrent-session revocation.

**Grenzen laut Worker:**

- No application execution or production testing.
- Requires a real authenticated desktop session and direct IPC access.

**Vorgeschlagene Korrektur, nicht als umgesetzt bestätigt:**

Pass actor identity/role into user management. Restrict owner creation, role changes, deactivation and password replacement to owners; preserve at least one active owner.

**Vorgeschlagene Regressionstests, nicht als ausgeführt bestätigt:**

- Admin self-promotion/owner creation/owner password replacement must fail; authorized owner workflows work; last active owner preserved.

### 73. DMARC ingestion lacks a cumulative expanded-data budget

Worker-Kennung: resource-exhaustion.dmarc-cumulative-decompression.

**Status:** offen; keine Behauptung einer Behebung im PR.

**Gemeldete Einstufung:**

- **level**: medium
- **rationale**: High process-availability impact from external sender-controlled compressed inputs; medium likelihood because a matching enabled DMARC workflow and job worker are required.

**Gemeldete Nachweissicherheit:**

- **level**: medium
- **rationale**: Source establishes amplification and retention; actual memory exhaustion threshold was not measured.

**Beschreibung:**

A message with many compressed report attachments can repeatedly consume the full per-file expansion allowance and accumulate retained records in the API process.

**Quellorte des Ausgangsstands:** `packages/server/src/dmarc-ingest.ts:27`, `packages/server/src/dmarc-ingest.ts:145`, `packages/server/src/dmarc/parse-aggregate-report.ts:106`, `packages/server/src/dmarc/parse-aggregate-report.ts:163`, `packages/server/src/db/postgres-dmarc-port.ts:95`, `packages/server/src/workflow-execution.ts:3967`, `packages/server/src/jobs/production-handlers.ts:248`, `packages/server/src/server.ts:409`, `packages/server/src/dmarc/parse-aggregate-report.ts:173`, `packages/server/src/mail-parse.ts:100`, `packages/server/src/mail-sync.ts:2015`

**Gemeldete Ursache:**

The message budget counts only compressed bytes. Each report may expand to32MiB independently; there is no attachment/record/expanded-byte aggregate cap, and summary.records retains parsed records even when persistence deduplicates the report.

**Prüfmethode laut Worker:**

independent static source trace

**Validierungszusammenfassung laut Worker:**

Independent trace verified sync stores repeated attachments separately, ingestion compressed20MiB/file40MiB/message limits, per-report32MiB decompressor, unrestricted record strings/arrays, post-persist unconditional retention, duplicate-store normal return and job execution in API process. Single-report cap and sequential queue are effective but do not bound cumulative retained objects. Extremely large spread arrays may throw, but many smaller reports still amplify. No adversarial file executed.

**Grenzen laut Worker:**

- No application execution or production testing.

**Vorgeschlagene Korrektur, nicht als umgesetzt bestätigt:**

Enforce cumulative expanded-byte, attachment-count and record-count budgets per message; pass remaining budget to decompression, summarize incrementally instead of retaining all records, and isolate resource-intensive parsing.

**Vorgeschlagene Regressionstests, nicht als ausgeführt bestätigt:**

- Many valid compressed reports and duplicate reports must stop at total expansion/record budget; normal reports and per-file oversize rejection still work.

### 74. Failed logout leaves authenticated UI and refresh timer active

Worker-Kennung: session-invalidation.browser-logout-error.

**Status:** offen; keine Behauptung einer Behebung im PR.

**Gemeldete Einstufung:**

- **level**: low
- **rationale**: Limited to shared/unlocked browser access after a failed logout; current-screen disclosure and possible session continuation, no remote authorization bypass.

**Gemeldete Nachweissicherheit:**

- **level**: high
- **rationale**: Independent offline source validation; no live reproduction.

**Beschreibung:**

When server logout rejects, local bearer storage clears but the authenticated React state and current sensitive screen remain, and the existing refresh timer can restore the cookie-backed session.

**Quellorte des Ausgangsstands:** `src/components/auth/auth-context.tsx:438`, `src/services/transport/server-auth-client.ts:389`, `src/components/auth/user-switcher.tsx:15`, `src/components/auth/auth-gate.tsx:70`, `src/components/auth/auth-context.tsx:188`

**Gemeldete Ursache:**

React logout awaits network-backed serverAuth.logout before all state cleanup. Client finally clears token storage but rethrows, skipping React cleanup/navigation and preserving the scheduled refresh effect.

**Prüfmethode laut Worker:**

independent static source trace

**Validierungszusammenfassung laut Worker:**

Verified server-auth-client try/finally, auth-context awaited logout and state-clearing sequence, user-switcher awaited navigation, auth-gate dependency and refresh timer. Successful logout is safe. If server request succeeded before response failure, server revocation still protects later refresh; screen retention remains. No runtime reproduction.

**Grenzen laut Worker:**

- No application execution or production testing.

**Vorgeschlagene Korrektur, nicht als umgesetzt bestätigt:**

Clear authenticated UI/caches and cancel refresh work in a finally block irrespective of revocation response; communicate failed server revocation without leaving authenticated UI active.

**Vorgeschlagene Regressionstests, nicht als ausgeführt bestätigt:**

- Rejected logout must immediately hide protected UI, clear auth state and cancel pending refresh; successful logout still revokes server session.

### 75. Untrusted Authentication-Results headers can become verified mail-security state

Worker-Kennung: authentication-bypass.untrusted-mail-auth-results.

**Status:** offen; keine Behauptung einer Behebung im PR.

**Gemeldete Einstufung:**

- **level**: low
- **rationale**: Medium security-decision integrity impact with constrained likelihood: receiving MTA must retain an attacker-controlled effective header, verification must be unknown/temperror for SPF/DKIM/DMARC, or fail/unknown for ARC, and relevant scoring/workflows must be enabled.

**Gemeldete Nachweissicherheit:**

- **level**: medium
- **rationale**: Both source paths and downstream use confirmed; receiving-MTA header policy and enabled workflow configuration unknown.

**Beschreibung:**

Desktop and server mail verification trust arbitrary Authentication-Results/ARC headers as fallback, allowing retained sender-supplied pass labels to influence spam classification and workflow authentication branches. Assigned source narrows SPF/DKIM/DMARC replacement to unknown/temperror and separately reports ARC failure eligible for fallback.

**Quellorte des Ausgangsstands:** `electron/email/mail-auth-verify.ts:68`, `electron/email/mail-auth-verify.ts:141`, `electron/email/mail-auth-verify.ts:203`, `electron/email/mail-auth-verify.ts:315`, `electron/email/mail-security-pipeline.ts:42`, `electron/email/mail-security-store.ts:27`, `packages/core/src/email/spam-engine.ts:75`, `packages/core/src/email/spam-engine.ts:306`, `electron/workflow/nodes/email-nodes.ts:211`, `packages/server/src/mail-security-check.ts:60`, `packages/server/src/mail-security-check.ts:125`, `packages/server/src/mail-security-check.ts:398`, `packages/server/src/db/postgres-mail-read-ports.ts:4470`, `packages/server/src/workflow-execution.ts:7182`, `packages/server/src/mail-security-check.ts:130`, `packages/server/src/mail-security-check.ts:400`, `packages/server/src/db/postgres-mail-read-ports.ts:2189`, `packages/server/src/db/postgres-mail-read-ports.ts:4473`, `packages/core/src/email/spam-engine.ts:100`, `packages/core/src/email/spam-engine.ts:325`, `electron/email/mail-auth-verify.ts:245`, `electron/email/mail-auth-verify.ts:133`

**Gemeldete Ursache:**

Header parsers accept any authserv-id and unvalidated ARC-Authentication-Results, then merge labels into verified status rather than keeping them advisory. Persisted status is consumed without checking fallback provenance/error.

Assigned dedup-0017 synthesis: Same untrusted Authentication-Results/ARC fallback in both editions. Trusted provenance or separation from verified outcomes closes source. Definite SPF/DKIM/DMARC failures remain; unknown/temperror may be replaced, ARC fail may become pass (+14 to -4), and triple-pass may suppress learned weights while static heuristics remain.

**Prüfmethode laut Worker:**

independent static source trace

**Validierungszusammenfassung laut Worker:**

Independently verified desktop/server parse-and-merge logic, timeout catch fallback, persistence, core spam 'objectively authenticated' branch disabling learned weights, and desktop email.auth_check pass routing. Successful live SPF/DKIM/DMARC fail results are not overwritten; trusted earlier decisive header can preempt attacker header; static spam heuristics/blocklist/Rspamd may still block. Warning text is stored but consumers use merged labels. No spoofed message sent.

**Grenzen laut Worker:**

- No application execution or production testing.

**Vorgeschlagene Korrektur, nicht als umgesetzt bestätigt:**

Trust only results from explicitly trusted ingress MTAs with validated header provenance and stripping of inbound forged headers; validate ARC chains. Keep untrusted advisory results separate and preserve unknown/fail decisions when verification is unavailable.

**Vorgeschlagene Regressionstests, nicht als ausgeführt bestätigt:**

- Forged authserv-id and unvalidated ARC pass cannot override failed/unavailable checks or enable authenticated-only branches; trusted ingress handling remains explicit.

### 76. Workflow read-only MSSQL guards allow SELECT INTO writes

Worker-Kennung: sql-authorization.read-only-select-into.

**Status:** offen; keine Behauptung einer Behebung im PR.

**Gemeldete Einstufung:**

- **level**: low
- **rationale**: Medium database integrity/availability impact with medium likelihood on a constrained integration; requires workflow-author authority and CREATE TABLE/schema rights in the configured external database. Least-privilege database grants prevent the write.

**Gemeldete Nachweissicherheit:**

- **level**: medium
- **rationale**: Current local source and relevant countercontrols were independently traced; exact code evidence was re-read and matched. Confidence in deployment-specific impact is limited by absent runtime reproduction and unanswered deployment/provisioning assumptions. Original investigator assessments are retained.

**Beschreibung:**

Both editions label workflow MSSQL execution read-only but accept SELECT INTO. A workflow author can create and populate persistent tables when the configured database credential has the necessary grants.

**Quellorte des Ausgangsstands:** `packages/server/src/mssql-settings.ts:179`, `packages/server/src/mssql-settings.ts:389`, `packages/server/src/workflow-execution.ts:4153`, `electron/workflow/nodes/integration-nodes.ts:119`, `electron/mssql-keytar-service.ts:574`, `packages/server/src/api/workflow-routes.ts:949`, `packages/server/src/mail-inbound-workflow-enqueue.ts:49`

**Gemeldete Ursache:**

SELECT/WITH prefix tests and forbidden-keyword lists do not define read-only SQL and omit the INTO write construct; execution uses the configured general connection.

**Prüfmethode laut Worker:**

static source trace

**Validierungszusammenfassung laut Worker:**

Independently traced both mssql.query implementations and server jtl.order_context to concrete pool query calls. All permit SELECT ... INTO with no CREATE/INSERT token. Server automatic enabled workflows accept delegated workflows.manage; manual admin controls do not constrain service-triggered execution. JTL placeholders are separately escaped, and no generic placeholder SQL injection is claimed.

**Grenzen laut Worker:**

- Offline static analysis only; no application execution or live reproduction.

**Vorgeschlagene Korrektur, nicht als umgesetzt bestätigt:**

Use a database identity with enforced read-only privileges. Additionally parse SQL into a narrow permitted statement grammar and reject SELECT INTO and all side effects for every read-only entry.

**Vorgeschlagene Regressionstests, nicht als ausgeführt bestätigt:**

Keine Angabe.

### 77. PGP decrypt operations permit unbounded compressed message expansion

Worker-Kennung: decompression.pgp-message-expansion.

**Status:** offen; keine Behauptung einer Behebung im PR.

**Gemeldete Einstufung:**

- **level**: low
- **rationale**: Medium availability impact with medium likelihood: an authorized user must invoke decryption with a private identity/passphrase. No automatic decryption established.

**Gemeldete Nachweissicherheit:**

- **level**: medium
- **rationale**: Current local source and relevant countercontrols were independently traced; exact code evidence was re-read and matched. Confidence in deployment-specific impact is limited by absent runtime reproduction and unanswered deployment/provisioning assumptions. Original investigator assessments are retained.

**Beschreibung:**

Server PGP message and attachment decryption uses buffered OpenPGP input without a finite decompression limit. Compressed attacker content can exhaust process resources when an authorized recipient decrypts it.

**Quellorte des Ausgangsstands:** `packages/server/src/pgp/message-crypto-port.ts:80`, `packages/server/src/pgp/message-crypto-port.ts:223`, `packages/server/src/pgp/message-crypto-port.ts:863`, `node_modules/openpgp/dist/node/openpgp.cjs:1765`, `node_modules/openpgp/dist/node/openpgp.cjs:12750`, `packages/server/src/api/pgp-routes.ts:423`, `packages/server/src/api/pgp-routes.ts:1024`

**Gemeldete Ursache:**

OpenPGP defaults maxDecompressedMessageSize to Infinity and buffers decompressed packets; consumers provide neither a finite parser configuration nor output cap.

**Prüfmethode laut Worker:**

static source trace

**Validierungszusammenfassung laut Worker:**

Independently traced both decrypt calls, input-size checks and installed OpenPGP.js 6.3.1 decompression readToEnd. Source search found no config override. The 25 MiB attachment cap constrains compressed bytes; identity, passphrase, route policy and workspace checks remain requirements. No malicious packet run.

**Grenzen laut Worker:**

- Offline static analysis only; no application execution or live reproduction.

**Vorgeschlagene Korrektur, nicht als umgesetzt bestätigt:**

Set a finite maxDecompressedMessageSize on every parser/decrypt operation, enforce aggregate plaintext/output limits and isolate parsing in a terminable resource-limited worker.

**Vorgeschlagene Regressionstests, nicht als ausgeführt bestätigt:**

Keine Angabe.

### 78. Desktop mail IPC skips authorization for unresolved target objects

Worker-Kennung: authorization.desktop-mail-target-resolution.

**Status:** offen; keine Behauptung einer Behebung im PR.

**Gemeldete Einstufung:**

- **level**: medium
- **rationale**: High mailbox confidentiality/integrity impact with medium likelihood on a local application boundary. Requires authenticated IPC access and target row IDs; native dialog actions require user completion. No unauthenticated network access claimed.

**Gemeldete Nachweissicherheit:**

- **level**: medium
- **rationale**: Current local source and relevant countercontrols were independently traced; exact code evidence was re-read and matched. Confidence in deployment-specific impact is limited by absent runtime reproduction and unanswered deployment/provisioning assumptions. Original investigator assessments are retained.

**Beschreibung:**

Authenticated desktop callers can read or mutate protected account objects through operations whose IDs are not resolved by the generic account guard. The wrapper treats unresolved scope as permission to continue.

**Quellorte des Ausgangsstands:** `electron/ipc/register.ts:51`, `electron/ipc/ipc-account-scope.ts:1`, `electron/ipc/email.ts:403`, `electron/email/email-store.ts:523`, `electron/ipc/email.ts:2087`, `electron/email/email-store.ts:1567`, `electron/ipc/email.ts:3023`, `electron/email/email-thread-aggregate.ts:120`, `electron/ipc/email.ts:3071`, `electron/email/email-thread-heuristics.ts:95`, `electron/ipc/email.ts:2805`, `electron/ipc/email.ts:1607`, `electron/email/email-crm-store.ts:285`, `electron/ipc/email.ts:2241`, `electron/email/email-store.ts:1945`, `electron/ipc/email.ts:1016`, `electron/email/email-compose-send.ts:110`, `electron/ipc/email.ts:2350`, `electron/email/email-spam-store.ts:85`, `electron/ipc/email.ts:1648`, `electron/email/email-crm-store.ts:435`, `electron/ipc/email.ts:1692`, `electron/email/email-crm-store.ts:503`

**Gemeldete Ursache:**

A finite payload-shape/channel resolver returns undefined for real scoped operations, and registerIpcHandler skips account checks in that case. Supplied destination account also substitutes for stored object's original account.

**Prüfmethode laut Worker:**

static source trace

**Validierungszusammenfassung laut Worker:**

Independently checked wrapper/resolver and every listed route/sink. Preserved instances: numeric DeleteAccount; optional-account bulk soft-delete/archive; thread contents and alias warnings; attachment save/open; note update/delete; draft delete/recovery; spam list read/save/delete; canned response update/delete; AI prompt update/delete/reorder. Ordinary message reads resolve ownership, multi-account lists scope by session, and canned/prompt all-mode exposes global rows only. Valid schema payloads suffice; no unknown-property injection required.

**Grenzen laut Worker:**

- Offline static analysis only; no application execution or live reproduction.

**Vorgeschlagene Korrektur, nicht als umgesetzt bestätigt:**

Require an explicit authorization policy for every scoped channel. Resolve each persistent object's stored account, authorize all bulk targets and both original/destination accounts on reassignment, and deny unresolved scope. Account deletion should require management privilege. Treat write-level enforcement separately.

**Vorgeschlagene Regressionstests, nicht als ausgeführt bestätigt:**

Keine Angabe.

### 79. Compose operations use a reply parent without authorizing its account

Worker-Kennung: authorization.desktop-reply-parent.

**Status:** offen; keine Behauptung einer Behebung im PR.

**Gemeldete Einstufung:**

- **level**: low
- **rationale**: Medium same-installation metadata/integrity impact with medium likelihood: caller needs a functioning sender with rw access and a protected parent ID. Full parent-body disclosure is not claimed.

**Gemeldete Nachweissicherheit:**

- **level**: medium
- **rationale**: Current local source and relevant countercontrols were independently traced; exact code evidence was re-read and matched. Confidence in deployment-specific impact is limited by absent runtime reproduction and unanswered deployment/provisioning assumptions. Original investigator assessments are retained.

**Beschreibung:**

Desktop send validates the sending account and draft, but reads a separately supplied parent message and optionally marks it done without checking that parent's account permissions. Scheduled send repeats the same path using a saved parent ID.

**Quellorte des Ausgangsstands:** `electron/ipc/email.ts:1307`, `electron/email/email-compose-send.ts:342`, `electron/email/email-compose-send.ts:460`, `electron/email/email-compose-send.ts:304`, `electron/email/email-compose-send.ts:608`, `electron/ipc/email.ts:699`, `electron/email/email-scheduled-send.ts:70`

**Gemeldete Ursache:**

Only the primary sending resource is authorized; secondary reply-parent reads and status writes occur in an actor-unaware service.

**Prüfmethode laut Worker:**

static source trace

**Validierungszusammenfassung laut Worker:**

Independently confirmed actual draft account mismatch rejection, parent metadata lookup, persisted thread/reference linkage, post-send parent done mutation, saved-draft parent input and scheduled caller. Outbound workflow checks and normal sender requirements remain active.

**Grenzen laut Worker:**

- Offline static analysis only; no application execution or live reproduction.

**Vorgeschlagene Korrektur, nicht als umgesetzt bestätigt:**

Authorize the stored parent's account before consuming its metadata and require rw before changing status. Apply checks in the shared send service including scheduled dispatch; explicitly define cross-account reply policy.

**Vorgeschlagene Regressionstests, nicht als ausgeführt bestätigt:**

Keine Angabe.

### 80. POP3 size limits apply after an unbounded line is buffered

Worker-Kennung: resource-exhaustion.pop3-line-buffer.

**Status:** offen; keine Behauptung einer Behebung im PR.

**Gemeldete Einstufung:**

- **level**: low
- **rationale**: Medium availability impact with medium likelihood: requires a malicious/compromised configured POP3 peer. Ordinary external sender control of provider protocol behavior is unproved.

**Gemeldete Nachweissicherheit:**

- **level**: medium
- **rationale**: Current local source and relevant countercontrols were independently traced; exact code evidence was re-read and matched. Confidence in deployment-specific impact is limited by absent runtime reproduction and unanswered deployment/provisioning assumptions. Original investigator assessments are retained.

**Beschreibung:**

The POP3 client accumulates incoming bytes until a newline before applying its RFC822 size counter. A configured peer can send a huge or unterminated line and exhaust memory before the message limit runs.

**Quellorte des Ausgangsstands:** `packages/server/src/mail-sync.ts:2238`, `packages/server/src/mail-sync.ts:2320`, `packages/core/src/email/inbound-message-size.ts:1`

**Gemeldete Ursache:**

The message byte counter runs after readLine, while receive buffering has no line or pre-assembly byte limit.

**Prüfmethode laut Worker:**

static source trace

**Validierungszusammenfassung laut Worker:**

Independently checked pushData, shiftLine and readMultiline. Complete ordinary lines stop accumulating at80MiB, but incomplete lines occupy an uncapped string. Per-line timeout bounds duration only and TLS does not constrain an authenticated malicious peer. No live exhaustion performed.

**Grenzen laut Worker:**

- Offline static analysis only; no application execution or live reproduction.

**Vorgeschlagene Korrektur, nicht als umgesetzt bestätigt:**

Bound buffered bytes immediately on chunk receipt and impose protocol-line/message budgets before assembly. Close on excess and persist an appropriate failure disposition.

**Vorgeschlagene Regressionstests, nicht als ausgeführt bestätigt:**

Keine Angabe.

### 81. SMTP sending and connection probes accept unbounded server responses

Worker-Kennung: resource-exhaustion.mail-response-buffers.

**Status:** offen; keine Behauptung einer Behebung im PR.

**Gemeldete Einstufung:**

- **level**: low
- **rationale**: Medium availability impact with medium likelihood, requiring a configured malicious/compromised mail endpoint or admin-selected test target. No ordinary sender or delegated arbitrary-connect path established.

**Gemeldete Nachweissicherheit:**

- **level**: medium
- **rationale**: Current local source and relevant countercontrols were independently traced; exact code evidence was re-read and matched. Confidence in deployment-specific impact is limited by absent runtime reproduction and unanswered deployment/provisioning assumptions. Original investigator assessments are retained.

**Beschreibung:**

Production SMTP and the separate connection-test client buffer unrestricted response bytes and continuation lines. IMAP probes can also consume endless untagged responses because deadlines apply to individual reads.

**Quellorte des Ausgangsstands:** `packages/server/src/mail-smtp-send.ts:479`, `packages/server/src/mail-smtp-send.ts:180`, `packages/server/src/mail-connection-test.ts:725`, `packages/server/src/mail-connection-test.ts:530`

**Gemeldete Ursache:**

Independent protocol clients omit receive-line/total-response caps and reset per-line deadlines instead of limiting complete operations.

**Prüfmethode laut Worker:**

static source trace

**Validierungszusammenfassung laut Worker:**

Independently read SMTP Buffer.concat receive path, continuation array, test string buffer/response array and commandUntilTagged loop. Continuous short lines can extend operations; one long line exhausts buffers. Stored-credential probes bind host/identity and require account management, while ad hoc overrides require admin; those authorization controls do not cap a peer's responses.

**Grenzen laut Worker:**

- Offline static analysis only; no application execution or live reproduction.

**Vorgeschlagene Korrektur, nicht als umgesetzt bestätigt:**

Bound bytes per line and response, continuation/untagged count, and whole-operation duration in both clients. Destroy sockets on limit violations.

**Vorgeschlagene Regressionstests, nicht als ausgeführt bestätigt:**

Keine Angabe.

### 82. Small workflow graphs can exhaust synchronous API compilation

Worker-Kennung: resource-exhaustion.workflow-graph-paths.

**Status:** offen; keine Behauptung einer Behebung im PR.

**Gemeldete Einstufung:**

- **level**: medium
- **rationale**: High availability impact with medium likelihood: a delegated workflow editor is required, but the expensive compile endpoint needs no activated workflow or mail privileges.

**Gemeldete Nachweissicherheit:**

- **level**: high
- **rationale**: Independent local source trace; no application execution or runtime reproduction.

**Beschreibung:**

A user with workflows.edit can submit a small graph with distinct intermediary branches that reconverge. compileGraphToDefinition independently enumerates paths and materializes rules synchronously, allowing exponential CPU and memory work before activation or mail execution. The supplied source also corroborates outbound trap validation; that separately established instance remains resource.workflow-graph-path-expansion.

**Quellorte des Ausgangsstands:** `packages/server/src/api/workflow-routes.ts:162`, `packages/server/src/api/workflow-routes.ts:266`, `packages/server/src/api/workflow-routes.ts:1620`, `packages/server/src/api/http.ts:117`, `packages/core/src/workflow/graph-compile.ts:110`, `packages/core/src/workflow/graph-validate.ts:620`

**Gemeldete Ursache:**

Compilation enumerates each graph path with path-local cycle sets and no work/output budget. Shared suffixes are recomputed independently; outbound trap validation has the same amplification.

**Prüfmethode laut Worker:**

independent static source trace

**Validierungszusammenfassung laut Worker:**

Confirmed compile endpoint, shallow input check, capability gate and both recursive algorithms. A sequence of distinct branching nodes that reconverge yields two traversals per stage, while input grows linearly; compiler identical-target optimization does not prevent this form.

**Grenzen laut Worker:**

- Offline source-only review; no application or payload execution.

**Gegenbelege laut Worker:**

- Authentication and workflows.edit required.
- Per-path visited sets stop simple cycles.
- Compiler avoids duplicate yes/no targets, but distinct intermediate nodes evade that optimization.
- HTTP body-size and request-rate controls limit request size/count, not cost of one small graph.
- No unbounded test was run.

**Vorgeschlagene Korrektur, nicht als umgesetzt bestätigt:**

Enforce explicit graph work, path and output budgets before and during compilation. Memoize validation states instead of enumerating paths; cap generated rules and isolate expensive compilation from the API event loop.

**Vorgeschlagene Regressionstests, nicht als ausgeführt bestätigt:**

- Bounded reconverging DAG tests stop at a deterministic work/output limit.
- Cycle and identical-target graphs remain bounded.
- Valid small graphs compile with existing semantics.

## Herkunft und KI-Autorenschaft

Die Ausgangsprüfungen wurden durch interne KI-Worker des Codex-Security-Plugins
erstellt. Der Scan-Kontext nennt gpt-6-astra mit Reasoning-Einstellung high;
das ist die gemeldete Scan-Konfiguration, kein Nachweis des exakten Builds jedes
Workers oder des schreibenden Hauptagenten.

OpenAI Codex hat diesen Anhang strukturiert, lokale Benutzerpfade entfernt und
die Aussagegrenzen ergänzt. Installierte CLI: codex-cli 0.155.0-alpha.16.4.
Exakte Modell-/Build-Kennung des Hauptagenten und Desktop-Agent-Version sind
nicht verifiziert. Keine menschliche Prüfung behauptet.
