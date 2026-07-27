# Gruppen & Rechte — Admin-Kurzanleitung

Drei Schritte für den Normalfall (Support-Mitarbeiter):

## 1. Gruppe anlegen

1. **Einstellungen → Benutzergruppen** (bzw. E-Mail-Einstellungen → Gruppen)
2. Name vergeben (z. B. `Support`)
3. Vorlage wählen: **Support**, **Support+**, **Backoffice** oder **Nur Lesen**
4. Gruppe anlegen

## 2. Mitglieder zuweisen

In der Gruppe unter **Mitglieder** die Nutzer hinzufügen.  
Rechte kommen nur über die Gruppe — keine Einzelrechte nötig.

## 3. Postfach freigeben

Unter **E-Mail → Einstellungen → Delegation**:

1. Konto oder Ordner wählen
2. Subjekt **Gruppe** → die neue Gruppe
3. Profil wählen (typisch **Triage** für Support)
4. Speichern

Optional unter **Erweitert: Sichtbarkeitsfilter**:

- nur zugewiesene Mails
- Kategorie-Allowlist / Exclude
- Tag-Allowlist / Exclude (Tags sind Freitext)

Pro Liste sind maximal 500 Einträge erlaubt (Tags zusätzlich max. 200 Zeichen) —
die Werte landen bei jeder Mail-Abfrage der betroffenen Nutzer in der Query.

Fertig. Neue Support-Mitarbeiter brauchen nur die Gruppenmitgliedschaft.

---

## Vorlagen (Modulrechte)

| Vorlage | CRM | Workflows | Einstellungen |
|---------|-----|-----------|---------------|
| Support | bearbeiten | keins | keins |
| Support+ | bearbeiten | ansehen + ausführen | keins |
| Backoffice | bearbeiten | verwalten | verwalten |
| Nur Lesen | ansehen | keins | ansehen |

Owner/Admin haben implizit alle Rechte.

Eine Vorlage **ersetzt** alle Modulrechte der Gruppe (kein Zusammenführen).
Werden dadurch Rechte entzogen, fragt die UI vorher nach; die Änderung wirkt
sofort für alle Mitglieder, weil Capabilities pro Request aufgelöst werden.

## Rollout-Modus und Sichtbarkeitsfilter

Der ACL-Rollout kennt `shadow` und `enforce`. Im **Shadow-Modus** entscheidet
weiterhin die Legacy-ACL über den Konto-/Ordner-Zugriff — die neuen
Sichtbarkeitsfilter (Zuweisung, Kategorie, Tag) greifen dort aber **bereits
echt**, sonst wären konfigurierte Bindings wirkungslos und der Vergleich
aussagelos. Wer in einer Shadow-Workspace einen Filter setzt, verändert also
sofort die Sichtbarkeit für die betroffenen Nutzer.

## Diagnose

Admin-API: `GET /api/v1/email/access/explain?userId=<uuid>&messageId=<id>`  
Antwort erklärt, ob und warum eine Nachricht sichtbar ist (Binding vs. Filter).

Siehe auch [GROUP_RIGHTS_MATRIX.md](GROUP_RIGHTS_MATRIX.md).
