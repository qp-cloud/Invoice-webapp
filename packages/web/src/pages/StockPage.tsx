import { useCallback, useEffect, useState } from 'react';
import { api, ApiRequestError } from '../api/client.js';
import type { Category, Page, Product, Unit } from '../api/types.js';
import { EditProductDrawer } from '../components/EditProductDrawer.js';
import { LedgerDrawer } from '../components/LedgerDrawer.js';
import { TransactionDrawer, type TxnKind } from '../components/TransactionDrawer.js';
import { qty } from '../lib/fmt.js';

const STATUS_BADGE: Record<Product['stock']['status'], string> = {
  normal: '🟢 ปกติ',
  low: '🟡 เตือนสั่งซื้อ',
  out: '🔴 สินค้าหมด',
};

type SortKey = 'sku' | 'name' | 'qtyOnHand' | 'minStock' | 'updatedAt';

interface DrawerState {
  product: Product;
  view: 'ledger' | 'edit' | TxnKind;
}

export function StockPage(): JSX.Element {
  const [page, setPage] = useState<Page<Product> | null>(null);
  const [units, setUnits] = useState<Unit[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<DrawerState | null>(null);

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [lowOnly, setLowOnly] = useState(false);
  const [oversoldOnly, setOversoldOnly] = useState(false);
  const [sort, setSort] = useState<SortKey>('sku');
  const [dir, setDir] = useState<'asc' | 'desc'>('asc');
  const [pageNo, setPageNo] = useState(1);

  const [form, setForm] = useState({ sku: '', name: '', unitCode: 'piece', minStock: '0' });

  const load = useCallback(() => {
    const p = new URLSearchParams({
      page: String(pageNo),
      pageSize: '20',
      sort,
      dir,
    });
    if (search.trim()) p.set('q', search.trim());
    if (status) p.set('status', status);
    if (categoryId) p.set('categoryId', categoryId);
    if (lowOnly) p.set('lowStockOnly', 'true');
    if (oversoldOnly) p.set('oversoldOnly', 'true');
    api
      .get<Page<Product>>(`/products?${p.toString()}`)
      .then(setPage)
      .catch((e: unknown) => setError(String(e)));
  }, [pageNo, sort, dir, search, status, categoryId, lowOnly, oversoldOnly]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    api.get<Unit[]>('/units').then(setUnits).catch(() => undefined);
    api.get<Category[]>('/categories').then(setCategories).catch(() => undefined);
  }, []);

  const refresh = (): void => {
    setDrawer(null);
    load();
  };

  const addProduct = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    try {
      await api.post('/products', form);
      setForm({ sku: '', name: '', unitCode: form.unitCode, minStock: '0' });
      load();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.api.message : String(err));
    }
  };

  const toggleSort = (key: SortKey): void => {
    if (sort === key) setDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSort(key);
      setDir('asc');
    }
  };

  const labels = page?.labels;
  const rows = page?.rows ?? [];
  const totalPages = page?.totalPages ?? 1;

  return (
    <div className="mx-auto max-w-6xl p-8">
      <h1 className="text-2xl font-semibold">สินค้า (Master)</h1>

      <form
        onSubmit={addProduct}
        className="mt-4 flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4"
      >
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

      <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
        <input
          className="rounded border px-2 py-1"
          placeholder="ค้นหา SKU หรือชื่อ"
          value={search}
          onChange={(e) => {
            setPageNo(1);
            setSearch(e.target.value);
          }}
        />
        <select
          className="rounded border px-2 py-1"
          value={status}
          onChange={(e) => {
            setPageNo(1);
            setStatus(e.target.value);
          }}
        >
          <option value="">ทุกสถานะ</option>
          <option value="normal">🟢 ปกติ</option>
          <option value="low">🟡 เตือนสั่งซื้อ</option>
          <option value="out">🔴 สินค้าหมด</option>
        </select>
        <select
          className="rounded border px-2 py-1"
          value={categoryId}
          onChange={(e) => {
            setPageNo(1);
            setCategoryId(e.target.value);
          }}
        >
          <option value="">ทุกหมวดหมู่</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={lowOnly}
            onChange={(e) => {
              setPageNo(1);
              setLowOnly(e.target.checked);
            }}
          />
          ใกล้หมดเท่านั้น
        </label>
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={oversoldOnly}
            onChange={(e) => {
              setPageNo(1);
              setOversoldOnly(e.target.checked);
            }}
          />
          ขายเกินเท่านั้น
        </label>
      </div>

      {error && <p className="mt-3 text-red-600">{error}</p>}

      <div className="mt-4 overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b text-left text-slate-500">
              <Th onClick={() => toggleSort('sku')} active={sort === 'sku'} dir={dir}>
                SKU
              </Th>
              <Th onClick={() => toggleSort('name')} active={sort === 'name'} dir={dir}>
                ชื่อสินค้า
              </Th>
              <th className="px-2">หน่วย</th>
              <th className="px-2 text-right">{labels?.stock68 ?? 'Stock 68'}</th>
              <th className="px-2 text-right">{labels?.purchases ?? 'ซื้อเข้า'}</th>
              <th className="px-2 text-right">{labels?.sales ?? 'ขายออก'}</th>
              <Th onClick={() => toggleSort('qtyOnHand')} active={sort === 'qtyOnHand'} dir={dir} right>
                สต็อกคงเหลือ
              </Th>
              <th className="px-2 text-right">ส่วนต่าง (+/−)</th>
              <Th onClick={() => toggleSort('minStock')} active={sort === 'minStock'} dir={dir} right>
                Min
              </Th>
              <th className="px-2">สถานะ</th>
              <th className="px-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id} className="border-b align-top">
                <td className="px-2 py-2 font-mono">{p.sku}</td>
                <td className="px-2">{p.name}</td>
                <td className="px-2">{p.unitCode}</td>
                <td className="px-2 text-right tabular-nums">{qty(p.fyView?.stock68 ?? '0')}</td>
                <td className="px-2 text-right tabular-nums">{qty(p.fyView?.purchasesCfy ?? '0')}</td>
                <td className="px-2 text-right tabular-nums">{qty(p.fyView?.salesCfy ?? '0')}</td>
                <td className="px-2 text-right tabular-nums">{qty(p.stock.qtyOnHand)}</td>
                <td className="px-2 text-right tabular-nums">{qty(p.fyView?.variance ?? '0')}</td>
                <td className="px-2 text-right tabular-nums">{qty(p.minStock)}</td>
                <td className="px-2">
                  {STATUS_BADGE[p.stock.status]}
                  {p.stock.oversold && (
                    <div className="text-xs text-red-600">
                      🚨 สต็อกติดลบ (ขายเกิน) · Missing Balance {qty(p.stock.missingBalance)}
                    </div>
                  )}
                </td>
                <td className="px-2">
                  <div className="flex flex-wrap gap-1">
                    <Action onClick={() => setDrawer({ product: p, view: 'purchase' })}>ซื้อ</Action>
                    <Action onClick={() => setDrawer({ product: p, view: 'sale' })}>ขาย</Action>
                    <Action onClick={() => setDrawer({ product: p, view: 'return' })}>รับคืน</Action>
                    <Action onClick={() => setDrawer({ product: p, view: 'adjust' })}>ปรับ</Action>
                    <Action onClick={() => setDrawer({ product: p, view: 'ledger' })}>บัญชี</Action>
                    <Action onClick={() => setDrawer({ product: p, view: 'edit' })}>แก้ไข</Action>
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={11} className="py-6 text-center text-slate-400">
                  ไม่พบสินค้า
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex items-center justify-between text-sm">
        <span className="text-slate-500">
          {page?.total ?? 0} รายการ · หน้า {page?.page ?? 1} / {totalPages}
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={pageNo <= 1}
            onClick={() => setPageNo((n) => n - 1)}
            className="rounded border px-3 py-1 disabled:opacity-40"
          >
            ก่อนหน้า
          </button>
          <button
            type="button"
            disabled={pageNo >= totalPages}
            onClick={() => setPageNo((n) => n + 1)}
            className="rounded border px-3 py-1 disabled:opacity-40"
          >
            ถัดไป
          </button>
        </div>
      </div>

      {drawer?.view === 'ledger' && (
        <LedgerDrawer product={drawer.product} onClose={() => setDrawer(null)} />
      )}
      {drawer?.view === 'edit' && (
        <EditProductDrawer
          product={drawer.product}
          units={units}
          categories={categories}
          onClose={() => setDrawer(null)}
          onDone={refresh}
        />
      )}
      {drawer && drawer.view !== 'ledger' && drawer.view !== 'edit' && (
        <TransactionDrawer
          kind={drawer.view}
          product={drawer.product}
          onClose={() => setDrawer(null)}
          onDone={refresh}
        />
      )}
    </div>
  );
}

function Th({
  children,
  onClick,
  active,
  dir,
  right,
}: {
  children: React.ReactNode;
  onClick: () => void;
  active: boolean;
  dir: 'asc' | 'desc';
  right?: boolean;
}): JSX.Element {
  return (
    <th className={`px-2 ${right ? 'text-right' : ''}`}>
      <button type="button" onClick={onClick} className="font-medium hover:text-slate-900">
        {children}
        {active ? (dir === 'asc' ? ' ▲' : ' ▼') : ''}
      </button>
    </th>
  );
}

function Action({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded border border-slate-300 px-2 py-0.5 text-xs hover:bg-slate-100"
    >
      {children}
    </button>
  );
}
