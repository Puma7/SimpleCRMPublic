# E-Mail-Modul — Produkt- und Bedienungslogik

Dieses Dokument beschreibt das **Soll-Verhalten** des SimpleCRM-E-Mail-Moduls aus Produkt- und Anwendersicht. Es ergänzt die technische Entwickler-Doku (`DEVELOPER_EMAIL.md`, `WORKFLOW_PHASES.md`).

**Zielgruppe:** Product Owner, Support, neue Entwickler und KI-Agenten, die Features erklären oder erweitern.

---

## 1. Konten und Postfach

### Ein Konto vs. alle Konten

- Oben in der Sidebar wählen Sie **ein Postfach-Konto** oder **„Alle Konten“**.
- **Ein Konto:** klassisches Verhalten — Ordner, Kategorien und Zähler beziehen sich nur auf dieses Konto.
- **Alle Konten:** **Shared Inbox** — alle Mitarbeiter sehen Nachrichten aller Konten in einer Liste (z. B. 100 Online-Shops). In der Nachrichtenliste erscheint ein Badge mit dem Kontonamen.
- **Synchronisieren** bei „Alle Konten“ lädt **jedes** konfigurierte Konto nacheinander.
- **Verfassen** bei „Alle Konten“ nutzt das erste Konto bzw. das Konto der beantworteten Nachricht (Antwort/Weiterleitung).

### Ordner (links)

| Ordner | Bedeutung |
|--------|-----------|
| Posteingang | Eingehende, nicht archivierte, nicht Spam |
| Gesendet | Lokal als gesendet markierte Nachrichten |
| Entwürfe | Entwürfe inkl. ausgehend gehaltene Entwürfe (`outbound_hold`) |
| Archiv | **Erledigt / ausgeblendet** — lokal `archived=1` |
| Spam | Lokal als Spam markiert |
| Papierkorb | Soft-Delete — lokal ausgeblendet, wiederherstellbar |

### Kategorien (unter den Ordnern)

- Kategorien sind **global** (z. B. Webshop, Rechnungen, Kundenservice) — nicht pro Konto.
- Sie dienen als **Filter im Posteingang** („Alle“ = kein Kategoriefilter).
- Zuweisung über **Workflows** (`email.set_category`) oder **manuell** am Thread (Kategorie-Dropdown in der Nachrichtenliste / Detail).
- Zähler neben Kategorien beziehen sich auf den **aktuellen Kontext** (ein Konto oder alle Konten im Posteingang).

---

## 2. Nachrichten bearbeiten

| Aktion | UI | Wiederfinden |
|--------|-----|--------------|
| **Archivieren** („erledigt“) | Button Archiv | Ordner **Archiv** oder Suche |
| **Spam** | Button Spam | Ordner **Spam** |
| **Papierkorb** | Button Löschen | Ordner **Papierkorb** → **Wiederherstellen** |
| **Weiterleiten / Antworten** | Compose | Gesendet / Posteingang |
| **Gelesen** | Toggle | Unread-Zähler |

**Hinweis:** Papierkorb und Archiv sind **lokal** (SQLite). Nur „Gelesen“ wird optional per IMAP zurückgeschrieben. Server-Löschung nur über Workflow-Knoten „Auf Server löschen“ (mit Opt-in unter **Einstellungen → Konten**).

### Suche (große Postfächer)

- Volltextsuche nutzt **SQLite FTS**, falls verfügbar, sonst LIKE auf Betreff/Snippet/Body.
- Suche im aktuellen Ordner-Kontext; bei sehr großen Datenmengen Pagination/Limits beachten (Standard-Limit in der Liste).
- **Regex** in der UI derzeit nicht — Erweiterung möglich.

---

## 3. Team, Signaturen, Textbausteine

### Team & Zuweisung

- **Teammitglieder** (Einstellungen → Team): ID + Anzeigename + **HTML-Signatur**.
- **Zuweisung:** Metadaten-Panel an der Nachricht (`assigned_to`) — für spätere Verteilung/Reporting.
- **Signatur:** wird bei **neuen** E-Mails (nicht bei jeder Antwort automatisch) unter den Entwurf gesetzt — aktuell Signatur des ersten Team-Eintrags (Vorbereitung Mehrbenutzer).

### Textbausteine

- Vorlagen mit Platzhaltern: `{{customer.name}}`, `{{customer.firstName}}`, `{{customer.email}}` (wenn Kunde verknüpft).
- Einfügen im Compose-Dialog; Erstellung unter **Einstellungen → Textbausteine**.

---

## 4. Workflows

- Liste filterbar: **Alle | Eingehend | Ausgehend | Sonstige** (Zeitplan, CRM, manuell).
- **Eingehend:** Trigger `inbound`, `draft_created`
- **Ausgehend:** Trigger `outbound` (Qualitätsprüfung vor SMTP)
- Graph-Editor: modulare Knoten aus der Palette; Ausführung über `graph_json`.
- **KI-Profil** pro KI-Knoten: Dropdown in den Knoten-Eigenschaften (oder Experten-JSON `profileId`). Reihenfolge bei Prompt-Knoten: Knoten-Profil → Prompt-Profil → Standard-Profil.

Ausführung intern: `workflow-executor` → `runtime` → Registry-Knoten. Tests: `npm test` (Workflow-Integration).

---

## 5. KI-Einstellungen (Profile)

- **Mehrere Profile** — je Anbieter/Modell ein Eintrag.
- **API-Key pro Profil** (Keytar), getrennt vom Modellnamen.
- Vorlagen: OpenAI, Open Router, Anthropic, Google, DeepSeek, Ollama, frei konfigurierbar.
- **Embedding-Modell** pro Profil für die **Wissensbasis**.
- Legacy-Einstellung (ein Key) wird beim ersten Start in ein Standard-Profil migriert.

---

## 6. Wissensbasis

- Unter **Einstellungen → Wissensbasis**: Sammlungen anlegen, Text-Chunks oder Dateien importieren.
- Embeddings (wenn API-Key) ermöglichen Ähnlichkeitssuche; sonst Stichwort-Fallback.
- Nutzung in Workflows über **KI-Agent** / **KI-Agent-Tool** mit `knowledgeBaseId` in der Konfiguration.
- Kein direkter Einsatz im Compose-Editor.

---

## 7. Einstellungen — Kurzüberblick

| Tab | Funktion |
|-----|----------|
| Konten | IMAP/POP3, **IMAP-Server-Löschung (Workflows)**, Alle-Konten-Hinweis |
| SMTP | Versand pro Konto |
| OAuth | Google/Microsoft (Implementierung im Main-Prozess) |
| KI | Profile, Keys, Modelle |
| Wissensbasis | RAG-Sammlungen |
| Automatisierung | Absender-Listen, Spam-Schwelle, HTTP-Allowlist, externe API |
| KI-Prompts | Vorlagen für Transform/KI-Knoten |
| Team | Mitglieder, Signaturen, Zuweisung |
| Textbausteine | CRM-Platzhalter |
| Datenschutz-Export | GDPR-Export |

---

## 8. Roadmap (aus Feedback)

- Mehrbenutzer-Login mit Signatur pro angemeldetem User
- Manuelle Kategorie-Zuweisung in der UI
- KI-Profil-Dropdown im Workflow-Knoten-Panel (statt nur JSON)
- Regex/erweiterte Suche, Pagination für Millionen Mails
- IMAP-Ordner-Sync für Archiv/Spam auf dem Server

Siehe auch `docs/EMAIL_ROADMAP.md`.
