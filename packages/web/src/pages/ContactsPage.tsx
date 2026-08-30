import { useCallback, useEffect, useState } from 'react';
import { api, ApiRequestError } from '../api/client.js';
import type { Contact, Page } from '../api/types.js';

const KIND_LABEL: Record<Contact['kind'], string> = {
  SUPPLIER: 'ผู้ขาย / ซัพพลายเออร์',
  CUSTOMER: 'ลูกค้า',
  BOTH: 'ทั้งซื้อและขาย',
};

const empty = { kind: 'SUPPLIER' as Contact['kind'], name: '', taxId: '', branch: 'สำนักงานใหญ่', address: '', phone: '' };

export function ContactsPage(): JSX.Element {
  const [rows, setRows] = useState<Contact[]>([]);
  const [filter, setFilter] = useState<'' | 'SUPPLIER' | 'CUSTOMER'>('');
  const [form, setForm] = useState<typeof empty & { id?: string }>(empty);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    const q = new URLSearchParams({ pageSize: '200' });
    if (filter) q.set('kind', filter);
    api
      .get<Page<Contact>>(`/contacts?${q}`)
      .then((p) => setRows(p.rows))
      .catch((e: unknown) => setError(String(e)));
  }, [filter]);

  useEffect(() => load(), [load]);

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    const body = {
      kind: form.kind,
      name: form.name,
      taxId: form.taxId.trim() || undefined,
      branch: form.branch.trim() || undefined,
      address: form.address.trim() || undefined,
      phone: form.phone.trim() || undefined,
    };
    try {
      if (form.id) await api.patch(`/contacts/${form.id}`, body);
      else await api.post('/contacts', body);
      setForm(empty);
      load();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.api.message : String(err));
    }
  };

  return (
    <div className="mx-auto max-w-5xl p-8">
      <h1 className="text-2xl font-semibold">ผู้ติดต่อ (ผู้ขาย / ลูกค้า)</h1>

      <form onSubmit={submit} className="mt-4 grid grid-cols-2 gap-3 rounded-lg border bg-white p-4 text-sm md:grid-cols-3">
        <label className="flex flex-col">
          ประเภท
          <select className="mt-1 rounded border px-2 py-1" value={form.kind}
            onChange={(e) => setForm({ ...form, kind: e.target.value as Contact['kind'] })}>
            <option value="SUPPLIER">ผู้ขาย</option>
            <option value="CUSTOMER">ลูกค้า</option>
            <option value="BOTH">ทั้งสอง</option>
          </select>
        </label>
        <label className="flex flex-col md:col-span-2">
          ชื่อ *
          <input className="mt-1 rounded border px-2 py-1" required value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </label>
        <label className="flex flex-col">
          เลขประจำตัวผู้เสียภาษี
          <input className="mt-1 rounded border px-2 py-1" value={form.taxId} placeholder="13 หลัก"
            onChange={(e) => setForm({ ...form, taxId: e.target.value })} />
        </label>
        <label className="flex flex-col">
          สาขา
          <input className="mt-1 rounded border px-2 py-1" value={form.branch}
            onChange={(e) => setForm({ ...form, branch: e.target.value })} />
        </label>
        <label className="flex flex-col">
          โทร
          <input className="mt-1 rounded border px-2 py-1" value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        </label>
        <label className="flex flex-col md:col-span-3">
          ที่อยู่
          <input className="mt-1 rounded border px-2 py-1" value={form.address}
            onChange={(e) => setForm({ ...form, address: e.target.value })} />
        </label>
        <div className="flex gap-2 md:col-span-3">
          <button type="submit" className="rounded bg-slate-900 px-4 py-1.5 text-white">
            {form.id ? 'บันทึกการแก้ไข' : 'เพิ่มผู้ติดต่อ'}
          </button>
          {form.id && (
            <button type="button" onClick={() => setForm(empty)} className="rounded border px-4 py-1.5">
              ยกเลิก
            </button>
          )}
        </div>
      </form>

      {error && <p className="mt-3 text-red-600">{error}</p>}

      <div className="mt-4 flex gap-2 text-sm">
        {(['', 'SUPPLIER', 'CUSTOMER'] as const).map((k) => (
          <button key={k} type="button" onClick={() => setFilter(k)}
            className={`rounded border px-3 py-1 ${filter === k ? 'bg-slate-900 text-white' : ''}`}>
            {k === '' ? 'ทั้งหมด' : KIND_LABEL[k]}
          </button>
        ))}
      </div>

      <table className="mt-3 w-full border-collapse text-sm">
        <thead>
          <tr className="border-b text-left text-slate-500">
            <th className="px-2 py-1">ชื่อ</th>
            <th className="px-2">ประเภท</th>
            <th className="px-2">เลขภาษี</th>
            <th className="px-2">สาขา</th>
            <th className="px-2">โทร</th>
            <th className="px-2"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id} className="border-b">
              <td className="px-2 py-1">{c.name}</td>
              <td className="px-2">{KIND_LABEL[c.kind]}</td>
              <td className="px-2 font-mono text-xs">{c.taxId ?? '—'}</td>
              <td className="px-2">{c.branch ?? '—'}</td>
              <td className="px-2">{c.phone ?? '—'}</td>
              <td className="px-2">
                <button type="button" className="text-blue-700 underline"
                  onClick={() => setForm({
                    id: c.id, kind: c.kind, name: c.name, taxId: c.taxId ?? '',
                    branch: c.branch ?? '', address: c.address ?? '', phone: c.phone ?? '',
                  })}>
                  แก้ไข
                </button>
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={6} className="py-6 text-center text-slate-400">ยังไม่มีผู้ติดต่อ</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
