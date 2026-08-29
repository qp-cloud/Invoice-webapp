import { useState } from 'react';
import { DashboardPage } from './pages/DashboardPage.js';
import { StockPage } from './pages/StockPage.js';

type View = 'dashboard' | 'stock';

export function App(): JSX.Element {
  const [view, setView] = useState<View>('dashboard');

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
      </nav>
      {view === 'dashboard' ? <DashboardPage /> : <StockPage />}
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
