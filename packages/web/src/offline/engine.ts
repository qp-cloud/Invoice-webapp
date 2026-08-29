import { odb, type QueueItem } from './db.js';

export type FetchLike = typeof fetch;

// Strictly increasing ordinal so FIFO holds even for items enqueued in the same
// millisecond. Time-dominant across sessions, counter-tie-broken within one.
let ordCounter = 0;
const nextOrd = (): number => Date.now() * 10_000 + (ordCounter++ % 10_000);

export function isOnline(): boolean {
  return typeof navigator === 'undefined' ? true : navigator.onLine;
}

/** IndexedDB is absent in some test/SSR contexts — the offline queue is a no-op there. */
export function hasStorage(): boolean {
  return typeof indexedDB !== 'undefined';
}

/** Queue a locally-created operation. The idempotency key is generated once and reused. */
export async function enqueue(endpoint: string, payload: unknown): Promise<QueueItem> {
  if (!hasStorage()) throw new Error('offline storage unavailable');
  const item: QueueItem = {
    localId: crypto.randomUUID(),
    serverId: null,
    idempotencyKey: crypto.randomUUID(),
    endpoint,
    syncStatus: 'PENDING',
    retryCount: 0,
    ord: nextOrd(),
    createdAt: new Date().toISOString(),
    syncedAt: null,
    payload,
    error: null,
  };
  await odb.queue.add(item);
  return item;
}

const byOrd = (a: QueueItem, b: QueueItem): number =>
  (a.ord ?? 0) - (b.ord ?? 0) || a.createdAt.localeCompare(b.createdAt);

export async function allItems(): Promise<QueueItem[]> {
  if (!hasStorage()) return [];
  return (await odb.queue.toArray()).sort(byOrd);
}

async function due(): Promise<QueueItem[]> {
  const items = await odb.queue
    .where('syncStatus')
    .anyOf('PENDING', 'FAILED')
    .toArray();
  return items.sort(byOrd);
}

export interface FlushSummary {
  attempted: number;
  synced: number;
  conflicts: number;
  retried: number;
}

/**
 * Flush the queue in FIFO order (spec §12.2). The whole due set goes to `POST /api/sync`,
 * which processes it one at a time. A typed conflict parks that item; a network/5xx
 * failure leaves the batch PENDING with a bumped retry count for the caller to back off.
 */
export async function flush(fetchFn: FetchLike = fetch): Promise<FlushSummary> {
  if (!hasStorage()) return { attempted: 0, synced: 0, conflicts: 0, retried: 0 };
  const items = await due();
  if (items.length === 0) return { attempted: 0, synced: 0, conflicts: 0, retried: 0 };

  await Promise.all(items.map((i) => odb.queue.update(i.localId, { syncStatus: 'SYNCING' })));
  const operations = items.map((i) => ({
    localId: i.localId,
    idempotencyKey: i.idempotencyKey,
    endpoint: i.endpoint,
    body: i.payload,
  }));

  const parkPending = async (error: string): Promise<FlushSummary> => {
    await Promise.all(
      items.map((i) =>
        odb.queue.update(i.localId, {
          syncStatus: 'PENDING',
          retryCount: i.retryCount + 1,
          error,
        }),
      ),
    );
    return { attempted: items.length, synced: 0, conflicts: 0, retried: items.length };
  };

  let res: Response;
  try {
    res = await fetchFn('/api/sync', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ operations }),
    });
  } catch (e) {
    return parkPending(String(e));
  }
  if (!res.ok) return parkPending(`HTTP ${res.status}`);

  const data = (await res.json()) as {
    results: {
      localId: string;
      status: 'SYNCED' | 'CONFLICT';
      serverId?: string | null;
      code?: string;
      message?: string;
      replayed?: boolean;
    }[];
  };

  let synced = 0;
  let conflicts = 0;
  const seen = new Set<string>();
  for (const r of data.results) {
    seen.add(r.localId);
    if (r.status === 'SYNCED') {
      synced += 1;
      await odb.queue.update(r.localId, {
        syncStatus: 'SYNCED',
        serverId: r.serverId ?? null,
        syncedAt: new Date().toISOString(),
        error: null,
      });
    } else {
      conflicts += 1;
      await odb.queue.update(r.localId, {
        syncStatus: 'CONFLICT',
        error: `${r.code ?? 'CONFLICT'}: ${r.message ?? ''}`,
      });
    }
  }
  // any item the server did not report -> leave for the next flush
  for (const i of items) {
    if (!seen.has(i.localId)) await odb.queue.update(i.localId, { syncStatus: 'PENDING' });
  }

  return { attempted: items.length, synced, conflicts, retried: 0 };
}

export async function retryItem(localId: string, fetchFn: FetchLike = fetch): Promise<FlushSummary> {
  await odb.queue.update(localId, { syncStatus: 'PENDING', error: null });
  return flush(fetchFn);
}

export async function editAndRetry(
  localId: string,
  payload: unknown,
  fetchFn: FetchLike = fetch,
): Promise<FlushSummary> {
  await odb.queue.update(localId, {
    syncStatus: 'PENDING',
    payload,
    idempotencyKey: crypto.randomUUID(),
    error: null,
  });
  return flush(fetchFn);
}

export async function discardItem(localId: string): Promise<void> {
  await odb.queue.delete(localId);
}
