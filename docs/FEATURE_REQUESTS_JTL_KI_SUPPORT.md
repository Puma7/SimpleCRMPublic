# Feature-Requests: KI-Kundensupport für JTL-Händler (Gap-Analyse + TODO)

**Quelle:** Community-Diskussion (JTL-Software-Gruppe) + Aufarbeitung Pascal.
**Stand:** 2026-06-14 · Settings-Frontend: Wissens-Kontext (inbound/outbound/general) pro Konto ✅
**Methode:** Jeder Request wurde **gegen den tatsächlichen Code abgeglichen** (nicht aus dem Bauch). Ziel: nichts doppelt bauen, was bereits existiert.

## Kernbedürfnis aus der Diskussion

Kleine JTL-Teams (~3 Personen) suchen ein **Support-/Ticketsystem mit KI-Antworten und JTL-Anbindung**, das **bezahlbar** ist (Greyhound-KI „zu langsam", Chatarmin >800 €/Monat). Wiederkehrende Anforderungen: KI-Vorschlag **schon beim Ticket-Eingang**, **JTL-Kontext** (Bestellung/Tracking/Retoure), **Tickettyp-Erkennung**, **abgestufte Automatisierung** (Vorschlag → Freigabe → Auto-Antwort), **Wissensbasis/RAG**, **Kostenkontrolle** und **lokale KI**.

Legende: ✅ vorhanden · 🟡 Bausteine da / teilweise · ❌ fehlt

## Gap-Analyse (Request → Stand im Code)

| # | Request | Stand | Beleg im Code | Restliche Lücke |
|---|---------|-------|---------------|-----------------|
| 1 | KI-Antwort beim Eingang vorberechnen | ✅ | `reply_suggestion_auto_enabled`, `reply_suggestion_trigger_inbound` (`ai-reply-suggestion.ts`), Worker-Job `ai.reply_suggestion` | UI-Status „Vorschlag wird erstellt", Latenz-Anzeige |
| 2 | Tiefe JTL-Wawi-Anbindung als Kontext | 🟡 | `jtl.lookup`-Node, `mssql.query` (read-only validiert, `mssql-settings.ts`), `jtl-order.ts`, `jtl-sync.ts` | Automatischer **JTL-Kontextblock** zur Mail (Bestellung/Tracking/Retoure/Bestand) als fertiger Baustein |
| 3 | Tickettyp automatisch erkennen | 🟡 | `ai.classify` (Label aus fester Liste → Tag/Kategorie, `ai-classification.ts`) | **Confidence/Sicherheit** (nur 1 Label, kein Prozentwert) |
| 4 | Modi: Vorschlag / Freigabe / Auto | 🟡 | Vorschlag ✅ (`ai.agent` createDraft, reply_suggestion); Freigabe ✅ (`email.hold_outbound` + `ai.outbound_review`, fail-closed) | **Modus 3 Vollauto-Antwort ❌** (kein Auto-Versand) |
| 5 | KI wählt Textbaustein statt Freitext | 🟡 | Canned Responses + `{{customer.*}}`-Platzhalter (Schema vorhanden) | KI-gestützte **Auswahl** des passenden Bausteins + Variablenfüllung |
| 6 | Wissensdatenbank / RAG | ✅ | `workflow_knowledge_bases` + `knowledge_context` pro Konto (inbound/outbound/general), Runtime in `ai.agent` | **Quellen-Transparenz** in der Antwort („basiert auf …") |
| 7 | Kostenkontrolle pro Antwort/Nutzer/Monat | ❌ | — (kein Token-/Kosten-Tracking gefunden) | Token-/Kosten-Erfassung, Budget- & Limit-Regeln |
| 8 | Modell-Router / Multi-Provider / lokale KI | 🟡 | AI-Profile mit `base_url` → **OpenAI-kompatibel inkl. LM Studio/Ollama** (`ai-classification.ts:880`) | Native Anthropic/Gemini; **Modellwahl pro Tickettyp** (günstig vs. stark) |
| 9 | Outbound-Workflow / Qualitätsprüfung | ✅ | `ai.outbound_review`, `email.hold_outbound`, fail-closed Hold+Banner (`OUTBOUND_EMAIL_WORKFLOW.md`) | — (starkes Bestandsfeature) |
| 10 | „KI antwortet nur, wenn sie sicher ist" | 🟡 | `logic.threshold`-Node (numerische Gates, z. B. `ai.spam_score`) | `ai.classify` liefert **keine Confidence** → Gate für Klassifikation nicht schließbar |
| 11 | Feedback-Lernen aus Korrekturen | 🟡 | Spam-Lernen (`email_spam_learning_events`, ham/spam) | **Reply-Korrektur-Lernen** (Draft↔Gesendet-Diff → Vorlagenvorschlag) |
| 12 | JTL-Aktionen aus dem Ticket | 🟡 | `jtl-order.ts` `createOrder` (Auftrag anlegen) | Rechnung erneut senden, Retoure anlegen, Trackinglink — kontrollierte Aktionen |
| 13 | E-Commerce-Vorlagen-Builder | 🟡 | Template-Infra: `workflow-templates-dialog.tsx`, `WorkflowTemplateDto`, Server-Templates | Konkrete **E-Commerce-Vorlagen** mitliefern (die 10 Standardfälle) |
| 14 | SLA / Performance-Monitoring KI | 🟡 | Diagnose: `runsLast24h/blocked/error`; Server-Logs + Selbsttest | **KI-Latenz pro Schritt, Automatisierungsquote, gesparte Zeit, Kosten** |
| 15 | Hybrid: eigenes CRM **oder** Anbindung | 🟡 | `http.request` + Webhook + `JOB_WEBHOOK_ALLOWLIST`; IMAP/SMTP + OAuth Gmail/M365 | Native Konnektoren Freshdesk/Zendesk/Greyhound/Marktplätze |

**Fazit:** 9 von 15 sind ganz oder weitgehend vorhanden. Das Produkt ist näher an „bezahlbarer JTL-KI-Support" als die Diskussion vermuten lässt — es fehlen vor allem **Kostentransparenz, Confidence-Gating, ein sicherer Auto-Antwort-Modus und JTL-Kontext/-Aktionen als fertige Bausteine**.

## TODO — nur die echten Lücken, priorisiert

### P0 — größter Hebel, kleiner/mittlerer Aufwand
- [ ] **Token-/Kosten-Tracking (#7).** Pro KI-Aufruf prompt/completion-Tokens + geschätzte Kosten je Modell erfassen; Aggregation pro Tag/Nutzer/Tickettyp; Budget- und Limit-Regeln (weich/hart). Anzeige in Diagnose.
- [ ] **Confidence aus `ai.classify` (#3 + #10).** Klassifizierung soll einen Sicherheitswert (0–100) als Variable ausgeben, damit `logic.threshold` „nur antworten, wenn ≥ X %" erlaubt. Schließt die „nur wenn sicher"-Logik.
- [ ] **JTL-Kontextblock automatisch zur Mail (#2).** Auf Basis von `jtl.lookup`/`mssql.query`: Absender → Bestellung(en) → Tracking/Retoure/Zahlstatus als strukturierter Kontext, der KI-Nodes automatisch mitbekommen.

### P1 — differenzierend
- [ ] **Vollautomatischer Auto-Antwort-Modus (#4 Modus 3)** mit Sicherheits-Layer: Tickettyp-Whitelist, Confidence-Gate, Absender-Whitelist, Rate-Limit, **Anti-Loop (`Auto-Submitted: auto-replied`, RFC 3834)**, Audit-Trail. (Heute existiert bewusst nur Draft/Hold — dieser Modus ist der explizite Wunsch.)
- [ ] **KI-gestützte Textbaustein-Auswahl + Variablenfüllung (#5).** Node, der aus Canned Responses den passenden Baustein wählt und mit JTL-Variablen füllt (günstiger/rechtssicherer als Freitext).
- [ ] **Modellwahl pro Tickettyp + native Provider (#8).** Anthropic/Gemini nativ; pro Tickettyp „günstiges Modell für Standard, starkes Modell für Reklamation".
- [ ] **E-Commerce-Workflow-Vorlagen mitliefern (#13)** in der bestehenden Template-Infra: „Wo ist meine Bestellung?", „Retoure", „Defekt", „Falsche Größe", „Rechnung", „Paket nicht angekommen", „Rückzahlung", „Umtausch", „Wieder verfügbar?".
- [ ] **Quellen-Transparenz (#6 Rest).** Jede KI-Antwort zeigt genutzte Wissens-/Bestellquellen.

### P2 — Qualität & Steuerung
- [ ] **Feedback-Lernen aus Korrekturen (#11).** KI-Vorschlag vs. gesendete Endfassung speichern, Diffs analysieren, häufige Ergänzungen als Vorlagen-Verbesserung vorschlagen.
- [ ] **KI-SLA/Latenz-Dashboard (#14).** Zeit bis Klassifizierung/Vorschlag, Automatisierungsquote, gesparte Bearbeitungszeit, Kosten.
- [ ] **Erweiterte kontrollierte JTL-Aktionen (#12).** Rechnung erneut senden, Retoure anlegen, Trackinglink senden — als freigabepflichtige Aktionen.

### P3 — strategisch / groß
- [ ] **Native Konnektoren (#15)** Freshdesk/Zendesk/Greyhound + Marktplätze (Amazon/eBay/OTTO) als „KI-Layer für bestehende Systeme".

## Zentraler Produktgedanke (geschärft)

Nicht „CRM mit KI-Antworten", sondern:

> **E-Commerce-Supportsystem für JTL-Händler**, das eingehende Anfragen automatisch mit **JTL-Kontext + Wissensbasis + Textbausteinen** verarbeitet, KI-Antworten **schon beim Eingang** erzeugt und je nach Tickettyp als **Vorschlag, Freigabeprozess oder (abgesicherte) Auto-Antwort** ausführt — mit **Kostenkontrolle** und **Outbound-Qualitätsprüfung** vor dem Versand.

Der eigentliche Vorsprung liegt nicht in „KI schreibt Antwort", sondern in **KI + JTL-Kontext + Workflow + Kostenkontrolle + Ausgangsprüfung** — und davon ist Workflow + Ausgangsprüfung + RAG + lokale KI bereits gebaut.
