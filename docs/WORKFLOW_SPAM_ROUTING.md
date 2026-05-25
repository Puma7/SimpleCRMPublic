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
