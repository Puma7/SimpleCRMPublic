# E-Mail-Evidenz V2 - Abnahme und Rollout

Stand: 15.07.2026
Branch: `codex/email-evidence-validity-v2`
Basis: `e3fd76e91cefff42ddc887367d76058c07eab5b5`

## Ergebnis

Der Masterplan `docs/superpowers/plans/2026-07-15-email-evidence-validity-masterplan.md` ist implementiert. Die Evidenzdarstellung trennt jetzt unveraenderliche Transport-/Legacy-Ereignisse von einer versionierten, konservativen V2-Klassifikation. Pixel- und Linkabrufe werden nach wahrscheinlich menschlich, automatisiert/Proxy und unbekannt getrennt; die UI leitet Aussagen nicht mehr aus einer auf 1.000 Zeilen begrenzten Timeline ab, sondern aus vollstaendig paginierten Summen.

IP-Insights werden ausschliesslich serverintern aus optionalen lokalen MaxMind-Country-/ASN-Datenbanken erzeugt. Es gibt keinen externen IP-Lookup und keine Tarnung des Trackingpixels. Tracking, Rohdatenerfassung und IP-Insights bleiben opt-in.

## Abnahmekriterien

| Kriterium | Status | Nachweis |
|---|---|---|
| Google-/Mailproxy-Abrufe werden nicht als menschliches Oeffnen dargestellt | Erfuellt | Core-, Service- und UI-Regressionstests |
| Lifecycle-Ereignisse erhalten keine Abrufbehauptung | Erfuellt | Core- und UI-Tests |
| Pixelabrufe, unbekannte/automatisierte Abrufe und wahrscheinliche Sitzungen sind getrennt | Erfuellt | additive V2-Summary und UI-Metriken |
| Linkklicke werden actor-basiert und auch bei gekuerzter Timeline vollstaendig bewertet | Erfuellt | paginierte Link-Akteur-Summen und Trunkierungsregression |
| Blockierte Bilder erzeugen kein erfundenes Negativ- oder Oeffnungssignal | Erfuellt | UI-Fallback `Kein messbares Oeffnungssignal` |
| IP-Insight ist Admin/Owner-, Workspace- und Policy-gebunden | Erfuellt | Route-/Service-Tests fuer 401/403/404/410/503 |
| Roh-IP erscheint nicht in Lookup-URLs oder Auditdaten | Erfuellt | eventId-basierte Route, Audit ohne Roh-IP |
| Fehlende/defekte MMDB beeintraechtigt Versand und Tracking nicht | Erfuellt | IP-Intelligence- und Route-Tests |
| Tab fuehrt von Empfaengern und Betreff direkt in `.ql-editor` | Erfuellt | Unit- und Electron-Playwright-Test |
| Legacy-API- und Workflowwerte bleiben eventtypbasiert | Erfuellt | Kompatibilitaets- und Workflowtests |

## Verifikation

| Befehl | Ergebnis |
|---|---|
| `pnpm run check:typescript-toolchain` | bestanden |
| `pnpm run lint` | bestanden, 0 Warnungen |
| `pnpm run typecheck` | bestanden |
| fokussierte Evidenz-/Security-/Composer-/IPC-Suiten | 7/7 Suiten, 159/159 Tests |
| `pnpm test` | 263/263 Suiten, 2368/2368 Tests |
| `pnpm run test:mail:coverage` | 177/177 Suiten, 1150 bestanden, 1 uebersprungen; 91.91% Statements, 80.08% Branches |
| `pnpm run test:server:coverage` | 263/263 Suiten, 2368/2368 Tests; 70.02% Statements, 68.94% Branches |
| `pnpm run test:ui:coverage:check` | 240/240 Suiten, 2064/2064 Tests; Ratchet bestanden |
| `pnpm run build` | bestanden; nur bestehender Vite-Hinweis zu grossen Chunks |
| `pnpm exec playwright test tests/e2e/email-compose-tab-order.spec.ts` | 1/1 Electron-Test bestanden |
| `pnpm run native:status` | Node ABI 141 wiederhergestellt, Electron ABI 148 gecacht |

## Live-PostgreSQL

Eine frische temporaere Instanz auf `postgres:18-alpine` wurde mit `docker/postgres-init` initialisiert. Der Migrations-CLI-Lauf hat alle Migrationen `0001` bis `0030_email_evidence_classification_v2` angewendet. `packages/server/dist/cli/rls-check.js` hat alle Tabellen-, Policy-, Workspace-Isolations- und Public-Token-Pruefungen bestanden, einschliesslich:

- `email_tracking_policies`
- `email_tracking_messages`
- `email_tracking_links`
- `email_tracking_events`
- `email_tracking_event_classifications`
- `email_tracking_token_resolver`

Der Testcontainer wurde anschliessend entfernt. Bestehende lokale Datenbanken wurden nicht verwendet oder veraendert.

## Sicherheits- und Datenschutzgrenzen

- Kein Stealth-Tracking, keine Umgehung von Proton, Apple, Gmail oder Blocklisten.
- SMTP `250`, Pixelabruf, Linkabruf und MDN bleiben unterschiedlich starke Signale; nur eine Antwort ist eine verifizierte menschliche Interaktion.
- IP-Land und ASN beschreiben ungefaehr die abrufende Infrastruktur, nicht den Wohn- oder Aufenthaltsort einer Person.
- Rohdatenzugriff ist zeitlich begrenzt, policy-gesteuert, Admin/Owner-only und wird ohne Roh-IP auditiert.
- MaxMind-Zugangsdaten gelangen nur in den optionalen Updater und nicht in API-Umgebung, Datenbank, Renderer oder Logs.
- Fehlende, alte oder defekte MMDB-Dateien deaktivieren nur Zusatzinformationen; Pixel-/Klickendpunkte bleiben verfuegbar.

## Rollout

1. Migrationen bis `0030_email_evidence_classification_v2` vor dem API-Rollout anwenden.
2. API, Worker und Web-/Desktop-Client gemeinsam ausrollen, damit Summary- und IPC-Vertrag uebereinstimmen.
3. Bestehendes Tracking-Opt-in unveraendert lassen; keine automatische Aktivierung fuer vorhandene Workspaces.
4. Optional das Compose-Profil `geoip` mit separater `.env.geoip` aktivieren und MMDB-Status mit Doctor pruefen.
5. IP-Insights erst aktivieren, wenn abgeleitete und rohe Metadaten bewusst aktiviert sowie Rechtsgrundlage und Datenschutzhinweis geprueft wurden.
6. Historische Nachrichten bei Bedarf einzeln ueber `Neu bewerten` klassifizieren; kein globaler ungefilterter Backfill.
7. Nach dem Rollout Fehlerquote der Tracking-Endpunkte, Reclassify-Auditereignisse und GeoIP-Status beobachten.

## Optionale Provider-Matrix

Die reale Matrix fuer Gmail, Proton, Apple Mail Privacy Protection, Outlook und Thunderbird wurde nicht ausgefuehrt, weil dafuer eigens freigegebene Testkonten, Empfaenger und eine Tracking-Domain erforderlich sind. Sie ist laut Masterplan kein Merge-Gate. Bei Durchfuehrung sind Remote-Bilder an/aus, wiederholtes Oeffnen, Klick, Antwort, DSN und Bounce lediglich als beobachtet, nicht beobachtbar oder nicht unterstuetzt zu protokollieren.
