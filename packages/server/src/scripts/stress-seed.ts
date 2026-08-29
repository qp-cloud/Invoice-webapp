import { randomUUID } from 'node:crypto';
import { closeDb, getDb } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { ensurePeriod } from '../services/periods.js';
import { logger } from '../logger.js';

/**
 * Scale fixture (spec §21): ~10k products, ~100k movements. Raw batched INSERTs, all
 * inflows at one unit cost, so `stock_state` can be filled set-based and stays
 * reconciliation-clean. Best run against real Postgres: DATABASE_URL=... npm run seed:stress
 */
const PRODUCTS = Number(process.env.STRESS_PRODUCTS ?? 10_000);
const MOVES_PER_PRODUCT = Number(process.env.STRESS_MOVES ?? 10);
const CHUNK = 1_000;
const UNIT_COST = 5_000;

async function main(): Promise<void> {
  const db = getDb();
  await runMigrations(db);
  const today = new Date().toISOString().slice(0, 10);
  const period = await ensurePeriod(db, today.slice(0, 7));

  const t0 = Date.now();
  const productIds: string[] = [];

  for (let start = 0; start < PRODUCTS; start += CHUNK) {
    const end = Math.min(start + CHUNK, PRODUCTS);
    const values: string[] = [];
    const params: unknown[] = [];
    for (let i = start; i < end; i += 1) {
      const id = randomUUID();
      productIds.push(id);
      const p = params.length;
      params.push(id, `STRESS-${String(i).padStart(6, '0')}`, `Stress ${i}`, 'piece', 0);
      values.push(`($${p + 1},$${p + 2},$${p + 3},$${p + 4},$${p + 5})`);
    }
    await db.query(
      `INSERT INTO products (id, sku, name, unit_code, min_stock) VALUES ${values.join(',')}`,
      params,
    );
    await db.query(
      `INSERT INTO stock_state (product_id) SELECT unnest($1::uuid[])`,
      [productIds.slice(start, end)],
    );
  }
  logger.info({ products: productIds.length, ms: Date.now() - t0 }, 'products inserted');

  const t1 = Date.now();
  let moveBuf: string[] = [];
  let moveParams: unknown[] = [];
  let pending = 0;
  const flush = async (): Promise<void> => {
    if (pending === 0) return;
    await db.query(
      `INSERT INTO movements
         (product_id, type, quantity, occurred_on, period_id, unit_cost_satang, source_kind)
       VALUES ${moveBuf.join(',')}`,
      moveParams,
    );
    moveBuf = [];
    moveParams = [];
    pending = 0;
  };

  for (const pid of productIds) {
    for (let m = 0; m < MOVES_PER_PRODUCT; m += 1) {
      const type = m === 0 ? 'OPENING' : 'PURCHASE';
      const p = moveParams.length;
      moveParams.push(pid, type, '100', today, period.id, UNIT_COST, type);
      moveBuf.push(`($${p + 1},$${p + 2},$${p + 3},$${p + 4},$${p + 5},$${p + 6},$${p + 7})`);
      pending += 1;
      if (pending >= CHUNK) await flush();
    }
  }
  await flush();
  logger.info({ movements: productIds.length * MOVES_PER_PRODUCT, ms: Date.now() - t1 }, 'movements inserted');

  const t2 = Date.now();
  await db.query(`
    UPDATE stock_state ss SET
      qty_on_hand = agg.qty,
      total_cost_satang = agg.qty * ${UNIT_COST},
      avg_cost_micro = ${UNIT_COST} * 10000,
      last_nonzero_avg_micro = ${UNIT_COST} * 10000,
      last_seq = agg.max_seq,
      updated_at = now()
    FROM (
      SELECT product_id, sum(quantity) AS qty, max(seq) AS max_seq
      FROM movements GROUP BY product_id
    ) agg
    WHERE ss.product_id = agg.product_id
  `);
  logger.info({ ms: Date.now() - t2 }, 'stock_state filled');
  logger.info({ totalMs: Date.now() - t0 }, 'stress seed complete');
}

main()
  .catch((err) => {
    logger.error({ err }, 'stress seed failed');
    process.exitCode = 1;
  })
  .finally(closeDb);
