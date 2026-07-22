import React from 'react';
import { render, screen } from '@testing-library/react';

jest.mock('@/components/followup/priority-indicator', () => ({
  PriorityIndicator: () => <span data-testid="priority" />,
}));

jest.mock('@/components/followup/snooze-popover', () => ({
  SnoozePopover: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { ExecutionList } from '@/components/followup/execution-list';
import type { FollowUpItem } from '@/services/data/types';

const item: FollowUpItem = {
  item_id: 7,
  source_type: 'task',
  customer_id: 3,
  customer_name: 'Anna Meyer',
  customer_company: 'Meyer GmbH',
  title: 'Rueckruf',
  reason: 'Heute faellig',
  due_date: '2099-07-22T08:00:00.000Z',
  priority: 'High',
  priority_score: 30,
  completed: false,
};

test('shows customer company in the follow-up execution list', () => {
  render(
    <ExecutionList
      items={[item]}
      loading={false}
      selectedItem={null}
      selectedItemIds={new Set()}
      activeQueue="heute"
      onItemSelect={jest.fn()}
      onItemToggleSelect={jest.fn()}
      onComplete={jest.fn()}
      onSnooze={jest.fn()}
      onQueueSwitch={jest.fn()}
    />,
  );

  expect(screen.getByText('Anna Meyer')).toBeTruthy();
  expect(screen.getByText('Meyer GmbH')).toBeTruthy();
});

test('does not repeat the company when it is already the customer display name', () => {
  render(
    <ExecutionList
      items={[{ ...item, customer_name: 'Meyer GmbH' }]}
      loading={false}
      selectedItem={null}
      selectedItemIds={new Set()}
      activeQueue="heute"
      onItemSelect={jest.fn()}
      onItemToggleSelect={jest.fn()}
      onComplete={jest.fn()}
      onSnooze={jest.fn()}
      onQueueSwitch={jest.fn()}
    />,
  );

  expect(screen.getAllByText('Meyer GmbH')).toHaveLength(1);
});
