# CRM-Kern — Produkt- und Bedienungslogik

Dieses Dokument beschreibt das **Soll-Verhalten** des klassischen CRM in SimpleCRM (ohne E-Mail-Modul). Es ergänzt die technische Entwickler-Doku (`DEVELOPER_CRM.md`) und die Kurzanleitung (`USER_GUIDE_CRM.md`).

**Zielgruppe:** Product Owner, Support, neue Entwickler und KI-Agenten.

**Abgrenzung:** Postfach, Workflows und KI für E-Mail stehen in [`EMAIL_PRODUCT_GUIDE.md`](EMAIL_PRODUCT_GUIDE.md). Übergreifende Anforderungen: [`PRODUCT_REQUIREMENTS.md`](PRODUCT_REQUIREMENTS.md).

---

## 1. Architekturprinzipien

| Prinzip | Bedeutung |
|---------|-----------|
| **Lokal** | Kunden, Deals, Aufgaben, Produkte, Kalender und Aktivitäten liegen in **SQLite** auf dem Rechner (`better-sqlite3` im Electron-Main-Prozess). |
| **Kein CRM-Cloud-Backend** | Es gibt keinen zentralen SimpleCRM-Server für Stammdaten. Optional: **JTL-Wawi** per MSSQL-Sync (Lesen/Schreiben nur für konfigurierte Integration). |
| **Deutsche UI** | Navigation und Standardtexte sind deutsch (z. B. Kunden, Aufgaben, Nachverfolgung). |
| **Renderer ↔ Main** | Die React-Oberfläche ruft Daten per **IPC** ab (`window.electronAPI.invoke`); Business-Logik für Persistenz liegt im Main-Prozess. |

**Datenbankpfad (Linux, produktiv):** `~/.config/simplecrm/database.sqlite` — in der Entwicklung oft unter `~/.config/Electron/`.

---

## 2. Navigation und Bereiche

Hauptnavigation (`src/components/main-nav.tsx`):

| Route | Bereich | Zweck |
|-------|---------|--------|
| `/` | **Dashboard** | Kennzahlen, letzte Kunden, anstehende Aufgaben, Onboarding-Hinweis bei leerer DB |
| `/followup` | **Nachverfolgung** | Arbeitslisten (Queues) für Aufgaben und stagnierende Deals |
| `/customers` | **Kunden** | Liste, Suche, Anlage; Detail unter `/customers/$customerId` |
| `/deals` | **Deals** | Pipeline-Übersicht und Detail `/deals/$dealId` |
| `/tasks` | **Aufgaben** | Alle Aufgaben, Filter, Erledigen |
| `/products` | **Produkte** | Katalog (lokal oder aus JTL-Sync) |
| `/calendar` | **Kalender** | Termine; optional verknüpft mit Aufgaben |
| `/email` | **E-Mail** | Separates Modul (eigene Doku) |
| `/settings` | **Einstellungen** | MSSQL/JTL-Verbindung, Sync — **nicht** E-Mail-Einstellungen |
| `/settings/custom-fields` | **Benutzerdefinierte Felder** | Schema für Zusatzfelder am Kunden |

**Befehlspalette:** `Strg+K` — Schnellnavigation zu Kunden und weiteren Aktionen.

---

## 3. Entitäten und Beziehungen

```
Kunde (customers)
  ├── Deals (deals) — genau ein Kunde pro Deal
  ├── Aufgaben (tasks) — genau ein Kunde pro Aufgabe
  ├── Aktivitäten (activity_log) — optional Deal/Aufgabe
  └── Custom-Field-Werte (customer_custom_field_values)

Deal
  └── Deal-Produkte (deal_products) → Produkt (products)

Aufgabe
  └── optional calendar_event_id → Kalendertermin

Kalender (calendar_events)
  └── optional task_id
```

### Kunde

- Stammdaten: Name, Firma, E-Mail, Telefon, Adresse, Notizen, Status, Affiliate-Link.
- **JTL:** `jtl_kKunde`, Kundennummer, Sync-Zeitstempel — Datensätze können aus der Wawi stammen oder **lokal** angelegt werden (`jtl_kKunde` null).
- **E-Mail-Verknüpfung:** Im E-Mail-Modul kann eine Nachricht einem Kunden zugeordnet werden; Workflows und Textbausteine nutzen `{{customer.*}}`.

### Deal

- Gehört zu einem Kunden; hat **Stage** (Pipeline), **Wert**, erwartetes Abschlussdatum, Notizen.
- **Wertberechnung:** `static` (fester Betrag) oder `dynamic` (Summe aus verknüpften Produkten × Menge/Preis).
- **Produkte am Deal:** Zeilen in `deal_products` mit Menge und Preis zum Zeitpunkt der Zuordnung.

### Aufgabe

- Titel, Beschreibung, Fälligkeit, Priorität, erledigt/offen.
- **Snooze:** `snoozed_until` — relevant für Nachverfolgung („Zurückgestellt“).
- Optional Verknüpfung zu einem Kalendertermin.

### Produkt

- Name, SKU, Preis, aktiv/inaktiv; optional JTL-Artikel-ID.

### Aktivitätenprotokoll

- Typen z. B. Anruf, E-Mail, Notiz (Nachverfolgung / Kundenhistorie).
- Metadaten als JSON in `metadata`.

---

## 4. Deal-Pipeline (Stages)

Definiert in `src/types/deal.ts` (`DealStage`):

| Stage | Typische Bedeutung |
|-------|-------------------|
| Prospekt | Erstkontakt / Lead |
| Interessent | Interesse bestätigt |
| Qualifiziert | Bedarf geklärt |
| Angebot | Angebot liegt vor |
| Vorschlag | Formales Angebot / Proposal |
| Verhandlung | Preis/Bedingungen |
| Gewonnen / Verloren | Abschluss (offen) |
| Abgeschlossen Gewonnen / Abgeschlossen Verloren | Finaler Abschluss |

**Nachverfolgung:** Offene Deals in Queues „Stagnierend“ und „High-Value-Risk“ schließen **Gewonnen**, **Verloren** und legacy-Namen `Closed Won` / `Closed Lost` aus (SQL in `sqlite-service.ts`).

---

## 5. Nachverfolgung (Follow-up)

Zentrale Arbeitsfläche unter `/followup` — drei Spalten: **Queues**, **Liste**, **Detail** (Kunde, Deal, Timeline).

### Aufgaben-Queues

| Queue-ID | Anzeigename | Logik (Kurz) |
|----------|-------------|--------------|
| `heute` | Heute | Offene Aufgaben, Fälligkeit = heute, nicht snoozed |
| `ueberfaellig` | Überfällig | Fälligkeit vor heute |
| `diese_woche` | Diese Woche | Fälligkeit innerhalb 7 Tage |
| `zurueckgestellt` | Zurückgestellt | `snoozed_until` in der Zukunft |

### Deal-Queues

| Queue-ID | Anzeigename | Logik (Kurz) |
|----------|-------------|--------------|
| `stagnierende_deals` | Stagnierende Deals | Offene Stage, `last_modified` älter als 14 Tage |
| `high_value_risk` | High-Value-Risk | Wert > 1000 € und (Abschlussdatum nahe oder inaktiv > 7 Tage) |

### Weitere Funktionen

- **Aktivität protokollieren** (Anruf, E-Mail, Notiz) → `activity_log`.
- **Aufgabe snoozen** — verschiebt Bearbeitung (geteilt mit E-Mail-Snooze-Zeiten in Einstellungen).
- **Gespeicherte Ansichten** — Filter-Presets in `saved_views`.
- **Tastaturkürzel** — Hilfe im UI (Popover auf der Nachverfolgungsseite).

---

## 6. Dashboard

- **Kennzahlen:** Kundenanzahl, aktive Deals, offene Aufgaben (IPC `dashboard:get-stats`).
- **Letzte Kunden** und **nächste Aufgaben** als Einstieg in die Bearbeitung.
- **Leere Installation:** Onboarding-Karte mit Links zu Kunden anlegen und Einstellungen.

---

## 7. JTL-Wawi-Integration (optional)

Unter **Einstellungen** (Haupt-App, nicht E-Mail):

1. **MSSQL-Verbindung** speichern (Server, DB, Benutzer; Passwort in **Keytar**).
2. **Verbindung testen** und **Sync starten** — importiert/aktualisiert Kunden und Produkte aus JTL (Richtung und Umfang siehe `electron/sync-service.ts`).
3. **JTL-Parameter:** `kBenutzer`, `kShop`, Währung usw. für Bestellungen.
4. **JTL-Auftrag anlegen** — IPC `jtl:create-order` (aus passenden UI-Flows / Integration).

Lokale Tabellen für JTL-Stammdaten: Firmen, Warenlager, Zahlungsarten, Versandarten.

**Wichtig:** CRM-Stammdaten bleiben in SQLite; MSSQL ist die **externe** Wawi, nicht der SimpleCRM-Server.

---

## 8. Benutzerdefinierte Felder

- Definition unter **Einstellungen → Benutzerdefinierte Felder** (`/settings/custom-fields`).
- Feldtypen (Text, Zahl, Auswahl, …) mit optional **Pflichtfeld** und **Reihenfolge**.
- Werte pro Kunde in `customer_custom_field_values`.

---

## 9. Externe Automation API (CRM-relevant)

Wenn aktiviert (**E-Mail → Einstellungen → Automatisierung**), erreichbar unter `http://127.0.0.1:<port>/api/v1`:

- **Scopes `read` / `write`:** Kunden, Deals, Aufgaben (CRUD, Stage-Update, Task-Toggle).
- Siehe [`API_V1.md`](API_V1.md) und [`SECURITY_AUTOMATION_API.md`](SECURITY_AUTOMATION_API.md).

E-Mail- und Workflow-Endpunkte sind **zusätzlich** (Scopes `email`, `workflows`).

---

## 10. Schnittstelle zum E-Mail-Modul

| CRM | E-Mail |
|-----|--------|
| Kundenstamm | Nachricht → Kunde verknüpfen |
| Deal aus Mail | „Neuer Deal“ im Nachrichten-Menü (Kunde vorausgesetzt) |
| Kalender | Termin aus E-Mail (mit/ohne Kunde) |
| Workflows | Trigger/Aktionen `crm.*` (z. B. Aufgabe anlegen, Deal-Stage) |
| Nachverfolgung | Gemeinsame Snooze-Voreinstellungen (E-Mail-Einstellungen) |

Produktlogik E-Mail: [`EMAIL_PRODUCT_GUIDE.md`](EMAIL_PRODUCT_GUIDE.md).

---

## 11. Bekannte Grenzen / Roadmap-Hinweise

| Thema | Stand |
|-------|--------|
| Multi-User / Rechte | Single-User-Desktop; keine Mandanten-Trennung in SQLite |
| CRM-Cloud-Sync | Nicht vorgesehen |
| Deal-Pipeline konfigurierbar | Stages fest im Code/Enum |
| Vollbackup CRM-only | E-Mail-Backup-ZIP enthält DB + Anhänge; CRM-Daten in derselben DB |
| Offline | Standardbetrieb ist offline-first (ohne JTL/MSSQL) |

---

## Änderungshistorie

| Datum | Änderung |
|-------|----------|
| 2026-05-24 | Erstversion — Parität zur E-Mail-Produktdoku |
