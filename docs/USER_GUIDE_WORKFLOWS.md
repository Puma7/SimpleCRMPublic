# Workflows — Anleitung für Anwender

Diese Anleitung erklärt Schritt für Schritt, wie Sie in SimpleCRM E-Mail-Workflows einrichten und bedienen — ohne Vorkenntnisse. Für einen Überblick über das E-Mail-Modul insgesamt siehe [`USER_GUIDE_EMAIL.md`](USER_GUIDE_EMAIL.md).

## Was sind Workflows?

Ein Workflow ist eine **Wenn-dann-Automatik** für Ihr Postfach: *Wenn eine neue Mail ankommt und im Betreff „Rechnung“ steht, dann Tag setzen, in die Kategorie „Rechnungen“ einsortieren und den Kunden verknüpfen.* Solche Abläufe bauen Sie sich aus Bausteinen zusammen — ganz ohne Programmierung.

Jeder Workflow besteht aus:

- einem **Auslöser** (z. B. „neue Mail eingegangen“, „Mail wird gleich versendet“, Zeitplan),
- optional **Bedingungen** (z. B. „Betreff enthält …“),
- einem oder mehreren **Schritten** („Knoten“), die etwas tun: Tag setzen, Aufgabe anlegen, KI fragen, Entwurf erstellen, …

Sie finden die Workflows unter **E-Mail → Workflows** (Unterleiste im E-Mail-Bereich).

### Welche Auslöser gibt es?

| Auslöser | Der Workflow startet … |
|----------|------------------------|
| **E-Mail eingehend** | wenn eine neue Mail abgeholt wurde |
| **E-Mail ausgehend** | kurz bevor eine Mail versendet wird (kann den Versand anhalten) |
| **Entwurf erstellt** | wenn ein neuer Entwurf angelegt wurde |
| **Zeitplan (Cron)** | regelmäßig zu festen Zeiten (Desktop und Server), optional mit Postfach-Abgleich |
| **Manuell** | per Knopf „Jetzt ausführen“ |
| **CRM-Ereignisse** | z. B. Kunde angelegt, Deal-Phase geändert, Aufgabe fällig, Termin beginnt |
| **Webhook (eingehend)** | wenn ein externes System die Automations-Schnittstelle aufruft (für Fortgeschrittene) |

**Entwurf erstellt** und die **CRM-Ereignisse** gibt es nur in der Desktop-Edition. Die Server-Edition bietet sie nicht an und lehnt das Speichern mit einem solchen Auslöser ab; bestehende Workflows bleiben lesbar und lassen sich umstellen oder deaktivieren. Den **Zeitplan** gibt es in beiden Editionen.

### Zeitplan-Workflows

Den Zeitplan tragen Sie unter **„Erweitert (Zeitplan, Test, Backfill)“** im Feld **Cron** ein — fünf Felder: `Minute Stunde Tag Monat Wochentag`. Beispiele: `0 6 * * 1-5` (werktags 06:00), `*/30 * * * *` (jede halbe Stunde), `0 6 * * MON` (montags 06:00). Wochentag 0 und 7 sind Sonntag; Monats- und Tagesnamen (`JAN`, `MON-FRI`) sind erlaubt.

- **Mindestabstand 15 Minuten** — dichtere Ausdrücke lehnt der Editor ab.
- **Tag und Wochentag:** Sind beide eingeschränkt, müssen **beide** passen — `0 6 1 * 1` läuft nur an einem Montag, der auf den 1. fällt. Das gilt in beiden Editionen gleich (ein exportierter Workflow läuft überall zu denselben Zeiten). Achtung: Das klassische Unix-crontab lässt dort eines von beiden genügen (der 1. *oder* jeder Montag); wer Ausdrücke von dort übernimmt, prüft das am besten anhand der angezeigten nächsten Ausführung.
- **Geplantes Konto:** optional. Auf dem Desktop wird dieses Postfach vor dem Lauf abgeholt; auf dem Server holt SimpleCRM alle Postfächer ohnehin regelmäßig ab, das Konto steht dem Workflow als `email.account_id` zur Verfügung (z. B. für „E-Mail-Konto syncen“).
- **Variablen:** `{{schedule.sync_log}}` (Desktop: Ergebnis des Abgleichs; Server: Hinweis auf den automatischen Abruf), auf dem Server zusätzlich `{{schedule.slot}}` (geplanter Zeitpunkt) und `{{schedule.fired_at}}` (Zeitpunkt der Auslösung durch den Server).
- **Jetzt ausführen** startet einen Zeitplan-Workflow sofort mit denselben Variablen.

**Server-Edition:** Der Server prüft jede Minute, welche Zeitpunkte fällig sind, und startet jeden Zeitpunkt genau einmal — auch mit mehreren Server-Prozessen. Maßgeblich ist die **Zeitzone** unter **Einstellungen → Automatisierung** (Standard `Europe/Berlin`, Sommer- und Winterzeit inklusive); der Editor zeigt die **nächste Ausführung** in dieser Zeitzone an. Nur fünf Felder (kein Sekundenfeld); ein aktiver Zeitplan braucht einen Ausdruck. Verpasste Zeitpunkte (Server war aus) holt der Server nur nach, wenn sie **höchstens 15 Minuten** zurückliegen; ältere verfallen. Ein neu gespeicherter oder aktivierter Zeitplan startet erst mit dem nächsten Zeitpunkt.

**„Scharf“ schalten (Server):** Ein Zeitplan läuft auf dem Server erst, nachdem er dort einmal angelegt, aktiviert oder gespeichert wurde. Aktive Zeitplan-Workflows aus der Zeit vor dem Update und vom Desktop importierte Workflows laufen deshalb nicht von selbst los. Der Editor zeigt bei ihnen **„Zeitplan ist noch nicht scharf geschaltet – einmal speichern, um ihn zu aktivieren.“** — ein Klick auf **Speichern** genügt (mit denselben Rechten wie beim Aktivieren; der Ausdruck muss gültig sein). Ab dann zählt der nächste Zeitpunkt.

 Uhrzeiten, die es beim Umstellen auf Sommerzeit nicht gibt (z. B. 02:30), fallen an diesem Tag aus; doppelte Uhrzeiten beim Zurückstellen zählen nur einmal. Der Lauf reiht sich in die Workflow-Warteschlange des Workspaces ein und kann deshalb kurz hinter anderen Workflow-Läufen warten.

**Desktop-Edition:** Zeitplan-Workflows laufen, solange SimpleCRM geöffnet ist, in der Zeitzone des Rechners; es gibt keine Nachholung.

## Der Editor in 5 Minuten

Der Editor hat drei Bereiche:

| Bereich | Was Sie dort tun |
|---------|------------------|
| **Links: Workflow-Liste** | Workflow anlegen („Neu“), auswählen, filtern (Alle / Eingehend / Ausgehend / Sonstige) |
| **Mitte: Zeichenfläche** | Bausteine anordnen und mit Linien verbinden |
| **Rechts: Eigenschaften + Lauf-Historie** | Ausgewählten Baustein einstellen; darunter sehen, was zuletzt passiert ist |

### Die Palette (Bausteine hinzufügen)

Oben links auf der Zeichenfläche schwebt die **Palette**. Tippen Sie in das Suchfeld („Knoten suchen…“) oder blättern Sie durch die Gruppen (E-Mail, KI, CRM, Logik, …). Ein Klick fügt den Baustein auf der Zeichenfläche ein. Jeder Baustein bringt eine deutsche Beschreibung mit — Sie müssen nichts auswendig wissen.

### Die Zeichenfläche (Knoten verbinden)

Ziehen Sie eine Linie vom **Ausgang** eines Bausteins zum nächsten Baustein. Viele Bausteine haben **mehrere, farbig beschriftete Ausgänge** — zum Beispiel hat das „Auto-Antwort (Gate)“ die Ausgänge **Erlaubt** und **Blockiert**, die KI-Gegenprüfung **Senden** und **Prüfen**. So bauen Sie Verzweigungen: der grüne Weg macht das eine, der gelbe das andere.

- Bei Bausteinen mit mehreren Ausgängen wählen Sie die Beschriftung der Verbindungslinie aus einer **Liste** aus — Tippfehler, die früher ins Leere liefen, sind damit ausgeschlossen.
- Ein Baustein, dem noch Pflichtangaben fehlen, zeigt eine rote Markierung **„Unvollständig“**.

### Die Eigenschaften (Baustein einstellen)

Klicken Sie einen Baustein an — rechts erscheint sein **Formular**: deutsche Feldnamen, ein Hilfetext und ein Beispiel („z. B. …“) zu jedem Feld. Pflichtfelder sind markiert; selten benötigte Felder stehen zusammengeklappt unter **„Erweitert“**. Fachfremde Eingaben (etwa Nummern-IDs) sind durch Auswahllisten ersetzt — z. B. wählen Sie das Teammitglied oder das KI-Profil einfach aus einer Liste.

### Variablen — Werte aus früheren Schritten verwenden

Viele Felder verstehen **Platzhalter** in doppelten geschweiften Klammern, z. B. `{{subject}}` für den Betreff der auslösenden Mail. So kann eine Aufgabe „KI-Entwurf prüfen: {{subject}}“ heißen.

Sie müssen sich keine Namen merken: Neben passenden Feldern gibt es den Knopf **„Variablen“**. Er zeigt alle an dieser Stelle verfügbaren Variablen — inklusive derer, die **vorgelagerte Bausteine** in Ihrem Workflow erzeugen — jeweils mit Erklärung und Beispielwert. Ein Klick fügt die Variable ein.

### Speichern (mit eingebauter Prüfung)

Beim Klick auf **Speichern** prüft der Editor Ihren Workflow:

- **Fehlende Pflichtangaben oder ungültige Werte blockieren das Speichern.** Die Meldung nennt den betroffenen Baustein und wählt ihn direkt aus, damit Sie die Stelle sofort sehen.
- **Verdächtige Verbindungen** (z. B. eine unbeschriftete Linie an einem Baustein mit mehreren Ausgängen) erzeugen eine Warnung — gespeichert wird trotzdem.
- Vor jedem Speichern wird automatisch eine **Version** gesichert; über den Knopf **„Versionen“** können Sie zu einem früheren Stand zurückkehren.

Ein Workflow läuft nur, wenn der Schalter **„Aktiv“** eingeschaltet ist (bei neu angelegten Workflows ist er bereits an).

### Gut zu wissen

- **Konto-Auswahl:** Oben links im Editor wählen Sie, ob Sie globale Workflows (für alle Konten) oder die eines bestimmten Kontos sehen.
- **Import/Export:** Über die Knöpfe **„Import“**/**„Export“** lassen sich Workflows als Datei sichern oder auf einen anderen Rechner übertragen. Ein importierter Workflow ist zunächst **deaktiviert** (Desktop- und Server-Edition) — prüfen Sie ihn im Editor und schalten Sie ihn dann auf **„Aktiv“**.
- **Sehr lange Mails (Server):** Nach einem KI-, HTTP- oder Verzögerungs-Schritt arbeitet der Workflow mit den ersten 48 000 Zeichen des Mailtexts weiter (Platzhalter `{{body_truncated}}` ergibt dann `true`). Bedingungen, die das Ende einer sehr langen Mail prüfen sollen, gehören deshalb vor diesen Schritt.
- **Schleifen:** Im Zweig **„Je Eintrag“** einer Schleife dürfen keine Schritte stehen, die später weiterlaufen: eine Verzögerung, auf dem Server außerdem KI-, HTTP-, Weiterleitungs- und DMARC-Schritte mit Folgeknoten. Der Lauf endet sonst mit Fehler, der Editor warnt beim Speichern. Solche Schritte gehören hinter den Ausgang **„Fertig“**.
- **Neues Konto oder neuer Ordner:** Beim allerersten Abruf gelten die vorhandenen Mails als Bestand. Sie werden auf Spam geprüft, lösen aber keine eingehenden Workflows, KI-Antwortvorschläge oder Abwesenheitsantworten aus. Ab dem zweiten Abruf laufen neue Mails normal. Wer Workflows bewusst auf den Bestand anwenden will, nutzt unter **„Erweitert“** den Knopf **„Inbound-Backfill“**.
- **Referenz:** Der Knopf **„Referenz“** öffnet ein Nachschlagewerk aller Bausteine, Auslöser und Variablen mit Erklärungen.
- **JSON-Ansicht:** Das Code-Symbol oben öffnet den **Workflow-Quelltext** — Tab **„Graph (JSON)“** zeigt den Roh-Graph (nur Lesen), Tab **„Kompiliert“** die Regel-Definition.

### Prioritäten bei mehreren eingehenden Workflows

Wenn mehrere Workflows auf **„E-Mail eingehend“** reagieren, entscheidet die **Priorität** (kleinere Zahl = früher). Empfehlung:

| Bereich | Priorität |
|---------|-----------|
| Spam-Pipelines | 1–9 |
| Sortierung / Klassifizierung | 10–49 |
| KI-Agent / Auto-Antwort | 50+ |

Auf dem Server werden eingehende Workflows **nacheinander** ausgeführt; ist die Mail danach als Spam oder „Spam prüfen“ markiert, werden nachfolgende Workflows übersprungen.

Eine **Verzögerung** hält die nachrangigen Workflows nur dann auf, wenn danach noch ein Knoten die Kette stoppen kann („Weitere Workflows stoppen“ oder „Stopp nach Spam“). Dann warten sie bis zum Ende der Verzögerung, und der Editor weist beim Speichern darauf hin. Ohne einen solchen Knoten starten die nachrangigen Workflows sofort, der verzögerte Teil läuft später für sich weiter. Eine Verzögerung hinter einem KI- oder HTTP-Schritt hält die Kette weiterhin an.

### Ausgehende KI-Qualitätsprüfung — was die Ausgänge bedeuten

Der Baustein **„KI-Ausgangsprüfung“** hat drei sichtbare Ausgänge:

| Ausgang | Bedeutung |
|---------|-----------|
| **OK** | Entwurf ist versandfertig → z. B. „Versand freigeben“ (autoSend) anschließen |
| **Blockiert** | KI hat Beanstandungen — Entwurf bleibt mit gelbem Banner im Posteingang |
| **KI-Fehler** | KI-Aufruf fehlgeschlagen — sicherheitshalber ebenfalls Hold (fail-closed) |

Ohne Kante an **Blockiert** oder **KI-Fehler** stoppt der Workflow dort — der Entwurf bleibt trotzdem gehalten.

### KI-Entscheidung — Ja/Nein-Fragen an die KI

Der Baustein **„KI-Entscheidung“** beantwortet eine Ja/Nein-Frage zur Mail, z. B. „Ist diese E-Mail Spam?“ oder „Muss ein Mensch das bearbeiten?“, und verzweigt je nach Antwort.

| Feld | Bedeutung |
|------|-----------|
| **Frage (Ja/Nein)** | Pflicht. Platzhalter wie `{{subject}}` sind erlaubt. |
| **Wann „Ja“? / Wann „Nein“?** | Optional: Kriterien in eigenen Worten. |
| **Was darf die KI sehen?** | **Kompletten Text** (Standard: Betreff, Absender, Empfänger, Text bis 12 000 Zeichen, Anhangsnamen) oder **Nur Kopfdaten**. Im Ausgangs-Workflow ist die Mail der Entwurf (Betreff, Empfänger, Text). |
| **Mindest-Sicherheit** | 50–99 %, Standard 80: „Ja“ ab 80 % Ja-Wahrscheinlichkeit, „Nein“ bis 20 %, dazwischen „Unsicher“. |
| **KI-Profil** | Ein Entscheidungsmodell (Profil-Typ **„OpenRouter Entscheidungsmodell (Decisions API)“**, z. B. `typesafe/jev-1.13`) oder ein normales Chat-Modell. Chat-Modelle liefern zusätzlich eine kurze Begründung. |

| Ausgang | Bedeutung |
|---------|-----------|
| **Ja** | Ja-Wahrscheinlichkeit mindestens bei der Mindest-Sicherheit. Ohne beschriftete Kante geht es auf der unbeschrifteten Kante weiter. |
| **Nein** | Ja-Wahrscheinlichkeit höchstens bei 100 minus Mindest-Sicherheit. Im Ausgangs-Workflow wird der Versand angehalten. |
| **Unsicher** | Dazwischen. Im Ausgangs-Workflow wird der Versand angehalten. |
| **KI-Fehler** | KI-Aufruf fehlgeschlagen oder Antwort nicht auswertbar. Im Ausgangs-Workflow wird der Versand angehalten. |

Ist an **Nein**, **Unsicher** oder **KI-Fehler** nichts angeschlossen, endet der Lauf dort — es gibt keinen Rückfall auf eine unbeschriftete Kante. Im **Ausgangs-Workflow** dienen diese drei Ausgänge nur für Zusatzschritte wie Tags; der Entwurf bleibt immer angehalten. Der Hinweis „Versand blockiert“ zeigt dann die Begründung des Modells oder, bei Entscheidungsmodellen ohne Begründung, „Vom Entscheidungsmodell als nicht versandfähig blockiert – bitte E-Mail prüfen.“ mit der Ja-Wahrscheinlichkeit.

Im **Eingang** verzweigt der Baustein nur; er setzt keine Sperre und überspringt auch als Spam markierte Mails nicht. Jeder der vier Ausgänge zählt als erfüllte Bedingung: dahinter dürfen Aktionen wie „Tag setzen“ oder „Spam-Status setzen“ ohne weitere Bedingung laufen, z. B. „Unsicher → Spam prüfen“ oder „KI-Fehler → Tag manuell“.

Ergebnis-Variablen für spätere Schritte: `ai.decide.answer` (ja, nein, unsicher, error), `ai.decide.probability` (Ja-Wahrscheinlichkeit 0–100), `ai.decide.confidence` (Sicherheit der gewählten Antwort), `ai.decide.reason` (Begründung, nur Chat-Modelle), `ai.decide.summary` (ein Satz, z. B. „Entscheidungsmodell: Nein (Ja-Wahrscheinlichkeit 12 %)“) und `ai.decide.model`.

Der **Testlauf** fragt die KI nicht, Ergebnis ist immer „Unsicher“ („Testlauf: keine KI-Anfrage“). Die Prüfung beim Senden (Ausgang prüfen) fragt die KI dagegen wirklich. Auf dem Server läuft der Baustein als Hintergrund-Job; nachrangige eingehende Workflows warten darauf.

### Angehaltene Mails im Posteingang

Hält ein Ausgangs-Workflow eine Mail an (Baustein **„Versand sperren“**, KI-Ausgangsprüfung **Blockiert** oder **KI-Fehler**), liegt der Entwurf mit dem gelben Hinweis **„Versand blockiert“** und dem Grund im **Posteingang**. Das gilt auch für **automatische Antworten** aus Workflows und für Mails, die mit **„Später senden“** geplant waren: Ihre Planung wird aufgehoben, damit nichts ohne Ihre Entscheidung doch noch rausgeht. Nach dem Korrigieren senden Sie den Entwurf wie gewohnt.

- Gibt der Workflow keinen Grund an, steht dort **„Vom Workflow ohne Begründung angehalten – bitte E-Mail prüfen.“**
- Server-Edition: Während die Ausgangs-Workflows noch laufen, zeigt der Entwurf „Ausgangsprüfung wird serverseitig ausgeführt …“. Erst ein echter Block ersetzt diesen Hinweis durch den Grund.
- Soll die Mail trotzdem so raus, gibt es im Hinweis und im Entwurfsfenster den Knopf **„Ohne Ausgangsprüfung senden“** (mit Rückfrage; der Versand wird protokolliert). Wer ihn sieht, legt **Einstellungen → Automatisierung → „Ausgangsprüfung überspringen erlauben“** fest.

### Ihr erster Workflow in fünf Schritten

1. **E-Mail → Workflows** öffnen und links auf **„Neu“** klicken.
2. Auf der Zeichenfläche liegt bereits der **Auslöser**. In der **Palette** „Bedingung“ suchen und hinzufügen, dann z. B. den Baustein **„Tag setzen“**.
3. Linien ziehen: Auslöser → Bedingung → (Ausgang **ja**) → Tag setzen.
4. Bedingung anklicken und rechts einstellen (z. B. Betreff enthält „Rechnung“); beim Tag-Baustein den Tag-Namen eintragen.
5. **Speichern** und prüfen, dass der Schalter **„Aktiv“** an ist — fertig. Ab jetzt bekommt jede passende Mail automatisch den Tag.

## Vorlagen nutzen

Der schnellste Einstieg: Klicken Sie oben auf **„Vorlagen“**. Jede Vorlage zeigt

- eine **Beschreibung**, was sie tut,
- die **Kette der Bausteine** als Vorschau,
- eine **Checkliste der Voraussetzungen** mit Live-Ampel: grüner Haken = eingerichtet, rotes Kreuz = fehlt noch, graues Dreieck = konnte nicht geprüft werden. Geprüft werden z. B. „KI-Profil mit API-Schlüssel“ (ein Chat-Modell mit hinterlegtem Schlüssel), „KI-Profil vom Typ Entscheidungsmodell (oder Chat-Modell)“, „Mindestens ein Textbaustein“, „Auto-Antwort-Schalter aktiviert“, „Wissensbasis vorhanden“, „Learnings sammeln aktiviert“ und „Auslöser Zeitplan verfügbar“ — jeweils mit dem Ort in den Einstellungen, wo Sie es nachholen.

**„Vorlage laden“** ersetzt den aktuellen Inhalt der Zeichenfläche — falls dort schon etwas gebaut ist, fragt SimpleCRM vorher nach. Bringt eine Vorlage eine empfohlene **Priorität** oder einen **Zeitplan** mit, trägt „Vorlage laden“ beides gleich mit ein (die Vorlage zeigt es unter „Beim Laden eingetragen“). Enthält sie den Baustein **„KI-Entscheidung“** ohne gewähltes KI-Profil, trägt „Vorlage laden“ dort das erste Profil vom Typ Entscheidungsmodell (mit API-Schlüssel) ein; gibt es keins, bleibt das Feld leer und der Baustein nutzt das Standard-Profil — die Checkliste sagt, was passiert. Gespeicherte Workflows ändert das nie. Danach können Sie alles anpassen und müssen nur noch **speichern** (und sicherstellen, dass der Workflow auf **Aktiv** steht).

Eine kleine Auswahl der mitgelieferten Vorlagen:

| Vorlage | Zweck |
|---------|-------|
| **Eingehend: Rechnung sortieren** | Rechnungen taggen, einsortieren, Kunden verknüpfen |
| **Ausgehend: KI-Qualitätsprüfung** | Jede ausgehende Mail vor dem Versand von der KI gegenlesen lassen — mit sichtbaren Ausgängen **OK** (freigeben), **Blockiert** (Hold) und **KI-Fehler** |
| **Eingehend: KI-Spam-Pipeline (DSGVO)** | Absender-Filter → KI-Spam-Score (nur Metadaten) → Schwellwert → Spam markieren → Stopp. **Priorität 1–9** empfohlen |
| **Eingehend: KI antwortet mit Textbaustein (mit Gate)** | KI wählt einen Ihrer Textbausteine und antwortet damit |
| **Eingehend: KI-Antwort mit Gegenprüfung (empfohlen)** | Frei formulierte KI-Antwort mit zweiter Prüf-KI — siehe unten |
| **E-Commerce: …** (8 Vorlagen) | Typische Shop-Anliegen erkennen und einsortieren (Wo ist meine Bestellung, Retoure, Reklamation, …) |
| **Eingehend: Spam-Entscheidung (Entscheidungsmodell)** | Teilautomatisierung: KI-Entscheidung „Spam?“ — Ja → Spam-Ordner und Stopp, Unsicher → „Spam prüfen“ und Stopp, KI-Fehler → Tag `ki-fehler`. **Priorität 5** |
| **Eingehend: Mensch oder KI? → KI-Antwort mit Gegenprüfung** | Teilautomatisierung: Nur einfache Standardfragen beantwortet die KI (Entwurf, Gegenprüfung, Versand durch die Ausgangs-Workflows), alles andere bekommt das Tag `manuell`. **Priorität 50** |
| **Ausgehend: KI-Entscheidung vor dem Versand** | Teilautomatisierung: Jede ausgehende Mail wird auf Versandfähigkeit geprüft; sonst angehalten mit Tag `ausgang-blockiert`. **Priorität 50** |
| **Learnings wöchentlich auswerten** | Teilautomatisierung: Zeitplan montags 06:00, legt einen Learnings-Vorschlag für die Wissensbasis an |

Wie die vier Vorlagen der Teilautomatisierung zusammenspielen, beschreibt der Abschnitt [Teilautomatisierung Schritt für Schritt](#teilautomatisierung-schritt-für-schritt).

## Schritt für Schritt: Automatische KI-Antwort mit Gegenprüfung

Die empfohlene Vorlage **„Eingehend: KI-Antwort mit Gegenprüfung (empfohlen)“** beantwortet einfache Kundenmails automatisch — mit doppeltem Netz:

1. **KI 1 entwirft** eine Antwort (mit Ihrer Wissensbasis, automatischer Anrede und Ihrer Konto-Signatur).
2. **KI 2 liest gegen**: Ist die Kundenfrage wirklich beantwortet? Stimmt der Ton? Wurde nichts erfunden?
3. Nur wenn die Gegenprüfung **„senden“** sagt, geht die Antwort raus. In allen anderen Fällen — auch bei jedem Zweifel oder technischen Fehler — **wartet der Entwurf auf Ihre Freigabe**. Der Mensch behält das letzte Wort.

### Voraussetzungen einrichten

1. **KI-Profil mit API-Schlüssel:** Unter **E-Mail → Einstellungen → KI** ein Profil anlegen (Anbieter und Modell wählen, API-Schlüssel eintragen). Ohne Profil kann keine KI arbeiten.
2. **Auto-Antwort-Schalter einschalten:** Unter **E-Mail → Einstellungen → Automatisierung** den Schalter **„Automatische KI-Antworten erlauben“** aktivieren. Er ist ab Werk **aus** — solange er aus ist, erstellen Workflows höchstens Entwürfe, versendet wird nie etwas automatisch.
3. **Tageslimit prüfen:** Direkt darunter steht **„Max. automatische Antworten pro Absender und Tag“** (Standard: 1). Mehr dazu unten.
4. **Optional — Wissensbasis:** Unter **Einstellungen → Wissensbasis** FAQ-Texte, Versandinfos usw. hinterlegen. Die Entwurfs-KI nutzt sie, um korrekt zu antworten.
5. **Optional — Textbausteine:** Unter **Einstellungen → Textbausteine** bewährte Formulierungen pflegen; die KI bekommt sie als Formulierungshilfe.

### Vorlage aktivieren

1. **E-Mail → Workflows** öffnen, mit **„Neu“** einen Workflow anlegen (oder einen bestehenden auswählen).
2. **„Vorlagen“** → „Eingehend: KI-Antwort mit Gegenprüfung (empfohlen)“ — die Checkliste sollte grün sein — **„Vorlage laden“**.
3. Bei Bedarf anpassen (z. B. den Auftrag an die KI im Baustein „KI-Antwort entwerfen“, oder die Mindest-Sicherheit im Gate).
4. **Speichern** und sicherstellen, dass der Workflow auf **Aktiv** steht.

### Was dann bei jeder eingehenden Mail passiert

| Weg | Wann | Ergebnis |
|-----|------|----------|
| **Senden** | Gate erlaubt + Gegenprüfung sagt „senden“ | Antwort geht automatisch raus — vorher durch die aktiven **Ausgangs-Workflows**; hält einer sie an, liegt der Entwurf mit Grund im Posteingang |
| **Wartet auf Freigabe** | Gegenprüfung hat Zweifel (oder ein KI-Fehler trat auf) | Entwurf bleibt liegen, Sie entscheiden |
| **Blockiert** | Das Gate stoppt (Schalter aus, unsicherer Absender, Tageslimit, KI zu unsicher) | Nichts wird gesendet; war die KI sich zu unsicher, bekommt die Mail das Tag `ki-manuell` zur manuellen Bearbeitung |

Die KI-Antwort-Vorlagen haben am Baustein „Entwurf versenden“ die Option **„Zusätzlich durch Ausgangs-Workflows prüfen“** eingeschaltet. Legen Sie dazu einen Ausgangs-Workflow an (z. B. Vorlage **„Ausgehend: KI-Qualitätsprüfung“**); ohne aktiven Ausgangs-Workflow geht die Antwort nach der Gegenprüfung direkt raus.

### „Wartet auf Freigabe“ — was tun?

Hält die Gegenprüfung einen Entwurf an, sehen Sie:

- Den **Entwurf** im Ordner **Entwürfe** mit dem Hinweis-Banner **„Wartet auf Freigabe“** samt der **Begründung der Prüf-KI** (z. B. „Preiszusage sollte ein Mensch prüfen“). In der Nachrichtenliste trägt er das Kürzel **„Freigabe“**.
- Die **Kundenmail** bekommt das Tag `ki-freigabe`, und es wird eine **Aufgabe** „KI-Entwurf prüfen: …“ angelegt, damit nichts untergeht.

Im Banner haben Sie zwei Knöpfe:

- **„Jetzt senden“** — der Entwurf wird sofort versendet.
- **„Als Entwurf behalten“** — der Hinweis verschwindet, der Entwurf bleibt ein normaler Entwurf.

Sie können den Entwurf auch einfach öffnen und **bearbeiten** — sobald Sie den Inhalt ändern oder selbst versenden, ist der Freigabe-Zustand erledigt.

### Nachher: Was hat die Automatik verschickt?

Gesendete Mails tragen ein Kennzeichen, wer sie verschickt hat (Details in der E-Mail-Anleitung, Abschnitt „Wer hat gesendet?“):

- **KI** — der Workflow hat die KI-Antwort selbst versendet (Weg **Senden**). Die Leseansicht nennt den Workflow: „Automatisch von KI gesendet (Workflow „…“)“.
- **KI · freigegeben** — Sie (oder ein Kollege) haben den KI-Entwurf **unverändert** gesendet, z. B. mit **„Jetzt senden“**. Haben Sie den Text vorher geändert, gilt die Mail als von Ihnen geschrieben und trägt kein Kennzeichen. Öffnen und Speichern im Entwurfsfenster, eine vom Fenster eingesetzte Signatur oder ein Zitat zählen nicht als Änderung.
- **Automatik** — ein Workflow ohne KI hat verschickt (z. B. **„Entwurf erstellen“** + **„Entwurf senden“**).

Die Ansicht **Gesendet (KI)** direkt unter **Gesendet** sammelt genau diese Mails. Wurde beim Versand **„Ohne Ausgangsprüfung senden“** verwendet, steht zusätzlich **„ohne Prüfung“** dabei.

### Tageslimit und Schutz vor Antwort-Schleifen

Damit sich nie zwei Automaten endlos gegenseitig antworten, sind mehrere Sicherungen fest eingebaut:

- **Tageslimit pro Absender:** Erhält dieselbe Absenderadresse an einem Tag bereits die eingestellte Zahl automatischer Antworten (Standard: 1), wird keine weitere verschickt.
- **Automaten werden nie beantwortet:** Mails, die sich selbst als automatisch erzeugt ausweisen (Abwesenheitsnotizen, Systemmeldungen, Zustellfehler) sowie **Newsletter/Verteiler** werden vom Gate blockiert.
- **No-Reply-Adressen** (no-reply@…, mailer-daemon@… usw.) werden nie automatisch beantwortet.
- **Eigene automatische Antworten werden gekennzeichnet:** SimpleCRM markiert ausgehende Auto-Antworten nach dem üblichen Internet-Standard als „automatisch versendet“, damit fremde Systeme ihrerseits nicht darauf antworten.

Diese Schutzmechanismen sind immer aktiv — Sie müssen dafür nichts einrichten.

## Learnings: Die Wissensbasis aus dem Alltag verbessern

Learnings stehen hier und nicht in der Postfach-Anleitung, weil sie die **Wissensbasis der KI-Bausteine** pflegen und über den Workflow-Baustein **„Learnings auswerten“** laufen.

### Sammeln

Unter **Einstellungen → Learnings** schalten Sie **„Learnings sammeln“** ein (ab Werk aus). Danach merkt sich SimpleCRM beim Versand:

- **Geänderte KI-Entwürfe:** Ein Mensch hat einen KI-Entwurf vor dem Senden deutlich geändert — gespeichert werden die KI-Fassung, die gesendete Fassung und die Kundenfrage.
- **Antworten Ihres Teams:** Eine von einem Menschen geschriebene Antwort auf eine eingehende Mail (automatisch versendete Antworten zählen nicht).
- Maßgeblich ist die Kennzeichnung **„Gesendet von“** (siehe „Nachher: Was hat die Automatik verschickt?“): Es zählen nur Mails, die ein Mensch gesendet hat. **KI · freigegeben** (unverändert gesendeter KI-Entwurf), **KI**, **Automatik** und **Relay** ergeben keine Learnings.
- **Notizen:** In der Leseansicht einer Mail gibt es den Knopf **„Learning notieren“**. Die Notiz wird immer gespeichert, auch wenn das automatische Sammeln aus ist. Optional mit Bezug auf die geöffnete Mail.

### Datenschutz

- Schon beim Sammeln entfernt SimpleCRM Zitat, Signatur, Anrede und Grußformel und ersetzt personenbezogene Daten durch Platzhalter: Namen (Absender, Empfänger, CRM-Kunde, Ihr Team) → `[Name]`, E-Mail-Adressen → `[E-Mail]`, Telefonnummern → `[Telefon]`, IBAN/BIC → `[IBAN]`/`[BIC]`, Links → `[Link]`, Straßen und PLZ/Ort → `[Adresse]`, Bestell-, Kunden-, Rechnungs- und Ticketnummern → `[Nummer]`. Datumsangaben, Preise und Mengen bleiben stehen.
- Gespeichert wird nur der bereinigte Text. Die KI bekommt die Anweisung, nur allgemeine Regeln ohne Personenbezug zu formulieren; ihre Ausgabe läuft noch einmal durch denselben Filter (Kontaktdaten, die schon in der Wissensbasis stehen, z. B. Ihre Hotline, bleiben erhalten).
- Die gesammelten Einträge werden gelöscht, sobald über den Vorschlag entschieden ist, spätestens nach **90 Tagen** — auch wenn der Vorschlag dann noch offen ist (er bleibt vollständig und kann weiter übernommen oder verworfen werden). Einzelne Einträge können Sie in der Übersicht selbst löschen.

### Auswerten

- **Per Knopf:** „Learnings jetzt auswerten“ mit Zeitraum (seit der letzten Auswertung, letzter Tag, Woche, Monat). Auf dem Server läuft die Auswertung im Hintergrund, die Übersicht zeigt „Auswertung läuft …“.
- **Per Workflow:** Baustein **„Learnings auswerten“** in einem Workflow mit Zeitplan oder manuellem Start. Felder: Ziel-Wissensbasis, Zeitraum, Mindestanzahl gesammelter Einträge (Standard 3), KI-Profil. Ergebnis steht in `learnings.status` (`queued` auf dem Server, `created`, `skipped_no_candidates`, `skipped_pending`, `failed`), `learnings.digest_id` und `learnings.candidate_count`. In eingehenden oder ausgehenden Workflows wird der Baustein übersprungen.
- Pro Wissensbasis gibt es höchstens **einen offenen Vorschlag**; solange er offen ist, entsteht kein zweiter.
- **Ziel:** leer = eigene Wissensbasis **„Learnings“** (wird beim ersten Vorschlag angelegt) oder eine vorhandene Wissensbasis, die korrigiert werden soll. Die eigene Wissensbasis bekommt den Kontext **„Learnings“**: KI-Entwurf, KI-Agent (ohne fest gewählte Wissensbasis) und der KI-Antwortvorschlag in der Leseansicht lesen sie in jeder Richtung **zusätzlich** zu den Wissensbasen „Allgemein“, „Eingehend“ bzw. „Ausgehend“ — auch wenn es schon eine andere allgemeine Wissensbasis gibt. Die Menge je Abruf bleibt gleich und wird gleichmäßig auf die beteiligten Wissensbasen verteilt. Ist in einem Baustein eine Wissensbasis fest gewählt, bleibt es bei dieser Auswahl. Wählen Sie eine vorhandene Wissensbasis als Ziel, behält sie ihren Kontext.
- Als KI-Profil eignet sich ein Chat-Modell; Entscheidungsmodelle liefern keine Texte.

### Vorschlag prüfen und übernehmen

Der offene Vorschlag zeigt die Zusammenfassung der KI und die **komplette neue Wissensbasis als Änderungsansicht**: Entferntes ist rot durchgestrichen, Neues grün hinterlegt. Mit **„Bearbeiten“** ändern oder ergänzen Sie den Vorschlag im Markdown-Editor; die Änderungsansicht vergleicht dabei immer mit dem aktuellen Stand der Wissensbasis.

- **Übernehmen** schreibt die neue Fassung in einem Schritt in die Wissensbasis. Wurde die Wissensbasis seit dem Vorschlag geändert, warnt SimpleCRM und fragt nach, bevor diese Änderungen überschrieben werden.
- **Verwerfen** lässt die Wissensbasis unverändert.
- Der **Verlauf** zeigt die letzten Vorschläge mit Status, Zeitpunkt und wer entschieden hat.

### Rechte

- Einstellungen, Einträge und Vorschläge sehen, auswerten, übernehmen und verwerfen: nur **Owner und Admins**, auch auf dem Server — das Recht „Workflows verwalten“ allein genügt nicht, weil die Einträge Inhalte aus allen Postfächern enthalten. Der Reiter **Learnings** erscheint nur für Owner und Admins. Der Baustein „Learnings auswerten“ in einem Workflow läuft mit den üblichen Workflow-Rechten.
- „Learning notieren“: jeder, der die Mail lesen darf; ohne Mail-Bezug jeder angemeldete Nutzer.
- Server: Anlegen, Übernehmen und Verwerfen stehen im Audit-Log (`ai_learning_note.created`, `ai_learning_candidate.deleted`, `ai_learning_digest.created|accepted|rejected`).

## Teilautomatisierung Schritt für Schritt

Ziel: Einfache Anfragen beantwortet die KI selbst, alles andere bleibt wie bisher beim Menschen. Jede automatische Antwort läuft vor dem Versand durch den Ausgangs-Workflow, und aus dem Alltag entstehen Learnings, die nach Ihrer Freigabe in die Wissensbasis wandern. Alles besteht aus normalen Bausteinen und vier Vorlagen, die Sie im Editor anpassen können. Hintergrund und Entscheidungen: [`MAIL_TEILAUTOMATISIERUNG.md`](MAIL_TEILAUTOMATISIERUNG.md).

So sieht die fertige Einrichtung aus:

| Priorität | Workflow | Aufgabe |
|-----------|----------|---------|
| 1–9 | Ihre statischen Regeln (Schritt 4) | Absender-Filter, Bedingungen, Verschieben, Weiterleiten, Tags |
| 5 | Vorlage **„Eingehend: Spam-Entscheidung (Entscheidungsmodell)“** | Spam aussortieren; die Kette stoppt |
| 50 | Vorlage **„Eingehend: Mensch oder KI? → KI-Antwort mit Gegenprüfung“** | Standardfragen beantworten, alles andere an den Menschen |
| Ausgang 10 | Ihre statischen Ausgangsregeln (optional) | z. B. „Ausgehend: Sensible Daten“ |
| Ausgang 50 | Vorlage **„Ausgehend: KI-Entscheidung vor dem Versand“** | Jede ausgehende Mail auf Versandfähigkeit prüfen |
| Zeitplan | Vorlage **„Learnings wöchentlich auswerten“** | Vorschlag für die Wissensbasis |

Jeder Workflow ist ein eigener Eintrag in der Workflow-Liste: je Zeile **„Neu“** klicken, **„Vorlagen“** öffnen, die Vorlage laden, anpassen, **speichern** und auf **Aktiv** achten.

### 1. KI-Profile anlegen

Unter **E-Mail → Einstellungen → KI**:

1. **Zuerst ein Chat-Modell** anlegen (Anbieter-Vorlage z. B. OpenAI oder Open Router, Chat-Modell, API-Key, **Speichern**). Das erste Profil wird zum **Standard-Profil**. Entwurf, Gegenprüfung und die Learnings-Auswertung nutzen es, solange im Baustein kein anderes Profil gewählt ist — das Standard-Profil sollte deshalb ein Chat-Modell bleiben, denn Entscheidungsmodelle schreiben keine Texte.
2. **Dann das Entscheidungsmodell**: neues Profil, Anbieter-Vorlage **„OpenRouter Entscheidungsmodell (Decisions API)“**. Sie füllt Base-URL (`https://openrouter.ai/api`) und Modell (`typesafe/jev-1.13`) vor; Ihren OpenRouter-API-Key eintragen und speichern.
3. Bei beiden Profilen **„Verbindung testen“** klicken. Das Entscheidungsmodell meldet „Verbindung erfolgreich (Ja-Wahrscheinlichkeit … %)“, das Chat-Modell seine Antwort.

Ohne Entscheidungsmodell funktionieren die Vorlagen auch: Die KI-Entscheidung fragt dann das Chat-Modell und liefert zusätzlich eine kurze Begründung.

### 2. Auto-Antwort-Schalter und Tageslimit

Unter **E-Mail → Einstellungen → Automatisierung** den Schalter **„Automatische KI-Antworten erlauben“** einschalten und **„Max. automatische Antworten pro Absender und Tag“** prüfen (Standard: 1). Solange der Schalter aus ist, versendet die Vorlage aus Schritt 6 nichts automatisch; die Mails, die die KI beantworten würde, bekommen stattdessen das Tag `ki-manuell`. So lässt sich die Einrichtung gefahrlos im Probebetrieb beobachten.

### 3. Wissensbasis und Learnings einschalten

- **Einstellungen → Wissensbasis:** Öffnungszeiten, Versand und Versandkosten, Lieferzeiten, Produktinformationen, häufige Fragen — je Thema ein `##`-Abschnitt. Die KI-Antwort liest die passenden Auszüge automatisch mit; was dort nicht steht, soll sie nicht beantworten.
- **Einstellungen → Learnings:** **„Learnings sammeln“** einschalten. Ziel-Wissensbasis leer lassen (dann entsteht die eigene Wissensbasis „Learnings“, die alle KI-Bausteine automatisch mitlesen) und als KI-Profil ein Chat-Modell wählen. Einzelheiten: [Learnings](#learnings-die-wissensbasis-aus-dem-alltag-verbessern).

### 4. Statische Regeln zuerst (Priorität 1–9)

Was sich ohne KI entscheiden lässt, gehört vor die KI — das ist schneller, kostet nichts und ist nachvollziehbar. Nutzen Sie dafür die vorhandenen Bausteine **Absender-Filter**, **Bedingung**, **Verschieben**, **Weiterleiten** und **Tag setzen** oder Vorlagen wie „Eingehend: Lokale Spam-Engine“, „Eingehend: Newsletter archivieren“ und „Eingehend: Rechnung weiterleiten“. Regeln, die Spam ohne KI erkennen (etwa eine Sperrliste), bekommen am besten Priorität 1–4 — schalten sie **„Weitere Inbound-Workflows stoppen“** ein oder enden mit **„Stopp nach Spam“**, spart die Spam-Entscheidung (Priorität 5) den KI-Aufruf. Die Vorlage aus Schritt 6 überspringt als Spam markierte Mails ohnehin.

### 5. Vorlage „Eingehend: Spam-Entscheidung (Entscheidungsmodell)“ (Priorität 5)

1. **Neu** → **Vorlagen** → „Eingehend: Spam-Entscheidung (Entscheidungsmodell)“ → **Vorlage laden**. Die Priorität 5 wird eingetragen.
2. „Vorlage laden“ hat im Baustein **„KI-Entscheidung“** bereits Ihr Entscheidungsmodell eingetragen (ohne Entscheidungsmodell bleibt das Feld leer = Standard-Profil); unter **KI-Profil** lässt es sich ändern. Frage und Kriterien („Wann Ja?“ / „Wann Nein?“) können Sie an Ihr Geschäft anpassen, die Mindest-Sicherheit steht auf 80 %.
3. **Speichern**, **Aktiv** prüfen.

| Antwort | Ergebnis |
|---------|----------|
| **Ja** | Als Spam markiert (Tag `ki-spam`), auf dem Mail-Server in den Ordner „Spam“ verschoben; nachfolgende Workflows laufen nicht |
| **Unsicher** | Spam-Status **„Spam prüfen“** (Tag `spam-pruefen`); nachfolgende Workflows laufen nicht, ein Mensch entscheidet |
| **Nein** | Nichts passiert; die nächsten Workflows (z. B. Schritt 6) laufen weiter |
| **KI-Fehler** | Tag `ki-fehler`; die Mail bleibt normal im Posteingang, die nächsten Workflows laufen weiter |

**Verschieben auf dem Mail-Server:** Das klappt nur bei IMAP-Konten mit einem Ordner namens „Spam“. Scheitert es (POP3-Konto, anders benannter Spam-Ordner, Server nicht erreichbar), bleibt die Mail in beiden Editionen trotzdem als Spam markiert und die Kette stoppt wie gewohnt; auf dem Desktop nennt die Lauf-Historie den Grund. Wer das Verschieben nicht braucht, schaltet im Baustein **„Als Spam markieren“** den Schalter **„Auf dem Mail-Server in den Spam-Ordner verschieben“** aus — die Mail landet trotzdem im Spam-Ordner von SimpleCRM.

### 6. Vorlage „Eingehend: Mensch oder KI? → KI-Antwort mit Gegenprüfung“ (Priorität 50)

1. **Neu** → **Vorlagen** → „Eingehend: Mensch oder KI? → KI-Antwort mit Gegenprüfung“ → **Vorlage laden** (Priorität 50). Die Checkliste sollte grün sein: Chat-Modell, Entscheidungsmodell (oder Chat-Modell), Auto-Antwort-Schalter, Wissensbasis.
2. Im Baustein **„KI-Entscheidung“** ist das Entscheidungsmodell bereits eingetragen (wie in Schritt 5). Entwurf und Gegenprüfung nutzen das Standard-Profil (Chat-Modell); die Einstellungen stammen aus der Vorlage „KI-Antwort mit Gegenprüfung (empfohlen)“.
3. Die Kriterien der Frage **„Muss ein Mensch diese Anfrage bearbeiten?“** an Ihr Geschäft anpassen. Ab Werk heißt es **Ja** bei Beschwerden mit Ärger, rechtlichen Themen, Preisverhandlungen und individuellen Angeboten, Kündigungen, Zahlungsproblemen, sensiblen Daten, mehreren Anliegen, unklaren Anfragen und allem, was die Wissensbasis nicht abdeckt; **Nein** bei einfachen Standardfragen wie Öffnungszeiten, Versand, Lieferzeiten, Produktinformationen oder dem Stand einer Bestellung.
4. **Speichern**, **Aktiv** prüfen.

| Weg | Ergebnis |
|-----|----------|
| **Ja**, **Unsicher** oder **KI-Fehler** | Tag `manuell`; die Mail bleibt im Posteingang |
| **Nein**, Gate blockiert | Tag `ki-manuell` — Schalter aus, Tageslimit erreicht, Absender ist ein Automat oder eine No-Reply-Adresse, oder die Sicherheit liegt unter 80 % |
| **Nein**, Gegenprüfung **„Prüfen“** | Entwurf wartet auf Freigabe, Tag `ki-freigabe`, Aufgabe „KI-Entwurf prüfen: …“ |
| **Nein**, Gegenprüfung **„Senden“** | Die Antwort wird zum Versand eingeplant und läuft vorher durch die Ausgangs-Workflows (Schritt 7) |

Als Spam oder „Spam prüfen“ markierte Mails beantwortet die Vorlage nie (Baustein „Stopp nach Spam“ am Anfang). Die KI-Entscheidung sieht nur die Mail, nicht die Wissensbasis: Ob die Wissensbasis die Antwort wirklich hergibt, prüft danach die Gegenprüfung („Wurde nichts erfunden?“) — im Zweifel wartet der Entwurf auf Sie.

### 7. Vorlage „Ausgehend: KI-Entscheidung vor dem Versand“ (Priorität 50)

1. **Neu** → **Vorlagen** → „Ausgehend: KI-Entscheidung vor dem Versand“ → **Vorlage laden** (Priorität 50).
2. Im Baustein **„KI-Entscheidung“** ist das Entscheidungsmodell bereits eingetragen (wie in Schritt 5); die Kriterien der Frage **„Ist diese E-Mail in dieser Form an den Kunden versandfähig?“** bei Bedarf anpassen (ab Werk: höflich, korrekte Anrede, beantwortet die Frage, keine internen Informationen, keine unbelegten Zusagen zu Preisen, Terminen oder Erstattungen, keine sensiblen Daten Dritter, angekündigte Anhänge vorhanden).
3. **Speichern**, **Aktiv** prüfen.

| Antwort | Ergebnis |
|---------|----------|
| **Ja** | Versand freigegeben |
| **Nein**, **Unsicher**, **KI-Fehler** | Versand angehalten, der Entwurf kommt mit dem Hinweis **„Versand blockiert“** in den Posteingang zurück, zusätzlich Tag `ausgang-blockiert` |

Die Vorlage prüft **jede** ausgehende Mail, auch die Ihres Teams. Statische Ausgangsregeln (z. B. „Ausgehend: Sensible Daten“) bekommen Priorität 10.

- **Desktop:** Ausgangs-Workflows laufen nacheinander nach Priorität; hält eine Regel an, läuft die KI-Entscheidung nicht mehr.
- **Server:** Ausgangs-Workflows laufen **parallel**. Die Priorität legt nur die Anzeige-Reihenfolge fest; versendet wird erst, wenn alle zugestimmt haben. Die KI-Entscheidung läuft also auch dann, wenn eine statische Regel schon blockiert.

### 8. Vorlage „Learnings wöchentlich auswerten“ — und einmal speichern

1. **Neu** → **Vorlagen** → „Learnings wöchentlich auswerten“ → **Vorlage laden**. Der Zeitplan `0 6 * * 1` (montags 06:00) wird unter **„Erweitert (Zeitplan, Test, Backfill)“** eingetragen; der Baustein wertet die letzte Woche ab 3 gesammelten Einträgen aus.
2. Täglich oder monatlich? Cron-Ausdruck ändern, z. B. `0 6 * * *` (täglich 06:00) oder `0 6 1 * *` (am 1. des Monats), und im Baustein den Zeitraum passend auf „Letzter Tag“ bzw. „Letzter Monat“ stellen.
3. **Speichern** und **Aktiv** prüfen. **Server:** Erst mit diesem Speichern ist der Zeitplan scharf geschaltet (siehe [Zeitplan-Workflows](#zeitplan-workflows)). **Desktop:** Der Zeitplan läuft, solange SimpleCRM geöffnet ist.

Das Ergebnis ist ein Vorschlag unter **Einstellungen → Learnings**; die Wissensbasis ändert sich erst, wenn Sie ihn übernehmen.

### 9. Was im Alltag passiert

- **Posteingang:** Mails mit Tag `manuell` bearbeitet ein Mensch wie bisher; `ki-manuell` heißt „die KI hätte geantwortet, durfte aber nicht“ (z. B. Tageslimit). `ki-fehler` markiert Mails, bei denen die Spam-Entscheidung fehlschlug; sie laufen normal weiter.
- **„Wartet auf Freigabe“:** Hat die Gegenprüfung Zweifel, wartet der Entwurf mit Begründung im Posteingang (Tag `ki-freigabe` an der Kundenmail, Aufgabe „KI-Entwurf prüfen: …“) — siehe [„Wartet auf Freigabe“ — was tun?](#wartet-auf-freigabe--was-tun).
- **„Versand blockiert“:** Hat der Ausgangs-Workflow angehalten, zeigt der Hinweis den Grund. Mit **„Ohne Ausgangsprüfung senden“** geht die Mail nach Rückfrage ohne erneute Prüfung raus; das wird protokolliert und an der Mail gekennzeichnet. Einzelheiten zu diesem Knopf, zu **„Gesendet (KI)“** und zu den Kennzeichen „gesendet von“ stehen in der Postfach-Anleitung [`USER_GUIDE_EMAIL.md`](USER_GUIDE_EMAIL.md) (Konzept: [`MAIL_TEILAUTOMATISIERUNG.md`](MAIL_TEILAUTOMATISIERUNG.md), Abschnitte 3.2 und 3.3).
- **Learnings-Vorschlag prüfen:** Nach der Auswertung liegt unter **Einstellungen → Learnings** ein Vorschlag mit Änderungsansicht; prüfen, bei Bedarf bearbeiten, dann **Übernehmen** oder **Verwerfen** (siehe [Vorschlag prüfen und übernehmen](#vorschlag-prüfen-und-übernehmen)).
- **Lauf-Historie:** Jeder Schritt zeigt, über welchen Ausgang es weiterging; die KI-Entscheidung nennt die Ja-Wahrscheinlichkeit (z. B. „Entscheidungsmodell: Nein (Ja-Wahrscheinlichkeit 12 %)“).

### Grenzen

- **Server:** Ausgangs-Workflows laufen parallel (siehe Schritt 7) — die Ausgangs-KI-Entscheidung läuft auch dann, wenn eine statische Regel schon blockiert, und kostet je ausgehender Mail einen KI-Aufruf.
- Die KI-Entscheidung kennt die Wissensbasis nicht; das Kriterium „ohne passende Information in der Wissensbasis“ schätzt sie nur aus der Art der Frage. Die Gegenprüfung fängt Entwürfe ohne belastbare Grundlage ab.
- Entscheidungsmodelle liefern keine Begründung; Hinweise und Lauf-Historie nennen dann die Ja-Wahrscheinlichkeit.
- Das Verschieben in den Spam-Ordner auf dem Mail-Server funktioniert nur bei IMAP-Konten mit einem Ordner „Spam“; sonst bleibt es bei der Spam-Markierung in SimpleCRM (siehe Schritt 5).
- Der Desktop erfasst keine KI-Kosten.

## Die Lauf-Historie lesen

Rechts unten im Editor sehen Sie zum ausgewählten Workflow die **Lauf-Historie**:

- **Linke Spalte:** die letzten Läufe („Lauf #123“) mit Status und Zeitpunkt.
- **Rechte Spalte:** nach Klick auf einen Lauf die einzelnen **Schritte** — welcher Baustein lief, mit welchem Ergebnis, über welchen **Ausgang** es weiterging und wie lange es dauerte.

Beispiele: Ein Gate-Schritt mit Ergebnis „Blockiert“ nennt den Grund — etwa dass die KI sich nicht sicher genug war (Kürzel `low_confidence`, siehe Tabelle unten). Bei der Gegenprüfung zeigt der Ausgang **Senden** bzw. **Prüfen**, wie die Prüf-KI entschieden hat.

**Gefahrlos testen:** Unter **„Erweitert (Zeitplan, Test, Backfill)“** können Sie eine Nachrichten-Nummer eintragen und **Test** klicken — der Workflow wird nur simuliert (es wird nichts gesendet, getaggt oder verschoben), und Sie sehen das Ergebnis Schritt für Schritt. Ausnahme in der Server-Edition: **MSSQL (Read-only)** (`mssql.query`) und **JTL Bestell-Kontext** lesen auch im Test live aus der JTL-Datenbank. Verwenden Sie für die MSSQL-Verbindung deshalb einen Benutzer, der nur lesen darf (`db_datareader`, siehe [SETUP_SERVER.md](SETUP_SERVER.md#jtl-wawi--mssql-connection-optional)).

## Häufige Fragen

**Warum wurde auf eine Mail nicht automatisch geantwortet?**
Schauen Sie in die Lauf-Historie: Der Gate-Schritt nennt den Grund (`auto_reply:blocked:…`):

| Grund im Protokoll | Bedeutung | Abhilfe |
|--------------------|-----------|---------|
| `disabled` | Auto-Antwort-Schalter ist aus | Einstellungen → Automatisierung einschalten |
| `noreply_sender` | Absender ist eine No-Reply-/Systemadresse | Gewollt — solche Adressen liest niemand |
| `automated_sender` | Mail war selbst automatisch erzeugt oder ein Newsletter | Gewollt — Schutz vor Antwort-Schleifen |
| `rate_limited` | Tageslimit für diesen Absender erreicht | Gewollt; bei Bedarf Limit in den Einstellungen erhöhen |
| `low_confidence` | Die KI war sich bei der Einordnung nicht sicher genug | Mindest-Sicherheit im Gate senken — oder die Mail bewusst manuell beantworten |

**Ein Workflow zu „Aufgabe fällig“ ist fehlgeschlagen. Wird er wiederholt?**
Nein, und das ist Absicht (Desktop-Edition). Die Auslöser **Aufgabe fällig**, **Termin beginnt** und **Kunde angelegt** starten einen Workflow je Aufgabe mit ihrem Fälligkeitsdatum, je Termin bzw. je Kunde genau einmal, auch wenn der Lauf mit einem Fehler endet oder blockiert wird. Die Schritte vor dem Fehler haben dann schon gewirkt (eine angelegte Aufgabe, ein Webhook-Aufruf, ein KI-Aufruf); ein Neustart bei jedem Prüfdurchlauf (alle zwei Minuten) würde sie vervielfachen. Den Fehler finden Sie in der **Lauf-Historie** des Workflows. Nach der Korrektur lösen Sie ihn für eine Aufgabe erneut aus, indem Sie deren Fälligkeitsdatum ändern: Jede Kombination aus Aufgabe und Fälligkeitsdatum löst einmal aus. Nur wenn gar kein Lauf zustande kam (etwa weil der Start mit einer Ausnahme abbrach), versucht es der nächste Durchlauf erneut.

**Warum wartet ein Entwurf auf Freigabe, obwohl er gut aussieht?**
Die Gegenprüfung ist absichtlich streng: Im Zweifel, bei ungewöhnlichen Antworten der Prüf-KI oder bei technischen Fehlern hält sie den Entwurf **immer** an, statt zu senden. Die Begründung steht im Banner — mit „Jetzt senden“ geben Sie ihn mit einem Klick frei.

**Es wird gar nichts automatisch versendet — warum?**
Der Hauptschalter unter **Einstellungen → Automatisierung** ist vermutlich aus (das ist der Auslieferungszustand). Ohne ihn erstellen Workflows höchstens Entwürfe.

**In der Palette fehlt ein Baustein, den die Doku erwähnt.**
Einige Bausteine (z. B. Retouren- und JTL-Aktionen) gibt es nur in der **Server-Edition**. Auf dem Desktop werden sie ausgeblendet; ein importierter Workflow, der sie enthält, meldet beim Lauf klar, dass der Baustein nur auf dem Server verfügbar ist.

**Ich habe eine Vorlage geladen und mein alter Aufbau ist weg.**
Über **„Versionen“** stellen Sie jeden zuvor gespeicherten Stand wieder her. Beim Laden einer Vorlage über einen nicht leeren Aufbau fragt SimpleCRM außerdem vorher nach.

**Kann die KI versehentlich Unsinn an Kunden schicken?**
Der automatische Versand ist mehrfach abgesichert: Hauptschalter (ab Werk aus), Sicherheits-Gate mit Mindest-Sicherheit, Gegenprüfung durch eine zweite KI (im Zweifel immer „Freigabe durch Menschen“), Tageslimit und Schleifenschutz. Ohne die Vorlage mit Gegenprüfung empfiehlt sich der Weg über Entwürfe: Die KI schreibt vor, Sie senden.

**Wie halte ich einen Workflow vorübergehend an?**
Einfach den Schalter **„Aktiv“** ausschalten und speichern — der Aufbau bleibt erhalten, es passiert nur nichts mehr. Für automatische Antworten wirkt zusätzlich der Hauptschalter unter **Einstellungen → Automatisierung** als Not-Aus für alle Workflows gleichzeitig.

**Woher weiß ich, welche Variablen es gibt?**
Nirgendwo nachschlagen — der Knopf **„Variablen“** neben dem jeweiligen Feld zeigt genau die Variablen, die an dieser Stelle Ihres Workflows verfügbar sind, mit Erklärung und Beispiel. Eine Gesamtübersicht der Bausteine bietet der Knopf **„Referenz“** in der Kopfzeile des Editors.
