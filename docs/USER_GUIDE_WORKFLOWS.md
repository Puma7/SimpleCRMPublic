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
| **Zeitplan (Cron)** | regelmäßig zu festen Zeiten, optional mit Postfach-Abgleich |
| **Manuell** | per Knopf „Jetzt ausführen“ |
| **CRM-Ereignisse** | z. B. Kunde angelegt, Deal-Phase geändert, Aufgabe fällig, Termin beginnt |
| **Webhook (eingehend)** | wenn ein externes System die Automations-Schnittstelle aufruft (für Fortgeschrittene) |

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
- **Import/Export:** Über die Knöpfe **„Import“**/**„Export“** lassen sich Workflows als Datei sichern oder auf einen anderen Rechner übertragen.
- **Referenz:** Der Knopf **„Referenz“** öffnet ein Nachschlagewerk aller Bausteine, Auslöser und Variablen mit Erklärungen.

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
- eine **Checkliste der Voraussetzungen** mit Live-Ampel: grüner Haken = eingerichtet, rotes Kreuz = fehlt noch. Geprüft werden z. B. „KI-Profil mit API-Schlüssel“, „Mindestens ein Textbaustein“ und „Auto-Antwort-Schalter aktiviert“ — jeweils mit dem Ort in den Einstellungen, wo Sie es nachholen.

**„Vorlage laden“** ersetzt den aktuellen Inhalt der Zeichenfläche — falls dort schon etwas gebaut ist, fragt SimpleCRM vorher nach. Danach können Sie alles anpassen und müssen nur noch **speichern** (und sicherstellen, dass der Workflow auf **Aktiv** steht).

Eine kleine Auswahl der mitgelieferten Vorlagen:

| Vorlage | Zweck |
|---------|-------|
| **Eingehend: Rechnung sortieren** | Rechnungen taggen, einsortieren, Kunden verknüpfen |
| **Ausgehend: KI-Qualitätsprüfung** | Jede ausgehende Mail vor dem Versand von der KI gegenlesen lassen |
| **Eingehend: KI antwortet mit Textbaustein (mit Gate)** | KI wählt einen Ihrer Textbausteine und antwortet damit |
| **Eingehend: KI-Antwort mit Gegenprüfung (empfohlen)** | Frei formulierte KI-Antwort mit zweiter Prüf-KI — siehe unten |
| **E-Commerce: …** (8 Vorlagen) | Typische Shop-Anliegen erkennen und einsortieren (Wo ist meine Bestellung, Retoure, Reklamation, …) |

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
| **Senden** | Gate erlaubt + Gegenprüfung sagt „senden“ | Antwort geht automatisch raus |
| **Wartet auf Freigabe** | Gegenprüfung hat Zweifel (oder ein KI-Fehler trat auf) | Entwurf bleibt liegen, Sie entscheiden |
| **Blockiert** | Das Gate stoppt (Schalter aus, unsicherer Absender, Tageslimit, KI zu unsicher) | Nichts wird gesendet; war die KI sich zu unsicher, bekommt die Mail das Tag `ki-manuell` zur manuellen Bearbeitung |

### „Wartet auf Freigabe“ — was tun?

Hält die Gegenprüfung einen Entwurf an, sehen Sie:

- Den **Entwurf** im Ordner **Entwürfe** mit dem Hinweis-Banner **„Wartet auf Freigabe“** samt der **Begründung der Prüf-KI** (z. B. „Preiszusage sollte ein Mensch prüfen“). In der Nachrichtenliste trägt er das Kürzel **„Freigabe“**.
- Die **Kundenmail** bekommt das Tag `ki-freigabe`, und es wird eine **Aufgabe** „KI-Entwurf prüfen: …“ angelegt, damit nichts untergeht.

Im Banner haben Sie zwei Knöpfe:

- **„Jetzt senden“** — der Entwurf wird sofort versendet.
- **„Als Entwurf behalten“** — der Hinweis verschwindet, der Entwurf bleibt ein normaler Entwurf.

Sie können den Entwurf auch einfach öffnen und **bearbeiten** — sobald Sie den Inhalt ändern oder selbst versenden, ist der Freigabe-Zustand erledigt.

### Tageslimit und Schutz vor Antwort-Schleifen

Damit sich nie zwei Automaten endlos gegenseitig antworten, sind mehrere Sicherungen fest eingebaut:

- **Tageslimit pro Absender:** Erhält dieselbe Absenderadresse an einem Tag bereits die eingestellte Zahl automatischer Antworten (Standard: 1), wird keine weitere verschickt.
- **Automaten werden nie beantwortet:** Mails, die sich selbst als automatisch erzeugt ausweisen (Abwesenheitsnotizen, Systemmeldungen, Zustellfehler) sowie **Newsletter/Verteiler** werden vom Gate blockiert.
- **No-Reply-Adressen** (no-reply@…, mailer-daemon@… usw.) werden nie automatisch beantwortet.
- **Eigene automatische Antworten werden gekennzeichnet:** SimpleCRM markiert ausgehende Auto-Antworten nach dem üblichen Internet-Standard als „automatisch versendet“, damit fremde Systeme ihrerseits nicht darauf antworten.

Diese Schutzmechanismen sind immer aktiv — Sie müssen dafür nichts einrichten.

## Die Lauf-Historie lesen

Rechts unten im Editor sehen Sie zum ausgewählten Workflow die **Lauf-Historie**:

- **Linke Spalte:** die letzten Läufe („Lauf #123“) mit Status und Zeitpunkt.
- **Rechte Spalte:** nach Klick auf einen Lauf die einzelnen **Schritte** — welcher Baustein lief, mit welchem Ergebnis, über welchen **Ausgang** es weiterging und wie lange es dauerte.

Beispiele: Ein Gate-Schritt mit Ergebnis „Blockiert“ nennt den Grund — etwa dass die KI sich nicht sicher genug war (Kürzel `low_confidence`, siehe Tabelle unten). Bei der Gegenprüfung zeigt der Ausgang **Senden** bzw. **Prüfen**, wie die Prüf-KI entschieden hat.

**Gefahrlos testen:** Unter **„Erweitert (Zeitplan, Test, Backfill)“** können Sie eine Nachrichten-Nummer eintragen und **Test** klicken — der Workflow wird nur simuliert (es wird nichts gesendet, getaggt oder verschoben), und Sie sehen das Ergebnis Schritt für Schritt.

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
