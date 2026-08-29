import { useEffect, useState } from 'react';
import { useOffline } from './offline/store.js';
import { DashboardPage } from './pages/DashboardPage.js';
import { ImportPage } from './pages/ImportPage.js';
import { ReportsPage } from './pages/ReportsPage.js';
import { StockPage } from './pages/StockPage.js';
import { SyncPage } from './pages/SyncPage.js';

type View = 'dashboard' | 'stock' | 'reports' | 'import' | 'sync';

export function App(): JSX.Element {
  const [view, setView] = useState<View>('dashboard');
  const { online, pendingCount, conflictCount, refresh } = useOffline();

  useEffect(() => {
    void refresh();
  }, [refresh, view]);

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
