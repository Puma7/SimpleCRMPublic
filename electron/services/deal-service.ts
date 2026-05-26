import {
  getAllDeals,
  getDealById,
  createDeal,
  updateDeal,
  updateDealStage,
  deleteDeal,
} from '../sqlite-service';
import { coercePositiveInt } from '../automation/http-response';

export const DealService = {
  list(opts: { limit?: number; offset?: number; customerId?: number } = {}) {
    const filter: { customer_id?: number } = {};
    if (opts.customerId != null) filter.customer_id = opts.customerId;
    return getAllDeals(opts.limit, opts.offset, filter);
  },

  getById(id: number) {
    return getDealById(id);
  },

  create(data: Record<string, unknown>) {
    const customerId = coercePositiveInt(data.customer_id);
    if (customerId == null || !data.name || typeof data.name !== 'string' || !data.name.trim()) {
      return { success: false as const, error: 'customer_id (positive Ganzzahl) und name sind erforderlich' };
    }
    return createDeal({ ...data, customer_id: customerId, name: data.name.trim() });
  },

  update(id: number, data: Record<string, unknown>) {
    return updateDeal(id, data);
  },

  updateStage(id: number, stage: string) {
    if (!stage?.trim()) return { success: false as const, error: 'stage ist erforderlich' };
    return updateDealStage(id, stage.trim());
  },

  delete(id: number) {
    return deleteDeal(id);
  },
};
