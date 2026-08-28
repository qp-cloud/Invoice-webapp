import { z } from 'zod';

/** Quantity on the wire is a decimal string with at most 3 dp (API.md §preamble). */
export const zQtyString = z
  .string()
  .regex(/^\d+(\.\d{1,3})?$/, 'must be a non-negative number with up to 3 decimal places');

export const zSignedQtyString = z
  .string()
  .regex(/^-?\d+(\.\d{1,3})?$/, 'must be a number with up to 3 decimal places')
  .refine((s) => s !== '0' && s !== '-0', 'must not be zero');

export const zSatang = z.number().int();
export const zSatangNonNeg = z.number().int().nonnegative();

export const zIsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD');
export const zYearMonth = z.string().regex(/^\d{4}-\d{2}$/, 'must be YYYY-MM');
export const zUuid = z.string().uuid();

/** Query-string booleans: "true"/"false" -> boolean. */
export const zQueryBool = z
  .union([z.boolean(), z.enum(['true', 'false'])])
  .transform((v) => v === true || v === 'true');

export const zPagination = {
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(200).default(50),
};
