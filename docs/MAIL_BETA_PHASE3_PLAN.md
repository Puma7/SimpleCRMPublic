# Mail Beta — Phase 3 (Härtung, Backup, Restore, Multi-Folder)

**Stand:** 2026-06-01 · Nach Merge [#76](https://github.com/Puma7/SimpleCRMPublic/pull/76) + [#77](https://github.com/Puma7/SimpleCRMPublic/pull/77)

**Mail Alpha-Gate:** Automatisierte Checkliste und CI (`test:mail`) — siehe [`MAIL_ALPHA_CHECKLIST.md`](MAIL_ALPHA_CHECKLIST.md) und [`MAIL_TESTING.md`](MAIL_TESTING.md).

Phase 3 bündelt Betriebssicherheit für Single-User-Desktop: Vollbackup, Integritätsprüfung, Restore-Wizard, Diagnose-JSON, Doku-Konsistenz, optionaler IMAP-Mehrordner-Sync.

---

## P3-1 — Lokales Vollbackup & Restore

| ID | Thema | Status |
|----|--------|--------|
| P3-1a | Export `database.sqlite` + `email-attachments/` + `manifest.json` | ✅ `electron/email/email-local-backup-export.ts` |
| P3-1b | Backup prüfen (`VerifyLocalMailBackup`) | ✅ |
| P3-1c | **Restore-Wizard** (Vorschau, Sicherheits-Backup, Bestätigung, Relaunch) | ✅ `restore-wizard-panel.tsx` |
| P3-1d | UI: Export + Prüfen + Restore unter Einstellungen → Diagnose | ✅ `diagnostics-panel.tsx` |
| P3-1e | Restore-Anleitung (manuell, App beendet) | ✅ § Manueller Restore |

**Nicht im ZIP:** Passwörter, OAuth-Refresh-Tokens, OpenRouter/API-Keys (Keytar). Nach Restore Konten und KI-Keys neu eintragen.

### Restore-Wizard (App)

1. Einstellungen → **Diagnose** → Abschnitt „Vollbackup wiederherstellen“
2. ZIP wählen → **Vorschau prüfen**
3. Optional: automatisches Sicherheits-Backup (empfohlen)
4. Risiken bestätigen + `WIEDERHERSTELLEN` eingeben
5. App startet neu

### Manueller Restore (App beendet)

1. **SimpleCRM vollständig beenden** (kein Tray-Prozess).
2. Aktuelles `userData` sichern (Ordner umbenennen, z. B. `simplecrm-old`).
3. ZIP entpacken.
4. In den **aktiven** `userData`-Ordner kopieren:
   - `database.sqlite` → Root von `userData`
   - Ordner `email-attachments/` → gleicher Pfad wie bei Export
5. App starten. Schema-Migrationen laufen beim Start automatisch.
6. **Einstellungen prüfen:** IMAP/SMTP-Passwörter, OAuth, KI-API-Keys, Workflow-Cron.

### userData-Pfade (Windows)

| Modus | Typischer Pfad |
|--------|----------------|
| **Packaged** | `%APPDATA%\simplecrm\` |
| **Dev (`electron:dev`)** | `%APPDATA%\Electron\` |

⚠️ Häufiger Datenverlust: Einstellungen in Dev angelegt, später nur die **packaged** App genutzt (anderer Ordner).

---

## P3-2 — IMAP Multi-Folder-Sync

| Ordner | Standard | Einstellung |
|--------|----------|-------------|
| INBOX | immer | — |
| Gesendet | aus | SMTP-Tab → „Gesendet-Ordner lesen“ |
| Archiv | aus | „Archiv-Ordner lesen“ (+ optional Pfad) |
| Spam/Junk | aus | „Spam/Junk-Ordner lesen“ (+ optional Pfad) |

Technik: eine IMAP-Verbindung, `client.list()`, Erkennung via `\\Sent` / `\\Archive` / `\\Junk` und Namensheuristiken.

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
| P3-4b | `AGENT_HANDOFF.md` / `INDEX.md` | ✅ (laufend pflegen) |

Siehe auch [`EMAIL_ROADMAP.md`](EMAIL_ROADMAP.md), [`PRODUCT_REQUIREMENTS.md`](PRODUCT_REQUIREMENTS.md), [`MAIL_SINGLE_USER_LIMITS.md`](MAIL_SINGLE_USER_LIMITS.md).
