import { z } from 'zod';
import { zIsoDate, zQtyString, zSatangNonNeg, zSignedQtyString, zUuid } from './common.js';

const baseDoc = {
  occurredOn: zIsoDate,
  productId: zUuid,
  note: z.string().max(500).optional(),
  /** Required when the transaction date is far enough in the past (spec §6.3). */
  backdateReason: z.string().max(500).optional(),
};

export const createPurchaseSchema = z.object({
  ...baseDoc,
  quantity: zQtyString.refine((s) => s !== '0', 'quantity must be > 0'),
  unitCostSatang: zSatangNonNeg,
  invoiceNo: z.string().max(100).optional(),
  supplier: z.string().max(200).optional(),
});
export type CreatePurchaseInput = z.infer<typeof createPurchaseSchema>;

export const createSaleSchema = z.object({
  ...baseDoc,
  quantity: zQtyString.refine((s) => s !== '0', 'quantity must be > 0'),
  unitPriceSatang: zSatangNonNeg,
  billNo: z.string().max(100).optional(),
  channel: z.string().max(100).optional(),
});
export type CreateSaleInput = z.infer<typeof createSaleSchema>;

export const createReturnSchema = z
  .object({
    ...baseDoc,
    kind: z.enum(['CUSTOMER', 'SUPPLIER']),
    quantity: zQtyString.refine((s) => s !== '0', 'quantity must be > 0'),
    unitCostSatang: zSatangNonNeg.optional(),
    linkedSaleId: zUuid.optional(),
    linkedPurchaseId: zUuid.optional(),
    reason: z.string().max(200).optional(),
  })
  .refine((v) => v.kind !== 'CUSTOMER' || v.unitCostSatang !== undefined, {
    message: 'unitCostSatang is required for a customer return',
    path: ['unitCostSatang'],
  });
export type CreateReturnInput = z.infer<typeof createReturnSchema>;

export const createAdjustmentSchema = z
  .object({
    ...baseDoc,
    quantityDelta: zSignedQtyString,
    reasonCode: z.enum(['STOCK_COUNT', 'DAMAGED', 'LOST', 'FOUND_EXTRA', 'CORRECTION', 'OTHER']),
    unitCostSatang: zSatangNonNeg.optional(),
  })
  .refine((v) => v.quantityDelta.startsWith('-') || v.unitCostSatang !== undefined, {
    message: 'unitCostSatang is required for a positive adjustment',
    path: ['unitCostSatang'],
  });
export type CreateAdjustmentInput = z.infer<typeof createAdjustmentSchema>;

export const voidDocumentSchema = z.object({
  kind: z.enum(['purchase', 'sale', 'return', 'adjustment']),
  reason: z.string().min(1).max(500),
});
export type VoidDocumentInput = z.infer<typeof voidDocumentSchema>;

export const createOpeningSchema = z.object({
  productId: zUuid,
  quantity: zQtyString,
  unitCostSatang: zSatangNonNeg,
  occurredOn: zIsoDate,
});
