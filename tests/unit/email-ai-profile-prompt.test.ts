import {
  getDefaultAiProfile,
  resolveAiProfile,
  resolvePromptProfileId,
} from '../../electron/email/email-ai-profiles';

const profiles = [
  {
    id: 1,
    label: 'Standard',
    provider: 'openai' as const,
    base_url: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    embedding_model: null,
    keytar_account: 'k1',
    is_default: 1,
    sort_order: 0,
  },
  {
    id: 2,
    label: 'Open Router',
    provider: 'openrouter' as const,
    base_url: 'https://openrouter.ai/api/v1',
    model: 'x',
    embedding_model: null,
    keytar_account: 'k2',
    is_default: 0,
    sort_order: 1,
  },
];

jest.mock('../../electron/sqlite-service', () => {
  const prepare = jest.fn((sql: string) => ({
    all: () => {
      if (sql.includes('is_default DESC')) return [...profiles];
      return [];
    },
    get: (id: number) => profiles.find((p) => p.id === id),
    run: jest.fn(),
  }));
  return {
    getDb: () => ({ prepare }),
    getSyncInfo: jest.fn(() => null),
    setSyncInfo: jest.fn(),
  };
});

jest.mock('../../electron/email/email-ai-keytar', () => ({
  getEmailAiApiKey: jest.fn(async () => null),
  saveEmailAiApiKey: jest.fn(),
}));

describe('resolvePromptProfileId', () => {
  it('uses assigned profile when valid', () => {
    expect(resolvePromptProfileId({ profile_id: 2 })).toBe(2);
  });

  it('falls back to default when profile_id is null', () => {
    expect(resolvePromptProfileId({ profile_id: null })).toBe(1);
  });

  it('falls back to default when profile_id points to missing row', () => {
    expect(resolvePromptProfileId({ profile_id: 99 })).toBe(1);
  });
});

describe('resolveAiProfile', () => {
  it('returns default when id is invalid', () => {
    expect(resolveAiProfile(99)?.id).toBe(getDefaultAiProfile()?.id);
  });
});
