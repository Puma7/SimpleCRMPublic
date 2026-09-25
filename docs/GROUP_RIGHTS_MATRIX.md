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
| Benutzer | `users.manage` | Nur Ordinary-User (kein Owner/Admin), die nicht mehr Rechte haben als der Delegierte (siehe unten); Owner-Konten nur durch Owner |

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

### Grenzen von `users.manage` (Delegierte ohne Admin-Rolle)

Ein Delegierter mit `users.manage` darf ein bestehendes Konto nur dann speichern
(inklusive Passwort, E-Mail, Deaktivieren), löschen oder dessen Login-PIN setzen,
wenn das Zielkonto

1. die Rolle `user` hat (kein Owner/Admin, `isForbiddenUserMutation`),
2. über seine Gruppen (`user_group_members` + `user_group_permissions`, expandiert)
   nur Capabilities hält, die der Delegierte selbst auch hat, und
3. keine Mail-ACL-Bindings besitzt, weder direkt noch über eine Gruppe.

Sonst antwortet der Server mit **403 `target_more_privileged`**. Grund: Ein
Passwort-Reset würde sonst die Anmeldung als Zielkonto und damit dessen
Gruppenrechte bzw. Postfach-Freigaben übertragen (F-A2b-06). Mail-ACLs werden
nicht einzeln verglichen; jedes Binding macht das Zielkonto „höher berechtigt“.
Das eigene Konto ist ausgenommen (dort gibt es nichts zu gewinnen), Anlegen neuer
Benutzer bleibt unverändert. Die Prüfung läuft in derselben Transaktion wie der
Schreibzugriff (`postgres-auth-port.ts`, reine Regel `isTargetMorePrivileged` in
`packages/server/src/api/capabilities.ts`). Solche Konten bearbeitet ein
Owner/Admin.

### Owner-Konten (nur Owner)

Nur ein Owner vergibt oder entzieht die Rolle `owner` und ändert oder löscht ein
Owner-Konto: Rolle, Aktiv-Status, Passwort, E-Mail, Anzeige- und öffentlicher
Name, Login-PIN, 2FA (Authenticator einrichten, E-Mail-2FA, 2FA abschalten).
Auch eine Einladung mit Rolle `owner` darf nur ein Owner erstellen. Admins
verwalten alle übrigen Konten weiter, auch andere Admins. Sonst antwortet der
Server mit **403 `owner_management_requires_owner`** (Regel
`isForbiddenUserMutation`). Grund: Ein Admin könnte sich sonst selbst zum Owner
machen oder ein Owner-Konto übernehmen und damit den Owner-only-Komplett-Reset
erreichen (G3, revidiert F-A2b-05). Ein Owner darf sich selbst herabstufen,
solange ein anderer aktiver Owner bleibt (`last_owner_required`). Das
Erst-Setup (`POST /api/v1/auth/initial-setup`) ist davon nicht betroffen. Die
Benutzerverwaltung blendet die Aktionen an Owner-Zeilen für Nicht-Owner aus.

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
| Verbindungstest IMAP, SMTP, POP3 (mit gespeicherten Zugangsdaten oder für ein neues Konto) | `email:test-imap`, `email:test-smtp`, `email:test-pop3` | Owner, Admin (gehört zu Konto anlegen und bearbeiten) |
| OAuth-App-Daten und Webhook-Secret speichern | `email:set-google-oauth-app`, `email:set-microsoft-oauth-app`, `email:set-misc-settings` | Owner, Admin; ein leeres Secret-Feld behält das gespeicherte |
| OAuth-Client-Secrets und Webhook-Secret lesen | `email:get-google-oauth-app`, `email:get-microsoft-oauth-app`, `email:get-misc-settings` | Klartext nur für Owner, Admin; alle anderen bekommen `hasSecret` |
| PGP-Empfängerschlüssel importieren, löschen, als verifiziert markieren oder Vertrauen entziehen | `pgp:import-peer-key`, `pgp:delete-peer-key`, `pgp:set-peer-key-trust` | Owner, Admin (die Schlüssel gelten workspace-weit, ohne Konto oder Eigentümer) |
| Workflow anlegen, ändern (auch aktivieren), löschen, importieren | `email:create-workflow`, `email:update-workflow`, `email:delete-workflow`, `workflow:import-bundle`, `workflow:import-bundle-from-file` | Owner, Admin. Cron- und Inbound-Workflows laufen ohne weitere Rollenprüfung im Main-Prozess, Code-Knoten mit den Rechten des Betriebssystem-Benutzers, Weiterleitungen über alle Konten |
| Workflow-Version speichern oder wiederherstellen | `workflow:save-version`, `workflow:restore-version` | Owner, Admin |
| Workflow jetzt ausführen, per Webhook auslösen, Inbound-Backfill | `workflow:execute-now`, `email:fire-webhook-workflow`, `email:backfill-inbound-workflows` | Owner, Admin (der Backfill führt alle aktiven Inbound-Workflows über alle Konten erneut aus) |
| Workflow-Automation-Einstellungen setzen (IMAP-Lösch-Opt-in, HTTP-Allowlist, Absenderlisten, Spam-Schwelle) | `workflow:set-automation-settings` | Owner, Admin |
| Wissensbasis anlegen, ändern, löschen, Inhalt speichern oder aus Datei importieren, Textabschnitt hinzufügen (auch die Wissensbasis-Slots eines Kontos) | `workflow:create-knowledge-base`, `workflow:update-knowledge-base`, `workflow:delete-knowledge-base`, `workflow:save-knowledge-base-document`, `workflow:import-knowledge-file`, `workflow:add-knowledge-chunk` | Owner, Admin (wie `workflows.manage` auf dem Server; lesen und exportieren mit `workflow:list-knowledge-bases`, `workflow:get-knowledge-base-document`, `workflow:export-knowledge-base-document` bleibt allen Rollen offen) |
| Workflows ansehen: Liste, Details, Versionen, Lauf-Historie, Export, Automation-Einstellungen lesen; Dry-Run | `email:list-workflows`, `email:get-workflow`, `workflow:list-versions`, `workflow:list-runs`, `workflow:get-run-log`, `workflow:list-run-steps`, `workflow:export-bundle`, `workflow:export-bundle-to-file`, `workflow:get-automation-settings`, `workflow:test-on-message` | alle Rollen |
| Benutzer anlegen, bearbeiten (auch Passwort setzen, deaktivieren), löschen | `auth:save-user`, `auth:delete-user` | Owner, Admin; die Rolle `owner` vergeben oder entziehen und Owner-Konten ändern oder löschen nur Owner (G3, Rolle aus der Session). Der letzte aktive Owner bleibt erhalten. Rollenwechsel, Deaktivieren und Passwort-Reset beenden die Sessions des Ziels; am eigenen Konto bleibt das aktuelle Fenster mit der neuen Rolle (Deaktivieren beendet auch es). `auth:change-password` beendet die anderen Sessions des Nutzers |

Die Oberfläche blendet die zugehörigen Einstellungen für andere Rollen aus: im Tab „Konten“ das Anlegen und Löschen, die Tabs „IMAP / POP3“, „SMTP“ und „OAuth“ samt Verbindungstests und die geteilten Konto-Signaturen (die Kontenliste bleibt sichtbar), den Tab „Datenschutz-Export“, in „Diagnose“ die Backup-Knöpfe (Owner, Admin) und den Restore-Assistenten (nur Owner) sowie die Tabs „OAuth-Apps“ und „Audit-Log“, in der Benutzerverwaltung die Aktionen an Owner-Konten für Admins. Maßgeblich ist die Prüfung im IPC-Handler, nicht die Oberfläche.

Den Workflow-Editor sehen Agent und Viewer schreibgeschützt: Neu, Speichern, Löschen, Import, Vorlagen, Anordnen, Aktiv-Schalter, Zeitplan, „Jetzt ausführen“, Inbound-Backfill und das Laden oder Speichern von Versionen sind gesperrt. Liste, Graph, Lauf-Historie, Versionsliste, Export und der Dry-Run bleiben offen. Im Tab „Automatisierung“ sind die Workflow-Optionen für sie nur lesbar. Den Tab „Wissensbasis“ und die Wissensbasis-Slots im Konto-Tab „KI“ sehen sie ebenfalls nur lesend (Inhalt ansehen und exportieren, nicht anlegen, ändern, zuweisen oder löschen).

**Grenze:** Die lokalen Rollen schützen nicht gegen Zugriff auf das Dateisystem. `database.sqlite` ist nicht verschlüsselt und liegt im Profil des Betriebssystem-Benutzers (unter Linux `~/.config/simplecrm/`). Alle lokalen App-Benutzer teilen sich dieses Profil. Wer die Datei lesen oder ersetzen kann, umgeht jede Rollenprüfung.
