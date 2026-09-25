import { IPCChannels } from '@shared/ipc/channels';
import { invokeRenderer, RendererTransportError } from '@/services/transport';

export type CustomerDependents = {
  deals: number;
  tasks: number;
  appointments: number;
};

export type CustomerDeleteOutcome =
  | { deleted: true }
  | { deleted: false; dependents: CustomerDependents };

/**
 * Deletes a customer. Without `cascade` both editions refuse while deals, tasks
 * or appointments still belong to the customer and report their counts, so the
 * UI can ask before deleting them too. The desktop answers with an IPC result,
 * the server with a 409 whose details carry the same counts.
 */
export async function deleteCustomerChecked(
  id: number,
  options: { cascade?: boolean } = {},
): Promise<CustomerDeleteOutcome> {
  let result: unknown;
  try {
    result = options.cascade
      ? await invokeRenderer(IPCChannels.Db.DeleteCustomer, id, { cascade: true })
      : await invokeRenderer(IPCChannels.Db.DeleteCustomer, id);
  } catch (error) {
    if (error instanceof RendererTransportError && error.code === 'customer_has_dependents') {
      const dependents = readDependents(error.details);
      if (dependents) return { deleted: false, dependents };
    }
    throw error;
  }

  if (isRecord(result) && result.success === false) {
    if (result.error === 'customer_has_dependents') {
      const dependents = readDependents(result);
      if (dependents) return { deleted: false, dependents };
    }
    throw new Error(typeof result.error === 'string' && result.error ? result.error : 'Customer delete failed');
  }
  return { deleted: true };
}

/** "2 Deals, 1 Aufgabe und 3 Termine" - only the kinds that exist. */
export function describeCustomerDependents(dependents: CustomerDependents): string {
  const parts = [
    countLabel(dependents.deals, 'Deal', 'Deals'),
    countLabel(dependents.tasks, 'Aufgabe', 'Aufgaben'),
    countLabel(dependents.appointments, 'Termin', 'Termine'),
  ].filter((part): part is string => part !== null);
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} und ${parts[parts.length - 1]}`;
}

export function addCustomerDependents(a: CustomerDependents, b: CustomerDependents): CustomerDependents {
  return {
    deals: a.deals + b.deals,
    tasks: a.tasks + b.tasks,
    appointments: a.appointments + b.appointments,
  };
}

function countLabel(count: number, singular: string, plural: string): string | null {
  if (count <= 0) return null;
  return `${count} ${count === 1 ? singular : plural}`;
}

function readDependents(value: unknown): CustomerDependents | null {
  if (!isRecord(value) || !isRecord(value.dependents)) return null;
  const { deals, tasks, appointments } = value.dependents;
  return {
    deals: Number(deals) || 0,
    tasks: Number(tasks) || 0,
    appointments: Number(appointments) || 0,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
