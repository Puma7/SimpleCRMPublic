# E-Mail-Postfach — Funktionsübersicht (Stand Prüfung)

## Postfach & Aktionen (ohne echtes Löschen)

| Funktion | Status | Hinweis |
|----------|--------|---------|
| Posteingang, Gesendet, Archiv, Entwürfe, Spam, Papierkorb | ✅ | Papierkorb = `soft_deleted` (ausblenden, Daten bleiben) |
| Archivieren | ✅ | Für Aufsicht / Finanzarchiv |
| Spam markieren | ✅ | Kein Server-Delete |
| Ablehnen (als Workflow-Begriff) | ⚠️ | Entspricht **Spam** oder **Papierkorb** (ausblenden) |
| Zurückstellen / Snooze | ❌ | Nur bei **Aufgaben**, nicht bei E-Mails |
| Shop-/Mitarbeiter-„Ordner“ | ⚠️ | Über **Kategorien** + Workflows (`set_category`, `assign`) |

## Priorität

| Funktion | Status |
|----------|--------|
| Workflow `email.set_priority` | ✅ Tags `priority:hoch` / `priority:normal` / `priority:niedrig` |
| Listen-Sortierung nach Priorität | ❌ (noch Datum) — Tags sichtbar in Details |

## Lesen & Datenschutz

| Funktion | Status |
|----------|--------|
| Anzeige nur als **Klartext** (kein HTML-Render) | ✅ Keine Tracking-Pixel, kein JS |
| Anhänge öffnen | ✅ Mit Warnung bei riskanten Endungen |
| Compose HTML (WYSIWYG) + Plain | ✅ ReactQuill + DOMPurify beim Senden |

## Antworten & Threading

| Funktion | Status |
|----------|--------|
| Ticket `[SCR-…]` im Betreff | ✅ |
| Inbound `Message-ID` / References | ✅ |
| Outbound `Message-ID` / In-Reply-To / References | ✅ (seit Fix) |
| Konversationsliste (Ticket/Kunde) | ✅ Details-Panel, max. 20 Mails |
| Vollständiger Thread-View in der Liste | ❌ |

## Versand

| Funktion | Status |
|----------|--------|
| SMTP-Versand | ✅ Nach Outbound-Workflow-Prüfung |
| UTF-8 / internationale Zeichen | ✅ RFC2047 Betreff, utf-8 Bodies |
| IMAP Sent-Append | ✅ Best-effort |

## Export

| Funktion | Status |
|----------|--------|
| GDPR-ZIP (komprimiert) | ✅ Einstellungen → Export |
| Vollständiges RFC822-Archiv | ❌ |
