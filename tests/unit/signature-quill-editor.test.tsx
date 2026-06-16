import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('SignatureQuillEditor', () => {
  it('uses Quill with a compact signature toolbar', () => {
    const source = readFileSync(
      resolve(__dirname, '../../src/components/email/signature-quill-editor.tsx'),
      'utf8',
    );
    expect(source).toMatch(/import Quill from "quill"/);
    expect(source).toMatch(/compose-quill/);
    expect(source).toMatch(/\["bold", "italic", "underline"\]/);
    expect(source).not.toMatch(/\["image"\]/);
  });

  it('is wired into account and team signature settings', () => {
    const account = readFileSync(
      resolve(__dirname, '../../src/components/email/settings/account-signatures-section.tsx'),
      'utf8',
    );
    const team = readFileSync(
      resolve(__dirname, '../../src/components/email/settings/team-panel.tsx'),
      'utf8',
    );
    expect(account).toMatch(/SignatureQuillEditor/);
    expect(team).toMatch(/SignatureQuillEditor/);
    expect(account).not.toMatch(/<Textarea[^>]*value=\{html\}/);
  });
});
