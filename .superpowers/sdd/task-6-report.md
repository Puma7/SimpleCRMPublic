# Task 6 Report: Interner IP-Insight-Endpunkt

## Status

Abgeschlossen auf `codex/email-evidence-validity-v2`.

## RED

Die folgenden RED-Läufe wurden vor der Implementierung beobachtet:

```powershell
pnpm exec jest --runInBand tests/unit/email-tracking-routes.test.ts tests/unit/renderer-transport.test.ts -t "IP insight|IP insight routes"
```

- Route-Suite: `EmailTrackingIpInsightNotFoundError is not a constructor`.
- Renderer-Transport: kein Mapping für den noch nicht vorhandenen IPC-Kanal.

```powershell
pnpm exec jest --runInBand tests/unit/email-tracking-service.test.ts -t "local IP insight|logically expired raw IP"
```

- Service: `service.getIpInsight is not a function`.

Ein zusätzlicher Regressionstest für die Reihenfolge ohne Tracking-Port schlug zunächst wie erwartet mit `503 email_tracking_unavailable` statt `403 forbidden` für einen Nicht-Admin fehl.

Die Pre-Commit-Boundary-Regressionen schlugen ebenfalls vor der Umstrukturierung fehl: Der injizierte `openJson`-Wrapper wurde nicht verwendet, und ein Lookup innerhalb der offenen RLS-Transaktion wurde als `ip_insights_unavailable` sichtbar. Ein Policy-/Envelope-Race konnte ohne zweiten Snapshot noch eine Insight-Antwort passieren lassen.

## GREEN

Implementiert wurden:

- `GET /api/v1/email/messages/:messageId/tracking/events/:eventId/ip-insight`.
- Admin-only-Pruefung vor der Port-Verfuegbarkeit, kanonische positive Dezimal-Event-ID ohne Number-Konvertierung und 404 ohne Workspace-Offenlegung.
- Admin-RLS-Transaktion mit expliziter Nachricht-, Tracking-Nachricht- und Ereignisbindung.
- Aktuelle `ip_insights_enabled`-, Derived-/Raw-Collection-Policy, Message-Snapshot, logische Raw-Retention und Entschluesselung erst nach allen Pruefungen.
- Zwei kurze RLS-Transaktionen umschliessen nur Autorisierung bzw. finale Revalidierung. Entschluesselung und lokaler MMDB-Lookup laufen dazwischen ohne offene DB-Transaktion; der finale Snapshot vergleicht die komplette Raw-Envelope-Identitaet und prueft Policy, Snapshot und Retention erneut.
- Ausschliesslich lokaler Lookup; oeffentliche IPs mit fehlender/staler/ungueltiger MMDB ergeben 503, lokale Scopes benoetigen keinen Ready-Status.
- Begrenzter Response ohne Stadt oder Koordinaten sowie sensible Success-/Denial-Audits ohne IP, UA, Geo, ASN, CIDR oder Secrets.
- Erwartete Denials erhalten spezifische Audit-Outcomes; unerwartete interne Fehler werden als `internal_error` auditiert und weiterhin geworfen, niemals als `not_found` verschleiert.
- Neuer HTTP-Renderer-Transport und IPC-Kanal mit `messageId` und `eventId`; eine IP erscheint nie in URL oder Query.

Frische Verifikation:

```powershell
pnpm exec jest --runInBand tests/unit/email-tracking.test.ts tests/unit/email-tracking-ip-intelligence.test.ts tests/unit/email-tracking-migration.test.ts tests/unit/email-tracking-service.test.ts tests/unit/email-tracking-routes.test.ts tests/unit/renderer-transport.test.ts
# 6/6 Suiten, 225/225 Tests bestanden

pnpm run typecheck
# bestanden

pnpm exec eslint packages/server/src/api/types.ts packages/server/src/api/email-tracking-routes.ts packages/server/src/email-tracking.ts src/services/transport/channel-http-registry.ts shared/ipc/channels.ts tests/unit/email-tracking-routes.test.ts tests/unit/email-tracking-service.test.ts tests/unit/renderer-transport.test.ts --max-warnings 0
# bestanden

git diff --check
# ohne Befund
```

Zusaetzlich bestanden die fokussierten Boundary-Regressionen fuer `transactionDepth === 0` waehrend `openJson` und MMDB-Lookup, fuer Policy-Deaktivierung und Ciphertext-Aenderung waehrend des Lookups sowie fuer den Audit-Outcome `internal_error`.

## Geaenderte Dateien

- `packages/server/src/api/types.ts`
- `packages/server/src/api/email-tracking-routes.ts`
- `packages/server/src/email-tracking.ts`
- `src/services/transport/channel-http-registry.ts`
- `shared/ipc/channels.ts`
- `tests/unit/email-tracking-routes.test.ts`
- `tests/unit/email-tracking-service.test.ts`
- `tests/unit/renderer-transport.test.ts`
- `.superpowers/sdd/task-6-report.md`

## Residual Risk

- Die Service-Tests verwenden Kysely-/RLS-Fakes. Die reale PostgreSQL-RLS-Ausfuehrung und konkrete MMDB-Dateifehler bleiben durch die bestehende Integrations-/Dokumentationsarbeit abgesichert, sind aber nicht als neuer End-to-End-Test dieses Tasks ausgefuehrt.
