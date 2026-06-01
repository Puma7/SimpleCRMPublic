# Mail Beta — Phase 3 (Härtung, Backup, Diagnose)

**Stand:** 2026-05-24 · Branch-Sprint `cursor/dev-from-main-d125`

Phase 3 bündelt Betriebssicherheit für Single-User-Desktop: Vollbackup, Restore-Anleitung, Diagnose-JSON, Doku-Konsistenz.

---

## P3-1 — Lokales Vollbackup (ZIP)

| ID | Thema | Status |
|----|--------|--------|
| P3-1a | Export `database.sqlite` + `email-attachments/` + `manifest.json` | ✅ `electron/email/email-local-backup.ts` |
| P3-1b | Restore-Anleitung (manuell) | ✅ dieses Dokument § Restore |
| P3-1c | UI: Export unter Einstellungen → Diagnose | ✅ `diagnostics-panel.tsx` |
| P3-1d | Backup prüfen (ZIP-Struktur, Manifest) | ✅ IPC `VerifyLocalMailBackup` |

**Nicht im ZIP:** Passwörter, OAuth-Refresh-Tokens, OpenRouter/API-Keys (Keytar). Nach Restore Konten und KI-Keys neu eintragen.

---

## P3-2 — Restore (manuell, App beendet)

1. **SimpleCRM vollständig beenden** (kein Tray-Prozess).
2. Aktuelles `userData` sichern (Ordner umbenennen, z. B. `simplecrm-old`).
3. ZIP entpacken.
4. In den **aktiven** `userData`-Ordner kopieren:
   - `database.sqlite` → Root von `userData`
   - Ordner `email-attachments/` → gleicher Pfad wie bei Export (siehe `getAttachmentsRootForExport()` in Code)
5. App starten. Schema-Migrationen laufen beim Start automatisch (`MAIL_SCHEMA_GENERATION` in Manifest beachten).
6. **Einstellungen prüfen:** IMAP/SMTP-Passwörter, OAuth, KI-API-Keys, Workflow-Cron.

### userData-Pfade (Windows)

| Modus | Typischer Pfad |
|--------|----------------|
| **Packaged** | `%APPDATA%\simplecrm\` |
| **Dev (`electron:dev`)** | `%APPDATA%\Electron\` |

⚠️ Häufiger Datenverlust: Einstellungen in Dev angelegt, später nur die **packaged** App genutzt (anderer Ordner). Vor Restore den richtigen Ordner wählen.

---

## P3-3 — Diagnose

| ID | Thema | Status |
|----|--------|--------|
| P3-3a | IPC `GetMailDiagnostics` | ✅ |
| P3-3b | UI Tab Diagnose | ✅ |
| P3-3c | Support-Matrix | ✅ [`MAIL_TROUBLESHOOTING.md`](MAIL_TROUBLESHOOTING.md) |

---

## P3-4 — Migrationen & Doku

| ID | Thema | Status |
|----|--------|--------|
| P3-4a | `PRODUCT_REQUIREMENTS.md` (Muss/Soll/Ist) | ✅ |
| P3-4b | `AGENT_HANDOFF.md` auf main-Stand | ✅ Sprint |
| P3-4c | Automatischer Restore-Wizard (ZIP → userData) | 🔲 Backlog (Risiko: Überschreiben ohne Bestätigung) |

---

## Offen (Backlog)

- IMAP Multi-Folder-Sync (Archiv/Spam vom Server)
- Restore-Wizard mit expliziter Bestätigung + automatischem Pre-Backup
- Zentrale Migrations-CLI außerhalb der App

Siehe auch [`EMAIL_ROADMAP.md`](EMAIL_ROADMAP.md), [`PRODUCT_REQUIREMENTS.md`](PRODUCT_REQUIREMENTS.md).
