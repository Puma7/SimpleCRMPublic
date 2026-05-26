import { formatAiUserError } from '../../electron/email/ai-error-format';

describe('formatAiUserError', () => {
  it('maps abort/timeout to German guidance', () => {
    const err = new Error('The operation was aborted');
    const msg = formatAiUserError(err);
    expect(msg).toContain('Zeitlimit');
    expect(msg).toContain('Antwort entwerfen');
  });

  it('maps TimeoutError DOMException', () => {
    const err = new DOMException('signal timed out', 'TimeoutError');
    const msg = formatAiUserError(err);
    expect(msg).toContain('Zeitlimit');
  });

  it('passes through API error text', () => {
    const msg = formatAiUserError(new Error('KI-Anfrage fehlgeschlagen: 401 invalid key'));
    expect(msg).toContain('401');
  });

  it('reformats legacy stored abort message', () => {
    const msg = formatAiUserError('operation was aborted');
    expect(msg).toContain('abgebrochen');
  });
});
