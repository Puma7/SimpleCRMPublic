import { parseSpamScore, clampScore, formatMetadataForSpamPrompt } from '../../packages/core/src/workflow';

describe('workflow ai score', () => {
  test('parseSpamScore extracts first number', () => {
    expect(parseSpamScore('87')).toBe(87);
    expect(parseSpamScore('Die Wahrscheinlichkeit ist 42')).toBe(42);
    expect(parseSpamScore('99.')).toBe(99);
  });

  test('parseSpamScore clamps and defaults', () => {
    expect(parseSpamScore('')).toBe(50);
    expect(parseSpamScore('200')).toBe(100);
    expect(clampScore(0)).toBe(1);
  });

  test('formatMetadataForSpamPrompt omits body', () => {
    const text = formatMetadataForSpamPrompt({
      subject: 'Rechnung Mai',
      snippet: 'Kurztext',
      from_address: 'a@b.de',
      to_address: 'inbox@firma.de',
      cc_address: '',
      has_attachments: 'true',
      attachment_names: 'r.pdf',
      attachment_types: 'application/pdf',
    });
    expect(text).toContain('Betreff: Rechnung Mai');
    expect(text).toContain('Volltext wurde aus Datenschutzgründen nicht');
    expect(text).not.toContain('body_text');
  });
});
