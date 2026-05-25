# E-Mail-Modul — Roadmap

Stand: Erweiterung nach Produkt-Rundgang (Branch `cursor/email-product-feedback-d125`).

## Erledigt in dieser Runde

- Shared Inbox **„Alle Konten“** im Postfach
- Workflow-Liste: Filter **Eingehend / Ausgehend / Sonstige**
- **KI-Profile** (mehrere Anbieter, Keys getrennt von Modellen)
- **Team-Signaturen** (HTML) + Signatur in neuen Entwürfen
- **IMAP-Server-Löschung** auch unter Einstellungen → Konten
- Doku: `EMAIL_PRODUCT_GUIDE.md`

## Geplant

| Priorität | Thema |
|-----------|--------|
| Erledigt | **P2 mailauth** — SPF/DKIM/DMARC/ARC auf `raw_headers` + Body (`docs/MAIL_SECURITY.md`) |
| Erledigt | **P3 Rspamd** — optional HTTP `/checkv2` (localhost) |
| Hoch | Mehrbenutzer + Signatur des eingeloggten Users |
| Hoch | KI-Profil-Auswahl im Workflow-Knoten-UI (`profileId` Dropdown) |
| Mittel | Manuelle Kategorie am Thread |
| Mittel | Kategorien-Verwaltung (anlegen/bearbeiten) in Einstellungen |
| Mittel | „Erledigt“-Alias / UX für Archiv + Wieder einblenden |
| Niedrig | Regex-Suche, Cursor-Pagination für sehr große Mailboxen |
| Niedrig | IMAP-Sync für Archiv/Spam-Ordner |
