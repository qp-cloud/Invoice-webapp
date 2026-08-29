import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import type { Dashboard } from '../api/types.js';
import { qty, thb } from '../lib/fmt.js';

interface Card {
  label: string;
  value: string;
  tone?: 'warn' | 'danger';
}

export function DashboardPage(): JSX.Element {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<Dashboard>('/dashboard')
      .then(setData)
      .catch((e: unknown) => setError(String(e)));
  }, []);

  if (error) return <p className="p-8 text-red-600">{error}</p>;
  if (!data) return <p className="p-8 text-slate-400">กำลังโหลด…</p>;

  const fy = String(data.fiscalYear).slice(-2);
  const cards: Card[] = [
    { label: 'สต็อกยกมา (Stock 68)', value: qty(data.stock68Qty) },
    { label: `ซื้อเข้า ${fy} (จำนวน)`, value: qty(data.purchasesCfyQty) },
    { label: 'มูลค่าซื้อเข้า', value: thb(data.purchasesCfyValueSatang, true) },
    { label: `ขายออก ${fy} (จำนวน)`, value: qty(data.salesCfyQty) },
    { label: 'รายได้จากการขาย', value: thb(data.salesRevenueSatang, true) },
    { label: 'สต็อกคงเหลือรวม', value: qty(data.currentStockQty) },
    { label: 'ต้นทุนขายโดยประมาณ (COGS)', value: thb(data.estimatedCogsSatang, true) },
    { label: 'กำไรขั้นต้นโดยประมาณ', value: thb(data.estimatedGrossProfitSatang, true) },
    {
      label: 'SKU ขายเกินสต็อก',
      value: String(data.oversoldSkuCount),
      tone: data.oversoldSkuCount > 0 ? 'danger' : undefined,
    },
    {
      label: 'SKU ใกล้หมด',
      value: String(data.lowStockSkuCount),
      tone: data.lowStockSkuCount > 0 ? 'warn' : undefined,
    },
  ];

  return (
    <div className="mx-auto max-w-6xl p-8">
      <h1 className="text-2xl font-semibold">แดชบอร์ด</h1>
      <p className="mt-1 text-sm text-slate-500">
        ปีบัญชี {data.fiscalYear} · ข้อมูล ณ {new Date(data.asOf).toLocaleString('th-TH')}
      </p>
      <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
        {cards.map((c) => (
          <div
            key={c.label}
            className={`rounded-lg border p-4 ${
              c.tone === 'danger'
                ? 'border-red-300 bg-red-50'
                : c.tone === 'warn'
                  ? 'border-amber-300 bg-amber-50'
                  : 'border-slate-200 bg-white'
            }`}
          >
            <div className="text-xs text-slate-500">{c.label}</div>
            <div className="mt-2 text-xl font-semibold tabular-nums">{c.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
