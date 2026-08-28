import { formatQuantity } from '@inventory/shared';
import { useEffect, useState } from 'react';
import { api, ApiRequestError } from '../api/client.js';
import type { Page, Product, Unit } from '../api/types.js';

const STATUS_LABEL: Record<Product['stock']['status'], string> = {
  normal: '🟢 ปกติ',
  low: '🟡 เตือนสั่งซื้อ',
  out: '🔴 สินค้าหมด / ติดลบ',
};

export function ProductsPage(): JSX.Element {
  const [products, setProducts] = useState<Product[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ sku: '', name: '', unitCode: 'piece', minStock: '0' });

  const reload = (): void => {
    api
      .get<Page<Product>>('/products?pageSize=100&sort=sku')
      .then((p) => setProducts(p.rows))
      .catch((e: unknown) => setError(String(e)));
  };

  useEffect(() => {
    reload();
    api.get<Unit[]>('/units').then(setUnits).catch(() => undefined);
  }, []);

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    try {
      await api.post('/products', form);
      setForm({ sku: '', name: '', unitCode: form.unitCode, minStock: '0' });
      reload();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.api.message : String(err));
    }
  };

  return (
    <div className="mx-auto max-w-5xl p-8">
      <h1 className="text-2xl font-semibold">สินค้า (Master)</h1>

      <form onSubmit={submit} className="mt-4 flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4">
        <label className="flex flex-col text-sm">
          SKU
          <input
            className="mt-1 rounded border px-2 py-1"
            value={form.sku}
            onChange={(e) => setForm({ ...form, sku: e.target.value })}
            required
          />
        </label>
        <label className="flex flex-col text-sm">
          ชื่อสินค้า
          <input
            className="mt-1 rounded border px-2 py-1"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
          />
        </label>
        <label className="flex flex-col text-sm">
          หน่วย
          <select
            className="mt-1 rounded border px-2 py-1"
            value={form.unitCode}
            onChange={(e) => setForm({ ...form, unitCode: e.target.value })}
          >
            {units.map((u) => (
              <option key={u.code} value={u.code}>
                {u.nameTh}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col text-sm">
          Min Stock
          <input
            className="mt-1 w-24 rounded border px-2 py-1"
            value={form.minStock}
            onChange={(e) => setForm({ ...form, minStock: e.target.value })}
          />
        </label>
        <button type="submit" className="rounded bg-slate-900 px-4 py-1.5 text-white">
          เพิ่มสินค้า
        </button>
      </form>

      {error && <p className="mt-3 text-red-600">{error}</p>}

      <table className="mt-6 w-full border-collapse text-sm">
        <thead>
          <tr className="border-b text-left text-slate-500">
            <th className="py-2">SKU</th>
            <th>ชื่อสินค้า</th>
            <th>หน่วย</th>
            <th className="text-right">คงเหลือ</th>
            <th className="text-right">Min</th>
            <th>สถานะ</th>
          </tr>
        </thead>
        <tbody>
          {products.map((p) => (
            <tr key={p.id} className="border-b">
              <td className="py-2 font-mono">{p.sku}</td>
              <td>{p.name}</td>
              <td>{p.unitCode}</td>
              <td className="text-right">{formatQuantity(p.stock.qtyOnHand)}</td>
              <td className="text-right">{formatQuantity(p.minStock)}</td>
              <td>{STATUS_LABEL[p.stock.status]}</td>
            </tr>
          ))}
          {products.length === 0 && (
            <tr>
              <td colSpan={6} className="py-6 text-center text-slate-400">
                ยังไม่มีสินค้า
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
