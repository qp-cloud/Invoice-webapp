import { useState } from 'react';
import { api, ApiRequestError, exportUrl } from '../api/client.js';

type Kind = 'MASTER_STOCK' | 'PURCHASES' | 'SALES';
type Mode = 'ALL_OR_NOTHING' | 'PARTIAL';

interface PreviewRow {
  rowNo: number;
  action: 'CREATE' | 'UPDATE' | 'SKIP' | 'DUPLICATE';
  sanitized: Record<string, unknown> | null;
  errors: { field: string; code: string; level: string }[];
  warnings: { field: string; code: string }[];
}
interface ImportTotals {
  totalRows: number;
  validRows: number;
  invalidRows: number;
  duplicateRows: number;
  willCreate: number;
  willUpdate: number;
}
interface Preview {
  batchId: string;
  kind: Kind;
  fileAlreadyImported: boolean;
  totals: ImportTotals;
  rows: PreviewRow[];
}
interface CommitResult {
  status: string;
  committedRows: number;
  skippedRows: number;
  createdProducts: number;
  updatedProducts: number;
  movementsCreated: number;
}

const ACTION_STYLE: Record<PreviewRow['action'], string> = {
  CREATE: 'text-green-700',
  UPDATE: 'text-blue-700',
  SKIP: 'text-red-700',
  DUPLICATE: 'text-slate-400',
};

export function ImportPage(): JSX.Element {
  const [kind, setKind] = useState<Kind>('PURCHASES');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mode, setMode] = useState<Mode>('ALL_OR_NOTHING');
  const [ack, setAck] = useState(false);
  const [result, setResult] = useState<CommitResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ym, setYm] = useState(new Date().toISOString().slice(0, 7));

  const doUpload = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!file) return;
    setError(null);
    setResult(null);
    setPreview(null);
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('kind', kind);
      fd.append('file', file);
      const p = await api.postForm<Preview>('/imports', fd);
      setPreview(p);
      setAck(false);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.api.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const doCommit = async (): Promise<void> => {
    if (!preview) return;
    setError(null);
    setBusy(true);
    try {
      const r = await api.commitImport<CommitResult>(`/imports/${preview.batchId}/commit`, {
        mode,
        acknowledgeDuplicateFile: ack || undefined,
      });
      setResult(r);
      setPreview(null);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.api.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const t = preview?.totals;

  return (
    <div className="mx-auto max-w-6xl p-8">
      <h1 className="text-2xl font-semibold">นำเข้า / ส่งออก</h1>

      <form onSubmit={doUpload} className="mt-4 flex flex-wrap items-end gap-3 rounded-lg border bg-white p-4 text-sm">
        <label className="flex flex-col">
          ประเภท
          <select className="mt-1 rounded border px-2 py-1" value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
            <option value="MASTER_STOCK">ยอดยกมา (Master Stock 68)</option>
            <option value="PURCHASES">ซื้อเข้า 69</option>
            <option value="SALES">ขายออก 69</option>
          </select>
        </label>
        <label className="flex flex-col">
          ไฟล์ (.xlsx / .csv)
          <input
            type="file"
            accept=".xlsx,.xls,.csv"
            className="mt-1"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </label>
        <button type="submit" disabled={!file || busy} className="rounded bg-slate-900 px-4 py-1.5 text-white disabled:opacity-50">
          อัปโหลด + ดูตัวอย่าง
        </button>
      </form>

      {error && <p className="mt-3 text-red-600">{error}</p>}

      {result && (
        <div className="mt-4 rounded-lg border border-green-300 bg-green-50 p-4 text-sm">
          นำเข้าสำเร็จ — บันทึก {result.committedRows} แถว · ข้าม {result.skippedRows} · เคลื่อนไหว {result.movementsCreated} ·
          สร้างสินค้า {result.createdProducts} · แก้ไข {result.updatedProducts}
        </div>
      )}

      {preview && t && (
        <div className="mt-4 rounded-lg border bg-white p-4 text-sm">
          {preview.fileAlreadyImported && (
            <div className="mb-3 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-amber-800">
              ⚠️ ไฟล์นี้อาจถูกนำเข้าแล้ว
              <label className="ml-3">
                <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /> นำเข้าอีกครั้ง
              </label>
            </div>
          )}

          <div className="flex flex-wrap gap-4">
            <Stat label="ทั้งหมด" value={t.totalRows} />
            <Stat label="ถูกต้อง" value={t.validRows} />
            <Stat label="ผิดพลาด" value={t.invalidRows} tone={t.invalidRows ? 'danger' : undefined} />
            <Stat label="ซ้ำ" value={t.duplicateRows} />
            <Stat label="จะสร้าง" value={t.willCreate} />
            <Stat label="จะแก้ไข" value={t.willUpdate} />
          </div>

          <div className="mt-3 flex items-center gap-4">
            <label>
              <input type="radio" checked={mode === 'ALL_OR_NOTHING'} onChange={() => setMode('ALL_OR_NOTHING')} />{' '}
              ทั้งหมดหรือไม่เลย
            </label>
            <label>
              <input type="radio" checked={mode === 'PARTIAL'} onChange={() => setMode('PARTIAL')} /> นำเข้าเฉพาะแถวที่ถูกต้อง
            </label>
            <button
              type="button"
              onClick={doCommit}
              disabled={busy}
              className="rounded bg-slate-900 px-4 py-1.5 text-white disabled:opacity-50"
            >
              ยืนยันนำเข้า
            </button>
            {t.invalidRows > 0 && (
              <a className="text-blue-700 underline" href={`/api/imports/${preview.batchId}/invalid-rows.xlsx`}>
                ดาวน์โหลดแถวที่ผิดพลาด
              </a>
            )}
          </div>

          <div className="mt-3 max-h-96 overflow-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b text-left text-slate-500">
                  <th className="px-2 py-1">แถว</th>
                  <th className="px-2">การกระทำ</th>
                  <th className="px-2">ข้อมูล</th>
                  <th className="px-2">ปัญหา</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((r) => (
                  <tr key={r.rowNo} className="border-b">
                    <td className="px-2 py-1">{r.rowNo}</td>
                    <td className={`px-2 font-medium ${ACTION_STYLE[r.action]}`}>{r.action}</td>
                    <td className="px-2 font-mono text-xs">
                      {r.sanitized ? JSON.stringify(r.sanitized) : '—'}
                    </td>
                    <td className="px-2 text-xs text-red-600">
                      {[...r.errors, ...r.warnings].map((e) => `${e.field}:${e.code}`).join(', ')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <section className="mt-8">
        <h2 className="mb-2 font-semibold">ส่งออก Excel</h2>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {(['current-stock', 'purchases', 'sales', 'low-stock', 'oversold'] as const).map((k) => (
            <a key={k} className="rounded border px-3 py-1 hover:bg-slate-100" href={exportUrl(k)}>
              {k}
            </a>
          ))}
          <span className="ml-2">รายเดือน</span>
          <input type="month" className="rounded border px-2 py-1" value={ym} onChange={(e) => setYm(e.target.value)} />
          <a className="rounded border px-3 py-1 hover:bg-slate-100" href={exportUrl('monthly-report', `?ym=${ym}`)}>
            ดาวน์โหลด
          </a>
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'danger' }): JSX.Element {
  return (
    <div className={`rounded border px-3 py-2 ${tone === 'danger' ? 'border-red-300 bg-red-50' : 'border-slate-200'}`}>
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}
