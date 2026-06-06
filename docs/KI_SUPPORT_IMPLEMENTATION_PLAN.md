# KI-Support — Implementierungsplan & Fortschritts-Tracker

**Branch:** `claude/epic-ramanujan-xPM8u`
**Quelle:** `docs/FEATURE_REQUESTS_JTL_KI_SUPPORT.md` (Gap-Analyse aus der Community-Diskussion)
**Leitplanken:** sauber, regressionsfrei, jede Änderung mit Tests (`tsc -b` + eslint + jest) verifiziert. **Basis zuerst**, Großprojekte anfangen + dokumentieren, Tiefe in Folgeschritten.

**Scope-Entscheidung (Pascal):** Nur **E-Mail** + **Marktplätze via E-Mail** (kein direkter Marktplatz-/Helpdesk-API-Kanal). → **P3 (native Konnektoren Freshdesk/Zendesk/Greyhound/Marktplatz-APIs) ist gestrichen.** Umgesetzt werden **P0, P1, P2**.

**Status-Legende:** ⬜ offen · 🟦 in Arbeit · 🟩 Basis steht (Tiefe offen) · ✅ fertig

---

## P0 — Fundament (größter Hebel)

### P0-1 · Token-/Kosten-Tracking + Budgets  — Status: 🟩 Basis steht
**Ziel:** Jeden KI-Aufruf mit prompt/completion-Tokens + geschätzten Kosten erfassen, aggregieren (Tag/Nutzer/Tickettyp/Modell), Budgets/Limits, Anzeige in Diagnose. Fundament für P2-SLA und für „bezahlbar".

**Basis (jetzt):**
- [x] Migration `0017_ai_usage_events` (workspace RLS) + Schema-Typ + Registrierung.
- [x] `ai-usage.ts`: `extractChatCompletionUsage`, Preis-Tabelle + `estimateAiCostMicroUsd`, `recordAiUsageSafe` (eigene Transaktion, best-effort).
- [x] Erfassung an allen 6 KI-Aufrufstellen (classify/transform/text_transform_api/review/agent/reply_suggestion) via `runTrackedChatCompletion` + `captureUsage`-Callback.
- [x] Aggregation im Diagnose-Port (24 h/30 d Tokens/Kosten/Latenz + byNodeType) + Anzeige „KI-Nutzung & Kosten" im Diagnose-Panel.
- [x] Tests: usage-Parsing, Kostenschätzung, `recordAiUsageSafe` (inkl. best-effort), Diagnose-Aggregation.

**Tiefe (später):** harte Budget-Sperre (Aufruf blockieren bei Überschreitung), Limit pro Nutzer/Tickettyp, Alerting, konfigurierbare Preis-Tabelle.

### P0-2 · Confidence aus `ai.classify`  — Status: 🟩 Basis steht
**Ziel:** Klassifizierung gibt zusätzlich einen Sicherheitswert (0–100) als Workflow-Variable aus, damit `logic.threshold` „nur wenn ≥ X %" greifen kann.

**Basis (jetzt):**
- [x] Prompt erweitert: Modell gibt `Kategorie|Sicherheit` zurück; `parseClassificationOutput` (robust, Fallback → null/0).
- [x] Variablen `ai.class` + `ai.class_confidence` (0–100) in die Workflow-Continuation gesetzt (für `logic.threshold`).
- [x] Test: Continuation enthält Label + Confidence (z. B. `Support | 85` → 85).

**Tiefe (später):** Kalibrierung der Confidence; Self-consistency; Confidence auch für `ai.review`/`ai.agent`.

### P0-3 · JTL-Kontextblock automatisch zur Mail  — Status: 🟩 Basis steht
**Ziel:** Absender → passende Bestellung(en) → Tracking/Retoure/Zahlstatus als strukturierter Kontext, den KI-Nodes automatisch erhalten.

**Basis (jetzt):**
- [x] Neuer Workflow-Knoten `jtl.order_context`: read-only-Query mit `{{email}}`/`{{orderNo}}`-Platzhaltern (streng validiert + SQL-escaped, keine kundenspezifische Schema-Annahme), bindet Absender-Adresse automatisch.
- [x] Mappt die erste Ergebniszeile auf `jtl.<spalte>`-Variablen (oder per `mapping`-Konfig) für KI-Nodes; `jtl.context_found` + `no_match`-Port.
- [x] Test: Absender-E-Mail wird escaped injiziert, Spalten-Mapping treibt Folgeknoten.

**Tiefe (später):** Aufnahme in die Editor-Palette; fertige SQL-Vorlagen je JTL-Standardschema; Mehrfach-Bestellungen/Heuristik; Marktplatz-Auftragsnr.-Erkennung aus dem Mailtext; Caching.

---

## P1 — differenzierend

### P1-4 · Abgesicherter Auto-Antwort-Modus (Modus 3)  — Status: ⬜
**Ziel:** Pro Tickettyp echte Auto-Antwort — aber nur mit Sicherheits-Layer. Heute existiert bewusst nur Draft/Hold.

**Basis (jetzt):**
- [ ] Einstellungen (sync_info): `auto_reply_enabled`, Tickettyp-Whitelist, Confidence-Schwelle, Absender-Whitelist, Rate-Limit, Dry-Run-Schalter.
- [ ] Workflow-Knoten/Pfad `email.auto_reply` der NUR sendet, wenn alle Guards erfüllt: Confidence-Gate (P0-2), Whitelist, Rate-Limit, **Anti-Loop `Auto-Submitted: auto-replied` (RFC 3834)**, Audit-Eintrag.
- [ ] Default: deaktiviert / Dry-Run (loggt „würde senden").
- [ ] Tests: alle Guards (jeder Guard blockt einzeln); Anti-Loop-Header; Audit.

**Tiefe (später):** echtes SMTP-Auto-Send produktiv freischalten; Eskalations-Routing.

### P1-5 · KI-gestützte Textbaustein-Auswahl + Variablenfüllung  — Status: ⬜
**Ziel:** KI wählt aus Canned Responses den passenden Baustein und füllt Variablen (günstiger/rechtssicherer als Freitext).

**Basis (jetzt):**
- [ ] Knoten `ai.pick_canned`: Canned-Liste → KI wählt beste ID (+ Confidence) → Variablen (JTL/Kunde) füllen → Draft.
- [ ] Tests: Auswahl + Platzhalterfüllung.

**Tiefe (später):** Mehrsprachigkeit, A/B der Bausteine.

### P1-6 · Modellwahl pro Tickettyp + native Provider  — Status: ⬜
**Ziel:** Günstiges Modell für Standard, starkes für Reklamation; native Anthropic/Gemini zusätzlich zu OpenAI-kompatibel (lokal via `base_url` läuft bereits).

**Basis (jetzt):**
- [ ] Provider-Abstraktion: `provider` am Profil (`openai_compatible` | `anthropic` | `gemini`); Adapter mit einheitlicher `usage`-Rückgabe (für P0-1).
- [ ] Modell-Map pro Tickettyp (sync_info), Auflösung im Node.
- [ ] Tests: Adapter-Auswahl, usage-Normalisierung.

**Tiefe (später):** automatische Eskalation günstig→stark bei niedriger Confidence.

### P1-7 · E-Commerce-Workflow-Vorlagen mitliefern  — Status: 🟩 Basis steht
**Ziel:** Die Standardfälle als fertige Vorlagen in der bestehenden Template-Infra (`workflow-templates-dialog` / `WORKFLOW_TEMPLATES`).

**Basis (jetzt):**
- [x] 8 E-Commerce-Vorlagen (`ecom-*`) in `packages/core/src/workflow/templates.ts`: Wo ist meine Bestellung, Retoure, Defekt/Reklamation, Rechnungskopie, Lieferverzug, Umtausch/Größe, Rückzahlung, Wieder verfügbar — je Stichwort-Erkennung → Tag → Kategorie (nur config-freie, server-unterstützte Knoten).
- [x] Test: alle Templates parsebar (`parseGraphDocument`), ecom-Set eindeutig + condition→tag→category.

**Tiefe (später):** Varianten mit KI-Vorschlag/Auto-Antwort aufgesetzt; mehrsprachige Stichwörter.

### P1-8 · Quellen-Transparenz der KI-Antwort  — Status: 🟩 Basis steht
**Ziel:** Jede KI-Antwort zeigt genutzte Wissens-/Bestellquellen.

**Basis (jetzt):**
- [x] `ai.agent` gibt genutzte Wissens-Chunks als `ai.agent.sources` (Titel/#id) + `ai.agent.source_count` in die Continuation-Variablen.

**Tiefe (später):** Quellen direkt am Entwurf sichtbar (interne Notiz/Header); JTL-Kontextquellen mit aufführen; Relevanz-Scores.

---

## P2 — Qualität & Steuerung

### P2-9 · Feedback-Lernen aus Korrekturen  — Status: ⬜
**Ziel:** KI-Vorschlag vs. gesendete Endfassung speichern, Diff analysieren, Vorlagenverbesserung vorschlagen.

**Basis (jetzt):**
- [ ] Beim Senden eines KI-Drafts: Original-Vorschlag + Endfassung + Diff-Kennzahl speichern (`ai_reply_feedback`).
- [ ] Read: häufigste Ergänzungen je Tickettyp.
- [ ] Tests.

**Tiefe (später):** automatische Vorlagen-Vorschläge, Klassifikator-Nachtraining.

### P2-10 · KI-SLA/Latenz-Dashboard  — Status: 🟩 Basis steht (via P0-1)
**Ziel:** Zeit bis Klassifizierung/Vorschlag, Automatisierungsquote, gesparte Zeit, Kosten.

**Basis (jetzt):** (durch P0-1 abgedeckt)
- [x] Ø-Latenz (24 h), Aufrufe/Tokens/Kosten (24 h/30 Tage) und Aufschlüsselung nach Nodetype im Diagnose-Panel.

**Tiefe (später):** Automatisierungsquote (Auto-Antworten/Tickets), geschätzte gesparte Bearbeitungszeit, Latenz-Perzentile p50/p95, Zeitreihen-Charts.

### P2-11 · Erweiterte kontrollierte JTL-Aktionen  — Status: ⬜
**Ziel:** Rechnung erneut senden, Retoure anlegen, Trackinglink senden — als freigabepflichtige Aktionen.

**Basis (jetzt):**
- [ ] Read-only/Vorschlags-Variante zuerst (Aktion vorbereiten, nicht ausführen) + Audit.
- [ ] Tests.

**Tiefe (später):** echte Schreibaktionen in JTL (hinter Freigabe + Allowlist).

---

## Ablaufplan (Reihenfolge nach Abhängigkeit)

1. **P0-1 Kosten-Tracking** (Fundament, liefert `latency_ms`/`usage` für P2-10 & P1-6).
2. **P0-2 Confidence** (klein, schaltet P1-4-Gate frei).
3. **P0-3 JTL-Kontext** (Basis-Helper).
4. **P1-6 Provider/Modell-Abstraktion** (vereinheitlicht `usage` → speist P0-1 sauber).
5. **P1-5 Canned-Auswahl** & **P1-8 Quellen** (bauen auf RAG/Canned).
6. **P1-4 Auto-Antwort** (braucht P0-2 + Guards) — Default Dry-Run.
7. **P1-7 Vorlagen** (Daten, risikoarm — jederzeit einschiebbar).
8. **P2-9 Feedback**, **P2-10 SLA**, **P2-11 JTL-Aktionen**.

---

## Fortschritts-Log

| Datum | Item | Ergebnis | Commit |
|-------|------|----------|--------|
| 2026-06-06 | Plan | Tracker angelegt; P3 gestrichen (nur E-Mail) | 9361c46 |
| 2026-06-06 | P0-1 | Kosten-Tracking Basis (ai_usage_events + Erfassung + Diagnose) | 394ea24 |
| 2026-06-06 | P0-2 | Confidence aus ai.classify (`ai.class_confidence`) | 1a50464 |
| 2026-06-06 | P0-3 | JTL-Kontext-Knoten `jtl.order_context` (generisch, read-only) | a7562f4 |
| 2026-06-06 | P1-7 | 8 E-Commerce-Workflow-Vorlagen (`ecom-*`) | _dieser Commit_ |
| 2026-06-06 | P1-8 | Quellen-Transparenz `ai.agent.sources` | _dieser Commit_ |
| 2026-06-06 | P2-10 | SLA/Latenz-Basis (durch P0-1 abgedeckt) | _dieser Commit_ |
