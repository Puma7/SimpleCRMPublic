import { readFileSync } from 'fs';
import { join } from 'path';
import {
  isDevToolsShortcut,
  registerWindowDevToolsShortcuts,
} from '../../electron/security/devtools-shortcuts';

const mainSource = readFileSync(join(__dirname, '../../electron/main.js'), 'utf8');

describe('Electron DevTools shortcuts', () => {
  // F-A7-06: F12 und Strg+Shift+I wurden per globalShortcut systemweit registriert, auch im gepackten Produktivbuild.
  test('main process never grabs the DevTools keys OS-wide', () => {
    expect(mainSource).not.toMatch(/globalShortcut\.register\(/);
  });

  test('main process binds the window-local shortcuts only for unpackaged builds', () => {
    expect(mainSource).toMatch(
      /if \(!app\.isPackaged\) \{\s*registerWindowDevToolsShortcuts\(mainWindow\.webContents, toggleDevTools\);\s*\}/,
    );
  });

  test('recognises F12 and Ctrl/Cmd+Shift+I on keyDown only', () => {
    expect(isDevToolsShortcut({ type: 'keyDown', key: 'F12' })).toBe(true);
    expect(isDevToolsShortcut({ type: 'keyDown', key: 'I', control: true, shift: true })).toBe(true);
    expect(isDevToolsShortcut({ type: 'keyDown', key: 'i', meta: true, shift: true })).toBe(true);

    expect(isDevToolsShortcut({ type: 'keyUp', key: 'F12' })).toBe(false);
    expect(isDevToolsShortcut({ type: 'keyDown', key: 'I', control: true })).toBe(false);
    expect(isDevToolsShortcut({ type: 'keyDown', key: 'I', shift: true })).toBe(false);
    expect(isDevToolsShortcut({ type: 'keyDown', key: 'I', control: true, shift: true, alt: true })).toBe(false);
    expect(isDevToolsShortcut({ type: 'keyDown', key: 'F11' })).toBe(false);
  });

  test('toggles through the window input event and swallows only the shortcut', () => {
    let listener: ((event: { preventDefault(): void }, input: { type: string; key: string }) => void) | undefined;
    const webContents = {
      on: jest.fn((_name: 'before-input-event', cb: typeof listener) => {
        listener = cb;
      }),
    };
    const toggle = jest.fn();

    registerWindowDevToolsShortcuts(webContents, toggle);
    expect(webContents.on).toHaveBeenCalledWith('before-input-event', expect.any(Function));

    const shortcutEvent = { preventDefault: jest.fn() };
    listener!(shortcutEvent, { type: 'keyDown', key: 'F12' });
    expect(shortcutEvent.preventDefault).toHaveBeenCalledTimes(1);
    expect(toggle).toHaveBeenCalledTimes(1);

    const typingEvent = { preventDefault: jest.fn() };
    listener!(typingEvent, { type: 'keyDown', key: 'a' });
    expect(typingEvent.preventDefault).not.toHaveBeenCalled();
    expect(toggle).toHaveBeenCalledTimes(1);
  });
});
