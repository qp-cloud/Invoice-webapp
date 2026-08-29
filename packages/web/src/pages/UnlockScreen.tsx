import { useState } from 'react';
import { api, ApiRequestError } from '../api/client.js';

export function UnlockScreen({ onUnlocked }: { onUnlocked: () => void }): JSX.Element {
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.post('/auth/unlock', { pin });
      onUnlocked();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.api.message : 'ปลดล็อกไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50">
      <form onSubmit={submit} className="w-80 rounded-lg border bg-white p-6 shadow-sm">
        <h1 className="text-lg font-semibold">ระบบสต็อกสินค้า</h1>
        <p className="mt-1 text-sm text-slate-500">กรุณาใส่รหัสผ่านเพื่อเข้าใช้งาน</p>
        <input
          type="password"
          autoFocus
          className="mt-4 w-full rounded border px-3 py-2"
          value={pin}
          onChange={(ev) => setPin(ev.target.value)}
          placeholder="รหัสผ่าน"
        />
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={busy || pin.length === 0}
          className="mt-4 w-full rounded bg-slate-900 px-4 py-2 text-white disabled:opacity-50"
        >
          {busy ? 'กำลังปลดล็อก…' : 'ปลดล็อก'}
        </button>
      </form>
    </div>
  );
}
