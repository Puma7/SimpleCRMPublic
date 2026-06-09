# Auth & Login-Sicherheit — Learnings

Lessons from implementing optional CAPTCHA / PIN / MFA (PR #107) and the pre-beta security audit. Read before changing login, `initial-setup`, or `login-security-service`.

**Siehe auch:** [LOGIN_SECURITY.md](LOGIN_SECURITY.md) (Betrieb & API), [THREAT_MODEL.md](THREAT_MODEL.md), [LEARNINGS.md](LEARNINGS.md).

---

## Workspace-Toggles vs. Benutzer-Zustand

1. **PIN-Keypad Workspace-Toggle ≠ PIN-Pflicht für alle.** Der Keypad erscheint nur, wenn der Workspace PIN erlaubt **und** der Benutzer `login_pin_enabled` hat (`pinRequired` in `login-config`). Admins ohne eigene PIN können den Workspace-Toggle aktiv lassen — UI warnt, blockiert aber nicht global.
2. **MFA ist pro Benutzer.** Workspace `mfaEnabled` schaltet den Mechanismus frei; `mfaRequired` im Login gilt nur, wenn der User `mfa_enabled` hat.
3. **Partielles PATCH** auf `/auth/security-settings` — niemals fehlende Felder mit Defaults überschreiben; sonst löscht ein Admin-Toggle unbeabsichtigt andere Layer.

---

## CAPTCHA (Turnstile)

1. **Beide Keys oder keiner** — Site-Key ohne Secret-Key → Provider inert; Toggle allein reicht nicht.
2. **Challenge ≠ Login-Session** — `captcha-verify` gibt ein kurzlebiges serverseitiges Challenge-Token; Login muss es mitschicken. Replay der Turnstile-Antwort allein reicht nicht.
3. **Timeout 5s** auf Provider-HTTP — ohne Timeout kann ein langsamer Turnstile-Endpunkt Login-Worker blockieren.
4. **Account-Enumeration** über `login-config?email=` ist bewusst möglich (PIN/MFA-Hints). Für Single-Tenant-Beta akzeptiert; bei Multi-Tenant später einschränken.
5. **CAPTCHA nur nach User-Lookup** — `handleLogin` prüft CAPTCHA nur, wenn `findUserByEmail` einen Treffer liefert. Unbekannte E-Mails erhalten sofort `invalid_credentials` ohne CAPTCHA; bekannte Accounts mit aktivem CAPTCHA erhalten `captcha_required`. Das schützt CAPTCHA primär gegen Passwort-Spray auf bekannte Accounts, nicht gegen Enumeration unbekannter Adressen. Zusätzlicher Enumeration-Hinweis: `captcha_required` impliziert „User existiert“. Für Single-Tenant-Beta akzeptiert; Fix wäre Workspace-CAPTCHA-Lookup ohne User (z. B. `workspaceId` im Login-Request) oder einheitliche `captcha_required`-Antwort auch bei unbekannter E-Mail.

---

## PIN

1. **Hash mit libsodium/scrypt-ähnlichem Muster** — PIN nie loggen, nie in Audit-Metadaten.
2. **E-Mail-Wechsel → PIN im UI zurücksetzen** — sonst tippt User alte PIN für neuen Account.
3. **Admin ohne PIN + Workspace-PIN an** — kein Deadlock (Passwort reicht), aber schwächer als beabsichtigt → Warnung in Settings.

---

## MFA (TOTP & E-Mail)

1. **Login-Response ist Union** — `AuthResponseBody | { mfaRequired, … }`. TypeScript und Transport müssen nach `mfaRequired` narrowen (`"user" in body`), sonst bricht `pnpm run build`.
2. **MFA-Challenge single-use** — `consumeSingleUseToken` auch bei erfolgreichem Verify; Replay derselben Challenge → 401.
3. **Deaktivierter User nach Passwort, vor MFA** — `completeMfaLogin` prüft `disabled_at`; sonst MFA-Bypass für gesperrte Accounts.
4. **E-Mail-MFA consume atomar** — `UPDATE … WHERE hash = ? AND expires > now RETURNING` statt SELECT+UPDATE (TOCTOU).
5. **E-Mail-Versand nutzt Invite-SMTP** — ohne `AUTH_INVITE_SMTP_*` schlägt E-Mail-MFA-Zustellung fehl (`mfa_delivery_failed`).

---

## Initial Setup Hardening

1. **`INITIAL_SETUP_TOKEN` ist Pflicht** — kein offenes `initial-setup` mehr. Token per Header `X-Initial-Setup-Token` oder Body-Feld.
2. **Operator muss Token vor erstem `docker compose up` setzen** — sonst ist Setup blockiert (gewollt).
3. **Dokumentation in SETUP_SERVER + `.env.example`** — fehlende Doku führt zu Support-Tickets.

---

## Brute-Force & Sessions

1. **Login-Failure-Inkrement in einer DB-Transaktion** — parallele Fehlversuche dürfen den Zähler nicht verlieren.
2. **Rate-Limits In-Memory** — für Single-Node ok; bei horizontaler Skalierung Redis o.ä. nötig (bekanntes Restrisiko).

---

## CI & Dependency-Hygiene

1. **`otplib` in `packages/server/package.json` → `pnpm-lock.yaml` pflegen** — CI nutzt `pnpm install --frozen-lockfile`; fehlender Lockfile-Eintrag = sofortiger Build-Fail.
2. **Renderer-Transport-Tests** bei neuen User-Feldern anpassen (`login_pin_enabled`, `mfa_enabled`, `mfa_method`).
3. **Nicht nur `npm test:server-edition`** — volle CI läuft `pnpm test` + `pnpm run build` (Renderer-Typecheck).

---

## Pre-Beta Audit — validiert vs. zurückgestellt

### Behoben

| Finding | Fix |
|---------|-----|
| Offenes Initial-Setup | `INITIAL_SETUP_TOKEN` required |
| MFA E-Mail Race | Atomic consume |
| Disabled user nach MFA | Check in `completeMfaLogin` |
| MFA challenge replay | Single-use store |
| Security PATCH overwrite | Partial PATCH |
| Login failure race | Single transaction |
| Turnstile hang | 5s timeout |
| SMTP duplicate on compose retry | Outbox claim in `sync_info` |
| Forward-copy duplicate on crash | Dedup before SMTP, rollback on fail |
| IMAP inside workflow txn | Deferred queue post-commit |
| Custom field N+1 | `customerIds` batch query |

### Bewusst zurückgestellt / falsifiziert

- Multi-workspace `findUserByEmail` — für Multi-Tenant relevant, Single-Tenant-Beta ok
- CAPTCHA replay über Challenge hinaus — durch Challenge-TTL abgefedert
- CAPTCHA-Bypass bei unbekannter E-Mail + Login-Enumeration über `captcha_required` vs. `invalid_credentials` — dokumentiert (siehe CAPTCHA §5)
- In-Memory rate limits bei Scale-out — dokumentiert
- PIN/MFA nicht per-User mandatory erzwingen — Produktentscheidung + UX-Warnungen

---

## Dokumentations-Hygiene

Bei Änderungen an Login-Sicherheit aktualisieren:

1. [LOGIN_SECURITY.md](LOGIN_SECURITY.md) — Betreiber & API
2. [CHANGELOG.md](../CHANGELOG.md) — Unreleased-Sektion
3. [LEARNINGS_AUTH.md](LEARNINGS_AUTH.md) — neue Fallen
4. [THREAT_MODEL.md](THREAT_MODEL.md) — neue Restrisiken
5. `docker/.env.example` — neue Env-Vars
