import { z } from 'zod';

/**
 * Tax-invoice print layout, stored as the `print_settings` row in `settings`.
 * Every field has a default so a partial or missing blob still parses.
 */
export const printSettingsSchema = z.object({
  paperSize: z.enum(['A4', 'A5']).default('A4'),
  marginMm: z.coerce.number().min(0).max(40).default(12),
  fontPx: z.coerce.number().min(8).max(20).default(13),
  /** data: URL for the header logo; '' = no logo. Capped to keep /settings small. */
  logoDataUrl: z.string().max(500_000).default(''),
  showLogo: z.boolean().default(true),
  showEnLabels: z.boolean().default(true),
  showSignatures: z.boolean().default(true),
  showCopyBadge: z.boolean().default(true),
  showReference: z.boolean().default(true),
  showVatLine: z.boolean().default(true),
  footerText: z.string().max(2000).default(''),
  showBahtWords: z.boolean().default(true),
});

export type PrintSettings = z.infer<typeof printSettingsSchema>;

/** All defaults, used when the row is absent or fails validation. */
export const defaultPrintSettings = (): PrintSettings => printSettingsSchema.parse({});
