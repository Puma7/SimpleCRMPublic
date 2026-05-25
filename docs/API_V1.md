# SimpleCRM Automation API v1

Lokale REST-API für **n8n**, **Make**, **Zapier** und eigene Skripte. Läuft nur, wenn die Desktop-App gestartet ist.

## Aktivierung

1. **E-Mail → Einstellungen → Automatisierung**
2. **Automation-API aktiv** einschalten, Port prüfen (Standard `3847`)
3. **API-Key erzeugen** und in n8n als Bearer-Token speichern
4. Basis-URL: `http://127.0.0.1:3847/api/v1`

OpenAPI: `GET http://127.0.0.1:3847/api/v1/openapi.json`

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

**Workflow ausführen (Dry-Run):**

- Method: `POST`
- URL: `http://127.0.0.1:3847/api/v1/workflows/1/execute`
- Body: `{ "dryRun": true, "messageId": 42 }`

## Endpoints (Übersicht)

| Methode | Pfad |
|---------|------|
| GET | `/health` |
| GET | `/openapi.json` |
| GET/POST | `/customers`, `/customers/{id}` |
| GET | `/customers?q=suchbegriff` |
| GET/POST | `/deals`, `/deals/{id}`, `/deals/{id}/stage` |
| GET/POST | `/tasks`, `/tasks/{id}`, `/tasks/{id}/toggle` |
| GET | `/email/accounts` |
| GET | `/email/messages?accountId=1&view=inbox` |
| GET | `/email/messages/{id}?includeBody=true` |
| POST | `/email/messages/{id}/actions` |
| GET | `/workflows`, `/workflows/{id}`, `/workflows/{id}/runs` |
| POST | `/workflows/{id}/execute` |

### Nachrichten-Aktionen (`POST …/actions`)

Body:

```json
{
  "action": "archive",
  "payload": {}
}
```

Aktionen: `archive`, `unarchive`, `mark_seen`, `mark_unseen`, `spam`, `not_spam`, `link_customer` (payload: `customerId`), `assign` (payload: `teamMemberId`), `add_tag` (payload: `tag`).

Siehe auch [`SECURITY_AUTOMATION_API.md`](SECURITY_AUTOMATION_API.md).
