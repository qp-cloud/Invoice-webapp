import Dexie, { type Table } from 'dexie';

export type SyncStatus = 'PENDING' | 'SYNCING' | 'SYNCED' | 'FAILED' | 'CONFLICT';

/** One locally-created operation waiting to reach the server (spec §12.2). */
export interface QueueItem {
  localId: string;
  serverId: string | null;
  idempotencyKey: string;
  endpoint: string;
  syncStatus: SyncStatus;
  retryCount: number;
  createdAt: string;
  syncedAt: string | null;
  payload: unknown;
  error: string | null;
}

class OfflineDb extends Dexie {
  queue!: Table<QueueItem, string>;
  prefs!: Table<{ key: string; value: unknown }, string>;

  constructor() {
    super('inventory-offline');
    this.version(1).stores({
      queue: 'localId, syncStatus, createdAt',
      prefs: 'key',
    });
  }
}

export const odb = new OfflineDb();
