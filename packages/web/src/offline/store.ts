import { create } from 'zustand';
import { allItems, flush, isOnline } from './engine.js';

interface OfflineState {
  online: boolean;
  pendingCount: number;
  conflictCount: number;
  refresh: () => Promise<void>;
  flushNow: () => Promise<void>;
  setOnline: (v: boolean) => void;
}

export const useOffline = create<OfflineState>((set, get) => ({
  online: isOnline(),
  pendingCount: 0,
  conflictCount: 0,
  refresh: async () => {
    try {
      const items = await allItems();
      set({
        pendingCount: items.filter((i) => ['PENDING', 'SYNCING', 'FAILED'].includes(i.syncStatus)).length,
        conflictCount: items.filter((i) => i.syncStatus === 'CONFLICT').length,
      });
    } catch {
      set({ pendingCount: 0, conflictCount: 0 });
    }
  },
  flushNow: async () => {
    if (!get().online) return;
    await flush();
    await get().refresh();
  },
  setOnline: (v) => {
    set({ online: v });
    if (v) void get().flushNow();
  },
}));

/** Call once at startup: wire browser connectivity events + an initial flush. */
export function initOffline(): void {
  if (typeof window === 'undefined') return;
  const { setOnline, refresh, flushNow } = useOffline.getState();
  window.addEventListener('online', () => setOnline(true));
  window.addEventListener('offline', () => setOnline(false));
  void refresh();
  void flushNow();
}
