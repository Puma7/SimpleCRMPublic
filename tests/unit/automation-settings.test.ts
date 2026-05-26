import {
  parseScopesInput,
  parseScopesForKeyGeneration,
} from '../../electron/automation/settings';

jest.mock('../../electron/sqlite-service', () => ({
  getSyncInfo: jest.fn(() => null),
  setSyncInfo: jest.fn(),
}));

jest.mock('../../electron/automation/automation-keytar', () => ({
  loadApiCredentials: jest.fn(async () => null),
  keyPreview: jest.fn(() => '****'),
}));

describe('automation settings scopes', () => {
  test('parseScopesInput defaults when empty', () => {
    expect(parseScopesInput(undefined)).toEqual(['read', 'write', 'email', 'workflows']);
  });

  test('parseScopesForKeyGeneration requires explicit scopes', () => {
    expect(parseScopesForKeyGeneration([])).toEqual([]);
    expect(parseScopesForKeyGeneration(['read', 'invalid' as 'read'])).toEqual(['read']);
  });
});
