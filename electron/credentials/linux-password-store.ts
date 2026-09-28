/**
 * Plan 044: Chromium wählt unter Linux libsecret bzw. KWallet nur bei einer
 * erkannten Desktop-Umgebung (GNOME, XFCE, Cinnamon, KDE …); sonst `basic_text`
 * mit dem eingebauten Schlüssel (Präfix `v10`, nur verschleiert). keytar sprach
 * libsecret immer direkt an. Damit Nutzer ohne erkannte Umgebung (i3, sway,
 * CI) nicht schlechter dastehen als mit keytar, wird libsecret angefordert –
 * außer unter KDE (KWallet) oder wenn der Start `--password-store` ausdrücklich
 * setzt. Läuft kein Secret-Service, bleibt es bei `v10`, und der
 * Zugangsdaten-Speicher speichert wie vorgesehen nichts Neues.
 *
 * Ausdrücklich heißt: in den Startargumenten (`process.argv`). Ein Schalter,
 * den vor `main.js` geladener Code anhängt, zählt nicht – Playwrights
 * Electron-Loader setzt so `--password-store=basic`. Deshalb wird der Wert aus
 * den Startargumenten erneut gesetzt; ein späteres `appendSwitch` überschreibt.
 */
export function linuxPasswordStoreSwitch(input: Readonly<{
  platform: NodeJS.Platform;
  env: Readonly<Record<string, string | undefined>>;
  argv: readonly string[];
}>): string | null {
  if (input.platform !== 'linux') return null;
  const explicit = passwordStoreArgument(input.argv);
  if (explicit !== undefined) return explicit || null;
  const desktop = `${input.env.XDG_CURRENT_DESKTOP ?? ''}:${input.env.DESKTOP_SESSION ?? ''}`.toUpperCase();
  if (desktop.includes('KDE') || input.env.KDE_FULL_SESSION === 'true') return null;
  return 'gnome-libsecret';
}

/** Wert des letzten `--password-store[=…]` vor `--` (Chromium: `-` oder `--`); `undefined` ohne Angabe. */
function passwordStoreArgument(argv: readonly string[]): string | undefined {
  let value: string | undefined;
  for (const arg of argv) {
    if (arg === '--') break;
    const name = arg.startsWith('--') ? arg.slice(2) : arg.startsWith('-') ? arg.slice(1) : null;
    if (name === null) continue;
    if (name === 'password-store') value = '';
    else if (name.startsWith('password-store=')) value = name.slice('password-store='.length);
  }
  return value;
}
