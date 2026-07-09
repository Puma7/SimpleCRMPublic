// Lightweight i18n dictionary (DE/EN). Each key maps to both languages.
// German is the source/default language; English is the alternative.
//
// Migration is incremental: replace a hardcoded German string with t('key')
// and add the key here. Components keep working in German even before a key is
// added (the hook falls back to German / the key itself).

export type Translation = { de: string; en: string }

export const translations = {
  // Common
  "common.save": { de: "Speichern", en: "Save" },
  "common.cancel": { de: "Abbrechen", en: "Cancel" },
  "common.delete": { de: "Löschen", en: "Delete" },
  "common.add": { de: "Hinzufügen", en: "Add" },
  "common.remove": { de: "Entfernen", en: "Remove" },
  "common.loading": { de: "Wird geladen…", en: "Loading…" },
  "common.actionFailed": { de: "Aktion fehlgeschlagen.", en: "Action failed." },

  // Language switcher
  "language.label": { de: "Sprache", en: "Language" },
  "language.de": { de: "Deutsch", en: "German" },
  "language.en": { de: "Englisch", en: "English" },

  // Main navigation
  "nav.dashboard": { de: "Dashboard", en: "Dashboard" },
  "nav.followup": { de: "Nachverfolgung", en: "Follow-up" },
  "nav.customers": { de: "Kunden", en: "Customers" },
  "nav.deals": { de: "Deals", en: "Deals" },
  "nav.tasks": { de: "Aufgaben", en: "Tasks" },
  "nav.products": { de: "Produkte", en: "Products" },
  "nav.calendar": { de: "Kalender", en: "Calendar" },
  "nav.email": { de: "E-Mail", en: "Email" },
  "nav.returns": { de: "Retouren", en: "Returns" },
  "nav.settings": { de: "Einstellungen", en: "Settings" },

  // User groups settings panel
  "userGroups.title": { de: "Benutzergruppen", en: "User groups" },
  "userGroups.description": {
    de: "Gruppen für die Zuweisung von Aufgaben (z. B. Support, Vertrieb).",
    en: "Groups for assigning tasks (e.g. Support, Sales).",
  },
  "userGroups.name": { de: "Name", en: "Name" },
  "userGroups.namePlaceholder": { de: "z. B. Support", en: "e.g. Support" },
  "userGroups.descriptionOptional": { de: "Beschreibung (optional)", en: "Description (optional)" },
  "userGroups.create": { de: "Gruppe anlegen", en: "Create group" },
  "userGroups.empty": { de: "Noch keine Gruppen angelegt.", en: "No groups yet." },
  "userGroups.memberCount": { de: "{count} Mitglieder", en: "{count} members" },
  "userGroups.members": { de: "Mitglieder", en: "Members" },
  "userGroups.membersOf": { de: "Mitglieder von {name}", en: "Members of {name}" },
  "userGroups.noMembers": { de: "Keine Mitglieder.", en: "No members." },
  "userGroups.addMember": { de: "Mitglied hinzufügen", en: "Add member" },
  "userGroups.selectUser": { de: "Benutzer auswählen…", en: "Select user…" },
  "userGroups.nameRequired": { de: "Bitte einen Gruppennamen eingeben.", en: "Please enter a group name." },
} satisfies Record<string, Translation>

export type TranslationKey = keyof typeof translations
