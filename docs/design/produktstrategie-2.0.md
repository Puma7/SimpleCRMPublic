# Produktstrategie: Server und Browser (1.x → 2.0)

Status: **ENTSCHIEDEN** (Pascal, 28.09.2026) für die Punkte 1–4; Punkte 5–7 offen.

## Ausgangslage

SimpleCRM läuft heute in zwei Editionen: Desktop (Electron, Hauptprozess mit
SQLite, ca. 46.000 Zeilen) und Server (Fastify, PostgreSQL, ca. 150.000 Zeilen).
Beide teilen das React-Frontend (`src/`, ca. 74.000 Zeilen) und den Kern
(`packages/core`, ca. 20.000 Zeilen). Dazu kommt eine Übersetzungsschicht
Renderer → Server-Routen (`src/services/transport/channel-http-registry.ts`,
7.700 Zeilen, 349 Kanäle). Jede neue Funktion entstand bisher zweimal (SQLite und
Postgres, IPC und HTTP), samt Paritätstests.

## Entscheidungen

1. **TypeScript bleibt.** Kein Umbau auf Svelte oder Go: Im Desktop bestimmt
   Chromium den Speicherbedarf (Electron-Laufzeit 312 MB), nicht React. Der
   Server wartet überwiegend auf IMAP, Postgres und KI-Aufrufe; Go brächte dort
   kaum Durchsatz und würde den gemeinsamen TypeScript-Kern verdoppeln.
   TypeScript 7 beschleunigt Typecheck und Build (Entwicklung), nicht die
   Laufzeit der App.
2. **Jetzt (1.x): Server-Edition ist das Produkt.** Electron dient nur noch als
   Client eines Servers. Die eigenständige Desktop-Edition (SQLite, Logik im
   Electron-Hauptprozess) ist **eingefroren**: nur Sicherheits- und kritische
   Fehlerbehebungen, keine neuen Funktionen, keine Parität mehr.
3. **Ab 2.0: Desktop-App abgekündigt.** Nur noch Server und Browser. Der Server
   läuft zentral (im Unternehmen oder gehostet, erreichbar über Intranet, VPN oder
   Internet) und verarbeitet eingehende Mails rund um die Uhr.
4. **Ausrichtung:** Customer-Relationship-Management mit Schwerpunkt E-Mail und KI
   – Mails effizient mit KI abarbeiten. Agenten arbeiten rund um die Uhr über API
   und MCP auf dem Server (empfangen, beantworten, senden). Weitere Kanäle (Chat,
   WhatsApp, Messenger) sind Zukunft, nicht Teil von 2.0.

## Folgen ab sofort

- Neue Funktionen nur in `packages/server`, `packages/core` und `src/`
  (Browser). Keine neuen IPC-Kanäle oder Desktop-Handler in `electron/`.
- Pläne, die nur die Desktop-Edition betreffen, ruhen. Plan 044: Phase 1 bleibt;
  die Schritte N+1 (keytar-Einträge löschen) und N+2 (keytar entfernen) entfallen –
  keytar bleibt lesend, bis die Desktop-App in 2.0 entfernt wird.
- Bestehende Desktop- und Paritätstests bleiben grün; neue werden nicht verlangt.
- Plan 037 (Mail-Liste virtualisieren) betrifft den Browser und bleibt relevant.

## Offen (Entscheidung Pascal)

5. **Rückbau in 2.0:** Funktionen ohne Nutzen für ein allgemeines CRM mit
   E-Mail-Schwerpunkt entfernen. Kandidaten (Bereiche in `src/app/`): Retouren,
   Dashboard, Produkte, Deals, Kalender, Aufgaben, Follow-ups, Kundenportal,
   JTL-/MSSQL-Anbindung, Svelte-Lab. Vor der Entscheidung: Bestandsaufnahme in
   Runde 3 (Nutzung, Verflechtung mit Mail/Workflows, Daten und Migrationen).
6. **Umzug bestehender Desktop-Nutzer** auf den Server vor 2.0: Der
   Desktop→Server-Import existiert (`packages/server/src/db/postgres-core-*-import.ts`,
   `postgres-sqlite-final-import.ts`); Weg dokumentieren und testen.
7. **Lizenz:** heute FSL-1.1-ALv2 (Lizenzgeber laut `LICENSE.md`: „bl4ckh4nd“).
   Sie erlaubt Unternehmen die interne Nutzung kostenlos, verbietet konkurrierende
   Angebote und wird je Version nach zwei Jahren zu Apache 2.0. Ein Modell
   „kostenlos nicht-kommerziell, kostenpflichtig kommerziell“ passt dazu nicht und
   bräuchte eine andere Lizenz für neue Versionen (bereits veröffentlichte bleiben
   FSL). Vorher klären: Rechteinhaber (Beiträge Dritter), rechtliche Beratung;
   technisch später Lizenzprüfung und Nutzerzählung im Server.
