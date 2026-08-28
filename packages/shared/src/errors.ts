/**
 * Shared error-code catalogue (API.md §15). Server services throw `AppError`;
 * the server's error mapper turns it into an HTTP response + Thai user message.
 * The client imports `ErrorCode` to branch on failures.
 */

export const ERROR_CODES = [
  'VALIDATION_FAILED',
  'UNAUTHENTICATED',
  'BAD_PASSPHRASE',
  'SKU_ALREADY_EXISTS',
  'PERIOD_CLOSED',
  'PERIOD_ALREADY_CLOSED',
  'PERIOD_NOT_CLOSED',
  'FY_PERIODS_OPEN',
  'BACKUP_REQUIRED',
  'ALREADY_VOIDED',
  'OPENING_LOCKED',
  'CATEGORY_IN_USE',
  'LAST_REMAINING_COPY',
  'CLOUD_DISABLED',
  'SCHEMA_NEWER_THAN_APP',
  'STOCK_WOULD_GO_NEGATIVE',
  'IMPORT_HAS_INVALID_ROWS',
  'IMPORT_FILE_ALREADY_IMPORTED',
  'BACKUP_INTEGRITY_FAILED',
  'IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_BODY',
  'NOT_FOUND',
  'RATE_LIMITED',
  'CONFLICT',
  'INTERNAL',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

const HTTP_STATUS: Record<ErrorCode, number> = {
  VALIDATION_FAILED: 400,
  UNAUTHENTICATED: 401,
  BAD_PASSPHRASE: 401,
  SKU_ALREADY_EXISTS: 409,
  PERIOD_CLOSED: 409,
  PERIOD_ALREADY_CLOSED: 409,
  PERIOD_NOT_CLOSED: 409,
  FY_PERIODS_OPEN: 409,
  BACKUP_REQUIRED: 409,
  ALREADY_VOIDED: 409,
  OPENING_LOCKED: 409,
  CATEGORY_IN_USE: 409,
  LAST_REMAINING_COPY: 409,
  CLOUD_DISABLED: 409,
  SCHEMA_NEWER_THAN_APP: 409,
  STOCK_WOULD_GO_NEGATIVE: 422,
  IMPORT_HAS_INVALID_ROWS: 422,
  IMPORT_FILE_ALREADY_IMPORTED: 422,
  BACKUP_INTEGRITY_FAILED: 422,
  IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_BODY: 422,
  NOT_FOUND: 404,
  RATE_LIMITED: 429,
  CONFLICT: 409,
  INTERNAL: 500,
};

/** Default Thai user-facing messages. A caller may override per-throw. */
const USER_MESSAGE_TH: Record<ErrorCode, string> = {
  VALIDATION_FAILED: 'ข้อมูลไม่ถูกต้อง',
  UNAUTHENTICATED: 'กรุณาปลดล็อกก่อนใช้งาน',
  BAD_PASSPHRASE: 'รหัสผ่านสำรองข้อมูลไม่ถูกต้อง',
  SKU_ALREADY_EXISTS: 'มี SKU นี้อยู่แล้ว',
  PERIOD_CLOSED: 'งวดนี้ถูกปิดแล้ว ไม่สามารถแก้ไขได้',
  PERIOD_ALREADY_CLOSED: 'งวดนี้ถูกปิดอยู่แล้ว',
  PERIOD_NOT_CLOSED: 'งวดนี้ยังไม่ถูกปิด',
  FY_PERIODS_OPEN: 'ยังมีงวดที่เปิดอยู่ ไม่สามารถปิดปีบัญชีได้',
  BACKUP_REQUIRED: 'ต้องสำรองข้อมูลให้สำเร็จก่อน',
  ALREADY_VOIDED: 'รายการนี้ถูกยกเลิกไปแล้ว',
  OPENING_LOCKED: 'ไม่สามารถแก้ยอดยกมาได้ เนื่องจากมีความเคลื่อนไหวแล้ว',
  CATEGORY_IN_USE: 'หมวดหมู่นี้ถูกใช้งานอยู่',
  LAST_REMAINING_COPY: 'ไม่สามารถลบสำเนาสำรองชุดสุดท้ายได้',
  CLOUD_DISABLED: 'ยังไม่ได้ตั้งค่าการสำรองข้อมูลบนคลาวด์',
  SCHEMA_NEWER_THAN_APP: 'ไฟล์สำรองใหม่กว่ารุ่นโปรแกรม',
  STOCK_WOULD_GO_NEGATIVE: 'ไม่สามารถบันทึกได้ สต็อกจะติดลบ',
  IMPORT_HAS_INVALID_ROWS: 'มีแถวข้อมูลที่ไม่ถูกต้อง',
  IMPORT_FILE_ALREADY_IMPORTED: 'ไฟล์นี้ถูกนำเข้าแล้ว',
  BACKUP_INTEGRITY_FAILED: 'ไฟล์สำรองเสียหาย',
  IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_BODY: 'คำขอซ้ำแต่ข้อมูลไม่ตรงกัน',
  NOT_FOUND: 'ไม่พบข้อมูล',
  RATE_LIMITED: 'พยายามมากเกินไป กรุณารอสักครู่',
  CONFLICT: 'ข้อมูลขัดแย้งกัน',
  INTERNAL: 'เกิดข้อผิดพลาดภายในระบบ',
};

export function httpStatusFor(code: ErrorCode): number {
  return HTTP_STATUS[code];
}

export function defaultUserMessage(code: ErrorCode): string {
  return USER_MESSAGE_TH[code];
}

export interface AppErrorOptions {
  /** Structured, safe-to-return context (no secrets). */
  details?: Record<string, unknown>;
  /** Override the default Thai message. */
  userMessage?: string;
  /** Underlying error for logging. */
  cause?: unknown;
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly httpStatus: number;
  readonly userMessage: string;
  readonly details?: Record<string, unknown>;

  constructor(code: ErrorCode, options: AppErrorOptions = {}) {
    super(options.userMessage ?? defaultUserMessage(code), { cause: options.cause });
    this.name = 'AppError';
    this.code = code;
    this.httpStatus = httpStatusFor(code);
    this.userMessage = options.userMessage ?? defaultUserMessage(code);
    this.details = options.details;
  }

  static is(err: unknown): err is AppError {
    return err instanceof AppError;
  }
}
