# Mail-Sicherheit (SimpleCRM)

E-Mail-Einstellungen → **Mail-Sicherheit** bündelt **statische** Schutzmaßnahmen, die **vor** Workflow-Graphen und KI-Knoten laufen.

## Aktuell umgesetzt

| Stufe | Beschreibung | Speicherort |
|--------|----------------|-------------|
| **Absender-Whitelist** | Domains/E-Mails ohne KI-Spam im Standard-Workflow | `sync_info` `workflow_sender_whitelist` |
| **Absender-Blacklist** | Optional sofort `is_spam` (Tag `security-blacklist`) | `workflow_sender_blacklist` + `mail_security_auto_blacklist` |
| **Bekannte Absender** | PayPal, Amazon, DHL, … (Builtin-Liste) | `mail_security_builtin_trusted` |
| **Spam-Schwellwert** | 1–100 für Knoten „Schwellwert“ + `useGlobalThreshold` | `workflow_spam_score_threshold` |

Code: `electron/workflow/sender-filter.ts`, `electron/email/mail-security-static.ts`, `electron/email/mail-security-settings.ts`.

Reihenfolge bei neuem Posteingang:

1. Sync legt Nachricht in SQLite ab  
2. **`applyPreWorkflowMailSecurity`** (Blacklist → ggf. Spam)  
3. Inbound-Workflows (Graph, ggf. KI-Spam)

## Industriestandard & Open Source (für spätere Phasen)

### Authentifizierung (Anti-Spoofing Basis)

| Tool | Typ | Nutzen in SimpleCRM |
|------|-----|---------------------|
| **[mailauth](https://www.npmjs.com/package/mailauth)** | Node.js (MIT) | SPF, DKIM, DMARC, ARC auf `raw_headers` — **ohne MTA**, passt zu Desktop |
| **Rspamd** | Daemon (C) | Voller Spam-Score + Auth; Integration per **HTTP-API** auf localhost |
| **SpamAssassin** | Daemon | Klassische Regeln; Rspamd kann SA-Regeln mitnutzen |

Empfehlung Phase 2: **mailauth** im Main-Prozess nach Sync, Ergebnis als Tags/Variablen (`auth.dmarc=fail`).

### Spam / Phishing (statisch + optional KI)

| Tool | Typ | Nutzen |
|------|-----|--------|
| **Rspamd** | Daemon | Bayes, RBL, URL-Checks, Kombination aus 60+ Modulen |
| **SpamAssassin** | Daemon | Bewährte Regelbasis |
| **Eigene Listen** | SQLite | Bereits Whitelist/Blacklist — erweiterbar um SURBL/RBL DNS (ohne Daemon) |

SimpleCRM nutzt bewusst **zuerst** lokale Listen (datenschutzfreundlich, offline), **danach** optional KI-Score im Workflow.

### Malware / Anhänge

| Tool | Typ | Nutzen |
|------|-----|--------|
| **[ClamAV](https://www.clamav.net/)** | Daemon | `#clamdscan` / clamd TCP — nur wenn Nutzer Scanner installiert |
| **Rspamd** | Modul | `antivirus` → ClamAV oder F-Secure etc. |

Desktop-CRM: Anhang-Scan nur als **opt-in** mit lokalem clamd.

### Tracker / Betrug (heuristisch, ohne große Deps)

- **Tracking**: bekannte Tracking-Domains in HTML (`list-unsubscribe`, 1×1 pixel hosts) — eigene kleine Liste
- **Betrug**: Reply-To ≠ From, Display-Name „PayPal“ mit From `@gmail.com`, junge Domains — Regeln in `mail-security-static.ts`

## Was nicht ins Workflow-UI gehört

Unter **Automatisierung** bleiben:

- Externe REST-API (n8n/Make)
- IMAP-Löschung auf dem Server (Opt-in)
- HTTP-Allowlist für Workflow-HTTP-Knoten

## Roadmap (Vorschlag)

1. **P1** — UI Mail-Sicherheit (dieses PR) + Auto-Blacklist  
2. **P2** — mailauth auf `raw_headers`, Anzeige im Nachrichten-Viewer  
3. **P3** — Optionale Rspamd-URL in Einstellungen (localhost)  
4. **P4** — ClamAV-Anhänge (opt-in)
