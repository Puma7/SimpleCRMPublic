import { createRef } from 'react';
import { act, render } from '@testing-library/react';

const mockQuillInstances: Array<{
  root: HTMLDivElement;
  options: any;
  handlers: Record<string, (...a: any[]) => void>;
}> = [];

jest.mock('quill/dist/quill.snow.css', () => ({}));
jest.mock('@/styles/compose-quill.css', () => ({}));

jest.mock('quill', () => {
  class MockQuill {
    root = document.createElement('div');
    handlers: Record<string, (...a: any[]) => void> = {};
    clipboard = {
      dangerouslyPasteHTML: (html: string) => {
        this.root.innerHTML = html;
      },
    };
    constructor(_el: HTMLElement, public options: any) {
      this.root.innerHTML = '<p><br></p>';
      mockQuillInstances.push(this);
    }
    on(evt: string, cb: (...a: any[]) => void) {
      this.handlers[evt] = cb;
    }
    getSelection() {
      return null;
    }
    getText() {
      return '';
    }
    getLength() {
      return 1;
    }
    setText() {
      this.root.innerHTML = '<p><br></p>';
    }
    deleteText() {}
    insertText() {}
    setSelection() {}
  }
  return { __esModule: true, default: MockQuill };
});

import {
  ComposeQuillEditor,
  type ComposeQuillEditorHandle,
} from '@/components/email/compose-quill-editor';

const EXPECTED_TOOLBAR = [
  [{ header: [1, 2, 3, false] }],
  ['bold', 'italic', 'underline', 'strike'],
  [{ list: 'ordered' }, { list: 'bullet' }],
  [{ indent: '-1' }, { indent: '+1' }],
  ['blockquote', 'code-block'],
  ['link', 'image'],
  [{ color: [] }, { background: [] }],
  [{ align: [] }],
  ['clean'],
];

describe('ComposeQuillEditor', () => {
  beforeEach(() => {
    mockQuillInstances.length = 0;
  });

  test('mounts Quill with the compose toolbar and placeholder', () => {
    render(<ComposeQuillEditor value="" onChange={jest.fn()} />);

    expect(mockQuillInstances).toHaveLength(1);
    const inst = mockQuillInstances[0]!;
    expect(inst.options.placeholder).toBe('Nachricht verfassen…');
    expect(inst.options.modules.toolbar.container).toEqual(EXPECTED_TOOLBAR);
  });

  test('forwards editor changes to onChange, normalizing empty content to ""', () => {
    const onChange = jest.fn();
    render(<ComposeQuillEditor value="" onChange={onChange} />);
    const inst = mockQuillInstances[0]!;

    inst.root.innerHTML = '<p>Hallo Welt</p>';
    act(() => inst.handlers['text-change']!());
    expect(onChange).toHaveBeenCalledWith('<p>Hallo Welt</p>');

    inst.root.innerHTML = '<p><br></p>';
    act(() => inst.handlers['text-change']!());
    expect(onChange).toHaveBeenLastCalledWith('');
  });

  test('getHtml() handle returns editor HTML and "" for the empty placeholder', () => {
    const ref = createRef<ComposeQuillEditorHandle>();
    render(<ComposeQuillEditor value="" onChange={jest.fn()} ref={ref} />);
    const inst = mockQuillInstances[0]!;

    inst.root.innerHTML = '<p>Text</p>';
    expect(ref.current!.getHtml()).toBe('<p>Text</p>');

    inst.root.innerHTML = '<p><br></p>';
    expect(ref.current!.getHtml()).toBe('');
  });
});
