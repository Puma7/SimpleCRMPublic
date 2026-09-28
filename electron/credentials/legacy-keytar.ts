import type { LegacyKeytar } from './credential-store';

type KeytarModule = typeof import('keytar');

/**
 * Plan 044: einziger Zugriff auf `keytar` außer dem Hard Reset
 * (maintenance/keytar-purge.ts). In dieser Version nur lesen und – bei
 * ausdrücklichem Löschen durch den Nutzer – wie bisher löschen; der Umzug
 * verändert keytar nie. Eine spätere Version entfernt keytar ganz
 * (docs/design/desktop-credential-store.md, Entscheidungen 5 und 6).
 *
 * Erst beim ersten Rückfall geladen: Ein fehlendes oder defektes natives Modul
 * blockiert so keine Zugangsdaten, die schon im neuen Speicher liegen.
 */
let loaded: KeytarModule | null = null;

function keytar(): KeytarModule {
  if (!loaded) {
    const mod = require('keytar') as KeytarModule & { default?: KeytarModule };
    loaded = mod.default ?? mod;
  }
  return loaded;
}

export const legacyKeytar: LegacyKeytar = {
  getPassword: (service, account) => keytar().getPassword(service, account),
  deletePassword: (service, account) => keytar().deletePassword(service, account),
};
