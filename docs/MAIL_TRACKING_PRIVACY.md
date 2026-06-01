# Mail — Tracking-Schutz und Lesebestätigungen

## Remote-Inhalte (Phase 1)

- **Standard:** Alle Remote-Ressourcen in HTML-Mails sind blockiert (`http`, `https`, `//`, CSS-`url()`, `video`/`audio`/`link`/`style`).
- **Keine Pixel-Heuristik** — Block-all statt 1×1-Erkennung.
- **Freigabe:** pro Nachricht `blocked` · `allowed_once` · `allowed_sender` · `allowed_domain` (Allowlist in SQLite).
- **Compose:** Ausgehendes HTML wird nach DOMPurify ebenfalls bereinigt (keine Tracking-Pixel in Entwürfen).
- **Workflows:** Laden keinen Remote-HTML-Inhalt.

## Lesebestätigungen (MDN)

- **Ausgehend:** Optional pro Konto und pro Mail (`Disposition-Notification-To`). Kein `Return-Receipt-To`.
- **Eingehend:** Standard `never`; Konto kann `ask` oder `always_trusted` (nur vertrauenswürdige Domains).
- **Keine automatische MDN-Antwort** ohne explizite Nutzer- oder Admin-Policy.

## Bewusst nicht implementiert

- **Open-/Click-Tracking** für Marketing (F7 im Backlog) — erfordert Server, Consent und Retention.

## Grenzen

- Subject, Header-Metadaten und lokale DB bleiben unverschlüsselt.
- Wer OS- oder Dateizugriff hat, kann alle Daten lesen (siehe `MAIL_SINGLE_USER_LIMITS.md`).
