export interface DevToolsShortcutInput {
  type: string;
  key: string;
  control?: boolean;
  meta?: boolean;
  shift?: boolean;
  alt?: boolean;
}

interface InputEventSource {
  on(
    event: 'before-input-event',
    listener: (event: { preventDefault(): void }, input: DevToolsShortcutInput) => void,
  ): unknown;
}

/** F12 or Ctrl/Cmd+Shift+I as delivered by webContents `before-input-event`. */
export function isDevToolsShortcut(input: DevToolsShortcutInput): boolean {
  if (input.type !== 'keyDown') return false;
  if (input.key === 'F12') return true;
  return Boolean((input.control || input.meta) && input.shift && !input.alt && input.key.toLowerCase() === 'i');
}

/**
 * Binds the DevTools toggle to one window's key events. Unlike globalShortcut
 * this only fires while the window has focus and never takes the keys away
 * from other applications.
 */
export function registerWindowDevToolsShortcuts(webContents: InputEventSource, toggle: () => void): void {
  webContents.on('before-input-event', (event, input) => {
    if (!isDevToolsShortcut(input)) return;
    event.preventDefault();
    toggle();
  });
}
