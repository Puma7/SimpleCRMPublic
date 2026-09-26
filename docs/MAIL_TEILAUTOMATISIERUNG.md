# Teilautomatisierung eingehender E-Mails — Konzept und Umsetzung

**Stand:** 2026-09-26 · Auftrag von Pascal nach Merge von PR #193. Gilt für beide Editionen (Desktop und Server), sofern nicht anders angegeben.

## 1. Ziel

Eingehende Mails, die sich ohne Risiko automatisch beantworten lassen, beantwortet die KI. Alles andere landet wie bisher beim Menschen. Jede automatische Antwort läuft vor dem Versand durch den Ausgangs-Workflow. Aus jeder menschlichen Antwort und aus Notizen der Mitarbeiter entstehen allgemeine Learnings, die nach Freigabe in die Wissensbasis wandern.

Alles bleibt aus normalen Workflow-Bausteinen gebaut. SimpleCRM liefert Vorlagen und Vorschläge; jeder kann seinen Ablauf im Workflow-Editor anpassen.

## 2. Ablauf

```
Eingang
  ├─ 1. Statische Regeln (Priorität 1–9): Absender-Filter, Bedingungen, Verschieben, Weiterleiten, Tags
  ├─ 2. KI-Entscheidung „Ist das Spam?“ (Priorität 5)
  │      Ja → Spam-Ordner, Kette stoppt · Unsicher → „Spam prüfen“ · Nein → weiter
  ├─ 3. KI-Entscheidung „Muss ein Mensch das bearbeiten?“ (Priorität 50)
  │      Ja / Unsicher / Fehler → bleibt im Posteingang (Tag „manuell“)
  │      Nein ↓
  ├─ 4. KI-Antwort entwerfen (Wissensbasis + Learnings) → Sicherheits-Gate → KI-Gegenprüfung
  │      Prüfen → Entwurf „Wartet auf Freigabe“ im Posteingang
  │      Senden ↓
  └─ 5. Versand über den Ausgangs-Workflow
Ausgang
  ├─ statische Regeln (Priorität 10)
  └─ KI-Entscheidung „Ist die Mail versandfähig?“ (Priorität 50)
         Ja → Versand · Nein/Unsicher/Fehler → angehalten, zurück in den Posteingang
Versendet → Kennzeichnung „KI“ bzw. „Mensch“ · virtueller Ordner „Gesendet (KI)“
Learnings → sammeln (bearbeitete KI-Entwürfe, menschliche Antworten, Notizen)
          → auswerten (Knopf oder Zeitplan) → Vorschlag mit Änderungsansicht → Freigabe → Wissensbasis
```

## 3. Entscheidungen

### 3.1 Entscheidungsmodelle (Jev, Span-01)

- Jev (`typesafe/jev-1.13`) und Span-01 (`respan/span-01`) laufen über die **OpenRouter Decisions API** (`POST https://openrouter.ai/api/alpha/decisions`), nicht über Chat Completions.
- Anfrage: `{ model, state, questions: { decision: { type: "noul", instructions, criteria: { true, false } } } }`.
- Antwort: `{ answers: { decision: { type: "noul", noul: 0.96 } }, usage: { input_tokens, output_tokens, cost } }`. Es gibt nur eine Wahrscheinlichkeit für „Ja“, keine Begründung.
- Span-01 liefert laut Anbieter je Verhalten die Wahrscheinlichkeiten „vorhanden / nicht vorhanden / nicht erkennbar“. Das genaue Format auf OpenRouter war aus der Entwicklungsumgebung nicht abrufbar. Die Auswertung akzeptiert deshalb mehrere Antwortformen (`noul`, `probability`, `p_present`); ob Span-01 funktioniert, zeigt der neue Knopf **„Verbindung testen“** im KI-Profil.
- Neuer Profil-Typ **„OpenRouter Entscheidungsmodell (Decisions API)“**. Solche Profile funktionieren nur im Baustein „KI-Entscheidung“; alle anderen KI-Bausteine melden das klar.
- Der Baustein „KI-Entscheidung“ funktioniert auch mit normalen Chat-Modellen. Dann liefert das Modell zusätzlich eine kurze Begründung.

### 3.2 Virtueller Ordner statt echtem IMAP-Ordner

| | Virtueller Ordner „Gesendet (KI)“ (Filter auf gesendete Mails) | Echter IMAP-Ordner auf dem Mailserver |
|---|---|---|
| Andere Mailprogramme (Outlook, Handy) | sehen die Mail im normalen „Gesendet“, ohne KI-Hinweis | sehen einen eigenen Ordner |
| POP3-Konten | funktioniert | geht nicht: POP3 hat keine Ordner |
| Umsetzung | Spalte an der Mail + Filter; die Seitenleiste besteht ohnehin nur aus solchen Ansichten | SimpleCRM legt heute keine IMAP-Ordner an; nach dem Versand müsste die Kopie zusätzlich verschoben werden (weitere Fehlerquelle) |
| Suche „Was habe ich gesendet?“ | vollständig in „Gesendet“ | aufgeteilt auf zwei Ordner, auch in anderen Programmen |
| Kennzeichnung an der Mail | bleibt dauerhaft in SimpleCRM | müsste trotzdem gespeichert werden; der Ordner allein sagt nicht, wer freigegeben hat |
| Zusammenhang mit Antworten/Threads | unverändert | Kopie liegt getrennt vom übrigen Verlauf |
| Wenn der Server-Sync der Gesendet-Ordner aktiv ist | eine Zeile je Mail (siehe Korrektur unten) | doppelte Pflege zweier Ordner |

**Entscheidung: virtueller Ordner.** Die gesendete Mail bleibt im echten „Gesendet“-Ordner des Mailservers. SimpleCRM speichert an jeder gesendeten Mail, wer sie verschickt hat, und zeigt:

- ein Kennzeichen in Liste und Leseansicht („KI“, „KI · freigegeben“, „Automatik“, „Relay“, „Ausgangsprüfung übersprungen“),
- den Ordner **„Gesendet (KI)“** unter „Gesendet“. „Gesendet“ zeigt weiterhin alle gesendeten Mails.

Nebenbei wird ein bestehender Fehler behoben: Mit aktivem Sync des Gesendet-Ordners legte der Server eine zweite Zeile für dieselbe Mail an. Der Desktop hat die gesendete Zeile schon immer per Message-ID zusammengeführt; der Server macht das jetzt auch.

### 3.3 Ausgangsprüfung überspringen

- Hält der Ausgangs-Workflow eine Mail an, zeigt der Hinweis „Versand blockiert“ die Begründung. Ein Entscheidungsmodell liefert keine; dann steht dort: **„Vom Entscheidungsmodell als nicht versandfähig blockiert – bitte E-Mail prüfen.“** (mit der Ja-Wahrscheinlichkeit).
- Neuer Knopf **„Ohne Ausgangsprüfung senden“** im Hinweis und im Entwurfsfenster eines angehaltenen Entwurfs, mit Rückfrage. Die Mail geht dann ohne erneuten Durchlauf der Ausgangs-Workflows raus.
- Jeder solche Versand wird protokolliert (Server: Audit-Log, Desktop: Protokoll) und an der Mail als „Ausgangsprüfung übersprungen“ gekennzeichnet.
- Einstellung unter **Einstellungen → Automatisierung**: „Ausgangsprüfung überspringen erlauben: alle, die senden dürfen (Standard) / nur Owner und Admin / niemand“.

### 3.4 Learnings mit Freigabe

- **Sammeln** (Schalter, ab Werk aus):
  - KI-Entwurf gegen die tatsächlich gesendete Fassung, wenn ein Mensch ihn geändert hat,
  - menschliche Antworten auf eingehende Mails (Frage und Antwort),
  - Knopf **„Learning notieren“** in der Leseansicht (freie Notiz).
- **Datenschutz:** Schon beim Sammeln werden Zitat und Signatur entfernt und personenbezogene Daten ersetzt (E-Mail-Adressen, Telefonnummern, IBAN, URLs, Absender- und Kundennamen, Adressen, Bestell- und Kundennummern). Gespeichert wird nur der bereinigte Text. Die KI bekommt zusätzlich die Anweisung, nur allgemeine Regeln ohne Personenbezug zu formulieren; ihre Ausgabe läuft noch einmal durch denselben Filter. Rohdaten werden nach der Entscheidung über den Vorschlag gelöscht, spätestens nach 90 Tagen (auch wenn der Vorschlag dann noch offen ist; er trägt Basis- und Vorschlagstext selbst).
- **Auswerten:** per Knopf „Learnings jetzt auswerten“ oder per Workflow mit Zeitplan (Baustein „Learnings auswerten“, Vorlage „wöchentlich“). Täglich, wöchentlich oder monatlich stellt man im Zeitplan ein.
- **Vorschlag:** Die KI liefert Änderungen je Abschnitt (`##`) der Ziel-Wissensbasis (hinzufügen, ändern, entfernen). SimpleCRM baut daraus die **komplette neue Wissensbasis** und zeigt sie als Änderungsansicht: Entferntes rot durchgestrichen, Neues farbig. Der Vorschlag lässt sich vor der Übernahme bearbeiten und um eigene Punkte ergänzen.
- **Ziel:** eine eigene Wissensbasis „Learnings“ (eigener Kontext „Learnings“, den alle KI-Bausteine in jeder Richtung automatisch mitlesen) oder eine vorhandene Wissensbasis, die korrigiert werden soll.
- **Freigabe:** Owner/Admin (Server: Recht `workflows.manage`) übernimmt oder verwirft. Hat sich die Wissensbasis seit dem Vorschlag geändert, warnt SimpleCRM vor dem Überschreiben.

### 3.5 Zeitplan auch auf dem Server

Der Auslöser „Zeitplan (Cron)“ war bisher nur auf dem Desktop verfügbar. Der Server bekommt einen eigenen Taktgeber: je Minute pro Workspace ein Prüf-Job; jeder fällige Zeitpunkt wird genau einmal ausgelöst (Sperre in der Datenbank, auch bei mehreren Server-Prozessen). Zeitzone: Einstellung je Workspace, Standard `Europe/Berlin`. Verpasste Zeitpunkte (Server war aus) werden nicht nachgeholt, wenn sie älter als 15 Minuten sind. Mindestabstand wie auf dem Desktop: 15 Minuten.

## 4. Bausteine

### 4.1 KI-Entscheidung (`ai.decide`)

| Feld | Bedeutung |
|---|---|
| Frage | Ja/Nein-Frage, z. B. „Ist diese E-Mail Spam?“ (Platzhalter erlaubt) |
| Wann „Ja“? / Wann „Nein“? | Kriterien in eigenen Worten (optional) |
| Was darf die KI sehen? | kompletter Text (Standard) oder nur Kopfdaten |
| Mindest-Sicherheit | Standard 80 %: Ja ab 80 % Ja-Wahrscheinlichkeit, Nein bis 20 %, dazwischen „Unsicher“ |
| KI-Profil | Entscheidungsmodell (Decisions API) oder Chat-Modell |

- Ausgänge: **Ja**, **Nein**, **Unsicher**, **KI-Fehler**. Ist an „Nein“ oder „Unsicher“ nichts angeschlossen, endet der Lauf dort (kein Rückfall auf eine unbeschriftete Kante).
- Variablen: `ai.decide.answer`, `ai.decide.probability` (0–100), `ai.decide.confidence`, `ai.decide.reason`, `ai.decide.summary`.
- Im **Ausgangs-Workflow** halten „Nein“, „Unsicher“ und „KI-Fehler“ den Versand immer an (wie die KI-Ausgangsprüfung); die Ausgänge dienen dann nur für Zusatzschritte wie Tags.
- Auf dem Server läuft der Baustein als Hintergrund-Job; die Kette der eingehenden Workflows wartet darauf.

### 4.2 Learnings auswerten (`ai.learnings_digest`)

Für Zeitplan- oder manuelle Workflows. Felder: Ziel-Wissensbasis (leer = „Learnings“), Zeitraum (seit letzter Auswertung / Tag / Woche / Monat), Mindestanzahl gesammelter Einträge (Standard 3), KI-Profil (Chat-Modell). Ergebnis: ein Vorschlag unter **Einstellungen → Learnings**; der Baustein ändert die Wissensbasis nie selbst.

### 4.3 Vorlagen „Teilautomatisierung“

| Vorlage | Auslöser | Priorität |
|---|---|---|
| Eingehend: Spam-Entscheidung (Entscheidungsmodell) | eingehend | 5 |
| Eingehend: Mensch oder KI? → KI-Antwort mit Gegenprüfung | eingehend | 50 |
| Ausgehend: KI-Entscheidung vor dem Versand | ausgehend | 50 |
| Learnings wöchentlich auswerten | Zeitplan (Mo 06:00) | – |

Die KI-Antwort-Vorlagen schicken Antworten ab jetzt durch den Ausgangs-Workflow („Zusätzlich durch Ausgangs-Workflows prüfen“ an).

Priorität und Zeitplan gehören zur Vorlage; „Vorlage laden“ trägt sie im Editor ein, dazu in „KI-Entscheidung“ ohne Profil das erste Entscheidungsmodell (sonst bleibt das Standard-Profil). „Mensch oder KI?“ beginnt mit „Stopp nach Spam“, damit eine als Spam markierte Mail nie beantwortet wird, auch wenn die Spam-Vorlage davor mit Fehler endete. Scheitert beim Baustein „Als Spam markieren“ nur das Verschieben auf dem Mail-Server (POP3-Konto, kein Ordner „Spam“, IMAP-Fehler), bleibt die Mail in beiden Editionen als Spam markiert; der Desktop nennt den Grund in der Lauf-Historie (`imap_spam_move_failed: …`), der Server versucht das Verschieben nach dem Commit und übergeht ein Scheitern. Schritt-für-Schritt-Anleitung: [`USER_GUIDE_WORKFLOWS.md`](USER_GUIDE_WORKFLOWS.md#teilautomatisierung-schritt-für-schritt).

## 5. Datenmodell (neu)

| Edition | Änderung |
|---|---|
| beide | `email_messages`: `draft_origin_kind`, `draft_origin_workflow_id`, `sent_by_kind`, `sent_by_user_id`, `sent_by_workflow_id`, `sent_by_label`, `sent_outbound_review_skipped` (Server-Migration `0055`) |
| Desktop | `email_messages.ai_suggestion_snapshot` (der Server hat die Spalte seit `0018`) |
| Server | `email_workflows.schedule_last_slot_at` (Migration `0056`) |
| beide | `ai_learning_candidates`, `ai_learning_digests` (Server-Migration `0057`) |
| Einstellungen | `outbound_review_skip_policy`, `workflow_schedule_timezone` (nur Server), `learnings_collect_enabled`, `learnings_target_kb_id`, `learnings_profile_id` |

`sent_by_kind`: `human` (Mensch hat geschrieben oder einen KI-Entwurf deutlich geändert), `ai_auto` (KI-Entwurf automatisch gesendet), `ai_approved` (KI-Entwurf, von einem Menschen unverändert freigegeben), `workflow` (Automatik ohne KI), `relay` (externes System über das SMTP-Relay). Ältere Mails haben keinen Wert und kein Kennzeichen.

## 6. Rechte und Sicherheit

- „KI-Entscheidung“ zählt als KI-Aufruf mit Seiteneffekt (externer Dienst) wie die übrigen KI-Bausteine.
- Zeitplan-Workflows laufen als System wie eingehende Workflows. Anlegen und Aktivieren braucht dieselben Rechte wie bisher (Server: `workflows.manage` für ausführungsrelevante Änderungen; Desktop: Owner/Admin).
- Learnings einsehen, auswerten, übernehmen (Einstellungen, Einträge, Vorschläge): in beiden Editionen nur Owner/Admin. Die Einträge enthalten bereinigte Inhalte aus allen Postfächern; `workflows.manage` lässt sich auf dem Server per Gruppe an Nicht-Admins vergeben und würde die Mail-Rechte umgehen. Der Baustein „Learnings auswerten“ läuft als Workflow unter den üblichen Workflow-Rechten. „Learning notieren“: jeder, der die Mail lesen darf.
- Die Decisions-API-Anfragen laufen über denselben SSRF-Schutz wie alle KI-Aufrufe (nur der Host aus dem Profil, fest aufgelöste IP, keine Weiterleitungen).

## 7. Umsetzung

| Paket | Inhalt |
|---|---|
| P1 | `ai.decide`, Decisions-API-Anbindung, „Verbindung testen“, Kosten aus der Antwort übernehmen (Server) |
| P2 | Ausgang: Grund in der Server-Oberfläche anzeigen (bisher fehlte er dort ganz), angehaltene automatische Antworten wieder sichtbar machen (bisher blieben sie unsichtbar „geplant“), Standardtext ohne Begründung, „Ohne Ausgangsprüfung senden“, Vorlagen mit Ausgangsprüfung |
| P3 | Kennzeichnung „gesendet von“, Ordner „Gesendet (KI)“, Server-Sync ohne Doppelzeilen |
| P4 | Zeitplan auf dem Server |
| P5 | Learnings: Sammeln, Datenschutzfilter, Auswertung, Änderungsansicht, Freigabe, „Learning notieren“ |
| P6 | Vorlagenpaket, Anleitung in `USER_GUIDE_WORKFLOWS.md` |

## 8. Grenzen

- Auf dem Server laufen mehrere Ausgangs-Workflows parallel, nicht nacheinander. Die Priorität legt deshalb im Ausgang nur die Anzeige-Reihenfolge fest; versendet wird erst, wenn alle zugestimmt haben. Die KI-Entscheidung läuft also auch dann, wenn eine statische Regel schon blockiert.
- Der Desktop erfasst keine KI-Kosten (wie bisher).
- Entscheidungsmodelle liefern keine Begründung; die Anzeige nennt dann die Ja-Wahrscheinlichkeit.
