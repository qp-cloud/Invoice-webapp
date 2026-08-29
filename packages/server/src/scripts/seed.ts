import { randomUUID } from 'node:crypto';
import { closeDb, getDb } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { createOpening, createPurchase, createSale } from '../services/documents.js';
import { createProduct } from '../services/products.js';
import { logger } from '../logger.js';

/** Spec §23 mock dataset. Idempotent-ish: refuses to run if products already exist. */
const DATASET = [
  { sku: 'SKU-001', name: 'สินค้า A', opening: '1000', purchase: '8000', sale: '7700', min: '500' },
  { sku: 'SKU-002', name: 'สินค้า B', opening: '500', purchase: '5000', sale: '5350', min: '300' },
  { sku: 'SKU-003', name: 'สินค้า C', opening: '200', purchase: '300', sale: '500', min: '50' },
  { sku: 'SKU-004', name: 'สินค้า D', opening: '50', purchase: '0', sale: '70', min: '20' },
];

async function main(): Promise<void> {
  const db = getDb();
  await runMigrations(db);

  const existing = await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM products`);
  if (Number(existing.rows[0]!.n) > 0 && !process.argv.includes('--force')) {
    logger.warn('products already exist — pass --force to seed anyway');
    return;
  }

  const today = new Date().toISOString().slice(0, 10);
  const key = (): string => randomUUID();

  for (const row of DATASET) {
    const product = await createProduct(db, {
      sku: row.sku, name: row.name, unitCode: 'piece', minStock: row.min,
    });
    await createOpening(db, key(), {
      productId: product.id, quantity: row.opening, unitCostSatang: 10_000, occurredOn: today,
    });
    if (row.purchase !== '0') {
      await createPurchase(db, key(), {
        productId: product.id, quantity: row.purchase, unitCostSatang: 10_000, occurredOn: today,
      });
    }
    if (row.sale !== '0') {
      await createSale(db, key(), {
        productId: product.id, quantity: row.sale, unitPriceSatang: 15_000, occurredOn: today,
      });
    }
    logger.info({ sku: row.sku }, 'seeded');
  }
  logger.info('mock dataset seeded (spec §23)');
}

main()
  .catch((err) => {
    logger.error({ err }, 'seed failed');
    process.exitCode = 1;
  })
  .finally(closeDb);
