import {
  COMPOSE_DIALOG_DEFAULT_HEIGHT_VH,
  COMPOSE_DIALOG_DEFAULT_WIDTH_VW,
} from '../../src/components/email/use-compose-dialog-size';

describe('compose dialog size', () => {
  it('defaults to near-full viewport width and 88vh height', () => {
    expect(COMPOSE_DIALOG_DEFAULT_WIDTH_VW).toBe(96);
    expect(COMPOSE_DIALOG_DEFAULT_HEIGHT_VH).toBe(88);
  });
});
