# SimpleCRM — Produktanforderungen (Muss / Soll / Ist)

**Stand:** 2026-05-24 · Verbindliche Übersicht für PO, Support und Entwicklung.

Detaillierte Checklisten: [`EMAIL_PHASES.md`](EMAIL_PHASES.md), [`WORKFLOW_PHASES.md`](WORKFLOW_PHASES.md). **CRM-Produktlogik:** [`CRM_PRODUCT_GUIDE.md`](CRM_PRODUCT_GUIDE.md).

Legende: **Muss** = Release-kritisch · **Soll** = geplant/nächste Iteration · **Ist** = implementiert (✅/🔲)

**Ist-Stand (Spalte „Ist“):** bezieht sich auf **`main`**, nicht auf offene Feature-Branches. Was nur in Draft-PRs liegt, ist **🔲 geplant** mit Verweis — nach Merge von [#76](https://github.com/Puma7/SimpleCRMPublic/pull/76) / [#77](https://github.com/Puma7/SimpleCRMPublic/pull/77) die betroffenen Zeilen auf ✅ setzen (oder dieses Dokument rebasen). **CRM-Doku (CRM-9, DOC-4)** gilt mit Merge von [#78](https://github.com/Puma7/SimpleCRMPublic/pull/78).

---

## 1. CRM-Kern

| ID | Anforderung | Priorität | Ist |
|----|-------------|-----------|-----|
| CRM-1 | Kunden, Deals, Aufgaben, Kalender, Produkte lokal in SQLite | Muss | ✅ |
| CRM-2 | Kein Cloud-Backend für CRM-Daten | Muss | ✅ |
| CRM-3 | Deutsche UI | Muss | ✅ |
| CRM-4 | Dashboard mit Kennzahlen und Einstiegslisten | Muss | ✅ |
| CRM-5 | Nachverfolgung (Queues, Aktivitäten, Snooze) | Soll | ✅ |
| CRM-6 | Deal-Pipeline mit Stages und Produkten am Deal | Muss | ✅ |
| CRM-7 | Benutzerdefinierte Kundenfelder | Soll | ✅ |
| CRM-8 | Optional JTL-Wawi-Sync (MSSQL) | Soll | ✅ |
| CRM-9 | CRM-Dokumentation (Produkt, User, Developer) | Muss | ✅ |

**Doku:** [`CRM_PRODUCT_GUIDE.md`](CRM_PRODUCT_GUIDE.md) · [`USER_GUIDE_CRM.md`](USER_GUIDE_CRM.md) · [`DEVELOPER_CRM.md`](DEVELOPER_CRM.md)

---

## 2. E-Mail — Postfach

| ID | Anforderung | Priorität | Ist |
|----|-------------|-----------|-----|
| MAIL-1 | IMAP/POP3 Sync, SMTP Versand | Muss | ✅ |
| MAIL-2 | Ordner: Posteingang, Gesendet, Entwürfe, Archiv, Spam, Papierkorb | Muss | ✅ |
| MAIL-3 | Archivieren, Spam, Soft-Delete, Wiederherstellen | Muss | ✅ |
| MAIL-4 | Snooze | Soll | ✅ |
| MAIL-5 | Shared Inbox „Alle Konten“ | Soll | ✅ |
| MAIL-6 | HTML-Lesemodus + DOMPurify | Muss | ✅ |
| MAIL-7 | Externe Links mit Bestätigung | Muss | ✅ |
| MAIL-8 | Compose: Antwort, Weiterleitung, Anhänge, geplanter Versand | Muss | ✅ |
| MAIL-9 | Manuelle Kategorie am Thread (UI) | Soll | ✅ (#71) |
| MAIL-10 | IMAP Sync optional Sent/Archive/Spam pro Konto | Soll | 🔲 geplant ([#77](https://github.com/Puma7/SimpleCRMPublic/pull/77)) |

---

## 3. E-Mail — Sicherheit & Auth

| ID | Anforderung | Priorität | Ist |
|----|-------------|-----------|-----|
| SEC-1 | Credentials in Keytar | Muss | ✅ |
| SEC-2 | SPF/DKIM/DMARC auf Headers (mailauth) | Soll | ✅ |
| SEC-3 | Optional Rspamd HTTP | Soll | ✅ |
| SEC-4 | Server-Löschung nur mit Opt-in | Muss | ✅ |

---

## 4. KI

| ID | Anforderung | Priorität | Ist |
|----|-------------|-----------|-----|
| AI-1 | Mehrere KI-Profile (Modell + Key) | Muss | ✅ |
| AI-2 | Prompt-Bibliothek mit Profil-Zuordnung | Muss | ✅ |
| AI-3 | Workflow-Knoten: Spam-Score, Klassifizierung, Agent, Outbound-Review | Muss | ✅ |
| AI-4 | **KI-Profil-Dropdown** im Workflow-Knoten-Editor | Muss | 🔲 geplant ([#76](https://github.com/Puma7/SimpleCRMPublic/pull/76); siehe [`EMAIL_ROADMAP.md`](EMAIL_ROADMAP.md)) |
| AI-5 | Embeddings / Vektor-RAG | Soll | 🔲 |

---

## 5. Workflows

| ID | Anforderung | Priorität | Ist |
|----|-------------|-----------|-----|
| WF-1 | Graph-Runtime (`graph_json`) | Muss | ✅ |
| WF-2 | Trigger: inbound, outbound, schedule, CRM, webhook | Muss | ✅ |
| WF-3 | Outbound fail-closed bei Fehler/Block | Muss | ✅ |
| WF-4 | Vorlagen, Versionen, Dry-Run, Lauf-Historie | Soll | ✅ |
| WF-5 | Visuelle KI-Profil-Auswahl (nicht nur JSON) | Muss | 🔲 geplant ([#76](https://github.com/Puma7/SimpleCRMPublic/pull/76)) |

---

## 6. Betrieb & Backup

| ID | Anforderung | Priorität | Ist |
|----|-------------|-----------|-----|
| OPS-1 | Diagnose-JSON (Support) | Muss | ✅ |
| OPS-2 | Vollbackup ZIP (DB + Anhänge) | Muss | ✅ |
| OPS-3 | Restore-Dokumentation | Muss | 🔲 geplant (Plan in Draft [#76](https://github.com/Puma7/SimpleCRMPublic/pull/76): `MAIL_BETA_PHASE3_PLAN.md`; Vollbackup-Export auf `main`: ✅) |
| OPS-4 | Backup-Integritätsprüfung | Soll | 🔲 geplant ([#76](https://github.com/Puma7/SimpleCRMPublic/pull/76)) |
| OPS-5 | Restore-Wizard in der App | Soll | 🔲 geplant ([#77](https://github.com/Puma7/SimpleCRMPublic/pull/77)) |

---

## 7. Externe Automation API

| ID | Anforderung | Priorität | Ist |
|----|-------------|-----------|-----|
| API-1 | REST `/api/v1` mit API-Key + Scopes | Soll | ✅ |
| API-2 | Dokumentation `API_V1.md` | Muss | ✅ |

---

## 8. Dokumentation (Meta)

| ID | Anforderung | Ist |
|----|-------------|-----|
| DOC-1 | `docs/INDEX.md` ohne tote Links | 🔲 (`main`: u. a. `MAIL_BETA_*`-Platzhalter ohne Datei; Nachzug [#76](https://github.com/Puma7/SimpleCRMPublic/pull/76)) |
| DOC-2 | `AGENT_HANDOFF.md` aktuell | 🔲 teilweise (`main`: veraltete PR-#19-Metadaten; CRM-Pfade mit [#78](https://github.com/Puma7/SimpleCRMPublic/pull/78)) |
| DOC-3 | Produktlogik `EMAIL_PRODUCT_GUIDE.md` | ✅ |
| DOC-4 | CRM-Doku (`CRM_*`, `USER_GUIDE_CRM`, `DEVELOPER_CRM`) | ✅ ([#78](https://github.com/Puma7/SimpleCRMPublic/pull/78)) |

---

## Änderungshistorie

| Datum | Änderung |
|-------|----------|
| 2026-05-24 | Erstversion (Ist-Spalte = `main`; Sprint-Features als 🔲 mit PR-Verweis) |
| 2026-05-24 | CRM-Kern erweitert; dedizierte CRM-Dokumentation ([#78](https://github.com/Puma7/SimpleCRMPublic/pull/78)) |
| 2026-06-01 | Bugbot [#78](https://github.com/Puma7/SimpleCRMPublic/pull/78): MAIL-10, AI-4, WF-5, OPS-4/5 nicht mehr als auf `main` ✅ ausgewiesen |
