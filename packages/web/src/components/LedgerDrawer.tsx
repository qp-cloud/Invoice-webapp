import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import type { LedgerResponse, Product } from '../api/types.js';
import { dateTh, movementLabel, qty, thb } from '../lib/fmt.js';
import { Drawer } from './Drawer.js';

interface Props {
  product: Product;
  onClose: () => void;
}

export function LedgerDrawer({ product, onClose }: Props): JSX.Element {
  const [data, setData] = useState<LedgerResponse | null>(null);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<LedgerResponse>(`/products/${product.id}/ledger?page=${page}&pageSize=50`)
      .then(setData)
      .catch((e: unknown) => setError(String(e)));
  }, [product.id, page]);

  return (
    <Drawer open title={`บัญชีเคลื่อนไหว — ${product.sku}`} onClose={onClose}>
      {error && <p className="text-red-600">{error}</p>}
      {data && (
        <div className="text-sm">
          <div className="mb-2 rounded bg-slate-100 px-3 py-2">
            ยอดยกมา (หน้านี้): <span className="font-semibold">{qty(data.openingBalance)}</span>
            <span className="mx-2">·</span>
            คงเหลือปัจจุบัน: <span className="font-semibold">{qty(data.currentStock)}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b text-left text-slate-500">
                  <th className="py-1">วันที่</th>
                  <th>ประเภท</th>
                  <th className="text-right">จำนวน</th>
                  <th className="text-right">คงเหลือ</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr
                    key={r.id}
                    className={`border-b ${r.status === 'VOIDED' ? 'text-slate-400 line-through' : ''}`}
                  >
                    <td className="py-1">{dateTh(r.occurredOn)}</td>
                    <td>
                      {movementLabel(r.type)}
                      {r.unitCostSatang != null && (
                        <span className="ml-1 text-xs text-slate-400">@{thb(r.unitCostSatang)}</span>
                      )}
                    </td>
                    <td className="text-right">{qty(r.quantity)}</td>
                    <td className="text-right">{r.status === 'ACTIVE' ? qty(r.runningBalance) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex items-center justify-between">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              className="rounded border px-3 py-1 disabled:opacity-40"
            >
              ก่อนหน้า
            </button>
            <span className="text-slate-500">
              {data.page} / {Math.max(1, Math.ceil(data.total / data.pageSize))}
            </span>
            <button
              type="button"
              disabled={page >= Math.ceil(data.total / data.pageSize)}
              onClick={() => setPage((p) => p + 1)}
              className="rounded border px-3 py-1 disabled:opacity-40"
            >
              ถัดไป
            </button>
          </div>
        </div>
      )}
    </Drawer>
  );
}
