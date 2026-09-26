# Teilautomatisierung eingehender E-Mails — Abschlussbericht

**Stand:** 2026-09-26 · Branch `claude/jolly-cerf-hkvznl` ab `main` `e82d282` (nach Merge von PR #193) · Konzept und Entscheidungen: [`docs/MAIL_TEILAUTOMATISIERUNG.md`](../../docs/MAIL_TEILAUTOMATISIERUNG.md) · Anleitung: `docs/USER_GUIDE_WORKFLOWS.md`, Abschnitt „Teilautomatisierung Schritt für Schritt“

## 1. Auftrag

Eingehende Mails, die sich ohne Risiko beantworten lassen, beantwortet die KI; alles andere bleibt beim Menschen. Ablauf: statische Regeln → Entscheidungsmodell „Spam?“ → Entscheidungsmodell „Mensch nötig?“ → KI-Antwort mit Gegenprüfung → Ausgangs-Workflow (statisch, dann KI-Entscheidung „versandfähig?“) → Kennzeichnung „von KI gesendet“. Learnings aus menschlichen Antworten und Notizen werden gesammelt, ausgewertet und nach Freigabe in die Wissensbasis übernommen. Alles bleibt über den Workflow-Editor anpassbar; SimpleCRM liefert Bausteine und Vorlagen.

## 2. Ergebnis je Paket

| Paket | Lieferung |
|---|---|
| P1 KI-Entscheidung | Baustein `ai.decide` (Ja/Nein/Unsicher/KI-Fehler, Mindest-Sicherheit), Profil-Typ „OpenRouter Entscheidungsmodell (Decisions API)“ für Jev/Span-01, Chat-Modelle mit Begründung, „Verbindung testen“ für alle KI-Profile, Server übernimmt die gemeldeten Kosten |
| P2 Ausgang | Angehaltene Mails landen mit echtem Grund im Posteingang (auch automatische Antworten und der Versand eines Menschen), Standardtext ohne Begründung, „Ohne Ausgangsprüfung senden“ (Einstellung, Audit, nur für den unveränderten angehaltenen Inhalt), KI-Antwort-Vorlagen senden durch den Ausgang |
| P3 Gesendet von | `sent_by_kind` (Mensch, KI automatisch, KI freigegeben, Automatik, Relay) an jeder gesendeten Mail, Kennzeichen in Liste und Leseansicht, virtueller Ordner „Gesendet (KI)“ |
| P4 Zeitplan | Auslöser „Zeitplan (Cron)“ auch auf dem Server: Minutentakt je Workspace, genau ein Lauf je Zeitpunkt, Zeitzone je Workspace (Standard Europe/Berlin), Zeitpläne laufen erst nach einmaligem Speichern im Server |
| P5 Learnings | Sammeln (bearbeitete KI-Entwürfe, menschliche Antworten, „Learning notieren“), Datenschutzfilter, Auswertung per Knopf oder Baustein `ai.learnings_digest`, Vorschlag als komplette neue Wissensbasis mit Änderungsansicht, bearbeitbar, Übernehmen/Verwerfen; eigene Wissensbasis „Learnings“ wird von allen KI-Bausteinen mitgelesen |
| P6 Vorlagen | „Spam-Entscheidung“ (Prio 5), „Mensch oder KI? → KI-Antwort mit Gegenprüfung“ (Prio 50), „KI-Entscheidung vor dem Versand“ (Ausgang, Prio 50), „Learnings wöchentlich auswerten“ (Mo 06:00); Checkliste im Vorlagen-Dialog; „Vorlage laden“ trägt das Entscheidungsmodell ein |

## 3. Entscheidungen

- **Virtueller Ordner statt IMAP-Ordner** (Pro/Contra im Konzept 3.2): POP3 hat keine Ordner, SimpleCRM legt keine IMAP-Ordner an, die Mail bleibt im echten „Gesendet“ auch für andere Mailprogramme.
- **Decisions API:** Jev und Span-01 laufen nicht über Chat Completions. Anfrage `POST https://openrouter.ai/api/alpha/decisions` mit `questions.decision.type = "noul"`; Antwort `answers.decision.noul` (0–1). Span-01-Format war aus der Umgebung nicht abrufbar; die Auswertung akzeptiert `noul`, `probability`, `p_present`, `yes`. Prüfung mit echtem Schlüssel über „Verbindung testen“.
- **Überspringen der Ausgangsprüfung:** Standard „alle, die senden dürfen“ (Wunsch Pascal), aber nur für den unveränderten angehaltenen Inhalt; wer ändert, sendet normal und die Prüfung läuft neu.
- **Learnings-Verwaltung:** Server nur Owner/Admin (Parität Desktop), weil Kandidaten Inhalte aus allen Postfächern enthalten. „Learning notieren“ darf jeder mit Leserecht auf die Mail.
- **Cron-Semantik:** Tag des Monats UND Wochentag müssen passen (wie node-cron auf dem Desktop), damit ein Workflow in beiden Editionen gleich läuft.

## 4. Nebenbei gefundene und behobene Fehler (bestanden schon vor dieser Arbeit)

1. Server-Oberfläche zeigte angehaltene Entwürfe nie als angehalten (Felder fehlten in API und Transport).
2. Angehaltene automatische Antworten blieben in beiden Editionen unsichtbar „geplant“ und kamen nie im Posteingang an.
3. Ausgangsprüfungs-Jobs aus Workflow-Versand liefen auf dem Server nie (Platzhalter-Akteur `system` wurde vom Job-Enforcer abgewiesen); gleiches Muster bei der Weiterleitungskopie.
4. Server-Sync des Gesendet-Ordners legte jede gesendete Mail doppelt an.
5. Desktop: angehaltene automatische Antwort verlor den RFC-3834-Marker (`Auto-Submitted`).
6. Server: synchroner Ausgangs-Block beim Versand eines Menschen hielt den Entwurf nicht an (Desktop schon).
7. „Ohne Ausgangsprüfung senden“ aus dem Entwurfsfenster hätte den internen Hinweis „Versand blockiert“ an den Kunden geschickt (Hinweis wurde beim Speichern umgeformt und nicht erkannt).
8. Desktop: „Als Spam markieren“ mit Verschieben brach bei POP3/fehlendem Spam-Ordner mit Fehler ab (Server tolerant).
9. Server-Speichern einer Wissensbasis lief nicht atomar (Lesen-Ändern-Schreiben im Client) — jetzt eigene atomare Route.

## 5. Sicherheitsprüfung

Unabhängiges Review des gesamten Diffs (neue Routen, IPC, Jobs, KI-Aufrufe, Datenschutz). Befunde und Stand:

| # | Schwere | Befund | Stand |
|---|---|---|---|
| B1 | hoch | Learnings-Datenschutzfilter lief auf ungekürztem Mailtext mit quadratischen Regexen (200 KB → bis 79 s Blockade) | behoben: Kürzen vor der Verarbeitung, lineare Muster, 45 entartete 200-KB-Eingaben je < 200 ms getestet |
| B2 | mittel | Learnings-Kandidaten für `workflows.manage` ohne Mail-ACL sichtbar | behoben: Verwaltung nur Owner/Admin |
| B3/B4 | mittel/niedrig | Überspringen erlaubte nach dem Anhalten geänderten, nie geprüften Inhalt | behoben: Fingerprint beim Anhalten, 409 bei Abweichung |
| B5 | niedrig | 90-Tage-Frist galt nicht für Kandidaten offener Vorschläge | behoben |
| B6 | niedrig | https-Pflicht für Entscheidungsprofile per PATCH umgehbar | behoben |
| B7 | niedrig | reine HTML-Änderung ließ „KI · freigegeben“ stehen | behoben |

Zusätzlich beim Gesamtlauf gefunden: Antwort-Parser von `ai.decide` und der Learnings-Auswertung waren bei entarteten Modellantworten quadratisch — beide mit Schrittbudget begrenzt.

## 6. Prüfungen

Jede Fehlerbehebung mit vorher rotem Regressionstest; neue Funktionen mit Unit-, Embedded-Postgres- (als Nicht-root) und Renderer-Tests in beiden Editionen. Ende-zu-Ende: KI-Entscheidung im Ausgang (Mensch sendet → angehalten → ohne Prüfung senden; automatische Antwort → angehalten bzw. versendet als „KI“), Vorlagen je Ausgang, Zeitplan-Taktgeber mit parallelen Ticks, Learnings vom Versand bis zur Übernahme. Ergebnis des letzten Gesamtlaufs in Abschnitt 9.

## 7. Betrieb und Update (Server)

- **Migrationen:** `0055_email_message_sent_provenance`, `0056_email_workflow_schedule_state`, `0057_ai_learnings` — additiv, idempotent, unter FORCE RLS getestet.
- **Zeitpläne** brauchen `JOB_WORKER_ENABLED=true` (wie der Mail-Sync). Bestehende oder vom Desktop importierte Zeitplan-Workflows laufen erst nach einmaligem Speichern im Server. Zeitzone unter Einstellungen → Automatisierung (Standard Europe/Berlin; der Container läuft in UTC).
- **Neue Einstellungen:** „Ausgangsprüfung überspringen erlauben“ (Standard alle), Zeitzone, Learnings (Sammeln ab Werk aus, Ziel-Wissensbasis, KI-Profil).
- **KI-Profil für Entscheidungsmodelle:** Profil-Typ „OpenRouter Entscheidungsmodell“, Basis `https://openrouter.ai/api`, Modell z. B. `typesafe/jev-1.13`, OpenRouter-Schlüssel, dann „Verbindung testen“.

## 8. Grenzen und offene Punkte

- Server: mehrere Ausgangs-Workflows laufen parallel; die Priorität ordnet im Ausgang nicht die Ausführung.
- Desktop erfasst keine KI-Kosten; Desktop-KI-Profile haben keine https-Pflicht (lokale Modelle über http sind dort üblich).
- `ai.decide` sieht die Wissensbasis nicht; „Mensch nötig?“ schätzt die KI aus der Art der Anfrage.
- Ein offener Learnings-Vorschlag blockiert neue Auswertungen derselben Wissensbasis, bis ein Admin ihn übernimmt oder verwirft.
- Span-01: Antwortformat nicht verifiziert (siehe 3).
- Electron-E2E und Docker-Compose-Smoke laufen nur in der CI (Pull Request auf `main`).

## 9. Letzter Gesamtlauf (Stand `9c2adf1`)

| Prüfung | Ergebnis |
|---|---|
| Typecheck (core, server, Renderer, Electron) | grün |
| ESLint auf allen 248 geänderten Dateien (`--max-warnings 0`) | grün |
| Toolchain-Prüfung, Dangerous-Defaults | grün |
| Unit + Integration inkl. Embedded Postgres (als Nicht-root), Server-Coverage-Ratchet | 549 Suiten, 5256 Tests grün; Ratchet erfüllt (81,04 / 74,13 / 80,85 / 81,04) |
| UI-Coverage-Ratchet | 415 Suiten, 4204 Tests grün; Ratchet erfüllt (55,93 / 70,01 / 42,35 / 55,93) |
| Mail-Suite mit Coverage-Schwelle | 224 Suiten, 1621 Tests grün; 93,65 % Zeilen / 83,73 % Branches (eine Datei scheiterte im Lauf nur an Dateirechten eines alten Temp-Verzeichnisses und ist nach Korrektur grün) |
| Build (Web + Electron-Main) | grün |
| Electron-E2E, Docker-Compose-Smoke | nicht lokal; laufen in der CI eines Pull Requests auf `main` |
