import { createRef } from 'react';
import { act, render } from '@testing-library/react';

const mockQuillInstances: Array<{
  root: HTMLDivElement;
  options: any;
  handlers: Record<string, (...a: any[]) => void>;
  focus: jest.Mock;
  getSelection: jest.Mock;
  getLength: jest.Mock;
  setSelection: jest.Mock;
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
    focus = jest.fn();
    getSelection = jest.fn(() => null);
    getText() {
      return '';
    }
    getLength = jest.fn(() => 1);
    setText() {
      this.root.innerHTML = '<p><br></p>';
    }
    deleteText() {}
    insertText() {}
    setSelection = jest.fn();
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

  test('focus() focuses Quill and moves an unknown selection to the document end', () => {
    const ref = createRef<ComposeQuillEditorHandle>();
    render(<ComposeQuillEditor value="" onChange={jest.fn()} ref={ref} />);
    const inst = mockQuillInstances[0]!;
    inst.getLength.mockReturnValue(8);

    expect(ref.current!.focus()).toBe(true);
    expect(inst.focus).toHaveBeenCalledTimes(1);
    expect(inst.setSelection).toHaveBeenCalledWith(7, 0, 'api');
  });

  test('focus() returns false after the editor unmounts', () => {
    const ref = createRef<ComposeQuillEditorHandle>();
    const { unmount } = render(<ComposeQuillEditor value="" onChange={jest.fn()} ref={ref} />);
    const handle = ref.current!;

    unmount();

    expect(handle.focus()).toBe(false);
  });

  test('sanitizes external HTML, editor changes, and imperative output', () => {
    const onChange = jest.fn();
    const ref = createRef<ComposeQuillEditorHandle>();
    render(
      <ComposeQuillEditor
        value={'<p>Safe</p><img src="x" onerror="alert(1)"><script>alert(2)</script>'}
        onChange={onChange}
        ref={ref}
      />,
    );
    const inst = mockQuillInstances[0]!;

    expect(inst.root.innerHTML).toContain('<p>Safe</p>');
    expect(inst.root.innerHTML).not.toMatch(/onerror|script/i);

    inst.root.innerHTML = '<p onclick="alert(3)">Changed</p><script>alert(4)</script>';
    act(() => inst.handlers['text-change']!());
    expect(onChange).toHaveBeenLastCalledWith('<p>Changed</p>');
    expect(ref.current!.getHtml()).toBe('<p>Changed</p>');
  });
});
