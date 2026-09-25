import {
  getAllCustomers,
  getCustomerById,
  createCustomer,
  updateCustomer,
  deleteCustomer,
  searchCustomers,
} from '../sqlite-service';
import { CustomerHasDependentsError } from '../customer-dependents-error';

export const CustomerService = {
  list(includeCustomFields = false) {
    return getAllCustomers(includeCustomFields);
  },

  getById(id: number) {
    return getCustomerById(id);
  },

  search(query: string, limit = 20) {
    return searchCustomers(query.trim(), Math.min(limit, 100));
  },

  create(data: Record<string, unknown>) {
    if (!data.name || typeof data.name !== 'string' || !data.name.trim()) {
      return { success: false as const, error: 'name ist erforderlich' };
    }
    try {
      const customer = createCustomer(data);
      return { success: true as const, customer };
    } catch (e) {
      return { success: false as const, error: e instanceof Error ? e.message : 'Unbekannter Fehler' };
    }
  },

  update(id: number, data: Record<string, unknown>) {
    try {
      const customer = updateCustomer(id, data);
      if (!customer) return { success: false as const, error: 'Kunde nicht gefunden' };
      return { success: true as const, customer };
    } catch (e) {
      return { success: false as const, error: e instanceof Error ? e.message : 'Unbekannter Fehler' };
    }
  },

  delete(id: number, options: { cascade?: boolean } = {}) {
    try {
      const ok = deleteCustomer(id, { cascade: options.cascade === true });
      return { success: ok, error: ok ? undefined : 'Kunde nicht gefunden' };
    } catch (e) {
      if (e instanceof CustomerHasDependentsError) {
        return { success: false as const, error: e.code, dependents: e.dependents };
      }
      throw e;
    }
  },
};
