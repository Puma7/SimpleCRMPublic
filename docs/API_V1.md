# SimpleCRM Automation API v1

Lokale REST-API für **n8n**, **Make**, **Zapier** und eigene Skripte. Läuft nur, wenn die Desktop-App gestartet ist.

## Aktivierung

1. **E-Mail → Einstellungen → Automatisierung**
2. **Automation-API aktiv** einschalten, Port prüfen (Standard `3847`)
3. **API-Key erzeugen** und in n8n als Bearer-Token speichern
4. Basis-URL: `http://127.0.0.1:3847/api/v1`

OpenAPI: `GET http://127.0.0.1:3847/api/v1/openapi.json` bzw. im Server-Modus `GET <server>/api/v1/openapi.json`

## Authentifizierung

```http
Authorization: Bearer scrm_…
```

oder

```http
X-API-Key: scrm_…
```

## Scopes

| Scope | Zugriff |
|-------|---------|
| `read` | GET Kunden, Deals, Aufgaben |
| `write` | POST/PATCH/DELETE Kunden, Deals, Aufgaben |
| `email` | E-Mail-Konten, Nachrichten, Aktionen |
| `workflows` | Workflows lesen & ausführen |

## n8n (Beispiel)

**HTTP Request Node:**

- Method: `GET`
- URL: `http://127.0.0.1:3847/api/v1/customers`
- Authentication: Header Auth → `Authorization` = `Bearer <Ihr-Key>`

**Neuen Kunden anlegen:**

- Method: `POST`
- URL: `http://127.0.0.1:3847/api/v1/customers`
- Body JSON: `{ "name": "Shop Kunde", "email": "k@example.com" }`

**Workflow ausführen:**

- Method: `POST`
- URL: `http://127.0.0.1:3847/api/v1/workflows/1/execute`
- Body: `{ "messageId": 42 }`

Hinweis: Der Server-Modus reiht echte Workflow-Ausführungen als Job ein. Mit `{ "messageId": 42, "dryRun": true }` wird der Workflow serverseitig ohne persistierte Runs, Jobs, IMAP-Aktionen, HTTP-Requests oder Datenmutationen simuliert.

**Eingehenden Workflow-Webhook auslösen:**

- Method: `POST`
- URL: `http://127.0.0.1:3847/api/v1/webhooks/incoming`
- Body: `{ "secret": "workspace-webhook-secret", "body": { "event": "test" } }`

Im Server-Modus akzeptiert derselbe Pfad auch `Authorization: Bearer <Automation-Key>` mit `workflows`- oder `write`-Scope; dann kann das Workspace-Secret im Body entfallen.

## Endpoints (Übersicht)

| Methode | Pfad |
|---------|------|
| GET | `/health` |
| GET | `/openapi.json` |
| GET/POST | `/customers`, `/customers/{id}` |
| GET | `/customers?q=suchbegriff` |
| GET/POST | `/deals` |
| GET/PATCH/DELETE | `/deals/{id}` |
| POST | `/deals/{id}/stage` |
| GET/POST | `/tasks` |
| GET/PATCH/DELETE | `/tasks/{id}` |
| POST | `/tasks/{id}/toggle` |
| GET | `/email/accounts` |
| DELETE | `/email/accounts/{id}/sync-lock` |
| GET | `/email/messages?accountId=1&view=inbox` |
| GET | `/email/messages?accountId=1&folderPath=INBOX` |
| GET | `/email/messages/{id}?includeBody=true` |
| GET | `/email/threads?accountId=1&view=inbox` |
| POST | `/email/messages/{id}/actions` |
| PATCH | `/email/messages/{id}/move` |
| PATCH | `/email/messages/{id}/spam-status` |
| POST | `/email/messages/{id}/spam-decision` |
| POST | `/email/messages/{id}/security/check` |
| GET/PATCH | `/email/settings/security` |
| GET | `/workflow/plugins` |
| GET | `/workflows`, `/workflows/{id}`, `/workflows/{id}/runs` |
| POST | `/workflows/compile-graph` |
| POST | `/workflows/{id}/execute` |
| POST | `/webhooks/incoming` |
| POST | `/workflows/webhook/incoming` |
| POST | `/pgp/messages/encrypt` |
| POST | `/pgp/messages/sign` |
| POST | `/pgp/attachments/{id}/decrypt` |
| POST | `/pgp/attachments/{id}/verify` |

### Nachrichten-Aktionen (`POST …/actions`)

Body:

```json
{
  "action": "archive",
  "payload": {}
}
```

Aktionen: `archive`, `unarchive`, `mark_seen`, `mark_unseen`, `spam`, `not_spam`, `link_customer` (payload: `customerId`), `assign` (payload: `teamMemberId`), `add_tag` (payload: `tag`).

Der server-client `PATCH /api/v1/email/messages/:id/seen` akzeptiert optional `syncToServer` im Body. Fehlt das Feld, entscheidet die Konto-Einstellung `imapSyncSeenOnOpen`; bei IMAP-Konten wird `\Seen` best-effort auf dem Server synchronisiert.

`PATCH /api/v1/email/messages/:id/spam-status` und die Spam-Aktionen trainieren serverseitig die lokale Feature-Statistik, wenn `localLearningEnabled` aktiv ist. Wenn `rspamdEnabled` und `rspamdLearningEnabled` aktiv sind, sendet der Server die gespeicherte RFC822-Nachricht nach erfolgreicher DB-Mutation best-effort an Rspamd `/learnspam` oder `/learnham`.

### PGP Plaintext und Anhaenge

`POST /pgp/messages/encrypt` und `POST /pgp/messages/sign` liefern weiterhin legacy-kompatibel `{ "armored": "..." }`. Optional koennen Browser-Clients `attachments` als JSON/Base64-Liste mitsenden:

```json
{
  "plaintext": "Hallo",
  "recipientEmails": ["kunde@example.com"],
  "attachments": [
    {
      "filename": "rechnung.pdf",
      "contentType": "application/pdf",
      "contentBase64": "..."
    }
  ]
}
```

Wenn Anhaenge vorbereitet wurden, enthaelt die Antwort zusaetzlich `attachments` mit `filename`, optional `contentType` und `contentBase64`.

### PGP Inbound-Anhaenge

Gespeicherte Mail-Anhaenge koennen im Server-Client transient entschluesselt oder gegen eine Detached-Signatur geprueft werden. Die entschluesselten Bytes werden nicht persistiert.

`POST /pgp/attachments/{id}/decrypt`:

```json
{
  "passphrase": "..."
}
```

Antwort:

```json
{
  "filename": "rechnung.pdf",
  "contentType": null,
  "contentBase64": "...",
  "sizeBytes": 12345,
  "status": "decrypted"
}
```

`POST /pgp/attachments/{id}/verify` akzeptiert entweder einen gespeicherten Signatur-Anhang oder eine direkte Base64-Signatur:

```json
{ "signatureAttachmentId": 124 }
```

```json
{ "signatureBase64": "...", "signerEmail": "kunde@example.com" }
```

Ohne `signerEmail` leitet der Server den Absender aus der zugehoerigen Mail ab, sofern die Mail-Metadaten verfuegbar sind.

Siehe auch [`SECURITY_AUTOMATION_API.md`](SECURITY_AUTOMATION_API.md).
