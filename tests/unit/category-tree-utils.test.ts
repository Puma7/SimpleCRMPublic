import {
  flatToReorderUpdates,
  flattenCategoryTree,
  indentFlatCategory,
} from '../../src/components/email/category-tree-utils';
import type { CategoryRow } from '../../src/components/email/types';

const sample: CategoryRow[] = [
  { id: 1, parent_id: null, name: 'A', sort_order: 0, created_at: 't' },
  { id: 2, parent_id: 1, name: 'B', sort_order: 0, created_at: 't' },
  { id: 3, parent_id: null, name: 'C', sort_order: 1, created_at: 't' },
];

describe('category-tree-utils', () => {
  it('flattenCategoryTree preserves hierarchy order', () => {
    const flat = flattenCategoryTree(sample);
    expect(flat.map((c) => c.id)).toEqual([1, 2, 3]);
    expect(flat.find((c) => c.id === 2)?.depth).toBe(1);
  });

  it('flatToReorderUpdates assigns parent and sort_order', () => {
    const flat = flattenCategoryTree(sample);
    const updates = flatToReorderUpdates(flat);
    expect(updates).toEqual([
      { id: 1, parentId: null, sortOrder: 0 },
      { id: 2, parentId: 1, sortOrder: 0 },
      { id: 3, parentId: null, sortOrder: 1 },
    ]);
  });

  it('indentFlatCategory increases depth under previous row', () => {
    const flat = flattenCategoryTree(sample);
    const next = indentFlatCategory(flat, 3);
    expect(next.find((c) => c.id === 3)?.depth).toBe(2);
  });
});
