/**
 * @jest-environment node
 */
/**
 * Preload: Drag-and-drop-Anhaenge. Den Pfad ermittelt der Preload per
 * webUtils.getPathForFile; der Freigabekanal ist fuer die allgemeine
 * invoke-Bruecke des Renderers gesperrt. Ersetzt ist nur Electron.
 */
const mockExposed = new Map<string, Record<string, any>>();
const mockInvoke = jest.fn();
const mockGetPathForFile = jest.fn();

jest.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: (key: string, api: Record<string, any>) => {
      mockExposed.set(key, api);
    },
  },
  ipcRenderer: {
    invoke: (...args: unknown[]) => mockInvoke(...args),
    send: jest.fn(),
    on: jest.fn(),
    removeListener: jest.fn(),
    removeAllListeners: jest.fn(),
  },
  webUtils: {
    getPathForFile: (file: unknown) => mockGetPathForFile(file),
  },
}));

import { IPCChannels } from '../../shared/ipc/channels';

const dropChannel = IPCChannels.Email.RegisterDroppedComposeAttachments;

describe('Preload: Drag-and-drop-Anhaenge', () => {
  beforeAll(() => {
    // Erst hier laden: der Preload ruft exposeInMainWorld beim Import auf.
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    require('../../electron/preload');
  });

  beforeEach(() => {
    mockInvoke.mockReset();
    mockGetPathForFile.mockReset();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  // C-A30: Ein kompromittierter Renderer koennte ueber einen offenen Kanal beliebige Host-Pfade freigeben.
  test('der Renderer kann den Freigabekanal nicht selbst aufrufen', async () => {
    const api = mockExposed.get('electronAPI')!;
    const legacy = mockExposed.get('electron')!;

    await expect(api.invoke(dropChannel, { paths: ['/etc/hosts'] })).rejects.toThrow(/blocked/);
    await expect(legacy.ipcRenderer.invoke(dropChannel, { paths: ['/etc/hosts'] })).rejects.toThrow(/blocked/);
    expect(mockInvoke).not.toHaveBeenCalled();

    mockInvoke.mockResolvedValue({ success: true, paths: [] });
    await api.invoke(IPCChannels.Email.PickComposeAttachments);
    expect(mockInvoke).toHaveBeenCalledWith(IPCChannels.Email.PickComposeAttachments);
  });

  test('ermittelt die Pfade der abgelegten Dateien im Preload', async () => {
    const api = mockExposed.get('electronAPI')!;
    const real = { name: 'angebot.pdf' };
    const inMemory = { name: 'erzeugt.txt' };
    const bogus = { name: 'kein-file' };
    mockGetPathForFile.mockImplementation((file: unknown) => {
      if (file === real) return '/home/anna/angebot.pdf';
      if (file === inMemory) return '';
      throw new TypeError('not a File');
    });
    mockInvoke.mockResolvedValue({ success: true, paths: ['/home/anna/angebot.pdf'] });

    await expect(api.registerDroppedComposeAttachments([real, inMemory, bogus])).resolves.toEqual([
      '/home/anna/angebot.pdf',
    ]);
    expect(mockInvoke).toHaveBeenCalledWith(dropChannel, { paths: ['/home/anna/angebot.pdf'] });

    mockInvoke.mockClear();
    await expect(api.registerDroppedComposeAttachments([inMemory])).resolves.toEqual([]);
    expect(mockInvoke).not.toHaveBeenCalled();
  });
});
