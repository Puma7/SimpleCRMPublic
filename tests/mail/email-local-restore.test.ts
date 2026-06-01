import path from 'path';
import { resolveSafePathUnderDirectory } from '../../electron/email/email-zip-path-safety';

describe('email-local-restore path safety', () => {
  const dest = path.join('/tmp', 'crm-restore-safe');

  test('allows normal relative paths', () => {
    const out = resolveSafePathUnderDirectory(dest, 'database.sqlite');
    expect(out).toBe(path.join(dest, 'database.sqlite'));
  });

  test('allows nested directories', () => {
    const out = resolveSafePathUnderDirectory(dest, 'email-attachments/a/b.dat');
    expect(out).toBe(path.join(dest, 'email-attachments', 'a', 'b.dat'));
  });

  test('rejects parent traversal', () => {
    expect(() => resolveSafePathUnderDirectory(dest, '../outside.sqlite')).toThrow(
      /Traversal|Pfad/i,
    );
  });

  test('rejects embedded traversal segments', () => {
    expect(() => resolveSafePathUnderDirectory(dest, 'email-attachments/../../etc/passwd')).toThrow(
      /Traversal|Pfad/i,
    );
  });
});
