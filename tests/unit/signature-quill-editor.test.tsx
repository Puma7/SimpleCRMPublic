import { SIGNATURE_QUILL_TOOLBAR } from '../../shared/signature-quill-toolbar';
import { COMPOSE_DRAFT_AUTOSAVE_DEBOUNCE_MS } from '../../shared/compose-autosave';

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
