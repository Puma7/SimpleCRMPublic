# Gruppenrechte — Capability-Matrix & Vorlagen

**Stand:** Masterplan „Einfaches, gruppenbasiertes Rechtemanagement“  
**Zielsystem:** Server-Edition (Desktop: nur lokale Rollen, siehe [Desktop-Edition](#desktop-edition-lokale-rollen))

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
- Siehe Migration `0047_group_rights_and_mail_constraints` und Admin-UI „Gruppen & Rechte“.

## Desktop-Edition (lokale Rollen)

Die Desktop-App kennt keine Capabilities und keine Gruppen. Sie kennt nur die Rollen der lokalen Anmeldung (`owner`, `admin`, `agent`, `viewer`) und die Konto-Freigaben in `user_account_access` (Stufen `ro`, `send_only`, `rw`). Owner und Admin dürfen auf alle Konten zugreifen. Die folgenden Aktionen prüft der Main-Prozess im IPC-Handler (`requireRole`) unabhängig von der Konto-Freigabe:

| Aktion | IPC-Kanäle | Rolle |
|--------|-----------|-------|
| Backup einspielen: ZIP wählen, Vorschau, Restore | `email:pick-local-mail-backup-zip`, `email:preview-restore-local-mail-backup`, `email:restore-local-mail-backup` | nur Owner, echte Anmeldung (wie der Hard-Reset `maintenance:*-hard-reset`) |
| Vollbackup exportieren und prüfen | `email:export-local-mail-backup`, `email:verify-local-mail-backup` | Owner, Admin |
| DSGVO-Export | `email:gdpr-export` | Owner, Admin |
| Mail-Konto anlegen, bearbeiten, löschen | `email:create-account`, `email:update-account`, `email:delete-account` | Owner, Admin (wie `mail.account.manage` auf dem Server) |
| OAuth-App-Daten und Webhook-Secret speichern | `email:set-google-oauth-app`, `email:set-microsoft-oauth-app`, `email:set-misc-settings` | Owner, Admin; ein leeres Secret-Feld behält das gespeicherte |
| OAuth-Client-Secrets und Webhook-Secret lesen | `email:get-google-oauth-app`, `email:get-microsoft-oauth-app`, `email:get-misc-settings` | Klartext nur für Owner, Admin; alle anderen bekommen `hasSecret` |

Die Oberfläche blendet die zugehörigen Einstellungen für andere Rollen aus: den Tab „Datenschutz-Export“, in „Diagnose“ die Backup-Knöpfe (Owner, Admin) und den Restore-Assistenten (nur Owner) sowie die Tabs „OAuth-Apps“ und „Audit-Log“. Maßgeblich ist die Prüfung im IPC-Handler, nicht die Oberfläche.

**Grenze:** Die lokalen Rollen schützen nicht gegen Zugriff auf das Dateisystem. `database.sqlite` ist nicht verschlüsselt und liegt im Profil des Betriebssystem-Benutzers (unter Linux `~/.config/simplecrm/`). Alle lokalen App-Benutzer teilen sich dieses Profil. Wer die Datei lesen oder ersetzen kann, umgeht jede Rollenprüfung.
