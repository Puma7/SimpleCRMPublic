# E-Mail-Workflows: Spam, Routing & DSGVO-KI

## Pipeline (empfohlen)

1. **Absender-Filter** (`email.sender_filter`)  
   - Kanten: `whitelist` | `blacklist` | `default`  
   - Globale Listen: Einstellungen → Automatisierung  
   - Eingebaute Vertrauensliste: PayPal, Amazon, Lidl, DHL, …

2. **KI-Spam-Wahrscheinlichkeit** (`ai.spam_score`)  
   - Nur **Metadaten** (Betreff, Vorschau, Von/An, Anhänge) — **kein Volltext**  
   - KI antwortet mit Zahl **1–100** → Variable `ai.spam_score`

3. **Schwellwert** (`logic.threshold`)  
   - z. B. `ai.spam_score` ≥ 70 → Kante `yes`

4. **Als Spam markieren** (`email.mark_spam`)  
   - Setzt `is_spam`, optional Tag und IMAP-Ordner Spam  
   - `stopFurtherWorkflows` (Standard in Vorlagen): Graph-Stopp + Server überspringt nachfolgende Inbound-Workflows bei Spam

5. **Stopp nach Spam** (`logic.stop_after_spam`) — optional hinter `mark_spam` in Vorlagen

## Prioritäten (Inbound)

| Bereich | Empfohlene Priorität |
|---------|----------------------|
| Spam-Pipelines | 1–9 (niedrigere Zahl = früher) |
| Sortierung / Klassifizierung | 10–49 |
| KI-Agent / Auto-Antwort | 50+ |

Server führt Inbound-Workflows **seriell** nach Priorität aus; bei Spam/Review werden Workflows mit `skipIfMessageSpamOrReview` übersprungen. `ai.agent` prüft zusätzlich vor Side-Effects.

## `ai.spam_score` — Desktop vs. Server

- **Desktop:** Profil, Prompt und `contextMode` (metadata/full) steuern den Live-KI-Score.
- **Server:** nutzt gespeicherten oder lokal berechneten Score — Profil/Prompt/contextMode werden ignoriert (`ai.spam_score.server_note` im Lauf).

## Weitere Knoten

| Knoten | Zweck |
|--------|--------|
| `ai.classify` | Themen (Rechnung, Support, …) — `contextMode: metadata` |
| `logic.switch` | Routing nach `ai.class` |
| `email.assign` | Mitarbeiter (`teamMemberId`) |
| `email.set_category` / `email.forward_copy` | Ordner & Rechnungs-Weiterleitung |

## Vorlagen

- **Eingehend: KI-Spam-Pipeline (DSGVO)** — komplette Spam-Kette  
- **Eingehend: Rechnung weiterleiten** — Bedingung + Weiterleitung  
- **Eingehend: Themen & Mitarbeiter (KI)** — Klassifizierung + Schalter  

## Einstellungen

**E-Mail → Einstellungen → Automatisierung → Workflow-Automatisierung**

- Absender-Whitelist / -Blacklist  
- Spam-Schwellwert (Empfehlung für `logic.threshold`)
