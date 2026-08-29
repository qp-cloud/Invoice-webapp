import { AppError } from '@inventory/shared';
import * as XLSX from 'xlsx';

export interface ParsedSheet {
  header: string[];
  body: unknown[][];
}

/**
 * Read the first sheet (or one named `data`) of an .xlsx/.csv buffer into a header row
 * plus an array-of-arrays body (spec §13.2, IMPORT_FORMAT.md preamble).
 */
export function parseWorkbook(buffer: Buffer): ParsedSheet {
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(buffer, { type: 'buffer', cellDates: false, raw: true });
  } catch (cause) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: 'ไม่สามารถอ่านไฟล์ได้ (รองรับ .xlsx และ .csv)',
      details: { code: 'BAD_FILE' },
      cause,
    });
  }
  const sheetName = wb.SheetNames.includes('data') ? 'data' : wb.SheetNames[0];
  const sheet = sheetName ? wb.Sheets[sheetName] : undefined;
  if (!sheet) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: 'ไฟล์ไม่มีข้อมูล',
      details: { code: 'EMPTY_FILE' },
    });
  }
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    blankrows: false,
    defval: null,
  });
  if (rows.length === 0) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: 'ไฟล์ไม่มีข้อมูล',
      details: { code: 'EMPTY_FILE' },
    });
  }
  const [header, ...body] = rows;
  return { header: (header ?? []).map((c) => String(c ?? '')), body };
}
