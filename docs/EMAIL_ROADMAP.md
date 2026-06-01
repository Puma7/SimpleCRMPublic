# E-Mail-Modul — Roadmap

Stand: 2026-05-24 (`cursor/dev-from-main-d125` Sprint).

## Erledigt in dieser Runde

- Shared Inbox **„Alle Konten“** im Postfach
- Workflow-Liste: Filter **Eingehend / Ausgehend / Sonstige**
- **KI-Profile** (mehrere Anbieter, Keys getrennt von Modellen)
- **Team-Signaturen** (HTML) + Signatur in neuen Entwürfen
- **IMAP-Server-Löschung** auch unter Einstellungen → Konten
- Doku: `EMAIL_PRODUCT_GUIDE.md`, `PRODUCT_REQUIREMENTS.md`
- **KI-Profil-Dropdown** in Workflow-Knoten (`ai.spam_score`, `ai.classify`, `ai.agent`, …)
- **Backup prüfen** (ZIP-Integrität) + Phase-3-Doku
- Manuelle Kategorie am Thread (#71)

## Geplant

| Priorität | Thema |
|-----------|--------|
| Erledigt | **P2 mailauth** — SPF/DKIM/DMARC/ARC (`docs/MAIL_SECURITY.md`) |
| Erledigt | **P3 Rspamd** — optional HTTP `/checkv2` |
| Erledigt | KI-Profil-Auswahl im Workflow-Knoten-UI |
| Hoch | Mehrbenutzer + Signatur des eingeloggten Users |
| Mittel | Restore-Wizard (ZIP → userData mit Bestätigung) |
| Mittel | Kategorien-Verwaltung (anlegen/bearbeiten) in Einstellungen |
| Mittel | „Erledigt“-Alias / UX für Archiv + Wieder einblenden |
| Niedrig | Regex-Suche, Cursor-Pagination für sehr große Mailboxen |
| Niedrig | IMAP-Sync für Archiv/Spam-Ordner |
