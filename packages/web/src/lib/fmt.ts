import { asSatang, formatQuantity, formatThb, toBuddhistDisplay } from '@inventory/shared';

/** `12345` satang -> `123.45` (spec §19.4). */
export function thb(satang: number, withSymbol = false): string {
  return formatThb(asSatang(Math.round(satang)), { withSymbol });
}

export function qty(value: string): string {
  return formatQuantity(value);
}

/** ISO `YYYY-MM-DD` -> Buddhist `DD/MM/2569`. */
export function dateTh(iso: string): string {
  return iso ? toBuddhistDisplay(iso) : '';
}

const MOVEMENT_LABEL: Record<string, string> = {
  OPENING: 'ยอดยกมา',
  PURCHASE: 'ซื้อเข้า',
  SALE: 'ขายออก',
  CUSTOMER_RETURN: 'รับคืนจากลูกค้า',
  SUPPLIER_RETURN: 'คืนผู้ขาย',
  TRANSFER_IN: 'โอนเข้า',
  TRANSFER_OUT: 'โอนออก',
  DAMAGE: 'เสียหาย',
  ADJUSTMENT: 'ปรับปรุงสต็อก',
};

export function movementLabel(type: string): string {
  return MOVEMENT_LABEL[type] ?? type;
}
