# E-Mail — Single-User- und Sandbox-Grenzen

SimpleCRM-Mail ist für **einen Desktop-Nutzer pro Installation** ausgelegt (lokale SQLite, kein Multi-Tenant-Server).

---

## Architektur

| Aspekt | Grenze |
|--------|--------|
| Datenhaltung | Lokal `userData/database.sqlite` |
| Geheimnisse | OS-Keytar (nicht in Backups) |
| Team-Feature | Metadaten (`assigned_to`); optional App-Login (Stufe 1: Profil + Audit, **kein** Disk-Schutz) |
| Shared Inbox | UI „Alle Konten“ — alle Konten einer Installation |

---

## Skalierung (praktisch)

| Ressource | Soft-Limit | Verhalten |
|-----------|------------|-----------|
| Nachrichten | Sehr große DB möglich | Liste paginiert; Suche FTS/LIKE |
| Anhänge Backup | 8 GB gesamt | Export bricht ab mit Fehlermeldung |
| Anhang pro Mail | 25 MB | Upload/Compose |
| Workflow-Läufe | SQLite | Historie in DB |

---

## Nicht unterstützt (bewusst)

- Gleichzeitiger Zugriff mehrerer PCs auf **dieselbe** DB-Datei (Netzwerkshare)
- Server-seitige Benutzerverwaltung für Mail
- Cloud-Sync der Datenbank zwischen Geräten
- PGP-Verschlüsselung: Basis in Main (OpenPGP.js); S/MIME folgt

---

## Dev vs. Production

| Modus | `userData` (Windows) |
|--------|----------------------|
| `npm run electron:dev` | `%APPDATA%\Electron\` |
| Installierte App | `%APPDATA%\simplecrm\` |

**Empfehlung:** Für echte Daten immer dieselbe Startart nutzen oder nach Tests Daten migrieren (siehe [`MAIL_BETA_PHASE3_PLAN.md`](MAIL_BETA_PHASE3_PLAN.md)).

---

## Externe API

REST `/api/v1` (optional) — ein API-Key pro Installation, Scopes. Siehe [`API_V1.md`](API_V1.md). Kein Ersatz für zentrale Mail-Server-Logik.
