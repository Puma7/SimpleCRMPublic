import { readFileSync } from 'fs';
import { join } from 'path';
import { resolveIsDevelopment } from '../../electron/security/runtime-mode';

const readSource = (relativePath: string) => readFileSync(join(__dirname, '../..', relativePath), 'utf8');

describe('Electron runtime mode', () => {
  test('a packaged app never runs in development mode', () => {
    expect(resolveIsDevelopment({ isPackaged: true, nodeEnv: 'development' })).toBe(false);
    expect(resolveIsDevelopment({ isPackaged: true, nodeEnv: undefined })).toBe(false);
  });

  test('unpackaged runs keep following NODE_ENV (electron:dev vs electron:start / E2E)', () => {
    expect(resolveIsDevelopment({ isPackaged: false, nodeEnv: 'development' })).toBe(true);
    expect(resolveIsDevelopment({ isPackaged: false, nodeEnv: 'production' })).toBe(false);
    expect(resolveIsDevelopment({ isPackaged: undefined, nodeEnv: 'test' })).toBe(false);
  });

  // F-A7-09: isDevelopment hing nur an NODE_ENV, eine gepackte App lud bei NODE_ENV=development den Dev-Server-Origin.
  test('main process and SQLite service derive development mode with app.isPackaged', () => {
    for (const file of ['electron/main.js', 'electron/sqlite-service.ts']) {
      const source = readSource(file);
      expect({ file, direct: /isDevelopment = process\.env\.NODE_ENV === 'development'/.test(source) })
        .toEqual({ file, direct: false });
      expect({ file, usesPackagedCheck: /isDevelopment = resolveIsDevelopment\(\{\s*isPackaged: app\??\.isPackaged,/.test(source) })
        .toEqual({ file, usesPackagedCheck: true });
    }
  });
});
