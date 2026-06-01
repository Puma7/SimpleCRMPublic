# Mail — Auth Threat Model (Stufe 1)

## Was geschützt wird

- **Profil-Trennung** am gemeinsamen Arbeitsplatz: Login, Rollen, Konto-Zugriff (`user_account_access`).
- **Audit-Log** mit Hash-Kette (Manipulation *erkennbar*, nicht verhindert bei Dateizugriff).
- **Sessions** nur im Main-Prozess (gekeyt an `webContents.id`), nicht in `localStorage`.

## Was nicht geschützt wird

- **Keine kryptographische Trennung** zwischen App-Benutzern auf demselben OS-User — wer `database.sqlite` lesen kann, sieht alles.
- **Recovery-Datei** `userData/.recovery` ist Wartungsmodus, kein sicherer Recovery-Pfad.
- **Keytar** trennt OS-Benutzer, nicht App-Benutzer innerhalb eines Windows-/Linux-Logins.

## KDF

- Stufe 1: `scrypt` (Node `crypto`, kein natives Argon2-Paket).
- Argon2id geplant für Stufe 2 (DEK-Ableitung aus Passphrase).

## IPC

- Zod-Validierung bleibt; optionale Middleware `requireAuth` / `accountScope` (Feature-Flag `auth_middleware_v1` in `sync_info`).
