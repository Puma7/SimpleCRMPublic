import { fireEvent, render, screen } from '@testing-library/react';

const mockSetMessageListFilter = jest.fn();

jest.mock('@/components/email/workspace-context', () => ({
  useMailWorkspace: () => ({
    messageListFilter: 'all',
    setMessageListFilter: mockSetMessageListFilter,
  }),
}));

import { MessageFilterChips } from '@/components/email/message-filter-chips';

describe('MessageFilterChips', () => {
  beforeEach(() => {
    mockSetMessageListFilter.mockClear();
  });

  test('renders the five filter chips inside a labelled group', () => {
    render(<MessageFilterChips />);

    expect(screen.getByRole('group', { name: 'Filter' })).toBeInTheDocument();
    for (const label of ['Alle', 'Ungelesen', 'Mit Anhang', 'Kundenverknüpft', 'Workflow betroffen']) {
      expect(screen.getByRole('button', { name: `Filter: ${label}` })).toBeInTheDocument();
    }
  });

  test('clicking a chip sets that filter on the workspace', () => {
    render(<MessageFilterChips />);

    fireEvent.click(screen.getByRole('button', { name: 'Filter: Ungelesen' }));
    expect(mockSetMessageListFilter).toHaveBeenCalledWith('unread');

    fireEvent.click(screen.getByRole('button', { name: 'Filter: Workflow betroffen' }));
    expect(mockSetMessageListFilter).toHaveBeenCalledWith('workflow');
  });
});
