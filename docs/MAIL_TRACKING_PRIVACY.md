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

## Ausgehende Evidenz (Server-Edition)

- In der Standalone-Edition bleibt Open-/Click-Tracking bewusst deaktiviert.
- Die Server-Edition bietet eine standardmäßig ausgeschaltete Evidenz-Pipeline für HTML-Mail:
  SMTP, DSN/MDN, klassifizierte Pixel-/Klickabrufe und Antworten.
- Aktivierung erfordert Rechtsgrundlage, HTTPS-Datenschutzhinweis, Admin-Bestätigung und
  Aufbewahrungsfristen. Roh-IP und User-Agent sind optional AES-GCM-verschlüsselt.
- Details und Aussagegrenzen: [`EMAIL_EVIDENCE_TRACKING.md`](EMAIL_EVIDENCE_TRACKING.md).

## Grenzen

- Subject, Header-Metadaten und lokale DB bleiben unverschlüsselt.
- Wer OS- oder Dateizugriff hat, kann alle Daten lesen (siehe `MAIL_SINGLE_USER_LIMITS.md`).
- Tracking-Signale beweisen weder persönliche Kenntnisnahme noch eine einzelne Person bei
  mehreren Empfängern oder Weiterleitungen.
