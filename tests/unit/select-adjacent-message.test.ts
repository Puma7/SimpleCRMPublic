import {
  pickAdjacentMessageId,
  pickBulkAdvanceAnchorId,
} from '../../src/components/email/select-adjacent-message';

const msgs = [{ id: 1 }, { id: 2 }, { id: 3 }];

describe('pickAdjacentMessageId', () => {
  test('picks next below when removing middle', () => {
    expect(pickAdjacentMessageId(msgs, 2)).toBe(3);
  });

  test('picks previous when removing last', () => {
    expect(pickAdjacentMessageId(msgs, 3)).toBe(2);
  });

  test('picks next when removing first', () => {
    expect(pickAdjacentMessageId(msgs, 1)).toBe(2);
  });

  test('returns null for single-item list', () => {
    expect(pickAdjacentMessageId([{ id: 1 }], 1)).toBeNull();
  });

  test('returns null for empty list', () => {
    expect(pickAdjacentMessageId([], 1)).toBeNull();
  });

  test('falls back to first when removed id not in list', () => {
    expect(pickAdjacentMessageId(msgs, 99)).toBe(1);
  });
});

describe('pickBulkAdvanceAnchorId', () => {
  test('prefers focused id when in selection', () => {
    expect(pickBulkAdvanceAnchorId(msgs, new Set([1, 2]), 2)).toBe(2);
  });

  test('uses first in list order when focus not in selection', () => {
    expect(pickBulkAdvanceAnchorId(msgs, new Set([2, 3]), 1)).toBe(2);
  });
});
