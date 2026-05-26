import { doneFilterSql } from '../../shared/email-done-filter';

describe('doneFilterSql', () => {
  it('filters open and done in inbox only', () => {
    expect(doneFilterSql('open', 'inbox')).toContain('done_local');
    expect(doneFilterSql('done', 'inbox')).toContain('= 1');
    expect(doneFilterSql('all', 'inbox')).toBe('');
    expect(doneFilterSql('open', 'sent')).toBe('');
  });
});
