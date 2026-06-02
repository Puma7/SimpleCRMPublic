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

- Zod-Validierung bleibt; `email:*` und `pgp:*` Channels sind standardmäßig mit `requireAuth` annotiert (siehe `shared/ipc/channel-auth-policy.ts`).
- Privilegierte Aktionen (Benutzerverwaltung, PGP-Keys, Remote-Policy schreiben) verlangen zusätzlich eine **echte Session** (`requireRealSession`), kein synthetischer Bootstrap-Owner.
- Nach Ersteinrichtung setzt `auth:set-initial-password` das Flag `auth_middleware_v1` — danach ist Login Pflicht.
- **Disk-Zugriff** auf `database.sqlite` umgeht alle IPC-Schutzmechanismen (Stufe 1).

## Ersteinrichtung

- Kein hardcodiertes Default-Passwort; `users.must_set_password = 1` bis `auth:set-initial-password`.
- Optionales Einmal-Setup-Token in `sync_info` (`local_owner_one_time_pass`), kein Klartext-Log.
- Auto-Lock nach 30 Minuten Idle; Brute-Force-Sperre nach 5 Fehlversuchen.
- Audit-Log UI + Hash-Ketten-Prüfung (`auth:list-audit-log`, `auth:verify-audit-chain`).
