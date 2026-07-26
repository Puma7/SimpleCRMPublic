# Gruppenrechte — Capability-Matrix & Vorlagen

**Stand:** Masterplan „Einfaches, gruppenbasiertes Rechtemanagement“  
**Zielsystem:** Server-Edition (Desktop bleibt unrestricted)

## Zwei Fragen

1. **Modulrechte** (Gruppe → Capabilities): Was darf die Person im Produkt?
2. **Mail-Sichtbarkeit** (Gruppe/User → Mail-ACL + Constraints): Welche Mails sieht sie?

## Modulrechte (inklusive Stufen)

| Modul | Keys (niedrig → hoch) | Typische Nutzung |
|-------|----------------------|------------------|
| CRM | `crm.read` → `crm.write` | Support schreibt Kunden/Deals/Aufgaben |
| Workflows | `workflows.view` → `run` → `edit` → `manage` | Support+ nur ausführen; Backoffice bearbeiten |
| Einstellungen | `settings.view` → `settings.manage` | Support: keines; Admin-Delegierte: manage |
| Tracking | `tracking.view` | Evidenz/Tracking |
| Benutzer | `users.manage` | Nur Ordinary-User (kein Owner/Admin) |

Höhere Stufe impliziert niedrigere (Expand beim Auth in `expandUserGroupCapabilities`).

**Legacy:** `email_settings.manage` wird wie `settings.manage` behandelt.

### Route-/UI-Zuordnung (Kurz)

| Bereich | Mindest-Capability |
|---------|-------------------|
| CRM lesen | authentifiziert (Status quo) bzw. `crm.read` wenn erzwungen |
| CRM schreiben/löschen | `crm.write` |
| Workflow-Liste/Detail | `workflows.view` |
| Workflow dry-run / anwenden | `workflows.run` |
| Workflow speichern | `workflows.edit` |
| Workflow löschen, KI-Profile mutieren | `workflows.manage` |
| AI-Prompt lesen / transform-text | authentifiziert (Compose) |
| Einstellungen öffnen (Nav) | `settings.view` (HTTP) |
| E-Mail-/Security-Settings schreiben | `settings.manage` |
| Tracking sensitiv | `tracking.view` |
| Benutzer CRUD | `users.manage` |

Owner/Admin: implizit alle Capabilities.

## Vorlagen

| ID | Capabilities |
|----|--------------|
| `support` | `crm.read`, `crm.write` |
| `support_plus` | + `workflows.view`, `workflows.run` |
| `backoffice` | CRM write + Workflows manage + Settings manage |
| `readonly` | `crm.read`, `settings.view` |

Postfächer und Sichtbarkeitsfilter (Zuweisung/Kategorie/Tag) werden **nicht** in der Vorlage gespeichert — separat unter Mail-ACL.

## Mail-Sichtbarkeit

- Basis: Account/Folder/Message + Profil (viewer…manager) — unverändert.
- Optional pro Binding: Zuweisungsmodus, Kategorie-Allow/Exclude, Tag-Allow/Exclude.
- Siehe Migration `0046_group_rights_and_mail_constraints` und Admin-UI „Gruppen & Rechte“.
