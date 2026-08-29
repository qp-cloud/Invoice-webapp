import { useState } from 'react';
import { api, ApiRequestError } from '../api/client.js';
import type { Category, Product, Unit } from '../api/types.js';
import { Drawer } from './Drawer.js';

interface Props {
  product: Product;
  units: Unit[];
  categories: Category[];
  onClose: () => void;
  onDone: () => void;
}

export function EditProductDrawer({ product, units, categories, onClose, onDone }: Props): JSX.Element {
  const [name, setName] = useState(product.name);
  const [unitCode, setUnitCode] = useState(product.unitCode);
  const [categoryId, setCategoryId] = useState(product.categoryId ?? '');
  const [minStock, setMinStock] = useState(product.minStock);
  const [active, setActive] = useState(product.active);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.patch(`/products/${product.id}`, {
        name,
        unitCode,
        categoryId: categoryId || null,
        minStock,
        active,
      });
      onDone();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.api.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer open title={`แก้ไขสินค้า — ${product.sku}`} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-3 text-sm">
        <label className="flex flex-col">
          ชื่อสินค้า
          <input
            className="mt-1 rounded border px-2 py-1"
            value={name}
            onChange={(ev) => setName(ev.target.value)}
            required
          />
        </label>
        <label className="flex flex-col">
          หน่วย
          <select
            className="mt-1 rounded border px-2 py-1"
            value={unitCode}
            onChange={(ev) => setUnitCode(ev.target.value)}
          >
            {units.map((u) => (
              <option key={u.code} value={u.code}>
                {u.nameTh}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col">
          หมวดหมู่
          <select
            className="mt-1 rounded border px-2 py-1"
            value={categoryId}
            onChange={(ev) => setCategoryId(ev.target.value)}
          >
            <option value="">— ไม่ระบุ —</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col">
          Min Stock
          <input
            className="mt-1 w-32 rounded border px-2 py-1"
            value={minStock}
            onChange={(ev) => setMinStock(ev.target.value)}
          />
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={active} onChange={(ev) => setActive(ev.target.checked)} />
          เปิดใช้งาน
        </label>
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
