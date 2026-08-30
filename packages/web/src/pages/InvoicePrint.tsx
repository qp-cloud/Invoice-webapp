import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import type { InvoiceDetail } from '../api/types.js';
import { dateTh, qty, thb } from '../lib/fmt.js';

const PRINT_CSS = `
@media print {
  .no-print { display: none !important; }
  body { background: #fff; }
  .sheet { box-shadow: none !important; margin: 0 !important; }
}
`;

export function InvoicePrint({ id, onClose }: { id: string; onClose: () => void }): JSX.Element {
  const [data, setData] = useState<InvoiceDetail | null>(null);
  const [copy, setCopy] = useState<'ต้นฉบับ' | 'สำเนา'>('ต้นฉบับ');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<InvoiceDetail>(`/invoices/${id}`).then(setData).catch((e) => setError(String(e)));
  }, [id]);

  if (error) return <div className="p-8 text-red-600">{error}</div>;
  if (!data) return <div className="p-8 text-slate-400">กำลังโหลด…</div>;

  const { invoice: inv, lines, company } = data;
  const isSell = inv.docType === 'SELL';
  const title = isSell ? 'ใบกำกับภาษี / ใบเสร็จรับเงิน' : 'ใบกำกับภาษีซื้อ / ใบรับสินค้า';
  const titleEn = isSell ? 'TAX INVOICE / RECEIPT' : 'PURCHASE TAX INVOICE';
  const partyLabel = isSell ? 'ลูกค้า / Customer' : 'ผู้ขาย / Supplier';

  return (
    <div className="min-h-screen bg-slate-100 p-6">
      <style>{PRINT_CSS}</style>
      <div className="no-print mx-auto mb-4 flex max-w-[210mm] items-center gap-3">
        <button type="button" onClick={() => window.print()} className="rounded bg-slate-900 px-4 py-2 text-sm text-white">
          พิมพ์
        </button>
        <label className="text-sm">
          <select className="rounded border px-2 py-1" value={copy} onChange={(e) => setCopy(e.target.value as 'ต้นฉบับ' | 'สำเนา')}>
            <option value="ต้นฉบับ">ต้นฉบับ (Original)</option>
            <option value="สำเนา">สำเนา (Copy)</option>
          </select>
        </label>
        <button type="button" onClick={onClose} className="ml-auto rounded border px-4 py-2 text-sm">ปิด</button>
      </div>

      <div className="sheet mx-auto max-w-[210mm] bg-white p-10 text-[13px] leading-relaxed shadow">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-lg font-bold">{company.name || '—'}</div>
            {company.nameEn && <div className="text-slate-600">{company.nameEn}</div>}
            {company.address && <div>{company.address}</div>}
            {company.phone && <div>โทร. {company.phone}</div>}
            <div>เลขประจำตัวผู้เสียภาษี {company.taxId || '—'} ({company.branch || 'สำนักงานใหญ่'})</div>
          </div>
          <div className="text-right">
            <div className="text-lg font-bold">{title}</div>
            <div className="text-xs text-slate-500">{titleEn}</div>
            <div className="mt-1 inline-block rounded border px-2 py-0.5 text-xs">
              {copy} / {copy === 'ต้นฉบับ' ? 'Original' : 'Copy'}
            </div>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-4 border-y py-3">
          <div>
            <div className="text-xs text-slate-500">{partyLabel}</div>
            <div className="font-semibold">{inv.contactNameSnapshot || data.contact?.name || '—'}</div>
            <div>เลขภาษี {inv.contactTaxIdSnapshot || '—'} ({inv.contactBranchSnapshot || 'สำนักงานใหญ่'})</div>
            {inv.contactAddressSnapshot && <div>{inv.contactAddressSnapshot}</div>}
          </div>
          <div className="text-right">
            <div>เลขที่ / No. <span className="font-mono font-semibold">{inv.invoiceNumber ?? '(ร่าง)'}</span></div>
            <div>วันที่ / Date {dateTh(inv.issueDate)}</div>
            {inv.referenceNo && <div>อ้างอิง / Ref. {inv.referenceNo}</div>}
            {inv.status === 'VOID' && <div className="font-bold text-red-600">** ยกเลิก / VOID **</div>}
          </div>
        </div>

        <table className="mt-4 w-full border-collapse">
          <thead>
            <tr className="border-b-2 border-slate-800 text-left">
              <th className="py-1 w-8">#</th>
              <th>รายการ / Description</th>
              <th className="text-right">จำนวน</th>
              <th className="text-right">ราคา/หน่วย</th>
              <th className="text-center">VAT</th>
              <th className="text-right">จำนวนเงิน</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id} className="border-b">
                <td className="py-1">{l.lineNo}</td>
                <td>{l.description || `${l.productSku ?? ''} ${l.productName ?? ''}`}</td>
                <td className="text-right tabular-nums">{qty(l.quantity)}</td>
                <td className="text-right tabular-nums">{thb(l.unitPriceSatang)}</td>
                <td className="text-center">{l.vatRate}%</td>
                <td className="text-right tabular-nums">{thb(l.lineNetSatang)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-3 ml-auto w-72 tabular-nums">
          <div className="flex justify-between"><span>รวมเงิน / Subtotal</span><span>{thb(inv.subtotalSatang)}</span></div>
          <div className="flex justify-between"><span>ภาษีมูลค่าเพิ่ม 7% / VAT</span><span>{thb(inv.vatSatang)}</span></div>
          <div className="mt-1 flex justify-between border-t-2 border-slate-800 pt-1 text-base font-bold">
            <span>ยอดสุทธิ / Grand Total</span><span>{thb(inv.totalSatang)}</span>
          </div>
        </div>

        <div className="mt-12 grid grid-cols-3 gap-8 text-center text-xs">
          {['ผู้รับสินค้า / Received by', 'ผู้ส่งสินค้า / Delivered by', 'ผู้มีอำนาจลงนาม / Authorised'].map((s) => (
            <div key={s}>
              <div className="border-t border-slate-400 pt-1">{s}</div>
              <div className="mt-1 text-slate-400">วันที่ ..................</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
