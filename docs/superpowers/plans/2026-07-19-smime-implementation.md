# S/MIME Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** E-Mails pro Mailkonto standardkonform signieren, verschluesseln, verifizieren und entschluesseln koennen, einschliesslich nachvollziehbarer Zertifikats- und Widerrufsstatus.

**Architecture:** Ein austauschbarer CMS-Adapter kapselt PKI.js. Kontenidentitaeten und Empfaengerzertifikate werden serverseitig verwaltet; Private Keys liegen ausschliesslich als verschluesselte Content-Objekte. Outbound integriert S/MIME vor SMTP-Commit, inbound verarbeitet CMS vor HTML-Sanitizing, Content-Spam-Analyse und Workflows.

**Tech Stack:** RFC 8551, CMS, PKI.js/asn1js, WebCrypto/Node Crypto, Fastify, PostgreSQL, Jest, OpenSSL fixtures.

## Global Constraints

- Voraussetzung: Mail-ACL und verschluesselter Content Store inklusive Recovery.
- S/MIME und OpenPGP sind fuer eine einzelne Nachricht gegenseitig exklusiv.
- Keine eigene ASN.1-/CMS-Implementierung.
- PKCS#12-Passphrase wird nur fuer den Import im Prozessspeicher gehalten und nie gespeichert oder geloggt.
- Private Keys sind pro Mailkonto; alte Generationen bleiben fuer Entschluesselung verfuegbar.
- Bei erzwungener Verschluesselung gilt all-or-nothing fuer alle Empfaenger inklusive Absenderkopie.
- Header Protection nach RFC 9788 ist ein spaeterer, expliziter Ausbau und nicht Teil dieses PRs.

---

## File Map

- Modify: `packages/server/package.json`
- Modify: `pnpm-lock.yaml`
- Create: `packages/server/src/migrations/0043_smime.ts`
- Modify: `packages/server/src/migrations/index.ts`
- Modify: `packages/server/src/db/schema.ts`
- Create: `packages/server/src/smime/types.ts`
- Create: `packages/server/src/smime/cms-adapter.ts`
- Create: `packages/server/src/smime/pkijs-cms-adapter.ts`
- Create: `packages/server/src/smime/certificate-validation.ts`
- Create: `packages/server/src/smime/revocation-fetcher.ts`
- Create: `packages/server/src/smime/postgres-smime-port.ts`
- Create: `packages/server/src/smime/service.ts`
- Create: `packages/server/src/api/smime-routes.ts`
- Modify: `packages/server/src/mail-compose-send.ts`
- Modify: `packages/server/src/mail-parse.ts`
- Modify: `packages/server/src/mail-sync-post-process.ts`
- Modify: `packages/server/src/api/openapi.ts`
- Modify: `src/services/transport/channel-http-registry.ts`
- Modify: `src/components/email/settings/accounts-panel.tsx`
- Modify: `src/components/email/compose-dialog.tsx`
- Modify: `src/components/email/message-viewer.tsx`
- Create: `tests/fixtures/smime/README.md`
- Create: `tests/unit/server-smime-cms-adapter.test.ts`
- Create: `tests/unit/server-smime-certificate-validation.test.ts`
- Create: `tests/unit/server-smime-revocation-fetcher.test.ts`
- Create: `tests/integration/server-smime-send.test.ts`
- Create: `tests/integration/server-smime-receive.test.ts`
- Create: `tests/e2e/email-smime.spec.ts`

## Stable Interfaces

```ts
export interface SmimeCmsAdapter {
  inspect(source: Uint8Array): Promise<SmimeEnvelopeInfo>;
  sign(input: SmimeSignInput): Promise<Uint8Array>;
  verify(input: SmimeVerifyInput): Promise<SmimeVerificationResult>;
  encrypt(input: SmimeEncryptInput): Promise<Uint8Array>;
  decrypt(input: SmimeDecryptInput): Promise<SmimeDecryptionResult>;
}
```

```ts
export type SmimeCertificateStatus =
  | 'valid' | 'expired' | 'not_yet_valid' | 'revoked'
  | 'untrusted' | 'revocation_unknown' | 'invalid';
```

## Task 1: Interoperability fixture corpus

- [ ] Add direct `pkijs` and `asn1js` dependencies to `packages/server/package.json` with pnpm; do not rely on transitive versions.
- [ ] Generate non-production fixture CA, sender/recipient generations, expired certificate, revoked certificate and wrong-key cases under `tests/fixtures/smime` using a documented script/commands.
- [ ] Store only fixture private keys clearly marked test-only; add fingerprints and expected outcomes in `README.md`.
- [ ] Add messages produced by OpenSSL and MIME structures representative of Outlook and Thunderbird: detached signed, opaque signed, encrypted and signed-then-encrypted.
- [ ] Add tests that parse every fixture before implementation; expect failures.
- [ ] Commit: `test(server): add smime interoperability corpus`.

## Task 2: CMS adapter

- [ ] Define the narrow adapter above and keep PKI.js types confined to `pkijs-cms-adapter.ts`.
- [ ] Implement detached `multipart/signed`, opaque `application/pkcs7-mime`, enveloped-data and sign-then-encrypt operations using canonical CRLF MIME bytes.
- [ ] Verify signer certificate binding, signed attributes and message digest; return structured status rather than boolean.
- [ ] Reject unsupported algorithms, excessive nesting, oversized ASN.1 lengths and recursive CMS bombs with bounded parsing limits.
- [ ] Run `server-smime-cms-adapter.test.ts`; expect all fixture cases PASS.
- [ ] Commit: `feat(server): implement standards based smime cms adapter`.

## Task 3: Identity and recipient certificate schema

- [ ] Add integration tests for one account/multiple identity generations, one active signing identity, decrypt-capable retired identities and recipient trust states.
- [ ] Create `0043_smime.ts` with `mail_smime_identities`, `mail_smime_recipient_certificates` and revocation cache metadata.
- [ ] Store certificates as DER/public metadata; store private keys only via `mail_content_objects.kind='smime_private_key'` reference.
- [ ] Enforce account/workspace ownership and certificate fingerprint uniqueness.
- [ ] Register migration/schema and run tests; expect PASS.
- [ ] Commit: `feat(server): persist account smime identities`.

## Task 4: PKCS#12 import and identity lifecycle

- [ ] Add route/service tests for valid import, wrong passphrase, no private key, certificate/key mismatch, duplicate generation, expiry and unauthorized account.
- [ ] Parse PKCS#12 in bounded memory, verify private/public key match and intended key usages, then immediately encrypt the private key into Content Store.
- [ ] Clear passphrase and raw key buffers in `finally`; never echo passphrase in errors.
- [ ] Support activate-for-signing, retain-for-decryption and revoke-local-use transitions with audited actor/account/fingerprint.
- [ ] Include identity keys in workspace recovery through their content refs, without a separate export path.
- [ ] Run focused tests; expect PASS.
- [ ] Commit: `feat(server): manage smime identities per mail account`.

## Task 5: Recipient certificate trust

- [ ] Add tests for manual import, certificate learned from a valid signed message, email/SAN mismatch, chain failure and competing generations.
- [ ] Store learned certificates as `observed`, not trusted; user/admin explicitly promotes or policy accepts only a valid configured chain.
- [ ] Select certificates by normalized recipient address, validity window, trust and encryption key usage; never choose solely by newest timestamp.
- [ ] Present fingerprint, issuer, validity and source without exposing unrelated certificate payload details.
- [ ] Run tests; expect PASS.
- [ ] Commit: `feat(server): validate smime recipient certificates`.

## Task 6: SSRF-safe OCSP and CRL

- [ ] Add tests for loopback/private/link-local/metadata IPs, DNS rebinding, redirects, oversized body, wrong MIME, timeout, stale cache and responder outage.
- [ ] Implement a dedicated fetcher resolving and pinning allowed public IPs, denying non-HTTP(S) schemes/private ranges and revalidating every redirect.
- [ ] Bound response bytes, redirects, connect/total timeout and concurrency; cache by issuer/serial/URL until nextUpdate with a configured maximum.
- [ ] Distinguish `revoked`, `valid` and `revocation_unknown`; outage must not be reported as valid.
- [ ] Keep fail-open/fail-closed send policy explicit per account and show it before send.
- [ ] Run revocation tests; expect PASS.
- [ ] Commit: `feat(server): add safe smime revocation checks`.

## Task 7: Atomic outbound S/MIME

- [ ] Add integration tests for sign only, encrypt only, sign-then-encrypt, mixed missing recipient cert, BCC, aliases, self-recipient and SMTP retry recovery.
- [ ] Resolve the sending account and require `mail.send`; alternative From additionally requires `mail.send_as`.
- [ ] Build final MIME once, add the sender certificate recipient for decryptable Sent copy, then snapshot exact RFC822 before SMTP.
- [ ] If any required recipient certificate/status is unacceptable, abort before SMTP and return all missing/invalid recipients; no partial send.
- [ ] Persist security mode/fingerprints/status as non-secret metadata tied to the send commit marker.
- [ ] Run send tests; expect PASS.
- [ ] Commit: `feat(server): send atomic smime protected mail`.

## Task 8: Inbound verification and decryption

- [ ] Add tests for valid/invalid signature, unknown CA, expired/revoked signer, encrypted message with current/retired/wrong key and nested malformed MIME.
- [ ] Detect CMS after RFC822 size validation; decrypt and verify before HTML sanitizing, content spam features, workflow variables and attachment extraction.
- [ ] Preserve original encrypted RFC822 as encrypted content object and store decrypted parsed content separately with provenance/status.
- [ ] Never execute active content from decrypted mail; pass it through the same sanitizer/attachment policy as plaintext mail.
- [ ] Expose structured verification results to workflow/UI without treating signature validity as sender authorization by itself.
- [ ] Run receive tests; expect PASS.
- [ ] Commit: `feat(server): verify and decrypt inbound smime mail`.

## Task 9: UI and policy settings

- [ ] Add Playwright tests for PKCS#12 import, identity generation switch, recipient certificate review, compose security mode and inbound status display.
- [ ] Add account S/MIME settings with certificate status, fingerprint, validity and revocation policy; passphrase input is never retained.
- [ ] Add compose segmented control `none|sign|encrypt|sign_and_encrypt`; disable OpenPGP when S/MIME selected and vice versa.
- [ ] Show missing recipient certificate list before send and clear recovery actions.
- [ ] In viewer, distinguish cryptographic signature validity, certificate trust and revocation freshness.
- [ ] Run UI/E2E tests; expect PASS.
- [ ] Commit: `feat(email): add smime controls and evidence`.

## Task 10: Final verification

- [ ] Verify generated messages with OpenSSL and import/send representative fixtures through Outlook and Thunderbird test profiles; record hashes/outcomes in `.hermes/reports/`.
- [ ] Fuzz ASN.1/CMS and nested MIME with strict size/time limits.
- [ ] Verify encrypted database/storage/log scan includes S/MIME private keys and decrypted bodies.
- [ ] Run `pnpm run lint`, `pnpm run test:unit`, `pnpm run test:integration`, `pnpm run test:mail:coverage`, and `pnpm run build`.
- [ ] Commit: `test(server): prove smime interoperability and resilience`.

## No-Regression Checklist

- [ ] DKIM signs the final transmitted S/MIME MIME in the existing outbound order.
- [ ] Tracking/link rewriting is either completed before cryptographic signing or disabled according to policy; it never invalidates the signature afterward.
- [ ] Spam content heuristics consume decrypted content only when decryption succeeds and retain an encrypted-message signal otherwise.
- [ ] A reply does not silently downgrade required S/MIME policy.
- [ ] Old private-key generations cannot sign new messages after deactivation.
- [ ] Certificate learning never converts observation into trust automatically.
