jest.mock('quill', () => ({ __esModule: true, default: class MockQuill {} }));
jest.mock('quill/dist/quill.snow.css', () => ({}));
jest.mock('@/styles/compose-quill.css', () => ({}));

import { uploadServerComposeFiles } from '../../src/components/email/compose-dialog';

function fakeFile(name: string, size: number): File {
  return { name, size, type: 'application/octet-stream' } as File;
}

describe('uploadServerComposeFiles', () => {
  // F-A13A14-06: Lehnt der Server einen Upload wegen der Entwurfsgrenze ab (413), gingen die zuvor hochgeladenen Dateien dem Entwurf verloren und belegten trotzdem das Kontingent.
  it('keeps files uploaded before the server rejects one and reports the rejection', async () => {
    const quotaError = new Error('Anhaenge dieses Entwurfs waeren zusammen groesser als 50 MB');
    const upload = jest.fn(async (file: File) => {
      if (file.name === 'c.pdf') throw quotaError;
      return { path: `ws/compose-drafts/44/${file.name}` };
    });
    const onTooLarge = jest.fn();

    const result = await uploadServerComposeFiles(
      [fakeFile('a.pdf', 10), fakeFile('b.pdf', 10), fakeFile('c.pdf', 10), fakeFile('d.pdf', 10)],
      upload,
      onTooLarge,
    );

    expect(result).toEqual({
      uploadedPaths: ['ws/compose-drafts/44/a.pdf', 'ws/compose-drafts/44/b.pdf'],
      error: quotaError,
    });
    expect(upload).toHaveBeenCalledTimes(3);
    expect(onTooLarge).not.toHaveBeenCalled();
  });

  it('skips files over 25 MB locally and uploads the rest', async () => {
    const upload = jest.fn(async (file: File) => ({ path: `ws/compose-drafts/44/${file.name}` }));
    const onTooLarge = jest.fn();

    const result = await uploadServerComposeFiles(
      [fakeFile('gross.bin', 25 * 1024 * 1024 + 1), fakeFile('klein.txt', 3)],
      upload,
      onTooLarge,
    );

    expect(result).toEqual({ uploadedPaths: ['ws/compose-drafts/44/klein.txt'], error: null });
    expect(onTooLarge).toHaveBeenCalledWith(expect.objectContaining({ name: 'gross.bin' }));
  });
});
