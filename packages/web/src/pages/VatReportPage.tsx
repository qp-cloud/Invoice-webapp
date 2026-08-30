import { useCallback, useEffect, useState } from 'react';
import { api, ApiRequestError, exportUrl } from '../api/client.js';
import type { CompanyProfile, VatReport } from '../api/types.js';
import { dateTh, thb } from '../lib/fmt.js';

const PRINT_CSS = `@media print { .no-print { display:none !important } body { background:#fff } }`;

const KIND_LABEL = { purchase: 'รายงานภาษีซื้อ', sales: 'รายงานภาษีขาย' } as const;
type ProfileForm = Pick<CompanyProfile, 'code' | 'name' | 'nameEn' | 'taxId' | 'branch' | 'address' | 'phone' | 'active'>;
const EMPTY_PROFILE: ProfileForm = { code: '', name: '', nameEn: '', taxId: '', branch: 'สำนักงานใหญ่', address: '', phone: '', active: true };

export function VatReportPage(): JSX.Element {
  const [kind, setKind] = useState<'purchase' | 'sales'>('purchase');
  const [ym, setYm] = useState(new Date().toISOString().slice(0, 7));
  const [report, setReport] = useState<VatReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [profiles, setProfiles] = useState<CompanyProfile[]>([]);
  const [companyProfileId, setCompanyProfileId] = useState('');
  const [profile, setProfile] = useState<ProfileForm | null>(null);
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileMsg, setProfileMsg] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!companyProfileId) return;
    const q = new URLSearchParams({ ym, companyProfileId });
    api.get<VatReport>(`/vat-reports/${kind}?${q}`).then(setReport).catch((e) => setError(String(e)));
  }, [kind, ym, companyProfileId]);
  useEffect(() => load(), [load]);

  const loadProfiles = useCallback(() => {
    api.get<CompanyProfile[]>('/company-profiles?includeInactive=true').then((items) => {
      setProfiles(items);
      setCompanyProfileId((current) => current || items.find((item) => item.active)?.id || '');
    }).catch((e) => setError(String(e)));
  }, []);
  useEffect(() => loadProfiles(), [loadProfiles]);

  const editProfile = (item?: CompanyProfile): void => {
    setEditingProfileId(item?.id ?? null);
    setProfile(item ? {
      code: item.code, name: item.name, nameEn: item.nameEn, taxId: item.taxId,
      branch: item.branch, address: item.address, phone: item.phone, active: item.active,
    } : { ...EMPTY_PROFILE });
    setProfileOpen(true);
    setProfileMsg(null);
  };

  const saveProfile = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!profile) return;
    setProfileMsg(null);
    try {
      if (editingProfileId) await api.patch(`/company-profiles/${editingProfileId}`, profile);
      else await api.post('/company-profiles', profile);
      setProfileMsg('บันทึกแล้ว');
      loadProfiles();
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
          <div className="flex gap-2 text-sm">
            <button type="button" className="rounded border px-3 py-1.5" onClick={() => editProfile(profiles.find((p) => p.id === companyProfileId))}>แก้ไขบริษัทนี้</button>
            <button type="button" className="rounded bg-slate-900 px-3 py-1.5 text-white" onClick={() => editProfile()}>+ เพิ่มบริษัท</button>
          </div>
        </div>

        {profileOpen && profile && (
          <form onSubmit={saveProfile} className="mt-3 grid grid-cols-2 gap-3 rounded-lg border border-slate-300 bg-white p-4 text-sm shadow-sm">
            <div className="col-span-2 flex items-center justify-between border-b pb-2">
              <strong>{editingProfileId ? 'แก้ไขโปรไฟล์บริษัท' : 'เพิ่มโปรไฟล์บริษัท'}</strong>
              <button type="button" className="text-slate-500" onClick={() => setProfileOpen(false)}>ปิด</button>
            </div>
            <div className="col-span-2 flex flex-wrap gap-2 rounded bg-slate-100 p-2">
              {profiles.map((item) => (
                <button key={item.id} type="button" onClick={() => editProfile(item)}
                  className={`rounded border px-2 py-1 ${editingProfileId === item.id ? 'border-slate-900 bg-white font-semibold' : 'border-slate-300'} ${item.active ? '' : 'text-slate-400 line-through'}`}>
                  {item.code} · {item.name}
                </button>
              ))}
            </div>
            {([
              ['code', 'รหัสบริษัท (เช่น MAIN, SHOP2)'],
              ['name', 'ชื่อบริษัท (ไทย)'], ['nameEn', 'ชื่อบริษัท (อังกฤษ)'],
              ['taxId', 'เลขประจำตัวผู้เสียภาษี'], ['branch', 'สาขา'],
              ['address', 'ที่อยู่'], ['phone', 'โทรศัพท์'],
            ] as [keyof ProfileForm, string][]).map(([k, label]) => (
              <label key={k} className="flex flex-col">
                {label}
                <input className="mt-1 rounded border px-2 py-1" value={String(profile[k])}
                  onChange={(e) => setProfile({ ...profile, [k]: e.target.value })} />
              </label>
            ))}
            <div className="col-span-2 flex items-center gap-3">
              <button type="submit" className="rounded bg-slate-900 px-4 py-1.5 text-white">บันทึก</button>
              {editingProfileId && (
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={profile.active} onChange={(e) => setProfile({ ...profile, active: e.target.checked })} />
                  เปิดใช้งานบริษัทนี้
                </label>
              )}
              {profileMsg && <span className="text-slate-500">{profileMsg}</span>}
            </div>
          </form>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
          <label className="flex items-center gap-2 rounded border border-slate-400 bg-white px-3 py-1.5 font-medium">
            บริษัท
            <select className="bg-transparent" value={companyProfileId} onChange={(e) => setCompanyProfileId(e.target.value)}>
              {profiles.filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}
            </select>
          </label>
          {(['purchase', 'sales'] as const).map((k) => (
            <button key={k} type="button" onClick={() => setKind(k)}
              className={`rounded border px-3 py-1 ${kind === k ? 'bg-slate-900 text-white' : ''}`}>
              {KIND_LABEL[k]}
            </button>
          ))}
          <input type="month" className="rounded border px-2 py-1" value={ym} onChange={(e) => setYm(e.target.value)} />
          <a className="rounded border px-3 py-1 hover:bg-slate-100"
            href={exportUrl(kind === 'purchase' ? 'vat-purchase' : 'vat-sales', `?ym=${ym}&companyProfileId=${companyProfileId}`)}>
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
