import { SIGNATURE_QUILL_TOOLBAR } from '../../shared/signature-quill-toolbar';
import { COMPOSE_DRAFT_AUTOSAVE_DEBOUNCE_MS } from '../../shared/compose-autosave';
import { act, render } from '@testing-library/react';

const mockQuillInstances: Array<{
  root: HTMLDivElement;
  handlers: Record<string, (...args: unknown[]) => void>;
}> = [];

jest.mock('quill/dist/quill.snow.css', () => ({}));
jest.mock('@/styles/compose-quill.css', () => ({}));
jest.mock('quill', () => {
  class MockQuill {
    root = document.createElement('div');
    handlers: Record<string, (...args: unknown[]) => void> = {};
    clipboard = {
      dangerouslyPasteHTML: (html: string) => {
        this.root.innerHTML = html;
      },
    };
    constructor() {
      this.root.innerHTML = '<p><br></p>';
      mockQuillInstances.push(this);
    }
    on(event: string, callback: (...args: unknown[]) => void) {
      this.handlers[event] = callback;
    }
    setText() {
      this.root.innerHTML = '<p><br></p>';
    }
  }
  return { __esModule: true, default: MockQuill };
});

import { SignatureQuillEditor } from '@/components/email/signature-quill-editor';

describe('signature quill toolbar', () => {
  it('is compact and excludes image upload', () => {
    expect(SIGNATURE_QUILL_TOOLBAR).toEqual([
      ['bold', 'italic', 'underline'],
      [{ list: 'ordered' }, { list: 'bullet' }],
      ['link'],
      ['clean'],
    ]);
    expect(JSON.stringify(SIGNATURE_QUILL_TOOLBAR)).not.toContain('image');
  });
});

describe('compose dialog autosave', () => {
  it('debounces draft saves by 2000ms', () => {
    expect(COMPOSE_DRAFT_AUTOSAVE_DEBOUNCE_MS).toBe(2000);
  });
});

describe('signature Quill HTML boundary', () => {
  beforeEach(() => {
    mockQuillInstances.length = 0;
  });

  test('sanitizes external values and editor change output', () => {
    const onChange = jest.fn();
    render(
      <SignatureQuillEditor
        value={'<p>Signatur</p><img src="x" onerror="alert(1)"><script>alert(2)</script>'}
        onChange={onChange}
      />,
    );
    const editor = mockQuillInstances[0]!;

    expect(editor.root.innerHTML).toContain('<p>Signatur</p>');
    expect(editor.root.innerHTML).not.toMatch(/onerror|script/i);

    editor.root.innerHTML = '<p onclick="alert(3)">Geändert</p><script>alert(4)</script>';
    act(() => editor.handlers['text-change']!());
    expect(onChange).toHaveBeenLastCalledWith('<p>Geändert</p>');
  });
});
