import { bahtText } from '@inventory/shared';
import { useEffect, useState } from 'react';
import { api, ApiRequestError } from '../api/client.js';
import type { InvoiceDetail, PrintSettings } from '../api/types.js';
import { dateTh, qty, thb } from '../lib/fmt.js';

const SHEET_WIDTH: Record<PrintSettings['paperSize'], string> = { A4: '210mm', A5: '148mm' };
const SHEET_HEIGHT: Record<PrintSettings['paperSize'], string> = { A4: '297mm', A5: '210mm' };
const LOGO_MAX_BYTES = 500_000;

const SIGNATURES: [th: string, en: string][] = [
  ['ผู้รับสินค้า', 'Received by'],
  ['ผู้ส่งสินค้า', 'Delivered by'],
  ['ผู้มีอำนาจลงนาม', 'Authorised'],
];

export function InvoicePrint({ id, onClose }: { id: string; onClose: () => void }): JSX.Element {
  const [data, setData] = useState<InvoiceDetail | null>(null);
  const [copy, setCopy] = useState<'ต้นฉบับ' | 'สำเนา'>('ต้นฉบับ');
  const [error, setError] = useState<string | null>(null);

  // print-format editor
  const [ps, setPs] = useState<PrintSettings | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api
      .get<InvoiceDetail>(`/invoices/${id}`)
      .then((d) => {
        setData(d);
        setPs(d.printSettings);
      })
      .catch((e) => setError(String(e)));
  }, [id]);

  if (error) return <div className="p-8 text-red-600">{error}</div>;
  if (!data || !ps) return <div className="p-8 text-slate-400">กำลังโหลด…</div>;

  const { invoice: inv, lines, company } = data;
  const isSell = inv.docType === 'SELL';
  const title = isSell ? 'ใบกำกับภาษี / ใบเสร็จรับเงิน' : 'ใบกำกับภาษีซื้อ / ใบรับสินค้า';
  const titleEn = isSell ? 'TAX INVOICE / RECEIPT' : 'PURCHASE TAX INVOICE';
  const isCopy = copy === 'สำเนา' && ps.showCopyBadge;
  const printedTitle = isCopy ? `สำเนา${title}` : title;
  const printedTitleEn = isCopy ? `COPY ${titleEn}` : titleEn;

  /** "th / en" when EN labels are on, otherwise just "th". */
  const L = (th: string, en: string): string => (ps.showEnLabels ? `${th} / ${en}` : th);
  const set = <K extends keyof PrintSettings>(k: K, v: PrintSettings[K]): void => {
    setPs({ ...ps, [k]: v });
    setSaveMsg(null);
  };

  const onLogoFile = (file: File | undefined): void => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result ?? '');
      if (url.length > LOGO_MAX_BYTES) {
        setSaveMsg(`ไฟล์ใหญ่เกินไป (จำกัด ~${Math.round(LOGO_MAX_BYTES / 1024)} KB) — ย่อรูปก่อน`);
        return;
      }
      set('logoDataUrl', url);
    };
    reader.readAsDataURL(file);
  };

  const savePrintSettings = async (): Promise<void> => {
    setSaving(true);
    setSaveMsg(null);
    try {
      await api.patch(`/company-profiles/${company.id}`, { printSettings: ps });
      setSaveMsg('บันทึกแล้ว');
    } catch (err) {
      setSaveMsg(err instanceof ApiRequestError ? err.api.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const printCss = `
@page { size: ${ps.paperSize}; margin: 0; }
.invoice-frame {
  border: 3px double #1e293b;
  box-sizing: border-box;
  color: #0f172a;
}
.invoice-table th,
.invoice-table td { border: 1px solid #94a3b8; }
.invoice-table th { background: #e2e8f0; }
.invoice-table tbody tr { break-inside: avoid; page-break-inside: avoid; }
.invoice-table .invoice-fill td { height: ${ps.paperSize === 'A4' ? '58mm' : '25mm'}; }
.invoice-summary,
.invoice-signatures { break-inside: avoid; page-break-inside: avoid; }
@media print {
  .no-print { display: none !important; }
  html, body, #root { margin: 0 !important; padding: 0 !important; background: #fff !important; }
  .print-root { margin: 0 !important; padding: 0 !important; background: #fff !important; }
  .sheet {
    position: relative;
    width: ${SHEET_WIDTH[ps.paperSize]} !important;
    min-width: ${SHEET_WIDTH[ps.paperSize]} !important;
    max-width: none !important;
    min-height: ${SHEET_HEIGHT[ps.paperSize]} !important;
    margin: 0 !important;
    padding: ${ps.marginMm + 5}mm !important;
    border: 0 !important;
    box-shadow: none !important;
    break-after: page;
  }
  .invoice-frame::before {
    content: '';
    position: absolute;
    inset: ${Math.max(ps.marginMm, 5)}mm;
    border: 3px double #1e293b;
    pointer-events: none;
  }
  .invoice-frame { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
}
`;

  const toggles: [keyof PrintSettings, string][] = [
    ['showLogo', 'แสดงโลโก้'],
    ['showEnLabels', 'ป้ายกำกับภาษาอังกฤษ'],
    ['showCopyBadge', 'ป้าย ต้นฉบับ/สำเนา'],
    ['showReference', 'บรรทัดเลขที่อ้างอิง'],
    ['showVatLine', 'บรรทัด VAT ในสรุปยอด'],
    ['showBahtWords', 'จำนวนเงินเป็นตัวอักษร (บาทถ้วน)'],
    ['showSignatures', 'ช่องลงนาม'],
  ];

  return (
    <div className="print-root min-h-screen bg-slate-100 p-6">
      <style>{printCss}</style>

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
        <button type="button" onClick={() => setPanelOpen((v) => !v)} className="rounded border px-3 py-2 text-sm">
          {panelOpen ? 'ซ่อนการตั้งค่า' : 'ตั้งค่ารูปแบบพิมพ์'}
        </button>
        <button type="button" onClick={onClose} className="ml-auto rounded border px-4 py-2 text-sm">ปิด</button>
      </div>

      {panelOpen && (
        <div className="no-print mx-auto mb-4 max-w-[210mm] rounded-lg border bg-white p-4 text-sm">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <label className="flex flex-col">
              ขนาดกระดาษ
              <select className="mt-1 rounded border px-2 py-1" value={ps.paperSize}
                onChange={(e) => set('paperSize', e.target.value as PrintSettings['paperSize'])}>
                <option value="A4">A4</option>
                <option value="A5">A5</option>
              </select>
            </label>
            <label className="flex flex-col">
              ระยะขอบ (มม.)
              <input type="number" min={0} max={40} className="mt-1 rounded border px-2 py-1" value={ps.marginMm}
                onChange={(e) => set('marginMm', Number(e.target.value))} />
            </label>
            <label className="flex flex-col">
              ขนาดตัวอักษร (px)
              <input type="number" min={8} max={20} className="mt-1 rounded border px-2 py-1" value={ps.fontPx}
                onChange={(e) => set('fontPx', Number(e.target.value))} />
            </label>
            <label className="flex flex-col">
              โลโก้
              <input type="file" accept="image/*" className="mt-1 text-xs"
                onChange={(e) => onLogoFile(e.target.files?.[0])} />
              {ps.logoDataUrl && (
                <button type="button" className="mt-1 text-left text-xs text-red-600" onClick={() => set('logoDataUrl', '')}>
                  ลบโลโก้
                </button>
              )}
            </label>
          </div>

          <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1">
            {toggles.map(([k, label]) => (
              <label key={k} className="flex items-center gap-1">
                <input type="checkbox" checked={ps[k] as boolean} onChange={(e) => set(k, e.target.checked)} />
                {label}
              </label>
            ))}
          </div>

          <label className="mt-3 flex flex-col">
            ข้อความท้ายเอกสาร (เงื่อนไข, เลขบัญชี ฯลฯ)
            <textarea className="mt-1 rounded border px-2 py-1" rows={2} value={ps.footerText}
              onChange={(e) => set('footerText', e.target.value)} />
          </label>

          <div className="mt-3 flex items-center gap-3">
            <button type="button" disabled={saving} onClick={savePrintSettings}
              className="rounded bg-slate-900 px-4 py-1.5 text-white disabled:opacity-50">
              บันทึกการตั้งค่า
            </button>
            <button type="button" className="rounded border px-3 py-1.5" onClick={() => setPs(data.printSettings)}>
              ย้อนกลับ
            </button>
            {saveMsg && <span className="text-slate-500">{saveMsg}</span>}
          </div>
          <p className="mt-2 text-xs text-slate-400">ใช้กับใบกำกับทุกใบ · แก้ที่นี่แล้วดูตัวอย่างด้านล่างได้ทันที</p>
        </div>
      )}

      <div
        className="sheet invoice-frame mx-auto bg-white p-6 leading-relaxed shadow-lg sm:p-10"
        style={{ width: SHEET_WIDTH[ps.paperSize], maxWidth: '100%', fontSize: `${ps.fontPx}px` }}
      >
        <div className="grid grid-cols-[1fr_42%] gap-4">
          <div className="min-w-0">
            {ps.showLogo && ps.logoDataUrl && (
              <img src={ps.logoDataUrl} alt="" className="mb-2 max-h-16 object-contain" />
            )}
            <div className="text-base font-bold">{company.name || '—'} ({company.branch || 'สำนักงานใหญ่'})</div>
            {company.nameEn && <div className="text-xs text-slate-600">{company.nameEn}</div>}
            {company.address && <div className="mt-2">{company.address}</div>}
            <div className="mt-1">โทรศัพท์ / Telephone: {company.phone || '—'}</div>
            <div>เลขประจำตัวผู้เสียภาษี / TAX ID: {company.taxId || '—'}</div>
          </div>
          <div>
            <div className="border-2 border-slate-700 px-3 py-3 text-center">
              <div className="text-lg font-bold">{printedTitle}</div>
              {ps.showEnLabels && <div className="font-semibold tracking-wide">{printedTitleEn}</div>}
            </div>
            <div className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 border-b border-slate-500 pb-1">
              <span>เลขที่ / No.</span><strong className="text-right font-mono">{inv.invoiceNumber ?? '(ร่าง)'}</strong>
              <span>หน้า / Page</span><span className="text-right">1 of 1</span>
              <span>วันที่ / Date</span><span className="text-right">{dateTh(inv.issueDate)}</span>
              {inv.status === 'VOID' && <><span /><strong className="text-right text-red-600">ยกเลิก / VOID</strong></>}
            </div>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-[58%_42%] border border-slate-700">
          <div className="p-2">
            <div><span className="inline-block w-20 text-xs">ชื่อ / Name</span><strong>{inv.contactNameSnapshot || data.contact?.name || '—'}</strong></div>
            <div><span className="inline-block w-20 text-xs">ที่อยู่ / Address</span>{inv.contactAddressSnapshot || '—'}</div>
            <div className="mt-1 grid grid-cols-2">
              <span>โทรศัพท์ / Telephone: {data.contact?.phone || '—'}</span>
              <span>เลขภาษี / TAX ID: {inv.contactTaxIdSnapshot || '—'} ({inv.contactBranchSnapshot || 'สำนักงานใหญ่'})</span>
            </div>
          </div>
          <div className="border-l border-slate-700">
            {[
              [L('เรียน', 'Attn.'), inv.attention],
              [L('พนักงานขาย', 'Sales'), inv.salesperson],
              [L('เอกสารอ้างอิง', 'Ref. No.'), ps.showReference ? inv.referenceNo : null],
              [L('วันครบกำหนด', 'Due date'), inv.dueDate ? dateTh(inv.dueDate) : null],
            ].map(([label, value]) => (
              <div key={label} className="grid min-h-7 grid-cols-[42%_1fr] border-b border-slate-400 px-2 py-1 last:border-b-0">
                <span className="text-xs">{label}</span><span>{value || '—'}</span>
              </div>
            ))}
          </div>
        </div>

        <table className="invoice-table w-full border-collapse">
          <thead>
            <tr className="text-center text-xs">
              <th className="w-[14%] px-1 py-1">รหัสสินค้า<br />Code</th>
              <th className="w-[36%] px-1 py-1">รายการสินค้า<br />Name</th>
              <th className="w-[9%] px-1 py-1">หน่วย<br />Unit</th>
              <th className="w-[10%] px-1 py-1">จำนวน<br />Qty</th>
              <th className="w-[11%] px-1 py-1">ราคาขาย<br />Price</th>
              <th className="w-[9%] px-1 py-1">ส่วนลด<br />Discount</th>
              <th className="w-[11%] px-1 py-1">จำนวนเงิน<br />Amount</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id}>
                <td className="px-1 py-1 font-mono text-xs">{l.productSku || '—'}</td>
                <td className="px-1 py-1">{l.description || l.productName || '—'}</td>
                <td className="px-1 py-1 text-center">{l.productUnit || '—'}</td>
                <td className="px-1 py-1 text-right tabular-nums">{qty(l.quantity)}</td>
                <td className="px-1 py-1 text-right tabular-nums">{thb(l.unitPriceSatang)}</td>
                <td className="px-1 py-1 text-right tabular-nums">—</td>
                <td className="px-1 py-1 text-right tabular-nums">{thb(l.lineNetSatang)}</td>
              </tr>
            ))}
            <tr className="invoice-fill"><td colSpan={7} /></tr>
          </tbody>
        </table>

        <div className="invoice-summary grid grid-cols-[1fr_38%] border-x border-b border-slate-700">
          <div className="p-2">
            <strong>หมายเหตุ / Remark</strong>
            <div className="min-h-12 whitespace-pre-wrap">{inv.note || '—'}</div>
            {ps.showBahtWords && <div className="mt-2 bg-slate-100 px-2 py-1 text-center font-semibold">({bahtText(inv.totalSatang)})</div>}
            {ps.footerText && <div className="mt-2 whitespace-pre-wrap text-xs">{ps.footerText}</div>}
          </div>
          <div className="border-l border-slate-700 tabular-nums">
            {[
              [L('รวมจำนวนเงิน', 'Sub Total'), inv.subtotalSatang],
              [L('ส่วนลด', 'Discount'), 0],
              [L('ราคาสินค้า', 'Good Value'), inv.subtotalSatang],
              [L('ภาษีมูลค่าเพิ่ม 7%', 'Value Added Tax'), ps.showVatLine ? inv.vatSatang : 0],
              [L('จำนวนเงินรวมทั้งสิ้น', 'Grand Total'), inv.totalSatang],
            ].map(([label, value], index) => (
              <div key={String(label)} className={`grid grid-cols-[1fr_auto] gap-2 border-b border-slate-400 px-2 py-1 last:border-b-0 ${index === 4 ? 'font-bold' : ''}`}>
                <span>{label}</span><span>{thb(Number(value))}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="invoice-signatures grid grid-cols-[1fr_42%] border-x border-b border-slate-700 text-xs">
          <div className="p-2">
            <div className="flex flex-wrap gap-5">
              <strong>ชำระโดย / PAID BY</strong>
              {([['CHEQUE', 'เช็ค / CHEQUE'], ['TRANSFER', 'เงินโอน / TRANSFER'], ['CASH', 'เงินสด / CASH']] as const).map(([method, label]) => (
                <span key={method}><span className="mr-1 inline-block h-4 w-4 border border-slate-700 text-center leading-3">{inv.paymentMethod === method ? '✓' : ''}</span>{label}</span>
              ))}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2">
              <span>ธนาคาร / Bank: <u>{inv.bankName || '........................'}</u></span>
              <span>สาขา / Branch: <u>{inv.bankBranch || '........................'}</u></span>
              <span>เลขที่เช็ค / Cheque No.: <u>{inv.chequeNo || '................'}</u></span>
              <span>จำนวนเงิน / Amount: <u>{inv.paymentAmountSatang == null ? '................' : thb(inv.paymentAmountSatang)}</u></span>
              <span>ลงวันที่ / Date: <u>{inv.paymentDate ? dateTh(inv.paymentDate) : '................'}</u></span>
              <span>ผู้รับเงิน / Collector: <u>{inv.collector || '................'}</u></span>
            </div>
          </div>
          {ps.showSignatures && (
            <div className="grid grid-cols-3 border-l border-slate-700 text-center">
              {SIGNATURES.map(([th, en]) => (
                <div key={th} className="flex min-h-24 flex-col justify-end border-r border-slate-500 p-1 last:border-r-0">
                  <div className="border-t border-dotted border-slate-600 pt-1">{L(th, en)}</div>
                  <div>วันที่ / Date ....../....../......</div>
                </div>
              ))}
              </div>
          )}
        </div>
      </div>
    </div>
  );
}
