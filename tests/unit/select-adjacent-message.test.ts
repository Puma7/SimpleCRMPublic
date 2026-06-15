import {
  pickAdjacentMessageId,
  pickBulkAdvanceAnchorId,
  pickBulkAdvanceTargetId,
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

  test('returns null when removed id not in list', () => {
    expect(pickAdjacentMessageId(msgs, 99)).toBeNull();
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

describe('pickBulkAdvanceTargetId', () => {
  const four = [{ id: 10 }, { id: 20 }, { id: 30 }, { id: 40 }];

  test('contiguous selection: picks first row after removed block', () => {
    expect(pickBulkAdvanceTargetId(four, new Set([20, 30]))).toBe(40);
  });

  test('contiguous at end: picks row before block', () => {
    expect(pickBulkAdvanceTargetId(four, new Set([30, 40]))).toBe(20);
  });

  test('non-contiguous selection: picks first remaining in list order', () => {
    expect(pickBulkAdvanceTargetId(four, new Set([10, 40]))).toBe(20);
  });

  test('returns null when all visible rows are selected', () => {
    expect(pickBulkAdvanceTargetId(four, new Set([10, 20, 30, 40]))).toBeNull();
  });

  test('returns null for empty selection', () => {
    expect(pickBulkAdvanceTargetId(four, new Set())).toBeNull();
  });
});
