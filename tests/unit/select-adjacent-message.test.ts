import {
  advanceSelectionAfterMessageRemoved,
  selectAdjacentAfterBulkRemove,
  selectAdjacentMessageId,
} from '../../src/components/email/select-adjacent-message';

const list = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }];

describe('select-adjacent-message', () => {
  it('selects the message below when not at list end', () => {
    expect(selectAdjacentMessageId(list, 1)).toBe(2);
    expect(selectAdjacentMessageId(list, 2)).toBe(3);
  });

  it('selects the message above at list end', () => {
    expect(selectAdjacentMessageId(list, 4)).toBe(3);
  });

  it('returns null for unknown id or single-item list removal', () => {
    expect(selectAdjacentMessageId(list, 99)).toBeNull();
    expect(selectAdjacentMessageId([{ id: 5 }], 5)).toBeNull();
  });

  it('bulk remove picks below the block, else above', () => {
    expect(selectAdjacentAfterBulkRemove(list, new Set([2, 3]))).toBe(4);
    expect(selectAdjacentAfterBulkRemove(list, new Set([3, 4]))).toBe(2);
    expect(selectAdjacentAfterBulkRemove(list, new Set([1, 2, 3, 4]))).toBeNull();
  });

  it('advanceSelectionAfterMessageRemoved delegates single vs bulk', () => {
    expect(advanceSelectionAfterMessageRemoved(list, 2)).toBe(3);
    expect(advanceSelectionAfterMessageRemoved(list, [2, 3])).toBe(4);
  });
});
