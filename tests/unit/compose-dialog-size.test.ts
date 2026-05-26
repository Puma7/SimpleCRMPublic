import { COMPOSE_DIALOG_DEFAULT_WIDTH } from '../../src/components/email/use-compose-dialog-size';

describe('compose dialog size', () => {
  it('defaults wider than legacy max-w-4xl (896px)', () => {
    expect(COMPOSE_DIALOG_DEFAULT_WIDTH).toBeGreaterThan(896);
  });
});
