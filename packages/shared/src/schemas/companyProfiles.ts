import { z } from 'zod';
import { zUuid } from './common.js';
import { printSettingsSchema } from './printSettings.js';

const profileFields = {
  code: z.string().trim().min(1).max(20).regex(/^[A-Za-z0-9_-]+$/, 'รหัสบริษัทใช้ได้เฉพาะ A-Z, 0-9, _ และ -'),
  name: z.string().trim().min(1).max(200),
  nameEn: z.string().trim().max(200).default(''),
  taxId: z.string().trim().regex(/^$|^\d{13}$/, 'เลขประจำตัวผู้เสียภาษีต้อง 13 หลัก').default(''),
  branch: z.string().trim().max(50).default('สำนักงานใหญ่'),
  address: z.string().trim().max(500).default(''),
  phone: z.string().trim().max(50).default(''),
  printSettings: printSettingsSchema.optional(),
};

export const createCompanyProfileSchema = z.object(profileFields);
export type CreateCompanyProfileInput = z.infer<typeof createCompanyProfileSchema>;

export const updateCompanyProfileSchema = z.object({
  code: profileFields.code.optional(),
  name: profileFields.name.optional(),
  nameEn: profileFields.nameEn.optional(),
  taxId: profileFields.taxId.optional(),
  branch: profileFields.branch.optional(),
  address: profileFields.address.optional(),
  phone: profileFields.phone.optional(),
  printSettings: printSettingsSchema.optional(),
  active: z.boolean().optional(),
}).refine((value) => Object.keys(value).length > 0, 'no fields to update');
export type UpdateCompanyProfileInput = z.infer<typeof updateCompanyProfileSchema>;

export const companyProfileIdSchema = z.object({ id: zUuid });
