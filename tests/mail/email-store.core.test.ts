import { createSqliteMock } from './helpers/sqlite-mock';

const { db, stmt } = createSqliteMock();
jest.mock('../../electron/sqlite-service', () => ({
  getDb: () => db,
}));

import {
  POP3_UID_CEILING,
  allocatePop3NegativeUid,
  addMessageTag,
  getEmailMessageById,
  listTagsForMessage,
  removeMessageTag,
  setMessageArchived,
  setMessageSeenLocal,
  setMessageSpam,
  setOutboundHold,
} from '../../electron/email/email-store';

describe('email-store core helpers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    stmt.all.mockReturnValue([]);
    stmt.get.mockReturnValue(undefined);
    stmt.run.mockReturnValue({ changes: 1, lastInsertRowid: 1 });
  });

  test('POP3_UID_CEILING and allocatePop3NegativeUid', () => {
    expect(POP3_UID_CEILING).toBe(-1_000_000);
    stmt.get.mockReturnValueOnce({ m: -1_000_005 });
    const uid = allocatePop3NegativeUid(1, 2);
    expect(uid).toBe(-1_000_006);
  });

  test('message flag helpers run updates', () => {
    setMessageArchived(1, true);
    setMessageSeenLocal(1, true);
    setMessageSpam(1, true);
    setOutboundHold(1, true, 'reason');
    expect(db.prepare).toHaveBeenCalled();
  });

  test('tags add list remove', () => {
    stmt.all.mockReturnValueOnce([{ tag: 'a' }]);
    expect(listTagsForMessage(3)).toEqual(['a']);
    addMessageTag(3, 'b');
    removeMessageTag(3, 'a');
    expect(getEmailMessageById(999)).toBeUndefined();
  });
});
