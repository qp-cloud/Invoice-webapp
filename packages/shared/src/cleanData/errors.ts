/** Field-level sanitization failures (spec §7; codes shared with IMPORT_FORMAT.md §5). */
export type SanitizationCode =
  | 'SKU_REQUIRED'
  | 'NOT_A_NUMBER'
  | 'QUANTITY_PRECISION'
  | 'NEGATIVE_NOT_ALLOWED'
  | 'BAD_DATE';

export class SanitizationError extends Error {
  readonly code: SanitizationCode;
  readonly field?: string;

  constructor(code: SanitizationCode, opts: { field?: string; message?: string } = {}) {
    super(opts.message ?? code);
    this.name = 'SanitizationError';
    this.code = code;
    this.field = opts.field;
  }

  static is(err: unknown): err is SanitizationError {
    return err instanceof SanitizationError;
  }
}

/** Non-fatal notes surfaced in the import preview (IMPORT_FORMAT.md §5). */
export type SanitizationWarningCode = 'DATE_ASSUMED_GREGORIAN';
