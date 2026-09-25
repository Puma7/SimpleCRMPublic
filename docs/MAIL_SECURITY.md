# Mail-Sicherheit (P2 mailauth, P3 Rspamd)

SimpleCRM prüft eingehende Mails **lokal** nach dem Sync — ohne eigenen MTA.

## Ablauf

1. IMAP/POP3 speichert `raw_headers`, `body_text`, `body_html`.
2. Vor **eingehenden Workflows** läuft `runMailSecurityPipeline()`:
   - optional **mailauth** (SPF, DKIM, DMARC, ARC)
   - optional **Rspamd** HTTP `/checkv2`
   - **Absender-Blacklist** → Spam + Workflows übersprungen
   - optionale Auto-Spam-Regeln (DMARC/SPF/Rspamd)
3. Ergebnisse landen in SQLite und als Workflow-Variablen.

## Einstellungen

**E-Mail → Einstellungen → Mail-Sicherheit**

| Option | Standard | Beschreibung |
|--------|----------|--------------|
| mailauth | an | Node-Paket `mailauth` (MIT), Rekonstruktion RFC822 aus DB |
| Rspamd | aus | `http://127.0.0.1:11333`, POST `/checkv2` |
| Blacklist | — | Sofort Spam, keine Workflows |
| Whitelist | — | Für Workflow-Knoten „Absender-Filter“ (global) |
| KI-Schwelle 1–100 | 70 | Knoten „Schwellwert“ nach `ai.spam_score` |

## Fallback auf Authentication-Results (RFC 8601)

Scheitert die Live-Prüfung (mailauth-Timeout, DNS-Fehler: `unknown`/`temperror`),
übernimmt SimpleCRM SPF/DKIM/DMARC aus einem `Authentication-Results`-Header des
empfangenden Servers. Weil jeder Absender solche Header mitschicken kann, gilt
nach RFC 8601 §5 nur der **oberste Header mit vertrauenswürdiger authserv-id**
(das Token vor dem ersten `;`). `ARC-Authentication-Results` und alle anderen
Header werden ignoriert.

- **Standard (beide Editionen):** die Domain des Eingangsservers, also der
  IMAP-Host (bei POP3 der POP3-Host) ohne erstes Label: `imap.example.com` →
  `example.com`. Hat der Host nur zwei Labels, ist er eine IP-Adresse oder bliebe
  nur eine kurze Länder-Endung wie `co.uk`/`com.au` übrig (≤ 3 Zeichen plus
  zweistellige TLD), gilt der volle Host.
- **Passend** ist eine authserv-id, die gleich diesem Wert oder eine Subdomain
  davon ist (`mx01.example.com` passt zu `example.com`).
- **Server-Edition:** Konto bearbeiten → **Erweitert** → „Vertrauenswürdige
  authserv-id“ (Spalte `email_accounts.trusted_authserv_id`, Migration 0054,
  API-Feld `trustedAuthservId`). Nötig, wenn der Provider eine andere Kennung
  setzt, z. B. `mx.google.com` für Gmail. Leer = Standard.
- **Desktop:** immer der Standard, kein eigenes Feld.
- **Restrisiko:** Fügt der eigene MTA gar keinen Header hinzu und entfernt er
  eingehende Header mit seiner authserv-id nicht (RFC 8601 §5), kann ein Absender
  einen passenden Header fälschen. Ohne passenden Header bleibt der Fallback aus.

Regeln: `packages/core/src/email/authentication-results.ts`.

## Verdächtige Anhänge

Eine gemeinsame Liste in `packages/core/src/email/attachment-safety.ts`
entscheidet in beiden Editionen: Programme und Skripte, Windows-Verknüpfungen
(`.lnk`, `.url`, …), Java (`.jar`), Disk-Images (`.iso`, `.img`, `.vhd`),
Office-Dateien mit Makros (`.docm`, `.xlsm`, …) sowie macOS-/Linux-Starter. Punkte
und Leerzeichen am Ende des Namens zählen nicht (`Rechnung.lnk. `). Der Desktop
fragt vor dem Öffnen nach; auf dem Server brauchen Download, PGP-Entschlüsselung,
Weiterleiten und DSGVO-Export solcher Dateien zusätzlich das Recht
`mail.attachment.suspicious_download` („Verdächtige Anhänge laden“).

## Workflow-Variablen

- `auth.spf`, `auth.dkim`, `auth.dmarc`, `auth.arc` — `pass`, `fail`, `softfail`, `none`, …
- `rspamd.score`, `rspamd.action`

Knoten **Auth-Prüfung (SPF/DKIM/DMARC/ARC)** — Ports: `pass` | `fail` | `none` | `default`.

## Rspamd lokal (optional)

```bash
# Beispiel: Rspamd als Docker
docker run -d -p 11333:11333 rspamd/rspamd
```

In SimpleCRM: Rspamd aktivieren → **Verbindung testen** → Spam-Schwelle (typisch 10–20, abhängig von Policy).

## Grenzen

- **Kein Ersatz für MX-Filter:** Prüfung erfolgt auf dem Desktop nach Zustellung.
- **DKIM/Body:** Wenn der Body in der DB leer ist (z. B. nur verschlüsselte Anzeige), kann DKIM-Nachprüfung abweichen; Header von Proton/Provider bleiben sichtbar.
- **DNS:** mailauth und Rspamd benötigen Netzwerk für DNS/RBL.

## Dateien

- `electron/email/mail-auth-verify.ts` — mailauth
- `electron/email/rspamd-client.ts` — HTTP-Client
- `electron/email/mail-security-pipeline.ts` — Orchestrierung
- `electron/email/mail-security-static.ts` — Blacklist / Auto-Spam
