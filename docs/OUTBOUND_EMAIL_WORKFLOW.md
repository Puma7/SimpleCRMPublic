# Ausgehende E-Mail-Workflows

## Ablauf beim Senden

1. Nutzer klickt **Senden** im Compose-Dialog.
2. Entwurf wird gespeichert; `outbound_hold` wird für den erneuten Versuch zurückgesetzt.
3. **`evaluateOutboundWorkflows`** läuft **vor** SMTP (fail-closed bei Engine-Fehlern).
4. Bei Block: Entwurf bleibt lokal (`folder_kind = draft`), `outbound_hold = 1`, Warnbanner wird **vor** den Text gesetzt.
5. Entwurf erscheint im **Posteingang** (nicht nur unter Entwürfe), damit Mitarbeitende die Prüfung sofort sehen.

## Vorlagen

| ID | Beschreibung |
|----|----------------|
| `outbound-quality-check` | KI-Ausgangsprüfung (Ton, Anhang, Betrugs-Antworten) |
| `outbound-sensitive` | Regex auf IBAN/Passwort → Versand sperren |

## Knoten

- **`ai.outbound_review`** — strukturierte Antwort `STATUS: OK` / `STATUS: BLOCK` + `REASON`
- **`ai.review`** — generische OK/BLOCK-Prüfung mit Prompt
- **`email.hold_outbound`** — manuelle Sperre mit Grund

## UI

- Gelber Hinweis im Nachrichten-Viewer und im E-Mail-Text (`⚠️ AUSGANGSPRÜFUNG — VERSAND BLOCKIERT`)
- Compose schließt bei Block; Posteingang öffnet die betroffene Nachricht

## IPC

- `email:send-compose` — führt die Pipeline aus
- `email:validate-outbound` — Dry-Check ohne Versand (falls konfiguriert)
