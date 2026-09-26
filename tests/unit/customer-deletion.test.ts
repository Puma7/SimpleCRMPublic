const mockInvoke = jest.fn();

jest.mock('@/services/transport', () => {
  class RendererTransportError extends Error {
    readonly status?: number;
    readonly code?: string;
    readonly details?: unknown;

    constructor(message: string, options: { status?: number; code?: string; details?: unknown } = {}) {
      super(message);
      this.status = options.status;
      this.code = options.code;
      this.details = options.details;
    }
  }
  return {
    RendererTransportError,
    invokeRenderer: (...args: unknown[]) => mockInvoke(...args),
  };
});

import { IPCChannels } from '@shared/ipc/channels';
import { RendererTransportError } from '@/services/transport';
import {
  deleteCustomerChecked,
  describeCustomerDependents,
} from '@/services/data/customerDeletion';

// F-A10-10: both editions refuse to delete a customer with deals, tasks or
// appointments until the user confirms; the renderer reads the counts from the
// desktop IPC result and from the server's 409 alike.
describe('deleteCustomerChecked', () => {
  const dependents = { deals: 2, tasks: 1, appointments: 3 };

  beforeEach(() => mockInvoke.mockReset());

  test('reports dependents from the desktop IPC result', async () => {
    mockInvoke.mockResolvedValueOnce({ success: false, error: 'customer_has_dependents', dependents });

    await expect(deleteCustomerChecked(7)).resolves.toEqual({ deleted: false, dependents });
    expect(mockInvoke).toHaveBeenCalledWith(IPCChannels.Db.DeleteCustomer, 7);
  });

  test('reports dependents from the server 409', async () => {
    mockInvoke.mockRejectedValueOnce(new RendererTransportError('Konflikt', {
      status: 409,
      code: 'customer_has_dependents',
      details: { dependents },
    }));

    await expect(deleteCustomerChecked(7)).resolves.toEqual({ deleted: false, dependents });
  });

  test('sends the cascade confirmation and reports success', async () => {
    mockInvoke.mockResolvedValueOnce({ success: true });

    await expect(deleteCustomerChecked(7, { cascade: true })).resolves.toEqual({ deleted: true });
    expect(mockInvoke).toHaveBeenCalledWith(IPCChannels.Db.DeleteCustomer, 7, { cascade: true });
  });

  test('rethrows other failures', async () => {
    mockInvoke.mockResolvedValueOnce({ success: false, error: 'Kunde nicht gefunden' });
    await expect(deleteCustomerChecked(7)).rejects.toThrow('Kunde nicht gefunden');

    mockInvoke.mockRejectedValueOnce(new RendererTransportError('weg', { status: 404, code: 'customer_not_found' }));
    await expect(deleteCustomerChecked(7)).rejects.toThrow('weg');
  });

  test('describes the dependents in German', () => {
    expect(describeCustomerDependents(dependents)).toBe('2 Deals, 1 Aufgabe und 3 Termine');
    expect(describeCustomerDependents({ deals: 1, tasks: 0, appointments: 0 })).toBe('1 Deal');
    expect(describeCustomerDependents({ deals: 0, tasks: 2, appointments: 1 })).toBe('2 Aufgaben und 1 Termin');
  });
});
