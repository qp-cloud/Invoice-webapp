import { useCallback, useEffect, useState } from 'react';
import { api } from './api/client.js';
import { useOffline } from './offline/store.js';
import { BackupPage } from './pages/BackupPage.js';
import { DashboardPage } from './pages/DashboardPage.js';
import { ImportPage } from './pages/ImportPage.js';
import { ReportsPage } from './pages/ReportsPage.js';
import { StockPage } from './pages/StockPage.js';
import { SyncPage } from './pages/SyncPage.js';
import { UnlockScreen } from './pages/UnlockScreen.js';

type View = 'dashboard' | 'stock' | 'reports' | 'import' | 'sync' | 'backup';

export function App(): JSX.Element {
  const [view, setView] = useState<View>('dashboard');
  const [locked, setLocked] = useState<boolean | null>(null);
  const { online, pendingCount, conflictCount, refresh } = useOffline();

  const checkAuth = useCallback(async () => {
    try {
      const s = await api.get<{ authRequired: boolean; unlocked: boolean }>('/auth/status');
      setLocked(s.authRequired && !s.unlocked);
    } catch {
      setLocked(false);
    }
  }, []);

  useEffect(() => {
    void checkAuth();
    const onLocked = (): void => setLocked(true);
    window.addEventListener('inv:locked', onLocked);
    return () => window.removeEventListener('inv:locked', onLocked);
  }, [checkAuth]);

  useEffect(() => {
    if (locked === false) void refresh();
  }, [refresh, view, locked]);

  if (locked === null) return <div className="p-8 text-slate-400">…</div>;
  if (locked) return <UnlockScreen onUnlocked={() => setLocked(false)} />;

  const queued = pendingCount + conflictCount;

  return (
    <div className="min-h-screen">
      <nav className="flex items-center gap-1 border-b bg-white px-6 py-3">
        <span className="mr-4 font-semibold">ระบบสต็อกสินค้า</span>
        <NavButton active={view === 'dashboard'} onClick={() => setView('dashboard')}>
          แดชบอร์ด
        </NavButton>
        <NavButton active={view === 'stock'} onClick={() => setView('stock')}>
          สต็อก
        </NavButton>
        <NavButton active={view === 'reports'} onClick={() => setView('reports')}>
          รายงาน
        </NavButton>
        <NavButton active={view === 'import'} onClick={() => setView('import')}>
          นำเข้า/ส่งออก
        </NavButton>
        <NavButton active={view === 'sync'} onClick={() => setView('sync')}>
          ซิงค์{queued > 0 ? ` (${queued})` : ''}
        </NavButton>
        <NavButton active={view === 'backup'} onClick={() => setView('backup')}>
          สำรองข้อมูล
        </NavButton>
        <span className="ml-auto text-xs text-slate-500">
          {online ? '🟢 ออนไลน์' : '🔴 ออฟไลน์'}
        </span>
      </nav>
      {!online && (
        <div className="bg-amber-100 px-6 py-1.5 text-center text-sm text-amber-800">
          ออฟไลน์ — รายการใหม่จะถูกจัดคิวไว้ซิงค์ภายหลัง
        </div>
      )}
      {view === 'dashboard' && <DashboardPage />}
      {view === 'stock' && <StockPage />}
      {view === 'reports' && <ReportsPage />}
      {view === 'import' && <ImportPage />}
      {view === 'sync' && <SyncPage />}
      {view === 'backup' && <BackupPage />}
    </div>
  );
}

function NavButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded px-3 py-1.5 text-sm ${
        active ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
      }`}
    >
      {children}
    </button>
  );
}
