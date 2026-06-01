/**
 * @jest-environment node
 */
import { bulkSetMessagesDoneLocal } from '../../electron/email/email-store';

const mockRun = jest.fn();

jest.mock('../../electron/sqlite-service', () => ({
  getDb: () => ({
    prepare: () => ({
      run: (...args: unknown[]) => {
        mockRun(...args);
        return { changes: 2 };
      },
    }),
  }),
}));

describe('bulkSetMessagesDoneLocal', () => {
  beforeEach(() => mockRun.mockClear());

  test('updates done flag for message ids', () => {
    const n = bulkSetMessagesDoneLocal([1, 2], true, 3);
    expect(n).toBe(2);
    expect(mockRun).toHaveBeenCalledWith(1, 3, 1, 2);
  });
});
