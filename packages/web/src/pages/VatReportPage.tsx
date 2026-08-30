import { useCallback, useEffect, useState } from 'react';
import { api, ApiRequestError, exportUrl } from '../api/client.js';
import type { CompanyProfile, VatReport } from '../api/types.js';
import { dateTh, thb } from '../lib/fmt.js';

const PRINT_CSS = `@media print { .no-print { display:none !important } body { background:#fff } }`;

const KIND_LABEL = { purchase: 'รายงานภาษีซื้อ', sales: 'รายงานภาษีขาย' } as const;

export function VatReportPage(): JSX.Element {
  const [kind, setKind] = useState<'purchase' | 'sales'>('purchase');
  const [ym, setYm] = useState(new Date().toISOString().slice(0, 7));
  const [report, setReport] = useState<VatReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [profile, setProfile] = useState<CompanyProfile | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileMsg, setProfileMsg] = useState<string | null>(null);

  const load = useCallback(() => {
    api.get<VatReport>(`/vat-reports/${kind}?ym=${ym}`).then(setReport).catch((e) => setError(String(e)));
  }, [kind, ym]);
  useEffect(() => load(), [load]);

  useEffect(() => {
    api.get<Record<string, unknown>>('/settings').then((s) => {
      setProfile({
        name: String(s.company_name ?? ''),
        nameEn: String(s.company_name_en ?? ''),
        taxId: String(s.company_tax_id ?? ''),
        branch: String(s.company_branch ?? 'สำนักงานใหญ่'),
        address: String(s.company_address ?? ''),
        phone: String(s.company_phone ?? ''),
      });
    }).catch(() => undefined);
  }, []);

  const saveProfile = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!profile) return;
    setProfileMsg(null);
    try {
      await api.patch('/settings', {
        company_name: profile.name,
        company_name_en: profile.nameEn,
        company_tax_id: profile.taxId,
        company_branch: profile.branch,
        company_address: profile.address,
        company_phone: profile.phone,
      });
      setProfileMsg('บันทึกแล้ว');
      load();
    } catch (err) {
      setProfileMsg(err instanceof ApiRequestError ? err.api.message : String(err));
    }
  };

  return (
    <div className="mx-auto max-w-5xl p-8">
      <style>{PRINT_CSS}</style>

      <div className="no-print">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">รายงานภาษีมูลค่าเพิ่ม (ภ.พ.30)</h1>
          <button type="button" className="text-sm underline" onClick={() => setProfileOpen((o) => !o)}>
            ตั้งค่าข้อมูลบริษัท
          </button>
        </div>

        {profileOpen && profile && (
          <form onSubmit={saveProfile} className="mt-3 grid grid-cols-2 gap-3 rounded-lg border bg-white p-4 text-sm">
            {([
              ['name', 'ชื่อบริษัท (ไทย)'], ['nameEn', 'ชื่อบริษัท (อังกฤษ)'],
              ['taxId', 'เลขประจำตัวผู้เสียภาษี'], ['branch', 'สาขา'],
              ['address', 'ที่อยู่'], ['phone', 'โทรศัพท์'],
            ] as [keyof CompanyProfile, string][]).map(([k, label]) => (
              <label key={k} className="flex flex-col">
                {label}
                <input className="mt-1 rounded border px-2 py-1" value={profile[k]}
                  onChange={(e) => setProfile({ ...profile, [k]: e.target.value })} />
              </label>
            ))}
            <div className="col-span-2 flex items-center gap-3">
              <button type="submit" className="rounded bg-slate-900 px-4 py-1.5 text-white">บันทึก</button>
              {profileMsg && <span className="text-slate-500">{profileMsg}</span>}
            </div>
          </form>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
          {(['purchase', 'sales'] as const).map((k) => (
            <button key={k} type="button" onClick={() => setKind(k)}
              className={`rounded border px-3 py-1 ${kind === k ? 'bg-slate-900 text-white' : ''}`}>
              {KIND_LABEL[k]}
            </button>
          ))}
          <input type="month" className="rounded border px-2 py-1" value={ym} onChange={(e) => setYm(e.target.value)} />
          <a className="rounded border px-3 py-1 hover:bg-slate-100"
            href={exportUrl(kind === 'purchase' ? 'vat-purchase' : 'vat-sales', `?ym=${ym}`)}>
            ดาวน์โหลด CSV
          </a>
          <button type="button" className="rounded border px-3 py-1 hover:bg-slate-100" onClick={() => window.print()}>
            พิมพ์
          </button>
        </div>
      </div>

      {error && <p className="mt-3 text-red-600">{error}</p>}

      {report && (
        <div className="mt-4">
          <div className="text-center">
            <div className="text-lg font-bold">{KIND_LABEL[kind]}</div>
            <div>{report.company.name} — เลขภาษี {report.company.taxId || '—'} ({report.company.branch})</div>
            <div className="text-sm text-slate-500">เดือนภาษี {ym}</div>
          </div>
          <table className="mt-3 w-full border-collapse text-sm">
            <thead>
              <tr className="border-y-2 border-slate-800 text-left">
                <th className="py-1">ลำดับ</th>
                <th>วันที่</th>
                <th>เลขที่ใบกำกับ</th>
                <th>ชื่อผู้ประกอบการ</th>
                <th>เลขประจำตัวผู้เสียภาษี</th>
                <th className="text-right">มูลค่า</th>
                <th className="text-right">ภาษีมูลค่าเพิ่ม</th>
              </tr>
            </thead>
            <tbody>
              {report.rows.map((r) => (
                <tr key={r.invoiceNumber} className="border-b">
                  <td className="py-1">{r.seq}</td>
                  <td>{dateTh(r.issueDate)}</td>
                  <td className="font-mono">{r.invoiceNumber}</td>
                  <td>{r.contactName}</td>
                  <td className="font-mono text-xs">{r.contactTaxId ?? '—'}{r.contactBranch ? ` (${r.contactBranch})` : ''}</td>
                  <td className="text-right tabular-nums">{thb(r.netSatang)}</td>
                  <td className="text-right tabular-nums">{thb(r.vatSatang)}</td>
                </tr>
              ))}
              {report.rows.length === 0 && (
                <tr><td colSpan={7} className="py-6 text-center text-slate-400">ไม่มีรายการในเดือนนี้</td></tr>
              )}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-slate-800 font-semibold tabular-nums">
                <td className="py-1" colSpan={5}>รวม {report.totals.count} รายการ</td>
                <td className="text-right">{thb(report.totals.netSatang)}</td>
                <td className="text-right">{thb(report.totals.vatSatang)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
