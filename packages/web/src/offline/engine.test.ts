import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { odb } from './db.js';
import { allItems, enqueue, flush, retryItem } from './engine.js';

afterEach(async () => {
  await odb.queue.clear();
  vi.restoreAllMocks();
});

const jsonResponse = (body: unknown): Response =>
  ({ ok: true, status: 200, json: async () => body }) as Response;

describe('offline sync engine (spec §12.2)', () => {
  it('queues operations as PENDING with a reused idempotency key', async () => {
    const a = await enqueue('/purchases', { productId: 'p1', quantity: '5' });
    await enqueue('/sales', { productId: 'p1', quantity: '2' });

    const items = await allItems();
    expect(items).toHaveLength(2);
    expect(items.every((i) => i.syncStatus === 'PENDING')).toBe(true);
    expect(a.idempotencyKey).toMatch(/[0-9a-f-]{36}/);
  });

  it('flushes in FIFO order; SYNCED and CONFLICT results are applied per item', async () => {
    const a = await enqueue('/purchases', { productId: 'p1', quantity: '5' });
    const b = await enqueue('/sales', { productId: 'p1', quantity: '999' });

    const fetchFn = vi.fn(async (_url: string, init?: RequestInit) => {
      const sent = JSON.parse(String(init?.body)) as { operations: { localId: string }[] };
      expect(sent.operations.map((o) => o.localId)).toEqual([a.localId, b.localId]); // FIFO
      return jsonResponse({
        results: [
          { localId: a.localId, status: 'SYNCED', serverId: 'srv-a', replayed: false },
          { localId: b.localId, status: 'CONFLICT', code: 'STOCK_WOULD_GO_NEGATIVE', message: 'ติดลบ' },
        ],
      });
    });

    const summary = await flush(fetchFn as unknown as typeof fetch);
    expect(summary).toMatchObject({ attempted: 2, synced: 1, conflicts: 1 });

    const items = await allItems();
    expect(items.find((i) => i.localId === a.localId)?.syncStatus).toBe('SYNCED');
    expect(items.find((i) => i.localId === a.localId)?.serverId).toBe('srv-a');
    const conflict = items.find((i) => i.localId === b.localId);
    expect(conflict?.syncStatus).toBe('CONFLICT');
    expect(conflict?.error).toContain('STOCK_WOULD_GO_NEGATIVE');
  });

  it('a network failure parks the batch back to PENDING and bumps retryCount', async () => {
    await enqueue('/purchases', { productId: 'p1', quantity: '5' });
    const fetchFn = vi.fn(async () => {
      throw new Error('offline');
    });

    const summary = await flush(fetchFn as unknown as typeof fetch);
    expect(summary).toMatchObject({ synced: 0, retried: 1 });

    const [item] = await allItems();
    expect(item!.syncStatus).toBe('PENDING');
    expect(item!.retryCount).toBe(1);
  });

  it('retrying a conflicted item re-sends it and can succeed, creating nothing extra', async () => {
    const a = await enqueue('/sales', { productId: 'p1', quantity: '3' });
    await flush(
      (async () =>
        jsonResponse({
          results: [{ localId: a.localId, status: 'CONFLICT', code: 'PERIOD_CLOSED', message: 'x' }],
        })) as unknown as typeof fetch,
    );
    expect((await allItems())[0]!.syncStatus).toBe('CONFLICT');

    await retryItem(
      a.localId,
      (async () =>
        jsonResponse({
          results: [{ localId: a.localId, status: 'SYNCED', serverId: 'srv-x', replayed: true }],
        })) as unknown as typeof fetch,
    );

    const items = await allItems();
    expect(items).toHaveLength(1);
    expect(items[0]!.syncStatus).toBe('SYNCED');
    expect(items[0]!.serverId).toBe('srv-x');
  });
});
