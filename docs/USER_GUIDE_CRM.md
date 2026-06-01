# CRM — Kurzanleitung für Anwender

SimpleCRM ist eine **Desktop-Anwendung** für Kunden, Verkaufschancen (Deals), Aufgaben und Termine. Ihre Daten bleiben **auf Ihrem Rechner** — es gibt keinen SimpleCRM-Cloud-Speicher für Kunden und Deals.

Die **E-Mail-Funktion** ist ein eigenes Modul; eine Kurzanleitung dazu finden Sie unter [`USER_GUIDE_EMAIL.md`](USER_GUIDE_EMAIL.md).

---

## Navigation

In der oberen Leiste finden Sie:

| Menüpunkt | Inhalt |
|-----------|--------|
| **Dashboard** | Überblick: Zahlen, letzte Kunden, fällige Aufgaben |
| **Nachverfolgung** | Tagesarbeit: Warteschlangen für Aufgaben und kritische Deals |
| **Kunden** | Alle Kontakte; Klick öffnet die Detailseite |
| **Deals** | Verkaufschancen in Phasen (Pipeline) |
| **Aufgaben** | To-dos mit Fälligkeit und Priorität |
| **Produkte** | Artikelkatalog (manuell oder aus JTL-Sync) |
| **Kalender** | Termine |
| **E-Mail** | Postfach und Automatisierung (separat) |
| **Einstellungen** (rechts) | Anbindung an **JTL-Wawi** (MSSQL), nicht E-Mail-Konten |

**Tipp:** `Strg+K` öffnet die Befehlspalette — schneller Sprung zu Kunden und Aktionen.

---

## Kunden anlegen und pflegen

1. **Kunden** öffnen → **Neuer Kunde** (oder über Dashboard/Onboarding).
2. Stammdaten ausfüllen: Name, Firma, Kontakt, Adresse, Notizen.
3. In der **Detailansicht** sehen Sie verknüpfte **Deals**, **Aufgaben** und (wenn genutzt) **benutzerdefinierte Felder**.

Kunden können **lokal** erfasst werden oder nach einem **Sync aus JTL** erscheinen (siehe unten).

---

## Deals (Verkaufschancen)

- Jeder Deal gehört zu **einem Kunden**.
- Die **Phase** (z. B. Prospekt, Angebot, Verhandlung, Gewonnen) zeigt den Fortschritt in der Pipeline.
- **Wert:** entweder fest eingetragen oder aus **Produkten im Deal** berechnet.
- Unter **Produkte am Deal** fügen Sie Artikel mit Menge hinzu — der Wert kann sich daraus ergeben.

---

## Aufgaben

- Aufgaben sind immer einem **Kunden** zugeordnet.
- **Fälligkeitsdatum** und **Priorität** steuern Sortierung und Nachverfolgung.
- Erledigte Aufgaben können ausgeblendet werden; offene erscheinen im Dashboard und in den Queues.

**Zurückstellen (Snooze):** In der Nachverfolgung können Sie Aufgaben vorübergehend verschieben — sie erscheinen dann in der Queue „Zurückgestellt“.

---

## Nachverfolgung — so arbeiten Sie die Queue ab

1. **Nachverfolgung** öffnen.
2. Links eine **Warteschlange** wählen (z. B. **Heute**, **Überfällig**, **Stagnierende Deals**).
3. In der Mitte einen Eintrag auswählen; rechts sehen Sie Kunde, Deal und **Verlauf** (Aktivitäten).
4. **Aktivität protokollieren** (Anruf, E-Mail, Notiz) dokumentiert den Kontakt für später.
5. Optional: **Gespeicherte Ansichten** für wiederkehrende Filter.

---

## Kalender

- Termine mit Titel, Zeitraum, ganztägig oder mit Uhrzeit.
- Ein Termin kann mit einer **Aufgabe** verknüpft sein.
- Die URL kann ein Datum per Parameter öffnen (`/calendar?date=…`).

---

## JTL-Wawi (optional)

Wenn Sie **JTL-Wawi** nutzen:

1. **Einstellungen** → MSSQL-Zugangsdaten eintragen und **Verbindung testen**.
2. **Synchronisation starten** — Kunden und Produkte werden in die lokale Datenbank übernommen.
3. Passwort wird sicher im **System-Schlüsselbund** gespeichert, nicht im Klartext in der Datei.

Ohne JTL arbeiten Sie vollständig mit **lokal angelegten** Kunden und Produkten.

**Benutzerdefinierte Felder:** **Einstellungen → Benutzerdefinierte Felder** — eigene Felder für Kunden definieren (z. B. Branche, VIP-Status).

---

## Zusammenspiel mit E-Mail

- In einer E-Mail können Sie einen **Kunden verknüpfen** — dann stehen Platzhalter in Textbausteinen zur Verfügung.
- Aus einer Mail können Sie einen **neuen Deal** oder **Kalendereintrag** anstoßen (wenn ein Kunde verknüpft ist, wo nötig).
- **Workflows** können CRM-Aktionen auslösen (z. B. Aufgabe anlegen) — Konfiguration unter **E-Mail → Workflows**.

---

## Automatisierung von außen (Fortgeschritten)

Mit aktivierter **Automation-API** können Tools wie n8n Kunden, Deals und Aufgaben per REST ansprechen — nur solange SimpleCRM läuft. Details: [`API_V1.md`](API_V1.md).

---

## Wenn etwas nicht klappt

| Problem | Hinweis |
|---------|---------|
| Sync schlägt fehl | MSSQL-Einstellungen, Firewall, VPN; Verbindung in Einstellungen testen |
| Keine Kunden nach Sync | Letzten Sync-Status in Einstellungen prüfen; Logs in der Entwicklerkonsole |
| Leeres Dashboard | Normal bei neuer Installation — ersten Kunden anlegen |
| E-Mail-Einstellungen | Liegen unter **E-Mail → Einstellungen**, nicht unter Haupt-**Einstellungen** |

Technische Details: [`CRM_PRODUCT_GUIDE.md`](CRM_PRODUCT_GUIDE.md).
