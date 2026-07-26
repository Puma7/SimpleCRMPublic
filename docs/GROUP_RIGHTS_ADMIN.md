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

## Diagnose

Admin-API: `GET /api/v1/email/access/explain?userId=<uuid>&messageId=<id>`  
Antwort erklärt, ob und warum eine Nachricht sichtbar ist (Binding vs. Filter).

Siehe auch [GROUP_RIGHTS_MATRIX.md](GROUP_RIGHTS_MATRIX.md).
