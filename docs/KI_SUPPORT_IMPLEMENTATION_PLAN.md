# KI-Support — Implementierungsplan & Fortschritts-Tracker

**Branch:** `claude/epic-ramanujan-xPM8u`
**Quelle:** `docs/FEATURE_REQUESTS_JTL_KI_SUPPORT.md` (Gap-Analyse aus der Community-Diskussion)
**Leitplanken:** sauber, regressionsfrei, jede Änderung mit Tests (`tsc -b` + eslint + jest) verifiziert. **Basis zuerst**, Großprojekte anfangen + dokumentieren, Tiefe in Folgeschritten.

**Scope-Entscheidung (Pascal):** Nur **E-Mail** + **Marktplätze via E-Mail** (kein direkter Marktplatz-/Helpdesk-API-Kanal). → **P3 (native Konnektoren Freshdesk/Zendesk/Greyhound/Marktplatz-APIs) ist gestrichen.** Umgesetzt werden **P0, P1, P2**.

**Status-Legende:** ⬜ offen · 🟦 in Arbeit · 🟩 Basis steht (Tiefe offen) · ✅ fertig

---

## P0 — Fundament (größter Hebel)

### P0-1 · Token-/Kosten-Tracking + Budgets  — Status: ⬜
**Ziel:** Jeden KI-Aufruf mit prompt/completion-Tokens + geschätzten Kosten erfassen, aggregieren (Tag/Nutzer/Tickettyp/Modell), Budgets/Limits, Anzeige in Diagnose. Fundament für P2-SLA und für „bezahlbar".

**Basis (jetzt):**
- [ ] Migration: Tabelle `ai_usage_events` (workspace, ts, profile_id, model, node_type, message_id, run_id, prompt_tokens, completion_tokens, est_cost_micro, latency_ms).
- [ ] Schema-Typ in `db/schema.ts` + Registrierung in `migrations/index.ts`.
- [ ] Erfassung an der zentralen KI-Aufrufstelle (OpenAI-kompatibler `chat/completions`-Call) → `usage` auslesen, Kosten je Modell schätzen (Preis-Tabelle, konfigurierbar).
- [ ] Read-Port: Aggregation (Summe Tokens/Kosten 24 h/30 d, Top-Modelle, Top-Nodetypes).
- [ ] Diagnose-Anzeige: neuer Abschnitt „KI-Nutzung & Kosten" im Diagnose-Panel.
- [ ] Tests: Erfassung schreibt Event; Aggregation rechnet korrekt; Kostenschätzung.

**Tiefe (später):** harte Budget-Sperre (Aufruf blockieren bei Überschreitung), Limit pro Nutzer/Tickettyp, Alerting.

### P0-2 · Confidence aus `ai.classify`  — Status: ⬜
**Ziel:** Klassifizierung gibt zusätzlich einen Sicherheitswert (0–100) als Workflow-Variable aus, damit `logic.threshold` „nur wenn ≥ X %" greifen kann.

**Basis (jetzt):**
- [ ] Prompt erweitern: Modell gibt `Label|Confidence` zurück (robustes Parsing, Fallback bei fehlender Zahl).
- [ ] Variable `ai.class_confidence` (0–100) + `ai.class` setzen.
- [ ] Tests: Parsing inkl. Fallback; Variable landet im Kontext.

**Tiefe (später):** Kalibrierung der Confidence; Self-consistency.

### P0-3 · JTL-Kontextblock automatisch zur Mail  — Status: ⬜
**Ziel:** Absender → passende Bestellung(en) → Tracking/Retoure/Zahlstatus als strukturierter Kontext, den KI-Nodes automatisch erhalten.

**Basis (jetzt):**
- [ ] Helper `buildJtlContextForMessage(message)` auf Basis `jtl.lookup`/`mssql.query`/`jtl-order` (read-only): Bestellnr., Status, Tracking, Carrier, Retoure, Zahlstatus.
- [ ] Als Kontext-Variablen (`jtl.order_no`, `jtl.tracking`, …) für KI-Nodes verfügbar.
- [ ] Tests mit Fake-JTL-Daten.

**Tiefe (später):** Mehrere Bestellungen/Heuristik beste Zuordnung; Caching; Marktplatz-Auftragsnr.-Erkennung aus dem Mailtext.

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

### P1-7 · E-Commerce-Workflow-Vorlagen mitliefern  — Status: ⬜
**Ziel:** Die 10 Standardfälle als fertige Vorlagen in der bestehenden Template-Infra (`workflow-templates-dialog`).

**Basis (jetzt):**
- [ ] Vorlagen: „Wo ist meine Bestellung?", Retoure, Defekt, Falsche Größe, Rechnung, Paket nicht angekommen, Rückzahlung, Umtausch, Wieder verfügbar?.
- [ ] Tests: Vorlagen valide (parsebar, Knoten unterstützt).

### P1-8 · Quellen-Transparenz der KI-Antwort  — Status: ⬜
**Ziel:** Jede KI-Antwort zeigt genutzte Wissens-/Bestellquellen.

**Basis (jetzt):**
- [ ] RAG/Agent-Nodes geben genutzte Chunk-/JTL-Quellen als Variable/Meta zurück; in Draft-Meta sichtbar.
- [ ] Tests.

---

## P2 — Qualität & Steuerung

### P2-9 · Feedback-Lernen aus Korrekturen  — Status: ⬜
**Ziel:** KI-Vorschlag vs. gesendete Endfassung speichern, Diff analysieren, Vorlagenverbesserung vorschlagen.

**Basis (jetzt):**
- [ ] Beim Senden eines KI-Drafts: Original-Vorschlag + Endfassung + Diff-Kennzahl speichern (`ai_reply_feedback`).
- [ ] Read: häufigste Ergänzungen je Tickettyp.
- [ ] Tests.

**Tiefe (später):** automatische Vorlagen-Vorschläge, Klassifikator-Nachtraining.

### P2-10 · KI-SLA/Latenz-Dashboard  — Status: ⬜
**Ziel:** Zeit bis Klassifizierung/Vorschlag, Automatisierungsquote, gesparte Zeit, Kosten.

**Basis (jetzt):** (nutzt P0-1 `latency_ms` + Aggregation)
- [ ] Metriken in Diagnose: Ø-Latenz je Nodetype, Automatisierungsquote, Kosten/Tag.
- [ ] Tests.

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
| 2026-06-06 | Plan | Tracker angelegt; P3 gestrichen (nur E-Mail) | _folgt_ |
