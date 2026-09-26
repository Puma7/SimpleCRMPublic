# Phase 0: Baseline

**Stand:** 2026-09-25 · **Commit:** `134b808` (`main`) · **Branch:** `claude/jolly-cerf-hkvznl`

## 1. Umgebung

| Punkt | Wert | Abweichung von CI |
|---|---|---|
| Node | 24.21.0 (nachinstalliert unter `/opt/node24`) | keine |
| pnpm | 11.12.0 (per Corepack aus `packageManager`) | keine |
| `better-sqlite3` | **lokal 12.11.1 aus npm** statt `github:WiseLibs/better-sqlite3#v12.11.2` | Der Egress-Proxy blockiert `codeload.github.com` (403). Die Override galt nur für die Installation; `package.json`, `pnpm-lock.yaml` und `pnpm-workspace.yaml` wurden sofort per `git checkout` zurückgesetzt. Die native Node-Binärdatei wurde lokal gebaut. |
| Install | `pnpm install --ignore-scripts`, dann die nötigen Postinstall-Schritte von Hand (`patch-better-sqlite3.js`, `electron/path.txt`, `embedded-postgres` Symlinks) | Electron-ABI-Build nicht ausgeführt (für Jest nicht nötig) |
| pnpm-Lauf | `pnpm_config_verify_deps_before_run=false`, sonst versucht pnpm wegen der lokalen Override eine Neuinstallation | – |
| Nutzer | Sitzung läuft als `root` | Die zwei Suites mit Embedded-PostgreSQL brechen als root ab (`initdb: could not access directory … Permission denied`). Unter einem normalen Nutzer (`tester`) laufen sie grün. |

## 2. Gates

| Gate | Ergebnis | Dauer |
|---|---|---|
| `check:typescript-toolchain` | grün | 1 s |
| `lint` | grün | 26 s |
| `typecheck` | grün | 13 s |
| `test` (Unit + Integration) | 3314/3403 grün; **89 rot, nur Umgebung** (2 PostgreSQL-Suites als root). Nachlauf als Nicht-root: `tests/integration/postgres-task-calendar-atomic.test.ts` + `tests/integration/server-mail-access-routes.test.ts` → 89/89 grün | 44 s |
| `test:mail` | 1265 grün, 1 übersprungen, 193 Suites | 72 s |
| `test:server:coverage` + Ratchet | dieselben 89 Umgebungsfehler wie bei `test` (PostgreSQL als root), sonst grün; der Ratchet-Check lief deshalb nicht, er wird mit der Abnahme in Phase 5 nachgeholt | 312 s |
| `test:ui:coverage:check` | grün, 2977 Tests; Ratchet erfüllt (Lines 31,67 %, Branches 71,89 %) | 248 s |
| `build` | grün | 11 s |

**Ergebnis:** Auf `main` sind keine Tests rot, die auf einen Code-Fehler zurückgehen. Kategorie B0 (bereits rote Tests) bleibt leer.

## 3. Abhängigkeiten (`pnpm audit --prod`)

47 Advisories: 30 hoch, 14 mittel, 3 niedrig. Für die produktive, aus dem Internet erreichbare Server-Edition relevant (Details kommen als Befunde ins Register):

| Paket | Stand im Lockfile | Behoben ab | Weg in den Server | Warum relevant |
|---|---|---|---|---|
| `fastify` | < 5.12.1 | 5.12.1 | direkt (`packages/server`) | X-Forwarded-*-Spoofing bei `trustProxy` mit Hop-Count; Schema-Validation-Bypass |
| `find-my-way` | ≤ 9.6.0 | 9.6.1 | fastify | DDoS über HTTP/2 (nur relevant, wenn HTTP/2 aktiv ist) |
| `nodemailer` | 9.0.3 (**per Override fest gepinnt**) | 9.1.1 | direkt, imapflow, mailparser, mailauth | quadratische Laufzeit im Adress-Parser (DoS über eingehende Mails), Umgehung der Empfänger-Domain-Prüfung, `disableFileAccess`-Bypass |
| `fast-uri` | 3.1.2 (**per Override gepinnt**) / 4.x < 4.1.3 | 3.1.6 / 4.1.3 | fastify/ajv, electron-store | Host-Verwechslung und SSRF-Umgehungen beim URI-Parsen |
| `ip-address` | ≤ 10.3.0 | 10.3.1 | imapflow | Fehlklassifikation von IPv4-mapped-/Special-Use-Adressen |
| `@xmldom/xmldom` | 0.8.13 (**per Override gepinnt**) | 0.8.15 | mammoth (DOCX-Textextraktion aus Anhängen) | ReDoS und quadratische Laufzeit/Speicher bei präparierten Anhängen |
| `brace-expansion` | < 5.0.9 | 5.0.9 | archiver | DoS (nur bei vom Angreifer kontrollierten Mustern) |
| `deepmerge-ts` | < 8.0.0 | 8.0.0 | mailparser | Stack-Erschöpfung bei rekursiven Objekten |
| `js-yaml` | 4.3.0 (**per Override gepinnt**) | 4.3.2 | electron-updater | CPU-DoS (Desktop-Updater) |
| `undici` | 7.28.0 (**per Override gepinnt**) | 7.29.0 | mailauth | u. a. CRLF-Injection, Informationsabfluss |
| `dompurify` | 3.4.12 (**per Override gepinnt**) | 3.4.13 | Renderer (Mail-Anzeige) | Hook-Removal lässt ausführbaren Subtree übrig |
| `quill` | 2.0.3 | kein Fix | Renderer | XSS über HTML-Export |

**Auffällig:** `pnpm-workspace.yaml` → `overrides` pinnt mehrere Pakete **exakt** auf Versionen, die inzwischen verwundbar sind (`@xmldom/xmldom`, `dompurify`, `fast-uri@3`, `js-yaml@4`, `undici@7`, `mailauth>nodemailer`). Die Pins waren vermutlich einmal Sicherheits-Fixes; jetzt verhindern sie die Aktualisierung.

## 4. Secret-Scan

- Git-History (alle Refs) und Arbeitsbaum nach privaten Schlüsseln, Cloud-/GitHub-/Slack-/Google-/Anthropic-/OpenAI-Tokenmustern durchsucht.
- Treffer ausschließlich in Test-Fixtures (`tests/fixtures/relay-tls/key.pem`, PGP-Testschlüssel in `tests/unit/server-edition-foundation*.test.ts`).
- `docker/.env.example` und `docker/.env.geoip.example` enthalten nur Platzhalter.
- **Ergebnis:** keine echten Secrets im Repository gefunden.
