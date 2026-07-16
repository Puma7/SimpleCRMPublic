# Task 7 Report: Ehrliche Evidenz-UI und IP-Insights

## Status

Abgeschlossen auf `codex/email-evidence-validity-v2`.

## RED

Vor der Implementierung schlugen die neuen Regressionen wie erwartet fehl:

```powershell
pnpm exec jest --runInBand tests/unit/message-evidence-panel.test.tsx
```

- Die konkrete Zwei-Google-Proxy-Ansicht enthielt keine Metrik `Automatisierte Abrufe`.

```powershell
pnpm exec jest --runInBand tests/unit/message-evidence-panel.test.tsx tests/unit/ip-insight-dialog.test.tsx tests/unit/tracking-settings-panel.test.tsx tests/unit/email-tracking-service.test.ts tests/unit/email-tracking-routes.test.ts tests/unit/renderer-transport.test.ts
```

- `IpInsightDialog` existierte nicht.
- Der IP-Insights-Schalter fehlte in den Einstellungen.
- `ipInsightsEnabled` wurde vom Policy-Parser als unbekannt abgelehnt.
- Die Policy erlaubte IP-Insights ohne beides, abgeleitete und verschluesselte Rohmetadaten.
- Es gab keinen Reclassify-IPC/HTTP-Transport.

## GREEN

- V2-Metriken zeigen Pixelabrufe, automatisierte und unklare Abrufe, wahrscheinlich menschliche Abrufe sowie Oeffnungssitzungen. Alte Summary-Felder bleiben als Fallback lesbar.
- Proxy-, Datenschutz-Proxy- und Scanner-Ereignisse werden als abrufende Infrastruktur beschrieben; Browser/OS/Geraet erscheinen nicht als Empfaengergeraet. Lifecycle-Zeilen verwenden keine Abruf-Klassifizierung nur wegen `automated`.
- Admins erhalten nach explizitem Laden sensibler Rohdaten einen icon-basierten, zugreifbaren IP-Insight-Einstieg. Der Dialog ruft ausschliesslich mit `messageId` und `eventId` ab, loest Laender lokal per `Intl.DisplayNames` auf und behandelt 410, 503, allgemeine Fehler sowie Unmount sicher. Es gibt keine Stadt-, Koordinaten- oder externen Lookup-Links.
- Die Reclassify-Aktion ist admin-only, gegen parallele Ausfuehrung gesperrt und laedt die Timeline nach Erfolg neu.
- `ipInsightsEnabled` ist end-to-end in Policy-Record, Mutation, Datenbank-Mapping und Route verfuegbar. Aktivierung erfordert Derived- und Raw-Metadaten; deren Abschaltung wird bei weiter aktivem IP-Insight klar abgewiesen. Die Migration `0030` setzt das Feld bereits standardmaessig auf `false`.

Frische Verifikation:

```powershell
pnpm exec jest --runInBand tests/unit/email-tracking.test.ts tests/unit/email-tracking-migration.test.ts tests/unit/email-tracking-ip-intelligence.test.ts tests/unit/email-tracking-service.test.ts tests/unit/email-tracking-routes.test.ts tests/unit/renderer-transport.test.ts tests/unit/message-evidence-panel.test.tsx tests/unit/ip-insight-dialog.test.tsx tests/unit/tracking-settings-panel.test.tsx
# 9/9 Suiten, 239/239 Tests bestanden

pnpm run typecheck
# bestanden

pnpm exec eslint packages/server/src/api/types.ts packages/server/src/api/email-tracking-routes.ts packages/server/src/email-tracking.ts shared/ipc/channels.ts src/services/transport/channel-http-registry.ts src/components/email/ip-insight-dialog.tsx src/components/email/message-evidence-panel.tsx src/components/email/settings/tracking-settings-panel.tsx tests/unit/email-tracking-routes.test.ts tests/unit/email-tracking-service.test.ts tests/unit/renderer-transport.test.ts tests/unit/message-evidence-panel.test.tsx tests/unit/ip-insight-dialog.test.tsx tests/unit/tracking-settings-panel.test.tsx --max-warnings 0
# bestanden

pnpm run build
# bestanden
```

## Geaenderte Dateien

- `src/components/email/ip-insight-dialog.tsx`
- `src/components/email/message-evidence-panel.tsx`
- `src/components/email/settings/tracking-settings-panel.tsx`
- `packages/server/src/api/types.ts`
- `packages/server/src/api/email-tracking-routes.ts`
- `packages/server/src/email-tracking.ts`
- `shared/ipc/channels.ts`
- `src/services/transport/channel-http-registry.ts`
- `tests/unit/message-evidence-panel.test.tsx`
- `tests/unit/ip-insight-dialog.test.tsx`
- `tests/unit/tracking-settings-panel.test.tsx`
- `tests/unit/email-tracking-routes.test.ts`
- `tests/unit/email-tracking-service.test.ts`
- `tests/unit/renderer-transport.test.ts`

## Residual Risk

- Die Browser-/Playwright-Abnahme ist bewusst nicht ausgefuehrt; sie ist der separate Task-11-Gate.
- Die Dialogtests verwenden den Renderer-Transport-Mock. Die Route, der HTTP-Transport und die Policy-Validierung sind separat abgedeckt, jedoch nicht als kompletter Browserfluss gegen eine laufende Serverinstanz.

## Review-Follow-up (2026-07-16)

### RED

```powershell
pnpm exec jest tests/unit/message-evidence-panel.test.tsx tests/unit/ip-insight-dialog.test.tsx tests/unit/tracking-settings-panel.test.tsx --runInBand
```

- Kanonische V2-Klassifizierungsgruende fehlten in der Renderer-Ansicht.
- Legacy-Eventtypen konnten trotz Proxy-/Scanner-Klassifizierung menschliche Oeffnungen oder Klicks behaupten.
- Ein Reclassify-Request fuer Nachricht A konnte nach einem Wechsel zu Nachricht B erneut laden.
- Der IP-Dialog hatte weder Retry-/Live-Feedback noch StrictMode-Deduplizierung.
- Das Abschalten von Raw-/Derived-Metadaten setzte IP-Insights nicht ebenfalls zurueck.

### GREEN

- Interaktionszeilen sind actor-first: Nur `probable_human` zeigt wahrscheinliche menschliche Nutzung. Fehlende oder nichtmenschliche Klassifizierung bleibt konservativ unklar bzw. Infrastruktur.
- V2-Metriken bestimmen den Kopfstatus. Zwei Google-Proxy-Abrufe ergeben exakt `2/2/0/0/0` fuer Pixel/automatisiert/unklar/wahrscheinlich menschlich/Sitzungen; kein menschlicher Kopfstatus erscheint.
- Der Renderer nutzt kanonische `classification.reasons`, lokalisiert alle aktuellen Core-/Server-Codes und zeigt unbekannte Codes sicher an.
- IP-Insights werden beim Nachrichtenwechsel, Parent-Close, Abschalten sensibler Daten und Unmount zurueckgesetzt. Async-Ladevorgaenge sowie Reclassify/Revoke/Delete pruefen Nachricht und Sequenz vor jedem State-Update.
- Der sichtbare Admin-Einstieg zeigt die geladene rohe IP als Button-Label mit Network/MapPin; der Transport erhaelt weiterhin ausschliesslich `{ messageId, eventId }`.
- Der Dialog liefert `role=status` und `role=alert`, Retry sowie lokale StrictMode-Deduplizierung. IPC-Cancellation ist nicht verfuegbar; alte Antworten werden per Sequenz ignoriert.
- Das Abschalten von Raw- oder Derived-Metadaten setzt `ipInsightsEnabled` explizit auf `false`, ohne Voraussetzungen still zu aktivieren.

Frische Verifikation:

```powershell
pnpm exec jest --selectProjects unit --runInBand tests/unit/email-tracking-migration.test.ts tests/unit/email-tracking-ip-intelligence.test.ts tests/unit/email-tracking-service.test.ts tests/unit/email-tracking-routes.test.ts tests/unit/renderer-transport.test.ts tests/unit/ip-insight-dialog.test.tsx tests/unit/message-evidence-panel.test.tsx tests/unit/tracking-settings-panel.test.tsx
# 8/8 Suiten, 232/232 Tests bestanden

pnpm run typecheck
# bestanden

pnpm exec eslint src/components/email/message-evidence-panel.tsx src/components/email/ip-insight-dialog.tsx src/components/email/settings/tracking-settings-panel.tsx tests/unit/message-evidence-panel.test.tsx tests/unit/ip-insight-dialog.test.tsx tests/unit/tracking-settings-panel.test.tsx --max-warnings 0
# bestanden

pnpm run build:web
# bestanden
```

Der wiederholte Lauf mit `tests/unit/email-tracking.test.ts` ist derzeit rot gegen parallel hinzugekommene, nicht zu Task 7 gehoerende Core-/Workflow-Testaenderungen. Diese Dateien wurden weder bearbeitet noch werden sie in diesem Commit enthalten sein.

## Zweiter Review-Follow-up (2026-07-16)

### RED

```powershell
pnpm exec jest --selectProjects unit --runInBand tests/unit/message-evidence-panel.test.tsx
```

- Ein wirkliches Legacy-Summary ohne V2-Felder konnte bei `engagement=probable_open` noch menschliche Kopfzeilen zeigen.
- Der Delete-Erfolg invalidierte seine eigene Action-Sequenz vor dem Timeline-Reload.

### GREEN

- Ein Legacy-`probable_open` ohne V2-Metrik und ohne `probable_human`-Klassifizierung wird als unklarer Pixelabruf dargestellt. Der Fallback leitet die unklare Pixelanzahl konsistent aus `openCount` ab; Link- und Antwortsignale bleiben unveraendert.
- Erfolgreiches Loeschen laedt die aktuelle Timeline vor dem Schliessen/Reset nach. Die Regressionsabdeckung prueft `tracked=false` nach erneutem Oeffnen; A/B-, Parent-Close- und Unmount-Guards bleiben erhalten.

Frische Verifikation:

```powershell
pnpm exec jest --selectProjects unit --runInBand tests/unit/message-evidence-panel.test.tsx tests/unit/ip-insight-dialog.test.tsx tests/unit/tracking-settings-panel.test.tsx
# 3/3 Suiten, 22/22 Tests bestanden

pnpm run typecheck
# bestanden

pnpm exec eslint src/components/email/message-evidence-panel.tsx tests/unit/message-evidence-panel.test.tsx --max-warnings 0
# bestanden

pnpm run build:web
# bestanden
```

## Finaler Review-Follow-up (2026-07-16)

### RED

```powershell
pnpm exec jest --selectProjects unit --runInBand tests/unit/message-evidence-panel.test.tsx
```

- 7 Regressionen schlugen wie erwartet fehl: Reply/Click/MDN-Prioritaet, Unknown-Status in Legacy und V2, Parent-Close waehrend Reclassify sowie der unbenannte Sensitive-Schalter.
- Die bisherigen IP-Sichtbarkeitstests suchten noch nach einem veralteten Accessible Name; der Non-Admin-Fall enthielt zudem keine rohe IP und pruefte die Schutzbedingung daher nicht wirksam.

### GREEN

- `human_reply` und `link_interaction` bleiben staerker als Pixelzaehler. Ein MDN-gestuetztes `probable_open` bleibt erhalten; nur Pixel-Signale ohne wahrscheinliche Human-Klassifizierung werden durch V2-Zaehler konservativ herabgestuft.
- `unknown_fetch` hat den expliziten Status `Pixelabruf, Ursache unklar` in kompakter und geoeffneter Kopfzeile; Legacy- und V2-Faelle sind abgedeckt.
- Parent-Close bewahrt eine laufende Reclassify-/Revoke-Action als in-flight. Reopen bleibt gesperrt, verhindert Duplikate und erhaelt nach Abschluss die frisch geladene Timeline. Nachrichtenwechsel und Unmount invalidieren weiterhin Sequenz und State-Updates.
- Der Schalter `Sensible Rohdaten` ist ueber `id`/`aria-labelledby` benannt. Admin- und Non-Admin-Tests verwenden den aktuellen IP-Button-Namen; der negative Fall enthaelt absichtlich ein Raw-IP-Ereignis.

Frische Verifikation:

```powershell
pnpm exec jest --selectProjects unit --runInBand tests/unit/message-evidence-panel.test.tsx tests/unit/ip-insight-dialog.test.tsx tests/unit/tracking-settings-panel.test.tsx
# 3/3 Suiten, 26/26 Tests bestanden

pnpm run typecheck
# bestanden

pnpm exec eslint src/components/email/message-evidence-panel.tsx tests/unit/message-evidence-panel.test.tsx --max-warnings 0
# bestanden

pnpm run build:web
# bestanden (bestehender Chunk-Size-Hinweis)
```
