# Sicherheits- und Funktionsdurchsicht vom 25.09.2026

Status: **Korrekturen umgesetzt und in Prüfung; unabhängiger Sicherheitsabschluss offen.**
Dieser Bericht ergänzt die Änderungen in [Draft-PR #192](https://github.com/Puma7/SimpleCRMPublic/pull/192).
Er ersetzt weder den noch laufenden Deep-Security-Bericht noch eine Zusicherung absoluter Fehlerfreiheit.

## Grundlage und Arbeitsweise

Ausgangsstand: `134b8088b168eee23acd89158562964813058fb2`.
Desktop (Electron/SQLite) und Server (Fastify/PostgreSQL/Caddy) gehören zum Umfang.
Der Nutzer hat Docker hinter Caddy sowie die aktuelle Veröffentlichung v1.0.8
als Upgrade-Ausgangspunkt bestätigt. Eigene Reverse-Proxys bleiben ausdrücklich
über vertrauenswürdige IP-Adressen beziehungsweise Netze konfigurierbar.

Reproduzierbare Fehler wurden mit echten Laufzeitpfaden oder gezielten Tests
von Testfehlern, Abhängigkeitsmeldungen und Umgebungsproblemen unterschieden.
Die unabhängige Sicherheitsprüfung läuft auf dem unveränderten Ausgangsstand;
Entwicklung und Tests erfolgen in einer getrennten Arbeitskopie. Deren Änderungen
werden auf demselben PR-Branch veröffentlicht. Keine Produktionsdaten, kein
Versand an Dritte, kein Merge und kein Deployment gehören zu dieser Abnahme.

## Befunde und umgesetzte Änderungen

| Beobachtung | Einordnung und Änderung | Nachweis |
|---|---|---|
| Quill exportiert aktive HTML-Attribute beim Kopieren/Ausschneiden | Anwendungsgrenze in beiden Editoren durch HTML-Bereinigung geschlossen; Bibliothekswarnung bleibt sichtbar | Echte Quill-Copy/Cut-Handler, Unicode/Formatierung/Klartext und Editor-Tests |
| Fastify-Update unterstützt numerische Proxy-Hop-Angaben nicht mehr | Explizite IP-/CIDR-Konfiguration, frühe verständliche Ablehnung alter Werte, feste Caddy-Adresse mit getrenntem dynamischem Adresspool | Proxy-Laufzeittests, Compose-Prüfungen und echte HTTPS-Anfragen mit manipulierten Forwarding-Headern |
| Produktionsimage hängt beim Prune-Schritt | Produktionsabhängigkeiten separat aus dem Lockfile installieren | Tatsächlicher Docker-Bau und Compose-Neuinstallation |
| Navigation verliert auf schmalen Fenstern erreichbare Einträge | Horizontales Scrollen und stabile Breiten | Desktop-Test bei 390 Pixeln sowie gerenderte Oberfläche |
| Bibliotheken mit Sicherheitsmeldungen | Sicherheitsupdates und gezielte transitive Overrides; tatsächliche Mail-/HTML-/CommonJS-Verträge geprüft | Abhängigkeitsprüfung und Laufzeit-Regressionstests; Details in [Dependency assessment](SECURITY_DEPENDENCY_EXCEPTIONS.md) |
| Testdateien scheitern an fehlenden direkten Abhängigkeiten | Explizite Testabhängigkeiten ergänzt | Installation, vollständige Tests und Build |
| Vier Mail-Testdateien nicht in der Mail-Auswahl | Auswahl ergänzt; IMAP-Nebenläufigkeit, Deduplizierung und Einstellungen genauer geprüft | Mail-Prüfung einschließlich unveränderter Abdeckungsgrenzen |
| Vier alte Desktop-Testdateien ausgeschlossen beziehungsweise wirkungslose Prüfungen | Isolierte Sessions und konkrete Prüfungen für Kunden, Deals, Einstellungen und Nachverfolgung; in normale Suite aufgenommen | 62 Desktop-Ablauftests bestanden |
| PDF-Test wegen Jest-VM-Grenze übersprungen | Echter Node-Unterprozess prüft Desktop- und Server-Extraktion eines synthetischen PDF | Aktivierter Test in `tests/mail/attachment-text-extract.test.ts` |
| Delegations-Browsertest meldet Rechtefehler | Falsche Testsimulation identifiziert: unbeteiligter Benutzer erhielt Verwaltungsrechte; nur Simulation korrigiert | Server-Client-Browserablauf bestanden; produktive ACL unverändert |

Eine Abhängigkeitswarnung ist kein Beweis einer ausnutzbaren CRM-Schwachstelle.
Für deepmerge-ts und uuid wurden die ursprünglichen Aufrufvoraussetzungen
untersucht und die betroffenen Versionen anschließend kompatibel ersetzt.
Es wurde weder eine entfernte Ausnutzbarkeit behauptet noch eine Warnung unterdrückt.

## Prüfdeckung

Aktueller lokaler Nachweis: 346 Unit-/Integrationssuiten mit 3.458 Tests und
einem Snapshot bestanden. Die allgemeine Abdeckungsprüfung besteht mit
93,03 % Anweisungen/Zeilen, 91,59 % Zweigen und 98,24 % Funktionen.
Die Mail-Prüfung besteht mit 197 Suiten/1.296 Tests ohne übersprungenen PDF-Test
und unverändertem Ratchet (92,45 % Zeilen, 81,49 % Zweige, 94,30 % Funktionen).
62 Desktop-Ablauftests sind bestanden. Die frische Linux-CI wird separat
gegen den jeweiligen aktuellen PR-Commit geprüft.

Die Tabelle beschreibt Nachweisarten, keine Behauptung einer lückenlosen Prüfung
jeder möglichen Eingabekombination. Bestehende Tests werden nicht als neu
entdeckte oder neu behobene Fehler gezählt.

| Bereich | Ausgeführte Prüfung und Grenze |
|---|---|
| Anmeldung, Setup, Sessions, CSRF | Bestehende Unit-/Integrationstests; zusätzlich echte HTTPS-Anmeldung, Cookie-Eigenschaften, Erneuerung, CSRF-Ablehnung und Abmeldung im isolierten Stack |
| Rollen, Postfachrechte, Events | Reale PostgreSQL-/HTTP-ACL-Tests, Live-/Replay-Event-Filterung sowie Browserablauf für Delegation; externe Gegenstellen kontrolliert |
| Mandantentrennung | 303 Prüfungen durch die RLS-CLI nach Neuinstallation und Release-Upgrade; zusätzliche PostgreSQL-Integrationstests |
| Electron/IPC | Router-, Schema- und Handler-Tests plus 62 vollständige Desktop-Abläufe mit isoliertem Benutzerverzeichnis |
| CRM-Verknüpfungen | Kunden, Deals, Produkte, Aufgaben, Kalender, Nachverfolgung und benutzerdefinierte Felder; echte SQLite-/PostgreSQL-Atomizitäts- und Nebenläufigkeitstests |
| E-Mail, Anhänge, Wiederherstellung | Mail-Suite mit kontrollierten IMAP/POP3/SMTP-Gegenstellen; echte MIME-, PDF-, DOCX- und lokale Datenbankpfade; keine produktiven Postfächer |
| Workflows und KI | Bestehende Graph-, Job-, Freigabe-, Retry- und Vorlagentests sowie Workflow-Oberfläche; keine kostenpflichtigen Provider-Aufrufe |
| HTTP-/Dateigrenzen, öffentliche APIs | Bestehende Negativ-/Grenztests ausgeführt; unabhängige Gesamtbewertung dieser Angriffsflächen bleibt bis zum Security-Scan offen |
| JTL, MSSQL, OAuth | Schnittstellen-, Fehler- und Mappingtests sowie CommonJS-Credential-Konstruktion; keine echte Anbieteranmeldung oder Kundeninstallation abgenommen |
| Docker und Betrieb | Tatsächlicher Caddy-/API-/PostgreSQL-Stack, 51 Migrationen, Backup/Restore und neun Betriebsskripttests unter Linux |
| Upgrade v1.0.8 | PostgreSQL 37 → 51 Migrationen, Bestandsanmeldung und CRM-Verknüpfungen, idempotente Wiederholung, Isolation und altes Backup; SQLite-Bestandsdaten/Kalenderlink, Integrität, Schreiben und erneutes Öffnen |
| Build und Werkzeugkette | Lint, Typecheck, Produktionsbuild und isolierter Svelte-Lab-Build; GitHub-CI auf dem PR zusätzlich prüfen |

Upgrade-Referenz ist Release-Commit `ac2cea1e480574ee78635dea9b1ffbaefc44ada3`.
Die Release-Quellen wurden mit ihrem unveränderten Lockfile gebaut.
Der PostgreSQL-Upgrade-Test verwendete echte alte/neue API-Prozesse mit
isolierter Docker-Datenbank; Caddy/Compose wurde separat geprüft.
Der SQLite-Test verwendete die tatsächlichen Initialisierungen mit einer
isolierten Electron-Pfadabfrage. Betriebssystem-Installer und ältere Releases
sind damit nicht pauschal abgenommen.

Der PDF-Unterprozess verwendet dieselben Core-Quellaliase wie Jest über
`tests/setup/tsconfig.node-runtime.json`. Ein gezielter Lauf ohne
`packages/core/dist` bestätigt, dass die Prüfung auch vor dem ersten Build
funktioniert; ein bereits vorhandener lokaler Build darf kein Testerfordernis
verdecken.

## Reproduzierbare Prüfbefehle

Mit der in `package.json` festgelegten Werkzeugkette:

```sh
pnpm install --frozen-lockfile
pnpm run check:typescript-toolchain
pnpm run check:dangerous-defaults
pnpm run lint
pnpm run typecheck
pnpm run build
pnpm run test:coverage --runInBand --verbose
pnpm run test:mail:coverage --runInBand
node scripts/check-mail-coverage-ratchet.mjs
pnpm run test:server:coverage
node scripts/check-server-coverage-ratchet.mjs
pnpm run test:ui:coverage:check
pnpm run test:e2e
pnpm audit
```

Headless-Linux benötigt die in CI eingerichtete Electron-/Xvfb-Umgebung.
Die separate Server-Client-Browserkonfiguration liegt unter
`tests/e2e/playwright.server-client.config.ts`.
Die Audit-Warnung für Quill bleibt erwartungsgemäß sichtbar.
Die allgemeinen 90-%-Grenzen beziehen sich auf die ausgewählte Dateiliste
in `jest.config.cjs`, nicht auf das gesamte Repository.
Mail-, Server- und UI-Auswertungen überlappen; Testzahlen nicht addieren.

Windows-Prüfungen benötigten eine temporäre Pfad-/Prozessstopp-Hilfe für
eingebettetes PostgreSQL und einen isolierten Schlüsselbund-Ersatz für Electron.
Diese Hilfen verändern keine Produktquellen und werden nicht ausgeliefert.
Lokale synthetische Geheimnisse, Datenbanken und Rohprotokolle sind kein PR-Inhalt.

## Noch erforderlicher Sicherheitsabschluss

- Kanonischen Deep-Security-Bericht abwarten und jeden bestätigten Befund gegen
  den geänderten Branch validieren, gegebenenfalls beheben und erneut prüfen.
- Den PR erst nach diesem Abgleich als sicherheitsseitig abgeschlossen bezeichnen.
- Quill-Mitigation bei Änderungen an Editoren oder HTML-Exporten erneut prüfen;
  die Bibliotheksausnahme spätestens am 25.10.2026 neu bewerten.
- Echte Provider- und Betriebssystem-Installer-Abnahmen bleiben gesonderte
  installationsabhängige Prüfungen. Sie sind nicht durch Mocks ersetzt oder
  als erfolgreich behauptet.

Der PR bleibt auf ausdrücklichen Nutzerwunsch ein Entwurf. Eine grüne CI allein
ersetzt den noch offenen unabhängigen Sicherheitsabschluss nicht.

## KI-Autorenschaft

OpenAI Codex (KI-Agent) hat Code, Tests, Dokumentation und diesen Bericht
vorbereitet sowie die genannten Prüfungen ausgeführt. Installierte CLI:
`codex-cli 0.155.0-alpha.16.4`. Diese Version ist keine Modellkennung und kein
Nachweis der Desktop-Agent-Version. Exakte Modell-/Build-Kennung und
Desktop-Agent-Version sind nicht verifiziert. Keine menschliche Prüfung behauptet.
