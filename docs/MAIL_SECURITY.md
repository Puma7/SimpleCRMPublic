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
