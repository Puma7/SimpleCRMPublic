/**
 * Plan 044: Chromium wählt unter Linux libsecret bzw. KWallet nur bei einer
 * erkannten Desktop-Umgebung (GNOME, XFCE, Cinnamon, KDE …); sonst `basic_text`
 * mit dem eingebauten Schlüssel (Präfix `v10`, nur verschleiert). keytar sprach
 * libsecret immer direkt an. Damit Nutzer ohne erkannte Umgebung (i3, sway,
 * CI) nicht schlechter dastehen als mit keytar, wird libsecret angefordert –
 * außer unter KDE (KWallet) oder wenn der Start `--password-store` schon setzt.
 * Läuft kein Secret-Service, bleibt es bei `v10`, und der Zugangsdaten-Speicher
 * speichert wie vorgesehen nichts Neues.
 */
export function linuxPasswordStoreSwitch(input: Readonly<{
  platform: NodeJS.Platform;
  env: Readonly<Record<string, string | undefined>>;
  hasPasswordStoreSwitch: boolean;
}>): string | null {
  if (input.platform !== 'linux' || input.hasPasswordStoreSwitch) return null;
  const desktop = `${input.env.XDG_CURRENT_DESKTOP ?? ''}:${input.env.DESKTOP_SESSION ?? ''}`.toUpperCase();
  if (desktop.includes('KDE') || input.env.KDE_FULL_SESSION === 'true') return null;
  return 'gnome-libsecret';
}
