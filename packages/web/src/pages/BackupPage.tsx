import { useCallback, useEffect, useState } from 'react';
import { api, ApiRequestError } from '../api/client.js';
import type { Backup, BackupStatus } from '../api/types.js';
import { dateTh } from '../lib/fmt.js';

const KB = 1024;
const fmtSize = (n: number): string =>
  n < KB * KB ? `${(n / KB).toFixed(0)} KB` : `${(n / KB / KB).toFixed(1)} MB`;

export function BackupPage(): JSX.Element {
  const [list, setList] = useState<Backup[]>([]);
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [passphrase, setPassphrase] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const [l, s] = await Promise.all([
      api.get<Backup[]>('/backups'),
      api.get<BackupStatus>('/backups/status'),
    ]);
    setList(l);
    setStatus(s);
  }, []);

  useEffect(() => {
    void reload().catch((e: unknown) => setErr(String(e)));
  }, [reload]);

  const run = async (fn: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      await fn();
      await reload();
    } catch (e) {
      setErr(e instanceof ApiRequestError ? e.api.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const backupNow = (): Promise<void> =>
    run(async () => {
      await api.post('/backups', passphrase ? { passphrase } : {});
      setMsg('สำรองข้อมูลสำเร็จและตรวจสอบแล้ว');
    });

  const restore = (id: string): Promise<void> =>
    run(async () => {
      if (!window.confirm('กู้คืนข้อมูลจากไฟล์นี้? ข้อมูลปัจจุบันจะถูกแทนที่ (มีการสำรองอัตโนมัติก่อนกู้คืน)')) {
        return;
      }
      const r = await api.post<{ preRestoreBackupId: string }>(`/backups/${id}/restore`, {
        confirm: 'RESTORE',
        ...(passphrase ? { passphrase } : {}),
      });
      setMsg(`กู้คืนสำเร็จ (สำรองก่อนกู้คืน: ${r.preRestoreBackupId.slice(0, 8)})`);
    });

  const del = (id: string): Promise<void> =>
    run(async () => {
      await api.del(`/backups/${id}`);
      setMsg('ลบไฟล์สำรองแล้ว');
    });

  return (
    <div className="mx-auto max-w-4xl p-8">
      <h1 className="text-2xl font-semibold">สำรอง / กู้คืนข้อมูล</h1>

      {status && (
        <div className="mt-3 rounded-lg border bg-white p-4 text-sm">
          สำรองล่าสุด: <span className="font-semibold">{status.lastBackupAt ? dateTh(status.lastBackupAt.slice(0, 10)) : '—'}</span>
          <span className="mx-2">·</span>
          ไฟล์ที่ตรวจสอบแล้ว: <span className="font-semibold">{status.verifiedCount}</span>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-end gap-3 rounded-lg border bg-white p-4 text-sm">
        <label className="flex flex-col">
          รหัสผ่านสำรองข้อมูล
          <input
            type="password"
            className="mt-1 rounded border px-2 py-1"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            placeholder="ใช้ค่าจากเซิร์ฟเวอร์ถ้าเว้นว่าง"
          />
        </label>
        <button
          type="button"
          onClick={backupNow}
          disabled={busy}
          className="rounded bg-slate-900 px-4 py-1.5 text-white disabled:opacity-50"
        >
          สำรองข้อมูลตอนนี้
        </button>
      </div>

      {msg && <p className="mt-3 text-green-700">{msg}</p>}
      {err && <p className="mt-3 text-red-600">{err}</p>}

      <table className="mt-4 w-full border-collapse text-sm">
        <thead>
          <tr className="border-b text-left text-slate-500">
            <th className="px-2 py-1">วันที่</th>
            <th className="px-2">ชนิด</th>
            <th className="px-2 text-right">ขนาด</th>
            <th className="px-2">Schema</th>
            <th className="px-2">สถานะ</th>
            <th className="px-2">การกระทำ</th>
          </tr>
        </thead>
        <tbody>
          {list.map((b) => (
            <tr key={b.id} className="border-b">
              <td className="px-2 py-1">{new Date(b.createdAt).toLocaleString('th-TH')}</td>
              <td className="px-2">{b.kind}</td>
              <td className="px-2 text-right tabular-nums">{fmtSize(b.sizeBytes)}</td>
              <td className="px-2 font-mono text-xs">{b.schemaVersion}</td>
              <td className="px-2">{b.verifiedAt ? '✅ ตรวจสอบแล้ว' : b.localStatus}</td>
              <td className="px-2">
                <div className="flex gap-1">
                  <a className="rounded border px-2 py-0.5 text-xs hover:bg-slate-100" href={`/api/backups/${b.id}/download`}>
                    ดาวน์โหลด
                  </a>
                  <button
                    type="button"
                    onClick={() => restore(b.id)}
                    disabled={busy}
                    className="rounded border px-2 py-0.5 text-xs hover:bg-slate-100"
                  >
                    กู้คืน
                  </button>
                  <button
                    type="button"
                    onClick={() => del(b.id)}
                    disabled={busy}
                    className="rounded border border-red-300 px-2 py-0.5 text-xs text-red-700 hover:bg-red-50"
                  >
                    ลบ
                  </button>
                </div>
              </td>
            </tr>
          ))}
          {list.length === 0 && (
            <tr>
              <td colSpan={6} className="py-6 text-center text-slate-400">
                ยังไม่มีไฟล์สำรอง
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <p className="mt-4 text-xs text-slate-400">
        การสำรองบนคลาวด์ยังไม่เปิดใช้งาน (รอการตั้งค่าผู้ให้บริการ) — ไฟล์สำรองถูกเข้ารหัส AES-256-GCM
        และเก็บไว้ในเครื่องเท่านั้น
      </p>
    </div>
  );
}
