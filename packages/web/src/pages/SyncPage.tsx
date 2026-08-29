import { useCallback, useEffect, useState } from 'react';
import type { QueueItem } from '../offline/db.js';
import { allItems, discardItem, flush, retryItem } from '../offline/engine.js';
import { useOffline } from '../offline/store.js';

const STATUS_STYLE: Record<QueueItem['syncStatus'], string> = {
  PENDING: 'text-amber-700',
  SYNCING: 'text-blue-700',
  SYNCED: 'text-green-700',
  FAILED: 'text-red-700',
  CONFLICT: 'text-red-700',
};

const ENDPOINT_LABEL: Record<string, string> = {
  '/purchases': 'ซื้อเข้า',
  '/sales': 'ขายออก',
  '/returns': 'รับคืน',
  '/adjustments': 'ปรับปรุงสต็อก',
};

export function SyncPage(): JSX.Element {
  const [items, setItems] = useState<QueueItem[]>([]);
  const { online, refresh } = useOffline();

  const reload = useCallback(async () => {
    setItems(await allItems());
    await refresh();
  }, [refresh]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const doFlush = async (): Promise<void> => {
    await flush();
    await reload();
  };
  const doRetry = async (localId: string): Promise<void> => {
    await retryItem(localId);
    await reload();
  };
  const doDiscard = async (localId: string): Promise<void> => {
    await discardItem(localId);
    await reload();
  };

  const active = items.filter((i) => i.syncStatus !== 'SYNCED');

  return (
    <div className="mx-auto max-w-5xl p-8">
      <h1 className="text-2xl font-semibold">รายการรอซิงค์ / ขัดแย้ง</h1>
      <p className="mt-1 text-sm text-slate-500">
        สถานะ: {online ? 'ออนไลน์' : 'ออฟไลน์'} · รอซิงค์ {active.filter((i) => i.syncStatus !== 'CONFLICT').length} ·
        ขัดแย้ง {active.filter((i) => i.syncStatus === 'CONFLICT').length}
      </p>

      <button
        type="button"
        onClick={doFlush}
        disabled={!online}
        className="mt-3 rounded bg-slate-900 px-4 py-1.5 text-sm text-white disabled:opacity-50"
      >
        ซิงค์เดี๋ยวนี้
      </button>

      <table className="mt-4 w-full border-collapse text-sm">
        <thead>
          <tr className="border-b text-left text-slate-500">
            <th className="px-2 py-1">ประเภท</th>
            <th className="px-2">ข้อมูล</th>
            <th className="px-2">สถานะ</th>
            <th className="px-2">ปัญหา</th>
            <th className="px-2">การกระทำ</th>
          </tr>
        </thead>
        <tbody>
          {active.map((i) => (
            <tr key={i.localId} className="border-b align-top">
              <td className="px-2 py-1">{ENDPOINT_LABEL[i.endpoint] ?? i.endpoint}</td>
              <td className="px-2 font-mono text-xs">{JSON.stringify(i.payload)}</td>
              <td className={`px-2 font-medium ${STATUS_STYLE[i.syncStatus]}`}>
                {i.syncStatus}
                {i.retryCount > 0 && <span className="text-slate-400"> ×{i.retryCount}</span>}
              </td>
              <td className="px-2 text-xs text-red-600">{i.error ?? ''}</td>
              <td className="px-2">
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => doRetry(i.localId)}
                    className="rounded border px-2 py-0.5 text-xs hover:bg-slate-100"
                  >
                    ลองใหม่
                  </button>
                  <button
                    type="button"
                    onClick={() => doDiscard(i.localId)}
                    className="rounded border border-red-300 px-2 py-0.5 text-xs text-red-700 hover:bg-red-50"
                  >
                    ทิ้ง
                  </button>
                </div>
              </td>
            </tr>
          ))}
          {active.length === 0 && (
            <tr>
              <td colSpan={5} className="py-6 text-center text-slate-400">
                ไม่มีรายการค้าง
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
