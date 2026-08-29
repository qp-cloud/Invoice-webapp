import { useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api } from '../api/client.js';
import type { LowStockRow, MonthlyReport, OversoldRow } from '../api/types.js';
import { qty, thb } from '../lib/fmt.js';

function thisMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

export function ReportsPage(): JSX.Element {
  const [ym, setYm] = useState(thisMonth());
  const [monthly, setMonthly] = useState<MonthlyReport | null>(null);
  const [lowStock, setLowStock] = useState<LowStockRow[]>([]);
  const [oversold, setOversold] = useState<OversoldRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<MonthlyReport>(`/reports/monthly?ym=${ym}`)
      .then(setMonthly)
      .catch((e: unknown) => setError(String(e)));
  }, [ym]);

  useEffect(() => {
    api.get<LowStockRow[]>('/reports/low-stock').then(setLowStock).catch(() => undefined);
    api.get<OversoldRow[]>('/reports/oversold').then(setOversold).catch(() => undefined);
  }, []);

  const chartData = useMemo(
    () =>
      (monthly?.rows ?? []).map((r) => ({
        sku: r.sku,
        ซื้อ: r.purchasesValueSatang / 100,
        ขาย: r.salesRevenueSatang / 100,
        กำไร: r.estimatedGrossProfitSatang / 100,
      })),
    [monthly],
  );

  return (
    <div className="mx-auto max-w-6xl p-8">
      <h1 className="text-2xl font-semibold">รายงาน</h1>

      <div className="mt-4 flex items-center gap-2 text-sm">
        <label>เดือน</label>
        <input
          type="month"
          className="rounded border px-2 py-1"
          value={ym}
          onChange={(e) => setYm(e.target.value)}
        />
      </div>

      {error && <p className="mt-3 text-red-600">{error}</p>}

      {monthly && (
        <>
          <section className="mt-6">
            <h2 className="mb-2 font-semibold">มูลค่าซื้อ / ขาย / กำไร ต่อ SKU (บาท)</h2>
            <div className="h-72 w-full rounded-lg border bg-white p-2">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="sku" fontSize={12} />
                  <YAxis fontSize={12} />
                  <Tooltip formatter={(v: number) => v.toLocaleString('en-US')} />
                  <Legend />
                  <Bar dataKey="ซื้อ" fill="#94a3b8" />
                  <Bar dataKey="ขาย" fill="#0f172a" />
                  <Bar dataKey="กำไร" fill="#22c55e" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>

          <section className="mt-6 overflow-x-auto">
            <h2 className="mb-2 font-semibold">รายเดือน {monthly.ym}</h2>
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b text-left text-slate-500">
                  <th className="px-2 py-1">SKU</th>
                  <th className="px-2 text-right">ยอดยกมา</th>
                  <th className="px-2 text-right">ซื้อ (จำนวน)</th>
                  <th className="px-2 text-right">มูลค่าซื้อ</th>
                  <th className="px-2 text-right">ขาย (จำนวน)</th>
                  <th className="px-2 text-right">รายได้</th>
                  <th className="px-2 text-right">COGS โดยประมาณ</th>
                  <th className="px-2 text-right">กำไรขั้นต้น</th>
                  <th className="px-2 text-right">มาร์จิน %</th>
                  <th className="px-2 text-right">ยอดยกไป</th>
                </tr>
              </thead>
              <tbody>
                {monthly.rows.map((r) => (
                  <tr key={r.productId} className="border-b tabular-nums">
                    <td className="px-2 py-1 font-mono">{r.sku}</td>
                    <td className="px-2 text-right">{qty(r.openingQty)}</td>
                    <td className="px-2 text-right">{qty(r.purchasesQty)}</td>
                    <td className="px-2 text-right">{thb(r.purchasesValueSatang)}</td>
                    <td className="px-2 text-right">{qty(r.salesQty)}</td>
                    <td className="px-2 text-right">{thb(r.salesRevenueSatang)}</td>
                    <td className="px-2 text-right">{thb(r.estimatedCogsSatang)}</td>
                    <td className="px-2 text-right">{thb(r.estimatedGrossProfitSatang)}</td>
                    <td className="px-2 text-right">
                      {r.grossMarginPct === null ? '—' : `${r.grossMarginPct}%`}
                    </td>
                    <td className="px-2 text-right">{qty(r.closingQty)}</td>
                  </tr>
                ))}
                {monthly.rows.length === 0 && (
                  <tr>
                    <td colSpan={10} className="py-6 text-center text-slate-400">
                      ไม่มีความเคลื่อนไหวในเดือนนี้
                    </td>
                  </tr>
                )}
              </tbody>
              {monthly.rows.length > 0 && (
                <tfoot>
                  <tr className="border-t-2 font-semibold tabular-nums">
                    <td className="px-2 py-1">รวม</td>
                    <td />
                    <td />
                    <td className="px-2 text-right">{thb(monthly.totals.purchasesValueSatang)}</td>
                    <td />
                    <td className="px-2 text-right">{thb(monthly.totals.salesRevenueSatang)}</td>
                    <td className="px-2 text-right">{thb(monthly.totals.estimatedCogsSatang)}</td>
                    <td className="px-2 text-right">
                      {thb(monthly.totals.estimatedGrossProfitSatang)}
                    </td>
                    <td className="px-2 text-right">
                      {monthly.totals.grossMarginPct === null
                        ? '—'
                        : `${monthly.totals.grossMarginPct}%`}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              )}
            </table>
          </section>
        </>
      )}

      <div className="mt-8 grid gap-6 md:grid-cols-2">
        <section>
          <h2 className="mb-2 font-semibold">🟡 สินค้าใกล้หมด ({lowStock.length})</h2>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b text-left text-slate-500">
                <th className="px-2 py-1">SKU</th>
                <th className="px-2 text-right">คงเหลือ</th>
                <th className="px-2 text-right">Min</th>
                <th className="px-2 text-right">ขาด</th>
              </tr>
            </thead>
            <tbody>
              {lowStock.map((r) => (
                <tr key={r.productId} className="border-b tabular-nums">
                  <td className="px-2 py-1 font-mono">{r.sku}</td>
                  <td className="px-2 text-right">{qty(r.qtyOnHand)}</td>
                  <td className="px-2 text-right">{qty(r.minStock)}</td>
                  <td className="px-2 text-right">{qty(r.shortfall)}</td>
                </tr>
              ))}
              {lowStock.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-4 text-center text-slate-400">
                    ไม่มี
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>

        <section>
          <h2 className="mb-2 font-semibold">🔴 ขายเกินสต็อก ({oversold.length})</h2>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b text-left text-slate-500">
                <th className="px-2 py-1">SKU</th>
                <th className="px-2 text-right">คงเหลือ</th>
                <th className="px-2 text-right">Missing Balance</th>
              </tr>
            </thead>
            <tbody>
              {oversold.map((r) => (
                <tr key={r.productId} className="border-b tabular-nums">
                  <td className="px-2 py-1 font-mono">{r.sku}</td>
                  <td className="px-2 text-right text-red-600">{qty(r.qtyOnHand)}</td>
                  <td className="px-2 text-right">{qty(r.missingBalance)}</td>
                </tr>
              ))}
              {oversold.length === 0 && (
                <tr>
                  <td colSpan={3} className="py-4 text-center text-slate-400">
                    ไม่มี
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
}
