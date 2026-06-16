import {
  COMPOSE_DIALOG_DEFAULT_HEIGHT_VH,
  COMPOSE_DIALOG_DEFAULT_WIDTH_VW,
  COMPOSE_DIALOG_VISIBLE_HEIGHT_VH,
} from '../../src/components/email/use-compose-dialog-size';

describe('compose dialog size', () => {
  it('defaults to 96vw width and 88vh visible height', () => {
    expect(COMPOSE_DIALOG_DEFAULT_WIDTH_VW).toBe(96);
    expect(COMPOSE_DIALOG_VISIBLE_HEIGHT_VH).toBe(88);
    expect(COMPOSE_DIALOG_DEFAULT_HEIGHT_VH).toBe(92);
  });
});
