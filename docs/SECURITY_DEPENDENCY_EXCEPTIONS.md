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

### deepmerge-ts 7.1.5 — GHSA-ggr8-5vv4-36mx (high)

[Upstream advisory](https://github.com/advisories/GHSA-ggr8-5vv4-36mx).
The dependency path is `mailparser → html-to-text → deepmerge-ts`.
`html-to-text` merges its options objects; mailparser passes an HTML string
without sender-controlled options. Incoming HTML is not passed as a recursive
object graph to the affected merge function. No application caller of
`deepmerge-ts` was found.

The reported recursive-object prerequisite was therefore not established at
this boundary. Version 8 is a major release; `html-to-text` uses
`deepmergeCustom` with custom array and metadata callbacks. Keep the warning
visible until an upstream-compatible update or explicit callback-contract
verification permits migration. Reassess immediately if untrusted options
objects become accepted by HTML conversion.

### uuid 8.3.2 — GHSA-w5hq-g745-h8pq (moderate)

[Upstream advisory](https://github.com/advisories/GHSA-w5hq-g745-h8pq).
The affected path is the development dependency chain
`@types/mssql → tedious → @azure/identity → @azure/msal-node → uuid`.
The installed MSAL code calls `uuid.v4()` without a buffer. The advisory
concerns output-buffer handling in `v3`, `v5` and `v6`; those calls were not
found in this consumer. The application uses other UUID implementations.

Do not equate this warning with a remotely reachable CRM vulnerability. Keep it
visible and prefer an upstream dependency update; a forced migration from
version 8 to 11 needs CommonJS and consumer compatibility verification.

## Dependency update policy

Security overrides in `pnpm-workspace.yaml` stay within each dependency's major
line unless separately evaluated. They also cover transitive consumers whose
parents pin vulnerable versions. Remove an override once every consumer
resolves a suitable patched version without it. The isolated Svelte experiment
keeps its separate npm lockfile and overrides; root pnpm settings do not apply
to that experiment.

Prepared by OpenAI Codex (AI agent): source assessment, documentation and
associated code/test changes. Exact model/build and agent software version
were not available for verification. No human review is claimed.
