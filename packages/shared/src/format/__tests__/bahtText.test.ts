import { describe, expect, it } from 'vitest';
import { bahtText } from '../bahtText.js';

describe('bahtText', () => {
  it('whole baht -> ...บาทถ้วน', () => {
    expect(bahtText(0)).toBe('ศูนย์บาทถ้วน');
    expect(bahtText(100)).toBe('หนึ่งบาทถ้วน');
    expect(bahtText(2500)).toBe('ยี่สิบห้าบาทถ้วน');
  });

  it('เอ็ด / สิบ / ยี่สิบ rules', () => {
    expect(bahtText(1100)).toBe('สิบเอ็ดบาทถ้วน');
    expect(bahtText(1000)).toBe('สิบบาทถ้วน');
    expect(bahtText(2100)).toBe('ยี่สิบเอ็ดบาทถ้วน');
    expect(bahtText(10100)).toBe('หนึ่งร้อยเอ็ดบาทถ้วน');
  });

  it('satang part', () => {
    expect(bahtText(12345)).toBe('หนึ่งร้อยยี่สิบสามบาทสี่สิบห้าสตางค์');
    expect(bahtText(50)).toBe('ศูนย์บาทห้าสิบสตางค์');
    expect(bahtText(2075)).toBe('ยี่สิบบาทเจ็ดสิบห้าสตางค์');
  });

  it('millions', () => {
    expect(bahtText(100_000_000)).toBe('หนึ่งล้านบาทถ้วน');
    expect(bahtText(2_100_000_000)).toBe('ยี่สิบเอ็ดล้านบาทถ้วน');
    expect(bahtText(123_456_789_00)).toBe(
      'หนึ่งร้อยยี่สิบสามล้านสี่แสนห้าหมื่นหกพันเจ็ดร้อยแปดสิบเก้าบาทถ้วน',
    );
  });

  it('negatives', () => {
    expect(bahtText(-2500)).toBe('ลบยี่สิบห้าบาทถ้วน');
  });
});
