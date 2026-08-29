import { toSatang } from '@inventory/shared';
import { useMemo, useState } from 'react';
import { api, ApiRequestError } from '../api/client.js';
import type { Product } from '../api/types.js';
import { qty, thb } from '../lib/fmt.js';
import { Drawer } from './Drawer.js';

export type TxnKind = 'purchase' | 'sale' | 'return' | 'adjust';

const TITLE: Record<TxnKind, string> = {
  purchase: 'บันทึกการซื้อเข้า',
  sale: 'บันทึกการขาย',
  return: 'รับคืนจากลูกค้า',
  adjust: 'ปรับปรุงสต็อก',
};

const REASON_CODES = [
  ['STOCK_COUNT', 'ตรวจนับสต็อก'],
  ['DAMAGED', 'สินค้าเสียหาย'],
  ['LOST', 'สูญหาย'],
  ['FOUND_EXTRA', 'พบเพิ่ม'],
  ['CORRECTION', 'แก้ไขข้อผิดพลาด'],
  ['OTHER', 'อื่น ๆ'],
] as const;

const TODAY = (): string => new Date().toISOString().slice(0, 10);

function toSatangSafe(v: string): number | null {
  const s = v.trim();
  if (s === '') return null;
  try {
    return toSatang(s);
  } catch {
    return null;
  }
}

interface Props {
  kind: TxnKind;
  product: Product;
  onClose: () => void;
  onDone: () => void;
}

export function TransactionDrawer({ kind, product, onClose, onDone }: Props): JSX.Element {
  const [occurredOn, setOccurredOn] = useState(TODAY());
  const [quantity, setQuantity] = useState('');
  const [price, setPrice] = useState(''); // THB, unit cost or selling price
  const [signedDelta, setSignedDelta] = useState(''); // adjust only
  const [reasonCode, setReasonCode] = useState('STOCK_COUNT');
  const [ref1, setRef1] = useState(''); // invoice / bill
  const [ref2, setRef2] = useState(''); // supplier / channel
  const [note, setNote] = useState('');
  const [backdateReason, setBackdateReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const backdated = occurredOn < TODAY();
  const current = product.stock.qtyOnHand;

  const deltaNum = kind === 'adjust' ? Number(signedDelta || '0') : 0;
  const needUnitCost = kind === 'return' || (kind === 'adjust' && deltaNum > 0);

  const unitSatang = toSatangSafe(price);
  const qtyForTotal = kind === 'adjust' ? Math.abs(deltaNum) : Number(quantity || '0');
  const totalSatang = unitSatang != null ? Math.round(unitSatang * qtyForTotal) : null;

  const projected = useMemo(() => {
    const c = Number(current);
    if (kind === 'purchase' || kind === 'return') return c + Number(quantity || '0');
    if (kind === 'sale') return c - Number(quantity || '0');
    return c + deltaNum;
  }, [current, kind, quantity, deltaNum]);

  const wouldGoNegative = projected < 0;

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const base: Record<string, unknown> = { productId: product.id, occurredOn };
      if (note) base.note = note;
      if (backdated && backdateReason) base.backdateReason = backdateReason;

      if (kind === 'purchase') {
        await api.postTxn('/purchases', {
          ...base,
          quantity,
          unitCostSatang: unitSatang,
          invoiceNo: ref1 || undefined,
          supplier: ref2 || undefined,
        });
      } else if (kind === 'sale') {
        await api.postTxn('/sales', {
          ...base,
          quantity,
          unitPriceSatang: unitSatang,
          billNo: ref1 || undefined,
          channel: ref2 || undefined,
        });
      } else if (kind === 'return') {
        await api.postTxn('/returns', {
          ...base,
          kind: 'CUSTOMER',
          quantity,
          unitCostSatang: unitSatang,
        });
      } else {
        await api.postTxn('/adjustments', {
          ...base,
          quantityDelta: signedDelta,
          reasonCode,
          ...(deltaNum > 0 ? { unitCostSatang: unitSatang } : {}),
        });
      }
      onDone();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.api.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const priceLabel = kind === 'sale' ? 'ราคาขาย/หน่วย (บาท)' : 'ต้นทุน/หน่วย (บาท)';

  return (
    <Drawer open title={`${TITLE[kind]} — ${product.sku}`} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-3 text-sm">
        <div className="rounded bg-slate-100 px-3 py-2">
          สต็อกปัจจุบัน: <span className="font-semibold">{qty(current)}</span> {product.unitCode}
        </div>

        <label className="flex flex-col">
          วันที่
          <input
            type="date"
            className="mt-1 rounded border px-2 py-1"
            value={occurredOn}
            onChange={(ev) => setOccurredOn(ev.target.value)}
            required
          />
        </label>
        {backdated && (
          <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-amber-800">
            ⚠️ รายการย้อนหลัง
            <input
              className="mt-1 w-full rounded border px-2 py-1"
              placeholder="เหตุผล (จำเป็นหากย้อนหลังเกินกำหนด)"
              value={backdateReason}
              onChange={(ev) => setBackdateReason(ev.target.value)}
            />
          </div>
        )}

        {kind === 'adjust' ? (
          <>
            <label className="flex flex-col">
              จำนวนที่ปรับ (+/−)
              <input
                className="mt-1 rounded border px-2 py-1"
                placeholder="เช่น -3 หรือ 10"
                value={signedDelta}
                onChange={(ev) => setSignedDelta(ev.target.value)}
                required
              />
            </label>
            <label className="flex flex-col">
              เหตุผล
              <select
                className="mt-1 rounded border px-2 py-1"
                value={reasonCode}
                onChange={(ev) => setReasonCode(ev.target.value)}
              >
                {REASON_CODES.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
          </>
        ) : (
          <label className="flex flex-col">
            จำนวน
            <input
              className="mt-1 rounded border px-2 py-1"
              value={quantity}
              onChange={(ev) => setQuantity(ev.target.value)}
              required
            />
          </label>
        )}

        {kind === 'purchase' || kind === 'sale' || needUnitCost ? (
          <label className="flex flex-col">
            {priceLabel}
            {needUnitCost && <span className="text-xs text-red-600">จำเป็น</span>}
            <input
              className="mt-1 rounded border px-2 py-1"
              value={price}
              onChange={(ev) => setPrice(ev.target.value)}
              required={kind === 'purchase' || kind === 'sale' || needUnitCost}
            />
          </label>
        ) : null}

        {totalSatang != null && (kind === 'purchase' || kind === 'sale') && (
          <div className="rounded bg-slate-100 px-3 py-2">
            {kind === 'sale' ? 'ราคารวม' : 'ต้นทุนรวม'}:{' '}
            <span className="font-semibold">{thb(totalSatang)}</span>
          </div>
        )}

        {kind === 'sale' && wouldGoNegative && (
          <div className="rounded border border-red-300 bg-red-50 px-3 py-2 text-red-700">
            🚨 สต็อกติดลบ (ขายเกิน) — คงเหลือหลังบันทึก {qty(String(projected))}
          </div>
        )}

        {(kind === 'purchase' || kind === 'sale') && (
          <>
            <label className="flex flex-col">
              {kind === 'sale' ? 'เลขที่บิล' : 'เลขที่ใบกำกับ'}
              <input
                className="mt-1 rounded border px-2 py-1"
                value={ref1}
                onChange={(ev) => setRef1(ev.target.value)}
              />
            </label>
            <label className="flex flex-col">
              {kind === 'sale' ? 'ช่องทางขาย' : 'ผู้ขาย'}
              <input
                className="mt-1 rounded border px-2 py-1"
                value={ref2}
                onChange={(ev) => setRef2(ev.target.value)}
              />
            </label>
          </>
        )}

        <label className="flex flex-col">
          หมายเหตุ
          <input
            className="mt-1 rounded border px-2 py-1"
            value={note}
            onChange={(ev) => setNote(ev.target.value)}
          />
        </label>

        <div className="rounded bg-slate-100 px-3 py-2">
          คงเหลือหลังบันทึก (ประมาณ): <span className="font-semibold">{qty(String(projected))}</span>
        </div>

        {error && <p className="text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={busy}
          className="mt-1 rounded bg-slate-900 px-4 py-2 text-white disabled:opacity-50"
        >
          {busy ? 'กำลังบันทึก…' : 'บันทึก'}
        </button>
      </form>
    </Drawer>
  );
}
