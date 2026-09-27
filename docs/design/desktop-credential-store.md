# Desktop-Zugangsdaten: `keytar` → Electron `safeStorage`

Entscheidungsdokument zu Plan 044 (Phase 0). Es ändert keinen Code. Phase 1
(Umbau) beginnt erst, wenn unten `Status: APPROVED` steht.

## Ausgangslage

Alle Geheimnisse der Desktop-Edition liegen heute über `keytar` (7.9.0, letzte
Version Februar 2022, natives Modul) im Schlüsselbund des Betriebssystems:

| Dienst (keytar-Service) | Inhalt |
|---|---|
| `SimpleCRMElectron-Email` | IMAP/SMTP-Passwörter, OAuth-Refresh-Tokens (Google, Microsoft) |
| `SimpleCRMElectron-PGP` | private PGP-Schlüssel |
| `SimpleCRMElectron-EmailAI` | KI-API-Keys (`profile-<uuid>`, alt: `api-key`) |
| `SimpleCRMElectron-MSSQL` | MSSQL-Passwort |
| `SimpleCRMElectron-AutomationAPI` | Zugangsdaten der Automation-API |
| `SimpleCRMElectron-StandalonePostgres` | nur für das Löschen beim Zurücksetzen |

Electron 43 bringt `safeStorage` mit, das dieselben Betriebssystem-Dienste nutzt
(Windows DPAPI, macOS-Schlüsselbund, unter Linux libsecret/KWallet) – ohne
natives Zusatzmodul. Das Ziel: `keytar` ablösen, **ohne dass je ein Zugang
verloren geht**.

## Spike-Ergebnisse (Linux, Electron 43.1.0, Xvfb, 27.09.2026)

Kleines Main-Prozess-Skript außerhalb des Repos, einmal pro Speicher-Option.
In dieser Umgebung läuft **kein** Schlüsselbund-Dienst (kein gnome-keyring).

| Start-Option | `getSelectedStorageBackend()` | `isEncryptionAvailable()` (sync) | `isAsyncEncryptionAvailable()` | async Hin und zurück | nach Neustart lesbar | Präfix Chiffrat |
|---|---|---|---|---|---|---|
| (keine) | `basic_text` | **false** | true | ja | – | `v10` |
| `--password-store=basic` | `basic_text` | **false** | true | ja | ja | `v10` |
| `--password-store=gnome-libsecret` | `gnome_libsecret` | **false** | true | ja | ja | `v10` |

Fremdes Chiffrat (`decryptString`) wirft eine Ausnahme
(„Decryption is not available“) – es stürzt nichts ab, muss aber abgefangen werden.
`shouldReEncrypt` war in allen Läufen `false`.

**Folgerungen aus dem Spike:**

1. Die **synchrone** API ist unter Linux in Electron 43 nicht nutzbar
   (`isEncryptionAvailable()` bleibt `false`, auch nach `ready`). Wir brauchen die
   **asynchrone** API.
2. **Der gemeldete Backend-Name reicht nicht.** Ohne laufenden Keyring-Dienst
   meldet Electron `gnome_libsecret`, verschlüsselt aber mit dem fest eingebauten
   Chromium-Schlüssel (Präfix `v10`). Das ist nur Verschleierung: jeder mit
   Zugriff auf die Datei kann es entschlüsseln. Sicher ist unter Linux nur ein
   Chiffrat mit Präfix `v11` (Schlüssel aus libsecret/KWallet).
3. Windows und macOS konnten hier nicht getestet werden – **von Pascal zu
   bestätigen** (erwartet: DPAPI bzw. Schlüsselbund, sync und async verfügbar).
   Das Spike-Skript liegt als Anhang am Ende und läuft mit
   `electron --no-sandbox spike.js`.

## Entscheidungen

### 1. Wo das Chiffrat liegt

- **(a)** Neue Tabelle `credential_store(service, account, ciphertext BLOB,
  updated_at, PRIMARY KEY(service, account))` in `database.sqlite`.
  Folgen: Mail-Backup-ZIP und Pre-Update-Backups enthalten das Chiffrat; eine
  Wiederherstellung **ersetzt** es. Auf demselben Rechner springen die
  Zugangsdaten auf den Stand des Backups zurück (ein inzwischen geändertes
  Passwort wäre wieder das alte). Auf einem anderen Rechner ist das Chiffrat
  nicht entschlüsselbar → muss als „fehlt“ gelten, darf nie abstürzen.
- **(b)** Eigene Datei `credentials.sqlite` in `userData`, die Backup, Restore
  und Pre-Update-Backup **nicht** anfassen. Folgen: Zugangsdaten bleiben wie
  heute (Schlüsselbund) unabhängig vom Mail-Backup; eine Wiederherstellung ändert
  keine Passwörter; die neue Datei muss beim Zurücksetzen gelöscht werden.

**Empfehlung: (b).** Das entspricht dem heutigen Verhalten (Backups enthalten
keine Zugangsdaten, `email-local-backup.ts`: „no Keytar secrets“), vermeidet
Rücksprünge auf alte Passwörter nach einem Restore und hält Chiffrat aus
ZIP-Dateien heraus, die Nutzer weitergeben.

### 2. Synchrone oder asynchrone API

**Empfehlung: nur asynchron** (`encryptStringAsync` / `decryptStringAsync`), weil
die synchrone unter Linux nicht verfügbar ist (Spike). Alle Aufrufer sind heute
schon `async` (keytar ist async). Liefert `decryptStringAsync`
`shouldReEncrypt: true`, wird neu verschlüsselt und nach erfolgreicher
Gegenprobe ersetzt.

### 3. Linux ohne sicheren Speicher (`basic_text`, `unknown` oder Präfix `v10`)

- **Neue Geheimnisse nicht speichern** und deutlich warnen:
  „Kein sicherer Schlüsselspeicher gefunden – Zugangsdaten werden nicht
  gespeichert.“ Lesen aus keytar funktioniert weiter.
- Alternative: mit ausdrücklicher Zustimmung im Klartext-Modus speichern.

**Empfehlung: nicht speichern** (wie im Plan), und die Prüfung am **Chiffrat**
festmachen: nach `encryptStringAsync` muss das Ergebnis unter Linux mit `v11`
beginnen, sonst gilt der Speicher als unsicher (Spike, Folgerung 2). Auf Windows
und macOS gilt die Prüfung über `isAsyncEncryptionAvailable()`.

Hinweis: keytar braucht unter Linux einen laufenden Secret-Service (libsecret);
ohne ihn schlägt das Speichern heute vermutlich ebenfalls fehl – für diese Nutzer
ändert sich dann nichts (im Spike nicht geprüft, keytar ist hier nicht gebaut).

### 4. Umzug der vorhandenen Einträge

**Empfehlung: bei Bedarf je Eintrag.** Lesen: erst neuer Speicher; fehlt der
Eintrag (oder ist nicht entschlüsselbar), aus keytar lesen; wenn gefunden:
verschlüsseln → schreiben → wieder lesen und vergleichen. Nur wenn alles gleich
ist, gilt der Eintrag als umgezogen. Bei jedem Fehler wird der keytar-Wert
zurückgegeben und nichts gelöscht. Gleichzeitige Zugriffe auf denselben Eintrag
ziehen nur einmal um.

### 5. Wann keytar-Einträge gelöscht werden

- sofort nach erfolgreichem Umzug,
- **eine Version später** (Version N zieht um, N+1 löscht),
- nie (nur beim Zurücksetzen).

Risiko „sofort“: Ein Downgrade über `backups/pre-update` auf die Vorversion liest
nur keytar → alle Zugänge wären weg.

**Empfehlung: eine Version später.** In Version N bleiben die keytar-Einträge
unangetastet; Version N+1 löscht sie nach nochmaliger Gegenprobe.

### 6. Wann `keytar` als Abhängigkeit entfällt

**Empfehlung:** Version N (Umzug, keytar nur noch lesend), Version N+1 (löscht
alte Einträge nach Gegenprobe, keytar noch lesend), Version N+2 entfernt
`keytar`, den Lese-Adapter, die Jest-Zuordnung, `vite.config.ts`-External und
in CI/`release.yml` den keytar-Neubau. Vor dem Entfernen von `gcc-12` und
`libsecret-1-dev` in CI prüfen, ob `better-sqlite3` sie noch braucht (vermutlich
`gcc-12` ja).

### 7. Zurücksetzen (Hard Reset)

Solange keytar Abhängigkeit ist: **beide** leeren – neue Speicherdatei löschen
und alle keytar-Dienste wie heute (`keytar-purge.ts`) bereinigen.

### 8. Klartext nie exportierbar

Keine neue IPC- oder API-Antwort gibt entschlüsselte Geheimnisse heraus; es
bleibt bei den heutigen Aufrufstellen (Senden, Abrufen, KI-Aufruf, MSSQL,
Automation-API). Mit Entscheidung 1b enthält das Backup-ZIP weder Klartext noch
Chiffrat. Logs enthalten nie Geheimnisse (auch nicht beim Umzug).

## Offene Punkte für Pascal

- Windows/macOS-Spike bestätigen (Skript unten).
- Soll Entscheidung 3 (nicht speichern ohne sicheren Speicher) für Linux-Nutzer
  ohne Keyring gelten, oder wird ein Klartext-Modus mit Zustimmung gewünscht?

## Checkliste der Entscheidungen

- [ ] 1. Speicherort: **(b) eigene Datei `credentials.sqlite`**, außerhalb von Backup/Restore
- [ ] 2. Nur asynchrone API, `shouldReEncrypt` beachten
- [ ] 3. Kein sicherer Speicher (Linux: Chiffrat ohne `v11`) → nicht speichern, Warnung
- [ ] 4. Umzug je Eintrag beim ersten Lesen, mit Gegenprobe
- [ ] 5. keytar-Einträge erst in Version N+1 löschen
- [ ] 6. `keytar` in Version N+2 entfernen (CI-Pakete vorher prüfen)
- [ ] 7. Zurücksetzen leert neuen Speicher und keytar
- [ ] 8. Kein Klartext in IPC/API/Backup/Logs

## Anhang: Spike-Skript

```js
const { app, safeStorage } = require('electron');
app.whenReady().then(async () => {
  const out = {};
  out.syncAvailable = safeStorage.isEncryptionAvailable();
  out.backend = process.platform === 'linux' ? safeStorage.getSelectedStorageBackend() : 'n/a';
  out.asyncAvailable = await safeStorage.isAsyncEncryptionAvailable();
  if (out.asyncAvailable) {
    const enc = await safeStorage.encryptStringAsync('geheim-äö€');
    const dec = await safeStorage.decryptStringAsync(enc);
    out.prefix = enc.subarray(0, 3).toString('latin1');
    out.roundTrip = dec.result === 'geheim-äö€';
    out.shouldReEncrypt = dec.shouldReEncrypt;
  }
  console.log(JSON.stringify(out));
  app.quit();
});
```

Status: DRAFT — wartet auf Freigabe
