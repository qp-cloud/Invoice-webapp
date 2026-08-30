import { toSatang } from '@inventory/shared';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiRequestError, exportUrl } from '../api/client.js';
import type { CompanyProfile, Contact, InvoiceDetail, InvoiceListRow, Page, Product } from '../api/types.js';
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
  const [companyFilter, setCompanyFilter] = useState('');
  const [companies, setCompanies] = useState<CompanyProfile[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [error, setError] = useState<string | null>(null);

  // editor state
  const [editId, setEditId] = useState<string | null>(null);
  const [docType, setDocType] = useState<DocType>('BUY');
  const [companyProfileId, setCompanyProfileId] = useState('');
  const [contactId, setContactId] = useState('');
  const [issueDate, setIssueDate] = useState(TODAY());
  const [referenceNo, setReferenceNo] = useState('');
  const [attention, setAttention] = useState('');
  const [salesperson, setSalesperson] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [note, setNote] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'' | 'CHEQUE' | 'TRANSFER' | 'CASH'>('');
  const [bankName, setBankName] = useState('');
  const [bankBranch, setBankBranch] = useState('');
  const [chequeNo, setChequeNo] = useState('');
  const [paymentDate, setPaymentDate] = useState('');
  const [paymentAmountThb, setPaymentAmountThb] = useState('');
  const [collector, setCollector] = useState('');
  const [lines, setLines] = useState<EditLine[]>([blankLine()]);
  const [busy, setBusy] = useState(false);

  const loadList = useCallback(() => {
    const q = new URLSearchParams({ pageSize: '100' });
    if (typeFilter) q.set('docType', typeFilter);
    if (companyFilter) q.set('companyProfileId', companyFilter);
    api.get<Page<InvoiceListRow>>(`/invoices?${q}`).then((p) => setRows(p.rows)).catch((e) => setError(String(e)));
  }, [typeFilter, companyFilter]);

  useEffect(() => {
    if (view === 'list') loadList();
  }, [view, loadList]);
  useEffect(() => {
    // Server caps pageSize at 200 (zPagination), so walk every page.
    const fetchAll = async <T,>(path: string): Promise<T[]> => {
      const out: T[] = [];
      const sep = path.includes('?') ? '&' : '?';
      for (let page = 1; ; page += 1) {
        const p = await api.get<Page<T>>(`${path}${sep}page=${page}&pageSize=200`);
        out.push(...p.rows);
        if (page >= p.totalPages) return out;
      }
    };
    fetchAll<Product>('/products?sort=sku').then(setProducts).catch((e) => setError(String(e)));
    fetchAll<Contact>('/contacts').then(setContacts).catch((e) => setError(String(e)));
    api.get<CompanyProfile[]>('/company-profiles').then((items) => {
      setCompanies(items);
      setCompanyProfileId((current) => current || items[0]?.id || '');
    }).catch((e) => setError(String(e)));
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
    setCompanyProfileId(companies[0]?.id ?? '');
    setContactId('');
    setIssueDate(TODAY());
    setReferenceNo('');
    setAttention(''); setSalesperson(''); setDueDate(''); setNote('');
    setPaymentMethod(''); setBankName(''); setBankBranch(''); setChequeNo('');
    setPaymentDate(''); setPaymentAmountThb(''); setCollector('');
    setLines([blankLine()]);
    setError(null);
    setView('edit');
  };

  const openEdit = async (id: string): Promise<void> => {
    setError(null);
    const d = await api.get<InvoiceDetail>(`/invoices/${id}`);
    setEditId(id);
    setDocType(d.invoice.docType);
    setCompanyProfileId(d.invoice.companyProfileId);
    setContactId(d.invoice.contactId);
    setIssueDate(d.invoice.issueDate);
    setReferenceNo(d.invoice.referenceNo ?? '');
    setAttention(d.invoice.attention ?? '');
    setSalesperson(d.invoice.salesperson ?? '');
    setDueDate(d.invoice.dueDate ?? '');
    setNote(d.invoice.note ?? '');
    setPaymentMethod(d.invoice.paymentMethod ?? '');
    setBankName(d.invoice.bankName ?? '');
    setBankBranch(d.invoice.bankBranch ?? '');
    setChequeNo(d.invoice.chequeNo ?? '');
    setPaymentDate(d.invoice.paymentDate ?? '');
    setPaymentAmountThb(d.invoice.paymentAmountSatang == null ? '' : (d.invoice.paymentAmountSatang / 100).toString());
    setCollector(d.invoice.collector ?? '');
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
      const details = {
        referenceNo: referenceNo || undefined, attention: attention || undefined, salesperson: salesperson || undefined,
        dueDate: dueDate || undefined, note: note || undefined, paymentMethod: paymentMethod || undefined,
        bankName: bankName || undefined, bankBranch: bankBranch || undefined, chequeNo: chequeNo || undefined,
        paymentDate: paymentDate || undefined, paymentAmountSatang: paymentAmountThb ? toSatang(paymentAmountThb) : undefined,
        collector: collector || undefined,
      };
      const body = { docType, companyProfileId, contactId, issueDate, ...details, lines: payloadLines() };
      let id = editId;
      if (id) await api.patch(`/invoices/${id}`, { companyProfileId, contactId, issueDate, ...details, lines: body.lines });
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

        <div className="mt-3 grid grid-cols-2 gap-3 rounded-lg border bg-white p-4 text-sm sm:grid-cols-4">
          <label className="flex flex-col">เรียน / Attn.<input className="mt-1 rounded border px-2 py-1" value={attention} onChange={(e) => setAttention(e.target.value)} /></label>
          <label className="flex flex-col">พนักงานขาย / Sales<input className="mt-1 rounded border px-2 py-1" value={salesperson} onChange={(e) => setSalesperson(e.target.value)} /></label>
          <label className="flex flex-col">วันครบกำหนด / Due date<input type="date" className="mt-1 rounded border px-2 py-1" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></label>
          <label className="flex flex-col">ผู้รับเงิน / Collector<input className="mt-1 rounded border px-2 py-1" value={collector} onChange={(e) => setCollector(e.target.value)} /></label>
          <label className="col-span-2 flex flex-col sm:col-span-4">หมายเหตุ / Remark<textarea rows={2} className="mt-1 rounded border px-2 py-1" value={note} onChange={(e) => setNote(e.target.value)} /></label>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 rounded-lg border bg-white p-4 text-sm sm:grid-cols-4">
          <label className="flex flex-col">
            บริษัทผู้ออกเอกสาร *
            <select className="mt-1 rounded border border-slate-400 px-2 py-1 font-medium" value={companyProfileId}
              onChange={(e) => setCompanyProfileId(e.target.value)}>
              <option value="">— เลือกบริษัท —</option>
              {companies.map((company) => <option key={company.id} value={company.id}>{company.code} · {company.name}</option>)}
            </select>
          </label>
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

        <div className="mt-3 grid grid-cols-2 gap-3 rounded-lg border bg-white p-4 text-sm sm:grid-cols-4">
          <label className="flex flex-col">ชำระโดย / Paid by<select className="mt-1 rounded border px-2 py-1" value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value as typeof paymentMethod)}><option value="">— ยังไม่ระบุ —</option><option value="CHEQUE">เช็ค / Cheque</option><option value="TRANSFER">เงินโอน / Transfer</option><option value="CASH">เงินสด / Cash</option></select></label>
          <label className="flex flex-col">ธนาคาร / Bank<input className="mt-1 rounded border px-2 py-1" value={bankName} onChange={(e) => setBankName(e.target.value)} /></label>
          <label className="flex flex-col">สาขา / Branch<input className="mt-1 rounded border px-2 py-1" value={bankBranch} onChange={(e) => setBankBranch(e.target.value)} /></label>
          <label className="flex flex-col">เลขที่เช็ค / Cheque no.<input className="mt-1 rounded border px-2 py-1" value={chequeNo} onChange={(e) => setChequeNo(e.target.value)} /></label>
          <label className="flex flex-col">วันที่ชำระ / Payment date<input type="date" className="mt-1 rounded border px-2 py-1" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} /></label>
          <label className="flex flex-col">จำนวนเงิน / Amount (฿)<input inputMode="decimal" className="mt-1 rounded border px-2 py-1 text-right" value={paymentAmountThb} onChange={(e) => setPaymentAmountThb(e.target.value)} /></label>
        </div>

        {error && <p className="mt-3 text-red-600">{error}</p>}

        <div className="mt-4 flex gap-2">
          <button type="button" disabled={busy || !companyProfileId || !contactId} onClick={() => save(false)}
            className="rounded border px-4 py-2 text-sm disabled:opacity-50">
            บันทึกร่าง
          </button>
          <button type="button" disabled={busy || !companyProfileId || !contactId || payloadLines().length === 0} onClick={() => save(true)}
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

      <div className="mt-3 flex flex-wrap gap-2 text-sm">
        {(['', 'BUY', 'SELL'] as const).map((t) => (
          <button key={t} type="button" onClick={() => setTypeFilter(t)}
            className={`rounded border px-3 py-1 ${typeFilter === t ? 'bg-slate-900 text-white' : ''}`}>
            {t === '' ? 'ทั้งหมด' : t === 'BUY' ? 'ซื้อ' : 'ขาย'}
          </button>
        ))}
        <select className="ml-auto rounded border px-3 py-1" value={companyFilter} onChange={(e) => setCompanyFilter(e.target.value)}>
          <option value="">ทุกบริษัท</option>
          {companies.map((company) => <option key={company.id} value={company.id}>{company.code} · {company.name}</option>)}
        </select>
      </div>

      {error && <p className="mt-3 text-red-600">{error}</p>}

      <table className="mt-3 w-full border-collapse text-sm">
        <thead>
          <tr className="border-b text-left text-slate-500">
            <th className="px-2 py-1">เลขที่</th>
            <th className="px-2">ประเภท</th>
            <th className="px-2">บริษัท</th>
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
              <td className="px-2">{r.companyName}</td>
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
            <tr><td colSpan={8} className="py-6 text-center text-slate-400">ยังไม่มีใบกำกับ</td></tr>
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
