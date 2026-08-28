import { useEffect, useState } from 'react';

interface Health {
  ok: boolean;
  db: string;
  schemaVersion: string | null;
  appVersion: string;
}

export function App(): JSX.Element {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/health')
      .then((r) => r.json() as Promise<Health>)
      .then(setHealth)
      .catch((e: unknown) => setError(String(e)));
  }, []);

  return (
    <div className="mx-auto max-w-3xl p-8">
      <h1 className="text-2xl font-semibold">ระบบจัดการสต็อกสินค้า</h1>
      <p className="mt-2 text-slate-600">Single-owner inventory management — Phase 1 scaffold.</p>

      <section className="mt-6 rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="font-medium">สถานะระบบ</h2>
        {error && <p className="mt-2 text-red-600">API error: {error}</p>}
        {!error && !health && <p className="mt-2 text-slate-500">กำลังตรวจสอบ…</p>}
        {health && (
          <ul className="mt-2 space-y-1 text-sm">
            <li>API: {health.ok ? '🟢 ok' : '🔴 down'}</li>
            <li>Database: {health.db}</li>
            <li>Schema: {health.schemaVersion ?? '—'}</li>
            <li>App version: {health.appVersion}</li>
          </ul>
        )}
      </section>
    </div>
  );
}
