import * as emailStore from '../../electron/email/email-store';

const mockRun = jest.fn();

jest.mock('../../electron/sqlite-service', () => ({
  getDb: () => ({
    prepare: () => ({
      run: (...args: unknown[]) => mockRun(...args),
    }),
  }),
}));

describe('deleteLocalComposeDraft', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects server messages (uid >= 0)', () => {
    jest.spyOn(emailStore, 'getEmailMessageById').mockReturnValue({
      id: 1,
      uid: 42,
    } as emailStore.EmailMessageRow);
    expect(() => emailStore.deleteLocalComposeDraft(1)).toThrow(/lokale Entwürfe/);
  });

  it('deletes local compose draft rows', () => {
    jest.spyOn(emailStore, 'getEmailMessageById').mockReturnValue({
      id: 5,
      uid: -3,
    } as emailStore.EmailMessageRow);
    emailStore.deleteLocalComposeDraft(5);
    expect(mockRun).toHaveBeenCalledWith(5);
  });
});
