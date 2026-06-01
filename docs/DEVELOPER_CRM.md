# CRM-Kern — Entwickler- & LLM-Referenz

Kurze technische Landkarte für Menschen und Assistenzsysteme, die am **klassischen CRM** (Kunden, Deals, Aufgaben, Kalender, JTL-Sync) arbeiten — **nicht** am E-Mail-Modul.

**AI agents:** Start mit [`AGENT_HANDOFF.md`](AGENT_HANDOFF.md) und [`LEARNINGS.md`](LEARNINGS.md). Produktlogik: [`CRM_PRODUCT_GUIDE.md`](CRM_PRODUCT_GUIDE.md). E-Mail: [`DEVELOPER_EMAIL.md`](DEVELOPER_EMAIL.md).

---

## Architektur

| Schicht | Pfade | Rolle |
|--------|--------|--------|
| **Main** | `electron/sqlite-service.ts`, `electron/sync-service.ts`, `electron/database-schema.ts` | SQLite CRUD, Migrationen, Follow-up-Queries, JTL-Sync |
| **IPC** | `electron/ipc/database.ts`, `deals.ts`, `tasks.ts`, `calendar.ts`, `followup.ts`, `dashboard.ts`, `custom-fields.ts`, `sync.ts`, `mssql.ts`, `jtl.ts` | Renderer ↔ Main |
| **Kanäle** | `shared/ipc/channels.ts` | `DbChannels`, `DealChannels`, `TaskChannels`, … |
| **Renderer** | `src/app/**`, `src/services/data/*` | Seiten und dünne Service-Wrapper um `invoke` |
| **Routing** | `src/router.tsx` | TanStack Router (Hash in Electron) |

Es gibt **keinen** separaten CRM-HTTP-Server; optional die **Automation API** (`electron/automation/`, Scope `read`/`write` für CRM-Entitäten).

---

## Datenmodell (SQLite)

Schema-Definitionen: `electron/database-schema.ts`. Migrationen: `runMigrations()` in `electron/sqlite-service.ts`.

| Tabelle | Zweck |
|---------|--------|
| `customers` | Kunden; optional `jtl_kKunde` |
| `deals` | Deals; FK `customer_id`; `stage`, `value`, `value_calculation_method` |
| `deal_products` | n:m Deal ↔ Produkt mit Menge/Preis |
| `tasks` | Aufgaben; FK `customer_id`; `snoozed_until`, `calendar_event_id` |
| `products` | Produktkatalog; optional `jtl_kArtikel` |
| `calendar_events` | Termine; optional `task_id` |
| `activity_log` | Nachverfolgung / Timeline |
| `saved_views` | Gespeicherte Filter für Follow-up |
| `customer_custom_fields` / `customer_custom_field_values` | Custom Fields |
| `sync_info` | Key-Value Sync-Metadaten |
| `jtl_*` | Gecachte JTL-Stammdaten (Firma, Lager, …) |

E-Mail-Tabellen liegen in derselben DB-Datei — siehe `DEVELOPER_EMAIL.md`.

---

## IPC-Kanäle (Auszug)

Definiert in `shared/ipc/channels.ts`, registriert in `electron/ipc/router.ts`:

| Gruppe | Beispiel-Kanäle |
|--------|------------------|
| **DbChannels** | `db:get-customers`, `db:create-customer`, `db:get-customer`, … |
| **DealChannels** | `deals:get-all`, `deals:update-stage`, `deals:add-product`, … |
| **TaskChannels** | `tasks:get-all`, `tasks:toggle-completion`, … |
| **CalendarChannels** | `db:getCalendarEvents`, `db:addCalendarEvent`, … |
| **ProductChannels** | `products:get-all`, `products:create`, … |
| **FollowUpChannels** | `followup:get-items`, `followup:log-activity`, … |
| **DashboardChannels** | `dashboard:get-stats`, … |
| **CustomFieldChannels** | `custom-fields:get-all`, `custom-fields:set-value-for-customer`, … |
| **SyncChannels** | `sync:run`, `sync:get-status` |
| **MssqlChannels** | `mssql:save-settings`, `mssql:test-connection` |
| **JtlChannels** | `jtl:create-order`, `jtl:get-firmen`, … |

**Regel:** Payloads und Rückgabetypen nicht raten — Handler in `electron/ipc/*.ts` und bestehende Services (`src/services/data/`) nachlesen.

---

## Renderer-Services

| Service | Datei | IPC |
|---------|-------|-----|
| Kunden | `customerService.ts` / `localDataService.ts` | DbChannels |
| Deals | (in App/IPC direkt oder über invoke) | DealChannels |
| Aufgaben | `taskService.ts` | TaskChannels |
| Kalender | `calendarService.ts` | CalendarChannels |
| Dashboard | `dashboardService.ts` | DashboardChannels |
| Nachverfolgung | `followUpService.ts` | FollowUpChannels |
| Custom Fields | `customFieldService.ts` | CustomFieldChannels |

Typen: `src/services/data/types.ts`.

---

## Follow-up-Implementierung

- **Zähler:** `getFollowUpQueueCounts()` in `sqlite-service.ts`
- **Listen:** `getFollowUpItems(queue, filters, limit, offset)` — vereinheitlicht Tasks und Deals (`source_type`: `task` | `deal`)
- **IPC:** `electron/ipc/followup.ts`
- **UI:** `src/app/followup/page.tsx`, `src/components/followup/*`

Deal-Queues filtern Stages: schließen u. a. `Gewonnen`, `Verloren`, `Closed Won`, `Closed Lost` aus (Legacy-Strings in SQL).

---

## JTL / MSSQL

- **Einstellungen-UI:** `src/app/settings/page.tsx` → `mssql:*` IPC
- **Sync:** `electron/sync-service.ts` → `runSync()`
- **Passwort:** Keytar (wie E-Mail-Credentials)
- **Bestellung:** `jtl:create-order` — Parameter aus gespeicherten JTL-Settings

---

## Deal-Stages

- Enum: `src/types/deal.ts` → `DealStage`
- Farben/Badges: `getDealStageColor()`
- Stage-Update per IPC: `deals:update-stage`

---

## Tests & Build

- Unit/Integration: `npm test` (Vitest)
- Main bauen: `npm run build:electron:main`
- Lint: `npx eslint . --ext ts,tsx --max-warnings 0`

CRM-spezifische Tests sind verstreut (z. B. Sync, SQLite-Helfer); neue Logik in `sqlite-service.ts` sollte wenn möglich isoliert testbar bleiben.

---

## Dateien bei typischen Änderungen

| Änderung | Dateien |
|----------|---------|
| Neues Kundenfeld | `database-schema.ts`, Migration, `database.ts` IPC, Formulare unter `src/app/customers/` |
| Deal-Logik | `sqlite-service.ts`, `electron/ipc/deals.ts`, `src/app/deals/` |
| Neue Follow-up-Queue | `getFollowUpQueueCounts`, `getFollowUpItems`, `smart-queue-rail.tsx`, `types.ts` |
| Custom Field Typ | `custom-fields.ts` IPC, `settings/custom-fields/page.tsx` |

---

## LLM-Hinweise

1. **Einstellungen:** `/settings` = JTL/MSSQL; `/email/settings` = Mail — nicht verwechseln.
2. **Eine Datenbank:** CRM- und E-Mail-Schema teilen sich `database.sqlite`; Migrationen nicht brechen.
3. **Keine Secrets** im Repo; MSSQL-Passwort und API-Keys über Keytar.
4. **Deutsche UI-Strings** bei neuen sichtbaren Texten beibehalten.
5. Workflow-CRM-Knoten leben unter `electron/workflow/nodes/` — siehe `LEARNINGS_WORKFLOW.md`.
