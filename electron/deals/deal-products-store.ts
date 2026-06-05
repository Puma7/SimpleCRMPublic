import { DEAL_PRODUCTS_TABLE } from '../database-schema';
import { getDb } from '../sqlite-service';

export type DealProductLookupRow = {
  id?: number;
  deal_id?: number;
  price_at_time_of_adding?: number;
};

export function getDealIdForDealProduct(dealProductId: number): number | undefined {
  const row = getDb()
    .prepare(`SELECT deal_id FROM ${DEAL_PRODUCTS_TABLE} WHERE id = ?`)
    .get(dealProductId) as DealProductLookupRow | undefined;
  return row?.deal_id;
}

export function findDealProductId(dealId: number, productId: number): number | undefined {
  const row = getDb()
    .prepare(`SELECT id FROM ${DEAL_PRODUCTS_TABLE} WHERE deal_id = ? AND product_id = ?`)
    .get(dealId, productId) as DealProductLookupRow | undefined;
  return row?.id;
}

export function getDealProductPriceAndDealId(dealProductId: number): DealProductLookupRow | undefined {
  return getDb()
    .prepare(`SELECT price_at_time_of_adding, deal_id FROM ${DEAL_PRODUCTS_TABLE} WHERE id = ?`)
    .get(dealProductId) as DealProductLookupRow | undefined;
}

export function updateDealProductStoredPrice(input: {
  dealId: number;
  productId: number;
  price: number;
}): void {
  getDb()
    .prepare(
      `UPDATE ${DEAL_PRODUCTS_TABLE}
       SET price_at_time_of_adding = @price
       WHERE deal_id = @dealId AND product_id = @productId`,
    )
    .run({
      price: input.price,
      dealId: input.dealId,
      productId: input.productId,
    });
}
