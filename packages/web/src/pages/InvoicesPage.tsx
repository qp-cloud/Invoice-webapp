import { toSatang } from '@inventory/shared';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiRequestError, exportUrl } from '../api/client.js';
import type { Contact, InvoiceDetail, InvoiceListRow, Page, Product } from '../api/types.js';
import { dateTh, thb } from '../lib/fmt.js';

type DocType = 'BUY' | 'SELL';
const TODAY = (): string => new Date().toISOString().slice(0, 10);

interface EditLine {
  productId: string;
  quantity: string;
  priceThb: string; // ex-VAT, as ฿
  vatRate: 0 | 7;
}
const blankLine = (): EditLine => ({ productId: '', quantity: '1', priceThb: '', vatRate: 7 });

const STATUS_BADGE: Record<string, string> = {
  DRAFT: '📝 ร่าง', CONFIRMED: '✅ ยืนยันแล้ว', VOID: '❌ ยกเลิก',
};

export function InvoicesPage({ onPrint }: { onPrint: (id: string) => void }): JSX.Element {
  const [view, setView] = useState<'list' | 'edit'>('list');
  const [rows, setRows] = useState<InvoiceListRow[]>([]);
  const [typeFilter, setTypeFilter] = useState<'' | DocType>('');
  const [products, setProducts] = useState<Product[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [error, setError] = useState<string | null>(null);

  // editor state
  const [editId, setEditId] = useState<string | null>(null);
  const [docType, setDocType] = useState<DocType>('BUY');
  const [contactId, setContactId] = useState('');
  const [issueDate, setIssueDate] = useState(TODAY());
  const [referenceNo, setReferenceNo] = useState('');
  const [lines, setLines] = useState<EditLine[]>([blankLine()]);
  const [busy, setBusy] = useState(false);

  const loadList = useCallback(() => {
    const q = new URLSearchParams({ pageSize: '100' });
    if (typeFilter) q.set('docType', typeFilter);
    api.get<Page<InvoiceListRow>>(`/invoices?${q}`).then((p) => setRows(p.rows)).catch((e) => setError(String(e)));
  }, [typeFilter]);

  useEffect(() => {
    if (view === 'list') loadList();
  }, [view, loadList]);
  useEffect(() => {
    api.get<Page<Product>>('/products?pageSize=1000&sort=sku').then((p) => setProducts(p.rows)).catch(() => undefined);
    api.get<Page<Contact>>('/contacts?pageSize=500').then((p) => setContacts(p.rows)).catch(() => undefined);
  }, []);

  const contactChoices = contacts.filter(
    (c) => c.kind === 'BOTH' || c.kind === (docType === 'BUY' ? 'SUPPLIER' : 'CUSTOMER'),
  );

  const totals = useMemo(() => {
    let net = 0;
    let vat = 0;
    for (const l of lines) {
      const price = Number(l.priceThb || '0') * 100;
      const q = Number(l.quantity || '0');
      const n = Math.round(price * q);
      net += n;
      vat += Math.round((n * l.vatRate) / 100);
    }
    return { net, vat, total: net + vat };
  }, [lines]);

  const startNew = (t: DocType): void => {
    setEditId(null);
    setDocType(t);
    setContactId('');
    setIssueDate(TODAY());
    setReferenceNo('');
    setLines([blankLine()]);
    setError(null);
    setView('edit');
  };

  const openEdit = async (id: string): Promise<void> => {
    setError(null);
    const d = await api.get<InvoiceDetail>(`/invoices/${id}`);
    setEditId(id);
    setDocType(d.invoice.docType);
    setContactId(d.invoice.contactId);
    setIssueDate(d.invoice.issueDate);
    setReferenceNo(d.invoice.referenceNo ?? '');
    setLines(
      d.lines.length
        ? d.lines.map((l) => ({
            productId: l.productId,
            quantity: l.quantity,
            priceThb: (l.unitPriceSatang / 100).toString(),
            vatRate: l.vatRate as 0 | 7,
          }))
        : [blankLine()],
    );
    setView(d.invoice.status === 'DRAFT' ? 'edit' : 'list');
    if (d.invoice.status !== 'DRAFT') onPrint(id);
  };

  const payloadLines = (): unknown[] =>
    lines
      .filter((l) => l.productId && Number(l.quantity) > 0)
      .map((l) => ({
        productId: l.productId,
        quantity: l.quantity,
        unitPriceSatang: toSatang(l.priceThb || '0'),
        vatRate: l.vatRate,
      }));

  const save = async (confirm: boolean): Promise<void> => {
    setError(null);
    setBusy(true);
    try {
      const body = { docType, contactId, issueDate, referenceNo: referenceNo || undefined, lines: payloadLines() };
      let id = editId;
      if (id) await api.patch(`/invoices/${id}`, { contactId, issueDate, referenceNo: referenceNo || undefined, lines: body.lines });
      else {
        const created = await api.post<{ id: string }>('/invoices', body);
        id = created.id;
      }
      if (confirm && id) {
        await api.commitImport(`/invoices/${id}/confirm`, {});
        onPrint(id);
      }
      setView('list');
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.api.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const voidInvoice = async (id: string): Promise<void> => {
    const reason = window.prompt('เหตุผลการยกเลิก');
    if (!reason) return;
    try {
      await api.commitImport(`/invoices/${id}/void`, { reason });
      loadList();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.api.message : String(err));
    }
  };

  if (view === 'edit') {
    const prod = (id: string): Product | undefined => products.find((p) => p.id === id);
    return (
      <div className="mx-auto max-w-4xl p-8">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">
            {editId ? 'แก้ไข' : 'สร้าง'}ใบกำกับภาษี{docType === 'BUY' ? 'ซื้อ' : 'ขาย'}
          </h1>
          <button type="button" className="text-sm text-slate-500 underline" onClick={() => setView('list')}>
            กลับ
          </button>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-3 rounded-lg border bg-white p-4 text-sm">
          <label className="flex flex-col">
            {docType === 'BUY' ? 'ผู้ขาย' : 'ลูกค้า'} *
            <select className="mt-1 rounded border px-2 py-1" value={contactId} onChange={(e) => setContactId(e.target.value)}>
              <option value="">— เลือก —</option>
              {contactChoices.map((c) => (
                <option key={c.id} value={c.id}>{c.name}{c.taxId ? ` (${c.taxId})` : ''}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col">
            วันที่
            <input type="date" className="mt-1 rounded border px-2 py-1" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
          </label>
          <label className="flex flex-col">
            เลขที่อ้างอิง{docType === 'BUY' ? ' (บิลผู้ขาย)' : ''}
            <input className="mt-1 rounded border px-2 py-1" value={referenceNo} onChange={(e) => setReferenceNo(e.target.value)} />
          </label>
        </div>

        <table className="mt-4 w-full border-collapse text-sm">
          <thead>
            <tr className="border-b text-left text-slate-500">
              <th className="px-2 py-1">สินค้า</th>
              <th className="px-2 text-right">จำนวน</th>
              <th className="px-2 text-right">ราคา/หน่วย (฿, ไม่รวม VAT)</th>
              <th className="px-2">VAT</th>
              <th className="px-2 text-right">รวม</th>
              <th className="px-2"></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => {
              const price = Number(l.priceThb || '0') * 100;
              const n = Math.round(price * Number(l.quantity || '0'));
              const lineTotal = n + Math.round((n * l.vatRate) / 100);
              return (
                <tr key={i} className="border-b">
                  <td className="px-2 py-1">
                    <select className="w-full rounded border px-1 py-1" value={l.productId}
                      onChange={(e) => {
                        const p = prod(e.target.value);
                        const def = docType === 'BUY' ? p?.stock.avgCostSatang : undefined;
                        setLines(lines.map((x, j) => j === i
                          ? { ...x, productId: e.target.value, priceThb: x.priceThb || (def ? (def / 100).toString() : '') }
                          : x));
                      }}>
                      <option value="">— เลือกสินค้า —</option>
                      {products.map((p) => <option key={p.id} value={p.id}>{p.sku} · {p.name}</option>)}
                    </select>
                  </td>
                  <td className="px-2 text-right">
                    <input className="w-20 rounded border px-1 py-1 text-right" value={l.quantity}
                      onChange={(e) => setLines(lines.map((x, j) => j === i ? { ...x, quantity: e.target.value } : x))} />
                  </td>
                  <td className="px-2 text-right">
                    <input className="w-28 rounded border px-1 py-1 text-right" value={l.priceThb}
                      onChange={(e) => setLines(lines.map((x, j) => j === i ? { ...x, priceThb: e.target.value } : x))} />
                  </td>
                  <td className="px-2">
                    <select className="rounded border px-1 py-1" value={l.vatRate}
                      onChange={(e) => setLines(lines.map((x, j) => j === i ? { ...x, vatRate: Number(e.target.value) as 0 | 7 } : x))}>
                      <option value={7}>7%</option>
                      <option value={0}>0% (ส่งออก)</option>
                    </select>
                  </td>
                  <td className="px-2 text-right tabular-nums">{thb(lineTotal)}</td>
                  <td className="px-2">
                    {lines.length > 1 && (
                      <button type="button" className="text-red-600" onClick={() => setLines(lines.filter((_, j) => j !== i))}>✕</button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <button type="button" className="mt-2 rounded border px-3 py-1 text-sm" onClick={() => setLines([...lines, blankLine()])}>
          + เพิ่มรายการ
        </button>

        <div className="mt-4 ml-auto w-64 rounded-lg border bg-white p-3 text-sm tabular-nums">
          <div className="flex justify-between"><span>รวมเงิน</span><span>{thb(totals.net)}</span></div>
          <div className="flex justify-between"><span>ภาษีมูลค่าเพิ่ม 7%</span><span>{thb(totals.vat)}</span></div>
          <div className="mt-1 flex justify-between border-t pt-1 font-semibold"><span>ยอดสุทธิ</span><span>{thb(totals.total)}</span></div>
        </div>

        {error && <p className="mt-3 text-red-600">{error}</p>}

        <div className="mt-4 flex gap-2">
          <button type="button" disabled={busy || !contactId} onClick={() => save(false)}
            className="rounded border px-4 py-2 text-sm disabled:opacity-50">
            บันทึกร่าง
          </button>
          <button type="button" disabled={busy || !contactId || payloadLines().length === 0} onClick={() => save(true)}
            className="rounded bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-50">
            ยืนยัน + พิมพ์
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">ใบกำกับภาษี</h1>
        <div className="flex gap-2 text-sm">
          <button type="button" className="rounded bg-slate-900 px-3 py-1.5 text-white" onClick={() => startNew('BUY')}>+ ใบซื้อ</button>
          <button type="button" className="rounded bg-slate-900 px-3 py-1.5 text-white" onClick={() => startNew('SELL')}>+ ใบขาย</button>
        </div>
      </div>

      <div className="mt-3 flex gap-2 text-sm">
        {(['', 'BUY', 'SELL'] as const).map((t) => (
          <button key={t} type="button" onClick={() => setTypeFilter(t)}
            className={`rounded border px-3 py-1 ${typeFilter === t ? 'bg-slate-900 text-white' : ''}`}>
            {t === '' ? 'ทั้งหมด' : t === 'BUY' ? 'ซื้อ' : 'ขาย'}
          </button>
        ))}
      </div>

      {error && <p className="mt-3 text-red-600">{error}</p>}

      <table className="mt-3 w-full border-collapse text-sm">
        <thead>
          <tr className="border-b text-left text-slate-500">
            <th className="px-2 py-1">เลขที่</th>
            <th className="px-2">ประเภท</th>
            <th className="px-2">วันที่</th>
            <th className="px-2">คู่ค้า</th>
            <th className="px-2 text-right">ยอดสุทธิ</th>
            <th className="px-2">สถานะ</th>
            <th className="px-2"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b">
              <td className="px-2 py-1 font-mono">{r.invoiceNumber ?? '—'}</td>
              <td className="px-2">{r.docType === 'BUY' ? 'ซื้อ' : 'ขาย'}</td>
              <td className="px-2">{dateTh(r.issueDate)}</td>
              <td className="px-2">{r.contactName}</td>
              <td className="px-2 text-right tabular-nums">{thb(r.totalSatang)}</td>
              <td className="px-2">{STATUS_BADGE[r.status]}</td>
              <td className="px-2">
                <div className="flex gap-2">
                  {r.status === 'DRAFT' && (
                    <button type="button" className="text-blue-700 underline" onClick={() => openEdit(r.id)}>แก้ไข</button>
                  )}
                  {r.status !== 'DRAFT' && (
                    <button type="button" className="text-blue-700 underline" onClick={() => onPrint(r.id)}>พิมพ์</button>
                  )}
                  {r.status === 'CONFIRMED' && (
                    <button type="button" className="text-red-600 underline" onClick={() => voidInvoice(r.id)}>ยกเลิก</button>
                  )}
                </div>
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={7} className="py-6 text-center text-slate-400">ยังไม่มีใบกำกับ</td></tr>
          )}
        </tbody>
      </table>

      <p className="mt-4 text-xs text-slate-400">
        ส่งออก: <a className="underline" href={exportUrl('purchases')}>ซื้อทั้งหมด</a> ·{' '}
        <a className="underline" href={exportUrl('sales')}>ขายทั้งหมด</a>
      </p>
    </div>
  );
}
