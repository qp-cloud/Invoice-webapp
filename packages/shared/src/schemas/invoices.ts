import { z } from 'zod';
import { zIsoDate, zPagination, zQtyString, zSatangNonNeg, zUuid, zYearMonth } from './common.js';

const thaiTaxId = z.string().regex(/^\d{13}$/, 'เลขประจำตัวผู้เสียภาษีต้อง 13 หลัก');

export const contactKind = z.enum(['SUPPLIER', 'CUSTOMER', 'BOTH']);

export const createContactSchema = z.object({
  kind: contactKind,
  name: z.string().min(1).max(200),
  taxId: thaiTaxId.optional(),
  branch: z.string().max(50).optional(),
  address: z.string().max(500).optional(),
  phone: z.string().max(50).optional(),
  note: z.string().max(500).optional(),
});
export type CreateContactInput = z.infer<typeof createContactSchema>;

export const updateContactSchema = createContactSchema.partial().extend({
  active: z.boolean().optional(),
}).refine((v) => Object.keys(v).length > 0, 'no fields to update');
export type UpdateContactInput = z.infer<typeof updateContactSchema>;

export const listContactsQuerySchema = z.object({
  kind: z.enum(['SUPPLIER', 'CUSTOMER']).optional(),
  q: z.string().optional(),
  active: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
  ...zPagination,
});
export type ListContactsQuery = z.infer<typeof listContactsQuerySchema>;

export const vatRate = z.union([z.literal(0), z.literal(7)]);
const paymentMethod = z.enum(['CHEQUE', 'TRANSFER', 'CASH']);
const invoicePrintFields = {
  attention: z.string().max(200).optional(),
  salesperson: z.string().max(200).optional(),
  dueDate: zIsoDate.optional(),
  paymentMethod: paymentMethod.optional(),
  bankName: z.string().max(200).optional(),
  bankBranch: z.string().max(200).optional(),
  chequeNo: z.string().max(100).optional(),
  paymentDate: zIsoDate.optional(),
  paymentAmountSatang: zSatangNonNeg.optional(),
  collector: z.string().max(200).optional(),
};

export const invoiceLineSchema = z.object({
  productId: zUuid,
  description: z.string().max(300).optional(),
  quantity: zQtyString.refine((s) => s !== '0', 'quantity must be > 0'),
  unitPriceSatang: zSatangNonNeg, // ex-VAT
  vatRate: vatRate.default(7),
});
export type InvoiceLineInput = z.infer<typeof invoiceLineSchema>;

export const createInvoiceSchema = z.object({
  docType: z.enum(['BUY', 'SELL']),
  companyProfileId: zUuid.optional(),
  contactId: zUuid,
  issueDate: zIsoDate,
  referenceNo: z.string().max(100).optional(),
  note: z.string().max(500).optional(),
  ...invoicePrintFields,
  lines: z.array(invoiceLineSchema).min(1).optional(),
});
export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>;

export const updateInvoiceSchema = z.object({
  companyProfileId: zUuid.optional(),
  contactId: zUuid.optional(),
  issueDate: zIsoDate.optional(),
  referenceNo: z.string().max(100).optional(),
  note: z.string().max(500).optional(),
  ...invoicePrintFields,
  lines: z.array(invoiceLineSchema).min(1).optional(),
}).refine((v) => Object.keys(v).length > 0, 'no fields to update');
export type UpdateInvoiceInput = z.infer<typeof updateInvoiceSchema>;

export const listInvoicesQuerySchema = z.object({
  companyProfileId: zUuid.optional(),
  docType: z.enum(['BUY', 'SELL']).optional(),
  status: z.enum(['DRAFT', 'CONFIRMED', 'VOID']).optional(),
  contactId: zUuid.optional(),
  from: zIsoDate.optional(),
  to: zIsoDate.optional(),
  q: z.string().optional(), // invoice_number / contact name
  ...zPagination,
});
export type ListInvoicesQuery = z.infer<typeof listInvoicesQuerySchema>;

export const voidInvoiceSchema = z.object({ reason: z.string().min(1).max(500) });

export const vatReportQuerySchema = z.object({ ym: zYearMonth, companyProfileId: zUuid.optional() });
