jest.mock('../../electron/sqlite-service', () => ({
  getSyncInfo: jest.fn((key: string) => (key === 'workflow_spam_score_threshold' ? '82' : null)),
}));

import { getWorkflowSpamScoreThreshold } from '../../electron/workflow/automation-settings';

describe('workflow automation settings', () => {
  test('getWorkflowSpamScoreThreshold reads sync_info', () => {
    expect(getWorkflowSpamScoreThreshold()).toBe(82);
  });
});
