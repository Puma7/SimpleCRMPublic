# Changelog

All notable changes to SimpleCRM will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Login-Sicherheit (Server Edition):** Drei unabhängig schaltbare Layer für den öffentlichen Login — Cloudflare Turnstile CAPTCHA, 6-stelliges PIN-Keypad pro Benutzer, MFA per TOTP oder E-Mail-Code. Workspace-Toggles unter Einstellungen → Sicherheit; PIN/MFA-Verwaltung unter Einstellungen → Benutzer. Migration `0020_auth_login_security`.
- **Login-Config API:** `GET /api/v1/auth/login-config` liefert pro E-Mail die aktiven Schichten (`pinRequired`, `mfaRequired`, CAPTCHA-Site-Key).
- **Batch Custom Fields:** `GET /api/v1/customer-custom-field-values?customerIds=1,2,3` — ein Request für mehrere Kunden (Transport nutzt Batch statt N+1).
- **Observability:** Job-Worker-Logs, `job_queue`-Diagnostik (locked/running Jobs), erweiterte Workflow-Run-Steps in UI und Doctor-CLI.
- **Dokumentation:** [LOGIN_SECURITY.md](docs/LOGIN_SECURITY.md), [LEARNINGS_AUTH.md](docs/LEARNINGS_AUTH.md).

### Changed
- **Passwortrichtlinie:** Mindestens 12 Zeichen für Registrierung, Ersteinrichtung und Einladungsannahme (shared `password-policy`).
- **Ersteinrichtung:** `INITIAL_SETUP_TOKEN` ist Pflicht in `docker/.env` vor `POST /api/v1/auth/initial-setup` (Header `X-Initial-Setup-Token`).
- **Workflow IMAP:** `setSeen`, `move` und `delete` laufen nach Commit der Workflow-DB-Transaktion (deferred queue) — kein externes I/O mehr innerhalb langer Transaktionen.
- **Compose SMTP:** Outbox-Claim (`sync_info` Wert `outbox`) vor Versand; Retry ohne erneutes SMTP nur bei bereits committetem Versand (`1`), nicht bei hängendem `outbox`.
- **Forward-Copy:** Dedup-Zeile erst nach erfolgreichem SMTP (Crash vor Versand bleibt retry-fähig).

### Fixed
- **Login CAPTCHA:** CAPTCHA-Pflicht gilt auch für unbekannte E-Mails, wenn der Workspace CAPTCHA aktiviert hat (analog `login-config`, Single-Workspace).
- **Email-MFA Self-Service:** `POST .../mfa/email` erlaubt wie TOTP-Setup Admin oder eigenen Account.
- **MFA E-Mail-Codes:** Verwaiste DB-Zeilen werden bei SMTP-Fehler wieder gelöscht.
- **Compose Outbox:** Claim erst nach Outbound-Review; `sent`-Marker nach SMTP verhindert Doppelversand bei Retry nach Crash.
- **SMTP-Host:** Kein stiller Fallback auf IMAP-Host mehr; `resolveConfiguredSmtpHost` + getrennte Verbindungstests pro Protokoll (IMAP/POP3/SMTP).
- **Pre-Beta Audit:** MFA E-Mail Race (atomic consume), deaktivierte User nach MFA blockiert, MFA-Challenge single-use, partielles PATCH für Security-Settings, Login-Failure-Counter in einer Transaktion, Turnstile 5s-Timeout.
- **CI:** `pnpm-lock.yaml` für `otplib`; Renderer-Transport-Test für MFA/PIN-Felder; TypeScript-Narrowing in `server-auth-client.ts` für MFA-Login-Union.

### Security
- Kein offenes Initial-Setup ohne Operator-Token.
- CAPTCHA-Challenge serverseitig gebunden; PIN gehasht; TOTP-Secret über Secret-Port.

---

## [0.1.7] - 2026-03-30

### Added
- **Follow-Up Queue**: New dedicated follow-up page with a smart queue rail, priority indicators, snooze popover, and instant detail panel. Log activities, view the full activity timeline per customer, and filter/sort the queue from a toolbar.
- **Onboarding Checklist**: Dashboard now shows a getting-started checklist (configure DB → sync JTL → add customers → create first deal) when the database is empty, guiding new users through initial setup.
- **Inline Deal & Task Creation on Customer Detail**: Create deals and tasks directly from the customer detail page via dialogs, without navigating away. Customer delete now uses a proper `AlertDialog` for destructive confirmation.
- **CSV Export**: Export button replaced with a format dropdown offering CSV and JSON. CSV files are BOM-prefixed for correct Excel encoding on Windows.
- **Deal Deletion**: Deals can now be deleted from the deal detail page. Deleting a deal removes its associated products before removing the deal row.
- **Deal Tasks Panel**: Deal detail page fetches and displays all tasks linked to the deal's customer.
- **Auto-Update System**: Electron app checks for and installs updates automatically via `electron-updater`. An update status indicator is shown in the UI during download and install.
- **Calendar Integration**: Tasks are linked to the calendar view with a new event-type colour legend.
- **Error Boundary**: A top-level `ErrorBoundary` component catches runtime errors and provides a reset action, preventing the entire app from going blank on unexpected errors.
- **Empty State & Page Header Components**: Reusable `EmptyState` and `PageHeader` components for consistent no-data UI and page title/action layouts.
- **LICENSE**: MIT license added to the repository.

### Changed
- **Deal Detail UI**: Inline stage-change `Select` on kanban cards avoids full-page navigation. Breadcrumb navigation replaces the back button. Redundant Products tab removed.
- **Customer Detail**: Default tab changed to "Deals" for quicker access. Status labels localized.
- **Settings Page**: Layout condensed and reorganized; MSSQL and sync sections restructured for clarity.
- **Main Navigation**: Simplified and tightened layout; Follow-Up added as a primary nav item.
- **Router**: Migrated from deprecated `new Route/Router` API to `createRoute/createRouter`. Added redirect from `/login` to `/` and wrapped the root outlet in `ErrorBoundary`.
- **IPC Modules**: All IPC handler imports switched from `@shared/ipc` path alias to relative imports, fixing resolution in compiled `dist-electron` output.
- **Priority Normalization**: Legacy German priority values (`Hoch`, `Mittel`, `Niedrig`) are automatically migrated to English equivalents (`high`, `medium`, `low`) on database startup.

### Fixed
- **Electron Dev/Prod Window Loading**: Dev URL normalized to include `#/` for `createHashHistory` compatibility. Production uses `electron-serve` with a `loadFile` fallback. Fixes blank window on app start in certain configurations.
- **Detached DevTools**: Added a dedicated `DevTools` `BrowserWindow` toggled via F12 global shortcut, preventing off-screen DevTools restoration issues.
- **MSSQL Error Feedback**: Structured MSSQL error types moved to `shared/errors/mssql.ts` with localized, actionable error messages surfaced in the settings UI.
- **Debug Logs Removed**: Cleaned up `console.log` statements left in production code paths across services and page components.

### Technical Details
- **Tailwind CSS v4**: Migrated from v3 config (`tailwind.config.ts` + `@tailwind` directives) to v4 (`@import "tailwindcss"` + `@theme` block). Removed `postcss` dependency for Tailwind.
- **Dependencies**: Upgraded Radix UI packages, `@tanstack/react-router`, `lucide-react`, `electron-log`, `electron-serve`, `electron-store`. Switched `better-sqlite3` to GitHub source ref `v12.7.1` for Electron 41 compatibility; added `scripts/patch-better-sqlite3.js` to apply a required native binding patch on install.
- **Test Suite**: Comprehensive Jest coverage added — unit tests for services, hooks, and UI components; integration tests for all IPC handler categories; Playwright E2E tests for the Electron app. Coverage scripts added for `unit` and `integration` projects.
- **CI/CD**: GitHub Actions CI workflow added for lint/test/build on push to `main` and pull requests.

---

## [0.1.6] - 2026-03-22

### Added
- **E-Mail (Desktop):** IMAP und POP3 (`imapflow`, `node-pop3`), SMTP (`nodemailer`), lokale SQLite-Ablage, Keytar für Passwörter; optional Google/Microsoft OAuth (Refresh im Keytar); IMAP-Append in den Sent-Ordner; Hintergrund-Sync (Cron + optional IDLE); Anhänge auf Disk mit Open/Save-IPC.
- **CRM-Mail:** JWZ-Threading, Ticket-Codes `[SCR-…]`, Kundenverknüpfung, Kategorien, interne Notizen, Team-Zuweisung, Soft-Delete/Archiv, Ansichten Inbox/Sent/Drafts/Archiv, FTS5-Suche (mit LIKE-Fallback).
- **Workflows:** JSON-Regelengine plus React-Flow-Editor (`@xyflow/react`); Trigger inbound, outbound, draft_created, schedule (Cron + optional Konto-Sync); Aktionen inkl. forward_copy (Dedupe nach erfolgreichem SMTP), tag_attachment_meta, Kategorie, Hold outbound.
- **Composer & KI:** React Quill, DOMPurify-Sanitization, OpenAI-kompatible API für Texttransformation; Canned Responses.
- **Reporting & Export:** Seite `/email/reporting`; DSGVO-Hilfe als ZIP (Metadaten JSONL, optional kompletter Anhängeordner oder „nur Metadaten“).
- **Dokumentation:** `docs/DEVELOPER_EMAIL.md`, `docs/USER_GUIDE_EMAIL.md`, `docs/LEARNINGS_EMAIL.md`, `docs/email-system-deep-review.md` (ergänzend zu `docs/EMAIL_PHASES.md`).

### Changed
- **Build:** Getrennte Web- und Electron-Main-Builds; Vite externalisiert E-Mail-/Sync-Natives für den Main-Bundle.
- **E-Mail-Sync:** Mutex pro Konto; Debounce/Überlappungsschutz für Cron/IDLE; Timeouts für IMAP/POP3/SMTP.

### Fixed
- POP3: stabile Zuordnung über **UIDL** und negative UIDs statt volatiler Message-Nummern; Reporting/Suche/Listen inkl. POP3-Zeilen.
- IMAP Sent-Append nutzt den **tatsächlich geöffneten** Ordner nach Fallback.
- Outbound-Workflows: **fail-closed** bei Fehlern; Ausführung aller konfigurierten Workflows vor finalem Block.
- Workflow-Updates: nullable Felder (z. B. Cron, Graph) per explizitem SQL-Update leerbar.

### Security
- Anhänge: Bestätigung vor Öffnen riskanter Dateitypen; HTML im Composer nach Sanitization speichern.

### Fixed (QA Review)
- SQL-Parameterreihenfolge bei Kategorie-Filter korrigiert — Nachrichten wurden bei aktiver Kategorie falsch oder gar nicht gefiltert.
- POP3: Rückgabe-ID nach Einfügen nutzt korrekte negative UID statt Fallback `0`.
- Nullable Felder (SMTP-Host, OAuth-Provider, Sent-Ordner, Draft-HTML/CC, AI-Prompt) können nun per `NULL` geleert werden — COALESCE-Anti-Pattern an 5 Stellen durch dynamische SET-Klauseln ersetzt.
- Compose: Komma-getrennte Empfänger (To/Cc) werden als separate Adressen geparst statt als ein Eintrag gespeichert.
- IMAP Sent-Append: Non-ASCII-Subjects (ä, ö, ü, ß, …) per RFC 2047 Base64 kodiert; lange Subjects auf ≤75-Zeichen-Chunks aufgeteilt.
- Reporting-Statistiken zählen soft-deleted Nachrichten nicht mehr mit.
- IDLE-Reconnect: Backoff wird nach erfolgreicher Verbindung zurückgesetzt; pending Timer bei Shutdown aufgeräumt (verhindert Ghost-Clients).
- Ticket-Code-Entropie von 3 auf 5 Bytes erhöht (~1.1 Billionen mögliche Codes).
- Frontend-Suche mit 300 ms Debounce (statt IPC-Call pro Tastendruck).

---

## [0.1.5] - 2025-10-07

### Added
- **Cross-Platform Git Attributes**: Introduced `.gitattributes` to normalize LF line endings while preserving CRLF for Windows scripts and marking binary assets.

### Changed
- **MSSQL Connectivity**: `mssql-keytar-service` now parses `host\\instance`, `host,port`, and `tcp:` formats, prefers direct host/port connections when configured, and automatically falls back if SQL Browser resolution fails.
- **Diagnostics Surfacing**: IPC handlers, sync service, and API error helpers forward localized messages with actionable suggestions so the settings UI can display root causes and remediation guidance.
- **Settings Experience**: The MSSQL settings page now shows enriched toast messages with suggested fixes when connection tests or sync operations fail.

### Fixed
- **Named Instance Support**: Resolves connection issues when targeting named instances or external servers with fixed ports by retrying with direct TCP connectivity.

### Technical Details
- **Testing Tooling**: Added Jest scripts and dependencies to support targeted Electron and frontend test suites.

---

## [0.1.4] - 2025-08-13

### Added
- **Global Search Enhancements**: Customer and product autocomplete with dedicated combobox components.
- **Optimized Dropdown Endpoints**: Specialized APIs for lightweight selection lists inside the app.

### Changed
- **Sync Performance**: Batch loading of custom field values, optimized database indexes, and upgraded `better-sqlite3` to v12.2.0.
- **Logging & IPC**: Expanded IPC handler logging for clearer diagnostics and refined TypeScript configurations.

### Fixed
- **Developer Tooling**: Prevented Electron from automatically opening DevTools in production builds.

### Technical Details
- **Automation Scripts**: Added performance-testing utilities plus database seeding and cleanup scripts for repeatable local environments.
- **Schema Improvements**: Introduced composite indexes and broader logging/debugging upgrades across 26+ files.

---

## [0.1.3] - 2025-07-15

### Added
- **Customer Numbers**: Added JTL customer number (cKundenNr) support throughout the application
- **Contact Utilities**: New contact utility functions for better phone/email handling and display
- **Grouping System**: Complete grouping functionality for customers and deals with custom field support
- **Dynamic Deal Calculations**: Dynamic value calculation method for deals with updated components
- **Custom Fields Management**: Full custom fields management system in settings
- **Enhanced Logging**: Integrated electron-log for better logging and error handling
- **MSSQL Keytar Service**: Enhanced password management and connection handling
- **Address Fields**: Updated customer data handling, refactored zipCode to zip
- **German Localization**: Updated deal metadata and notes to German language

### Changed
- **Sync Performance**: Parallel data fetching and chunked processing for better sync performance
- **Data Quality**: Active-only customer and product filtering in JTL sync
- **Enhanced Customer Views**: Improved customer display with proper contact prioritization
- **Database Schema**: Added `customerNumber` column to customers table with migration support
- **UI/UX**: Added customer number column to customer tables with proper sorting
- **Contact Display**: Enhanced customer detail page and cards with better contact information display
- **Progress Reporting**: More detailed progress reporting during sync operations

### Fixed
- **Database Queries**: Enhanced address handling in JTL customer sync with fallback mechanisms
- **Error Handling**: Better error handling and logging during sync operations
- **UI Freezing**: Chunked processing prevents UI freezing during large data imports

### Removed
- Authentication system components (actions, routes, private pages)

### Technical Details
- **Database**: Added customerNumber column migration
- **Sync Engine**: Parallel JTL data fetching with chunked processing
- **Performance**: Optimized customer and product queries with proper filtering
- **Code Quality**: Better prepared statement usage for database operations

---

## [0.1.2] - Previous Release
- Base functionality and features

## [0.1.1-beta] - Initial Beta Release
- Initial beta release with core CRM functionality
