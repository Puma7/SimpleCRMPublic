# Mail Beta — Phase 3 (Backup, Restore, Multi-Folder)

**Stand:** 2026-05-24 · Branch `cursor/restore-wizard-imap-multifolder-d125`

## P3-1 Backup & Restore

| ID | Thema | Status |
|----|--------|--------|
| P3-1a | Export ZIP | ✅ |
| P3-1b | Backup prüfen (`VerifyLocalMailBackup`) | ✅ |
| P3-1c | **Restore-Wizard** (Vorschau, Sicherheits-Backup, Bestätigung, Relaunch) | ✅ |
| P3-1d | Automatischer Restore-Wizard in UI (Diagnose-Tab) | ✅ |

### Restore-Wizard (App)

1. Einstellungen → **Diagnose** → Abschnitt „Vollbackup wiederherstellen“
2. ZIP wählen → **Vorschau prüfen**
3. Optional: automatisches Sicherheits-Backup (empfohlen)
4. Risiken bestätigen + `WIEDERHERSTELLEN` eingeben
5. App startet neu

**Hinweis:** Keytar-Geheimnisse sind nicht im ZIP — IMAP/SMTP/OAuth/KI-Keys ggf. neu setzen.

## P3-2 IMAP Multi-Folder-Sync

| Ordner | Standard | Einstellung |
|--------|----------|-------------|
| INBOX | immer | — |
| Gesendet | aus | SMTP-Tab → „Gesendet-Ordner lesen“ |
| Archiv | aus | „Archiv-Ordner lesen“ (+ optional Pfad) |
| Spam/Junk | aus | „Spam/Junk-Ordner lesen“ (+ optional Pfad) |

Technik: eine IMAP-Verbindung, `client.list()`, Erkennung via `\\Sent` / `\\Archive` / `\\Junk` und Namensheuristiken. Nachrichten erhalten passende `folder_kind` / `archived` / `is_spam` beim Import.
