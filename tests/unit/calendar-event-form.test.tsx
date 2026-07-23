import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { CalendarEventForm } from '../../src/app/calendar/components/event-form';

jest.mock('../../src/components/customer-combobox', () => ({
  CustomerCombobox: () => <div data-testid="customer-combobox" />,
}));

jest.mock('../../src/components/ui/select', () => ({
  Select: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectValue: () => null,
}));

jest.mock('../../src/components/ui/switch', () => ({
  Switch: ({ checked }: { checked?: boolean }) => <input type="checkbox" checked={checked} readOnly />,
}));

const toast = jest.fn();
jest.mock('../../src/components/ui/use-toast', () => ({
  useToast: () => ({ toast }),
}));

describe('CalendarEventForm task editing', () => {
  beforeEach(() => {
    toast.mockReset();
  });

  test('uses the raw task description and permits a customerless server task', () => {
    const onSubmit = jest.fn();

    render(
      <CalendarEventForm
        initialData={{
          id: 41,
          title: 'Angebot nachfassen',
          start: new Date('2026-07-23T08:00:00.000Z'),
          end: new Date('2026-07-23T09:00:00.000Z'),
          description: 'Kunde anrufen\nKunde: ACME GmbH',
        }}
        initialTaskData={{
          id: 51,
          customer_id: null,
          priority: 'Medium',
          description: 'Kunde anrufen',
          completed: false,
        }}
        requireTaskCustomer={false}
        isEditMode
        onSubmit={onSubmit}
        onCancel={jest.fn()}
      />,
    );

    expect(screen.getByLabelText('Beschreibung')).toHaveValue('Kunde anrufen');
    fireEvent.click(screen.getByRole('button', { name: 'Aktualisieren' }));

    expect(toast).not.toHaveBeenCalled();
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      event: expect.objectContaining({ description: 'Kunde anrufen' }),
      task: expect.objectContaining({
        customer_id: 0,
        description: 'Kunde anrufen',
      }),
    }));
  });
});
