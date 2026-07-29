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

Der ACL-Rollout kennt `shadow` und `enforce`.

**Im Shadow-Modus gewährt eine Delegation gar nichts.** Wer ein Postfach sehen
darf, entscheidet dort weiterhin die Legacy-ACL (`user_account_access`); die
Bindings können nur zusätzlich **einschränken**. Die Sichtbarkeitsfilter
(Zuweisung, Kategorie, Tag) greifen dabei bereits echt — sonst wären
konfigurierte Bindings wirkungslos und der Vergleich aussagelos. Wer in einem
Shadow-Workspace einen Filter setzt, verändert also sofort die Sichtbarkeit.

Das ist die wichtigste Falle des Modus: Eine vollständige Delegation lässt sich
anlegen, speichern und in der Liste betrachten — und die betroffenen Benutzer
haben trotzdem ein leeres Postfach, weil die Legacy-Seite sie nicht kennt. In
der Server-Edition schreibt **nichts** in `user_account_access`; die Tabelle
füllt sich nur beim Import aus einer SQLite-Desktop-Installation. Für einen
Workspace ohne diesen Import ist die Legacy-Antwort deshalb konstant „nein".
Das Delegations-Panel weist im Shadow-Modus ausdrücklich darauf hin, und
`doctor.sh` meldet solche Workspaces als `mail_acl_shadow_without_legacy`.
Migration `0050_mail_acl_shadow_without_legacy` räumt bestehende Fälle auf: sie
setzt genau die Workspaces auf `enforce`, die im Shadow-Modus stehen und keine
einzige Legacy-Zeile haben — dort ist der Vergleich beweisbar leer.

### Umschalten auf `enforce`

`POST /api/v1/email/acl-rollout/enforce` (Admin). Vorher `GET …/readiness`:

- `ready: true` — der Wechsel geht ohne weitere Angaben durch.
- `readyWithAcknowledgedWidening: true` — der Wechsel **erweitert** den Zugriff
  gegenüber der Alt-ACL (`legacyDenyNewAllow > 0`). Das ist der Normalfall,
  sobald überhaupt eine Delegation eingerichtet ist. Bestätigen mit
  `{"acknowledgeWidening": true}` im Body; das Audit-Event hält die Bestätigung
  samt Zähler fest.
- `access_regressions_present` — der Wechsel würde jemandem Zugriff **nehmen**
  (`legacyAllowNewDeny > 0`). Das bleibt gesperrt, auch mit Bestätigung: erst
  die Delegation so ergänzen, dass niemand verliert.

Der Wechsel ist einmalig; einen Weg zurück nach `shadow` gibt es nicht.

## Diagnose

Admin-API: `GET /api/v1/email/access/explain?userId=<uuid>&messageId=<id>`  
Antwort erklärt, ob und warum eine Nachricht sichtbar ist (Binding vs. Filter).

Siehe auch [GROUP_RIGHTS_MATRIX.md](GROUP_RIGHTS_MATRIX.md).
