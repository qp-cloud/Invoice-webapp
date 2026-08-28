import { describe, expect, it } from 'vitest';
import { AppError, ERROR_CODES, defaultUserMessage, httpStatusFor } from './errors.js';

describe('errors', () => {
  it('maps every code to an http status and a Thai message', () => {
    for (const code of ERROR_CODES) {
      expect(httpStatusFor(code)).toBeGreaterThanOrEqual(400);
      expect(defaultUserMessage(code)).toMatch(/\p{Script=Thai}/u);
    }
  });

  it('AppError carries code, status, message, details', () => {
    const err = new AppError('STOCK_WOULD_GO_NEGATIVE', { details: { shortfall: '8.000' } });
    expect(AppError.is(err)).toBe(true);
    expect(err.code).toBe('STOCK_WOULD_GO_NEGATIVE');
    expect(err.httpStatus).toBe(422);
    expect(err.details).toEqual({ shortfall: '8.000' });
  });

  it('allows a custom user message', () => {
    const err = new AppError('NOT_FOUND', { userMessage: 'ไม่พบสินค้า' });
    expect(err.userMessage).toBe('ไม่พบสินค้า');
  });
});
