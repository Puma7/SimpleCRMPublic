# Dependency advisory assessment

Reviewed 2026-09-25 against the repository based on
`134b8088b168eee23acd89158562964813058fb2` and the accompanying dependency patch.
This is a reachability assessment, not a claim that the affected libraries are
fixed or that the project has no vulnerabilities. The audit warnings remain
visible; no advisory is suppressed. Recheck these entries by 2026-10-25 and
whenever the listed callers, APIs or dependencies change.

## Outstanding advisories

### Quill 2.0.3 — GHSA-v3m3-f69x-jf25 (low)

[Upstream advisory](https://github.com/advisories/GHSA-v3m3-f69x-jf25).
No patched release was identified. Quill's default copy/cut handler calls
`getSemanticHTML` internally, even though application save/send paths read
`root.innerHTML`. A crafted pasted video URL was confirmed to produce active
HTML attributes in the exported clipboard HTML. This is an export vulnerability;
execution inside SimpleCRM was not demonstrated.

Both editors now install `sanitizeQuillClipboard`, which sanitizes the HTML
returned by the instance's `clipboard.onCopy` before Quill writes it to the
clipboard. The existing input and save/send sanitizers remain in place.

Evidence: `src/components/email/compose-quill-editor.tsx`,
`src/components/email/signature-quill-editor.tsx`;
`tests/unit/compose-quill-editor.test.tsx`,
`tests/unit/signature-quill-editor.test.tsx` and
`tests/unit/sanitize-email-html.test.ts`, plus
`tests/integration/quill-clipboard-runtime.test.ts`, which uses real Quill
copy/cut handlers with an in-memory DOM and clipboard. Preserve the clipboard
boundary as well as input/save sanitization. The dependency warning remains
until upstream is fixed; adding any new export consumer requires equivalent
output sanitization. The application mitigation does not fix Quill itself.

## Resolved dependency advisories

### deepmerge-ts — GHSA-ggr8-5vv4-36mx (high)

[Upstream advisory](https://github.com/advisories/GHSA-ggr8-5vv4-36mx).
The dependency path is `mailparser → html-to-text → deepmerge-ts`.
`html-to-text` merges its options objects; mailparser passes an HTML string
without sender-controlled options. Incoming HTML is not passed as a recursive
object graph to the affected merge function. No application caller of
`deepmerge-ts` was found.

The reported recursive-object prerequisite was not established at this
application boundary. The scoped `html-to-text>deepmerge-ts` override now uses
8.0.2. Before/after tests exercise the actual CommonJS consumer, default Unicode
formatting, root selector composition, nested-array replacement, duplicate
selector precedence, base-element selection, table/list formatting and
mailparser's HTML-only MIME conversion (`tests/integration/mail-library-runtime.test.ts`).
The installed dependency advisory is removed.

This update does not establish support for untrusted conversion options:
html-to-text's custom metadata callback retains only its own key path and
does not preserve the new merger's recursion metadata. Cyclic options can
still exhaust the stack in this consumer. All current application mailparser
callers pass message bytes, not sender-controlled options. Preserve that
boundary and reassess before exposing configurable conversion objects.

### uuid — GHSA-w5hq-g745-h8pq (moderate)

[Upstream advisory](https://github.com/advisories/GHSA-w5hq-g745-h8pq).
The affected path is the development dependency chain
`@types/mssql → tedious → @azure/identity → @azure/msal-node → uuid`.
The previous MSAL consumer called `uuid.v4()` without a buffer. The advisory
concerns output-buffer handling in `v3`, `v5` and `v6`; those calls were not
found in this consumer. The application uses other UUID implementations.

No remotely reachable CRM vulnerability was established from this warning.
The scoped `@azure/identity@4.13.0` override selects the 4.13.1 patch release,
which replaces the old MSAL/uuid dependency chain. It does not force a uuid or
tedious major-version override. The actual development dependency chain is
loaded through CommonJS and a credential object is constructed without
contacting an identity provider in `tests/integration/mssql-auth-library-runtime.test.ts`.
The installed uuid advisory is removed; live identity-provider authentication
is outside this offline compatibility test.

## Dependency update policy

Security overrides in `pnpm-workspace.yaml` stay within each dependency's major
line unless separately evaluated. They also cover transitive consumers whose
parents pin vulnerable versions. Remove an override once every consumer
resolves a suitable patched version without it. The isolated Svelte experiment
keeps its separate npm lockfile and overrides; root pnpm settings do not apply
to that experiment.

Prepared by OpenAI Codex (AI agent): source assessment, documentation, associated
code/test changes and execution of the reported checks. The installed CLI
reports `codex-cli 0.155.0-alpha.16.4`; this is not a model identifier or the
Desktop agent build. Exact model/build and Desktop agent version were not
available for verification. No human review is claimed.
