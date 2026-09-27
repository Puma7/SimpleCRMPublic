# Mail-Modul — Tests & Coverage

## Befehle

| Befehl | Wann | Gate |
|--------|------|------|
| `npm run test:mail` | Jede Änderung an `electron/email/**`, IPC, Mail-UI | Alle Tests grün (Coverage-Schwelle aus) |
| `npm run test:mail:coverage` | Vor Merge von Mail-PRs / Release | Ratchet-Schwellen in `jest.mail.config.cjs` |
| `pnpm run test:mail:coverage:check` | Vor dem Push, wie in CI | Ratchet gegen `mail-coverage-baseline.json`, wie in CI |
| `npm run test:mail:coverage:update-baseline` | Nach bewusster Coverage-Verbesserung | Aktualisiert `mail-coverage-baseline.json` |

## CI

GitHub Actions ([`.github/workflows/ci.yml`](../.github/workflows/ci.yml)) führt nach `pnpm test` automatisch **`pnpm run test:mail:coverage:check`** aus (Mail-Tests plus Ratchet). Die gemessenen Werte aller drei Bereiche liegen als Artefakt `coverage-summaries-*` am CI-Lauf.

## Coverage-Policy

- **Ziel:** Regressionen verhindern, nicht 100 % auf dem gesamten `electron/email/**`-Baum erzwingen.
- **Aktuelle Schwellen** (global, `jest.mail.config.cjs`): ~90 % statements/lines, ~80 % branches, ~93 % functions.
- **100 %-Gate** ist bewusst zurückgestellt (IMAP/POP3-Netzwerkpfade, große `email-store.ts`).

`node scripts/check-mail-coverage-ratchet.mjs` vergleicht `coverage/mail/coverage-summary.json` mit der committed Baseline. CI bricht ab, wenn die Coverage mehr als 1 Punkt unter die Baseline fällt oder mehr als 2 Punkte darüber liegt (dann Baseline mit `pnpm run test:mail:coverage:update-baseline` anheben).

## Fresh-Install

- **Code:** `bootstrapFreshDatabaseSchema()` in [`electron/sqlite-service.ts`](../electron/sqlite-service.ts) — gleicher Pfad wie neue DB in `initializeDatabase()`.
- **Contract:** [`tests/mail/sqlite-fresh-mail-schema.test.ts`](../tests/mail/sqlite-fresh-mail-schema.test.ts) (Quelltext-Reihenfolge).
- **Integration:** [`tests/mail/sqlite-fresh-install.integration.test.ts`](../tests/mail/sqlite-fresh-install.integration.test.ts) (echtes `better-sqlite3` in Temp-Verzeichnis).

## Alpha-Checkliste (manuell)

Siehe [`MAIL_ALPHA_CHECKLIST.md`](MAIL_ALPHA_CHECKLIST.md).
