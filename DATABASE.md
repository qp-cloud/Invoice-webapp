# DATABASE.md — Schema, Constraints, Indexes

> Subordinate to `PROJECT_SPEC.md`. If this file and the spec disagree, the spec wins —
> open a Change Log entry in the spec and fix this file.
> Engine: **PostgreSQL 16** in production; **PGlite (embedded Postgres 16)** for dev/test
> (Docker unavailable in the build env — spec §3.2 / Change Log v0.3).
> Migrations: hand-written SQL files in `packages/server/src/db/migrations/` (`0001_init.sql`,
> `0002_seed.sql`, `0003_periods_fy2569.sql`) applied in filename order by a small runner
> that records applied ids in a `_migrations(id text pk, applied_at timestamptz)` table.
> Forward-only. Drizzle ORM is used for typed queries only, not migration codegen.
>
> **PGlite fidelity notes:** single connection / single process — `pg_advisory_xact_lock`
> and `SELECT … FOR UPDATE` work but cannot be exercised by genuinely parallel clients
> (concurrency tests → real Postgres only, `TESTING.md` §3.5). If `citext` / `pg_trgm` are
> not bundled: store `sku` as lower-cased `text` with a `UNIQUE` index and do name search
> with `ILIKE` — decided at implementation time, recorded here.
> All money columns are integer **satang** (`BIGINT`), suffix `_satang`. All quantities are
> `NUMERIC(18,3)`. All timestamps are `timestamptz` (UTC). Business dates are `DATE`.

---

## 0. Conventions

- **Primary keys:** `uuid` via `gen_random_uuid()` (built-in in PG16). Client-generated
  UUIDs are accepted for offline-created rows (`local_id`).
- **Enums:** modelled as `TEXT` + `CHECK (col IN (...))`, not native `pg enum`. Rationale:
  adding a value is a one-line migration with no `ALTER TYPE ... ADD VALUE` transaction
  restrictions, and the shared `zod` enums are the real contract.
- **Soft-delete / void:** rows are never `DELETE`d in normal operation (§5.6 of spec).
  `status` moves `ACTIVE → VOIDED`.
- **Derived caches:** `stock_state` is a cache of `replayLedger(movements)`. It is written
  in the same transaction as every movement and independently rebuilt by the
  reconciliation job. It is never the answer of record.
- **updated_at:** set by the application; a trigger (`set_updated_at`) is a backstop on
  `products`, `settings`.
- Extensions required: `pgcrypto` is not needed for `gen_random_uuid()` on PG16; enable
  `citext` for `products.sku`.

---

## 1. Enumerated value sets (TEXT + CHECK)

| Set | Values |
| --- | --- |
| `movement_type` | `OPENING`, `PURCHASE`, `SALE`, `CUSTOMER_RETURN`, `SUPPLIER_RETURN`, `DAMAGE`, `ADJUSTMENT`, `TRANSFER_IN`, `TRANSFER_OUT` |
| `movement_source_kind` | `OPENING`, `PURCHASE`, `SALE`, `RETURN`, `ADJUSTMENT` |
| `doc_status` | `ACTIVE`, `VOIDED` |
| `period_status` | `OPEN`, `CLOSED` |
| `return_kind` | `CUSTOMER`, `SUPPLIER` |
| `adjust_reason` | `STOCK_COUNT`, `DAMAGED`, `LOST`, `FOUND_EXTRA`, `CORRECTION`, `OTHER` |
| `negative_stock_mode` | `ALLOW`, `PREVENT` |
| `import_kind` | `MASTER_STOCK`, `PURCHASES`, `SALES` |
| `import_status` | `PREVIEW`, `COMMITTED`, `DISCARDED`, `FAILED` |
| `import_mode` | `ALL_OR_NOTHING`, `PARTIAL` |
| `import_row_action` | `CREATE`, `UPDATE`, `SKIP`, `DUPLICATE` |
| `backup_kind` | `AUTO`, `MANUAL`, `PRE_RESTORE` |
| `backup_local_status` | `LOCAL_BACKUP_SUCCESS`, `LOCAL_BACKUP_FAILED` |
| `backup_cloud_status` | `NOT_ATTEMPTED`, `CLOUD_UPLOAD_SUCCESS`, `CLOUD_UPLOAD_FAILED` |
| `audit_action` | `CREATE`, `UPDATE`, `VOID`, `CLOSE_PERIOD`, `REOPEN_PERIOD`, `ROLL_FISCAL_YEAR`, `IMPORT_COMMIT`, `BACKUP`, `RESTORE`, `COST_BASIS_RESET`, `SETTINGS_CHANGE` |

**Inflow types** (`quantity > 0`): `OPENING`, `PURCHASE`, `CUSTOMER_RETURN`, `TRANSFER_IN`.
**Outflow types** (`quantity < 0`): `SALE`, `SUPPLIER_RETURN`, `DAMAGE`, `TRANSFER_OUT`.
**`ADJUSTMENT`**: `quantity <> 0`, either sign.

---

## 2. Tables

### 2.1 `settings`

Single-row-per-key key/value store for owner configuration.

| Column | Type | Notes |
| --- | --- | --- |
| `key` | `text` PK | e.g. `negative_stock_mode`, `current_fiscal_year`, `thai_dates`, `backdate_reason_threshold_days`, `backup_interval_hours`, `cloud_backup_enabled` |
| `value` | `jsonb` NOT NULL | |
| `updated_at` | `timestamptz` NOT NULL DEFAULT `now()` | trigger-maintained |

Seed keys (migration `0002_seed`):

```
negative_stock_mode            = "ALLOW"
current_fiscal_year            = 2569
thai_dates                     = true
backdate_reason_threshold_days = 7
backup_interval_hours          = 24
cloud_backup_enabled           = false
```

### 2.2 `categories`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `name` | `text` NOT NULL UNIQUE | |
| `created_at` | `timestamptz` NOT NULL DEFAULT `now()` | |

### 2.3 `units` (conversion-ready, unused conversion in v1)

| Column | Type | Notes |
| --- | --- | --- |
| `code` | `text` PK | `piece`, `box`, `pack`, `kg`, `g`, `meter`, `liter`, … |
| `name_th` | `text` NOT NULL | display label |
| `base_unit_code` | `text` NULL → `units(code)` | NULL = it is a base unit |
| `factor` | `numeric(18,6)` NULL | units of `base_unit_code` per 1 of this unit; NULL when base |
| `created_at` | `timestamptz` NOT NULL DEFAULT `now()` | |

CHECK: `(base_unit_code IS NULL AND factor IS NULL) OR (base_unit_code IS NOT NULL AND factor > 0)`.
v1 business logic **must not** read `factor` — reserved for a later conversion feature.

### 2.4 `products`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `sku` | `citext` NOT NULL UNIQUE | already normalized by `cleanData` (§7.1); `citext` is a backstop |
| `name` | `text` NOT NULL | |
| `category_id` | `uuid` NULL → `categories(id)` | `ON DELETE SET NULL` |
| `unit_code` | `text` NOT NULL → `units(code)` | `ON DELETE RESTRICT` |
| `min_stock` | `numeric(18,3)` NOT NULL DEFAULT `0` | CHECK `>= 0` |
| `active` | `boolean` NOT NULL DEFAULT `true` | |
| `created_at` | `timestamptz` NOT NULL DEFAULT `now()` | |
| `updated_at` | `timestamptz` NOT NULL DEFAULT `now()` | trigger-maintained |

### 2.5 `periods`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `ym` | `text` NOT NULL UNIQUE | Gregorian `YYYY-MM`; CHECK `ym ~ '^\d{4}-\d{2}$'` |
| `status` | `text` NOT NULL DEFAULT `'OPEN'` | CHECK in `period_status` |
| `closed_at` | `timestamptz` NULL | |
| `closed_reason` | `text` NULL | |
| `reopened_at` | `timestamptz` NULL | |
| `reopened_reason` | `text` NULL | |
| `created_at` | `timestamptz` NOT NULL DEFAULT `now()` | |

Periods are created lazily (on first write into a month) or in bulk for a fiscal year.
CHECK: `status = 'CLOSED'` implies `closed_at IS NOT NULL`.

### 2.6 `movements` — the ledger (source of truth)

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `seq` | `bigint` NOT NULL, `GENERATED ALWAYS AS IDENTITY`, UNIQUE | deterministic global order + cheap drift check |
| `product_id` | `uuid` NOT NULL → `products(id)` | `ON DELETE RESTRICT` |
| `type` | `text` NOT NULL | CHECK in `movement_type` |
| `quantity` | `numeric(18,3)` NOT NULL | signed; CHECK `quantity <> 0`; sign CHECK per §1 |
| `occurred_on` | `date` NOT NULL | business date |
| `period_id` | `uuid` NOT NULL → `periods(id)` | must be the period containing `occurred_on` |
| `unit_cost_satang` | `bigint` NULL | CHECK `>= 0`; set for `OPENING`, `PURCHASE`, `CUSTOMER_RETURN`, positive `ADJUSTMENT` |
| `source_kind` | `text` NOT NULL | CHECK in `movement_source_kind` |
| `source_id` | `uuid` NULL | FK-less pointer to the document row (`purchases`/`sales`/`returns`/`adjustments`) |
| `status` | `text` NOT NULL DEFAULT `'ACTIVE'` | CHECK in `doc_status` |
| `voided_at` | `timestamptz` NULL | |
| `void_reason` | `text` NULL | |
| `import_batch_id` | `uuid` NULL → `import_batches(id)` | |
| `source_row_hash` | `text` NULL | import idempotency (§15) |
| `local_id` | `uuid` NULL | client-generated id for offline-created rows |
| `created_at` | `timestamptz` NOT NULL DEFAULT `now()` | |

Constraints:

- `CHECK (status = 'ACTIVE' OR (voided_at IS NOT NULL AND void_reason IS NOT NULL))`
- Sign CHECK:
  ```
  CHECK (
    (type IN ('OPENING','PURCHASE','CUSTOMER_RETURN','TRANSFER_IN') AND quantity > 0) OR
    (type IN ('SALE','SUPPLIER_RETURN','DAMAGE','TRANSFER_OUT')     AND quantity < 0) OR
    (type = 'ADJUSTMENT')
  )
  ```
- `CHECK (type NOT IN ('OPENING','PURCHASE') OR unit_cost_satang IS NOT NULL)`
- Partial unique: **one ACTIVE `OPENING` per product**
  `CREATE UNIQUE INDEX ux_movements_one_active_opening ON movements(product_id) WHERE type='OPENING' AND status='ACTIVE';`
- Ordering key everywhere: `(occurred_on, seq)`.

> `TRANSFER_IN`/`TRANSFER_OUT` remain valid in the CHECK but no endpoint writes them in
> v1 (spec §5.1).

### 2.7 `purchases`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `occurred_on` | `date` NOT NULL | |
| `product_id` | `uuid` NOT NULL → `products(id)` | |
| `quantity` | `numeric(18,3)` NOT NULL | CHECK `> 0` |
| `unit_cost_satang` | `bigint` NOT NULL | CHECK `>= 0` |
| `total_cost_satang` | `bigint` NOT NULL | CHECK `>= 0`; server = `round_half_up(quantity * unit_cost_satang)` |
| `invoice_no` | `text` NULL | |
| `supplier` | `text` NULL | |
| `note` | `text` NULL | |
| `status` | `text` NOT NULL DEFAULT `'ACTIVE'` | CHECK in `doc_status` |
| `voided_at` | `timestamptz` NULL | |
| `void_reason` | `text` NULL | |
| `idempotency_key` | `uuid` NOT NULL UNIQUE | |
| `import_batch_id` | `uuid` NULL → `import_batches(id)` | |
| `source_row_hash` | `text` NULL | |
| `local_id` | `uuid` NULL | |
| `created_at` | `timestamptz` NOT NULL DEFAULT `now()` | |

### 2.8 `sales`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `occurred_on` | `date` NOT NULL | |
| `product_id` | `uuid` NOT NULL → `products(id)` | |
| `quantity` | `numeric(18,3)` NOT NULL | CHECK `> 0` |
| `unit_price_satang` | `bigint` NOT NULL | CHECK `>= 0` |
| `total_price_satang` | `bigint` NOT NULL | CHECK `>= 0`; server = `round_half_up(quantity * unit_price_satang)` |
| `cogs_satang` | `bigint` NOT NULL DEFAULT `0` | CHECK `>= 0`; set at post time from weighted-avg (§9.2) |
| `bill_no` | `text` NULL | |
| `channel` | `text` NULL | |
| `note` | `text` NULL | |
| `status` / `voided_at` / `void_reason` | | as `purchases` |
| `idempotency_key` | `uuid` NOT NULL UNIQUE | |
| `import_batch_id` / `source_row_hash` / `local_id` | | as `purchases` |
| `created_at` | `timestamptz` NOT NULL DEFAULT `now()` | |

### 2.9 `returns`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `kind` | `text` NOT NULL | CHECK in `return_kind` |
| `occurred_on` | `date` NOT NULL | |
| `product_id` | `uuid` NOT NULL → `products(id)` | |
| `quantity` | `numeric(18,3)` NOT NULL | CHECK `> 0` |
| `unit_cost_satang` | `bigint` NULL | CHECK `>= 0`; **required when `kind='CUSTOMER'`** |
| `linked_sale_id` | `uuid` NULL → `sales(id)` | |
| `linked_purchase_id` | `uuid` NULL → `purchases(id)` | |
| `reason` | `text` NULL | |
| `note` | `text` NULL | |
| `status` / `voided_at` / `void_reason` | | as `purchases` |
| `idempotency_key` | `uuid` NOT NULL UNIQUE | |
| `local_id` | `uuid` NULL | |
| `created_at` | `timestamptz` NOT NULL DEFAULT `now()` | |

Constraints:

- `CHECK (kind <> 'CUSTOMER' OR unit_cost_satang IS NOT NULL)`
- `CHECK (kind <> 'CUSTOMER' OR linked_purchase_id IS NULL)`
- `CHECK (kind <> 'SUPPLIER' OR (linked_sale_id IS NULL AND unit_cost_satang IS NULL))`

### 2.10 `adjustments`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `occurred_on` | `date` NOT NULL | |
| `product_id` | `uuid` NOT NULL → `products(id)` | |
| `quantity_delta` | `numeric(18,3)` NOT NULL | CHECK `<> 0`; signed |
| `reason_code` | `text` NOT NULL | CHECK in `adjust_reason` |
| `unit_cost_satang` | `bigint` NULL | CHECK `>= 0`; **required when `quantity_delta > 0`** |
| `note` | `text` NULL | |
| `status` / `voided_at` / `void_reason` | | as `purchases` |
| `idempotency_key` | `uuid` NOT NULL UNIQUE | |
| `local_id` | `uuid` NULL | |
| `created_at` | `timestamptz` NOT NULL DEFAULT `now()` | |

Constraint: `CHECK (quantity_delta < 0 OR unit_cost_satang IS NOT NULL)`.

> `reason_code = 'DAMAGED'` posts a `DAMAGE` movement, not `ADJUSTMENT` (spec §10.4 note,
> open Q #13 — PROVISIONAL). All other reasons post `ADJUSTMENT` with the signed delta.

### 2.11 `stock_state` — derived cache (qty + cost, merged)

> Folds together what earlier spec drafts split as `stock_state` + `stock_cost_state`,
> into one row per product, to remove a drift surface. Matches spec §9.2 (v0.2).

| Column | Type | Notes |
| --- | --- | --- |
| `product_id` | `uuid` PK → `products(id)` | |
| `qty_on_hand` | `numeric(18,3)` NOT NULL DEFAULT `0` | = Σ ACTIVE `movements.quantity` |
| `total_cost_satang` | `bigint` NOT NULL DEFAULT `0` | CHECK `>= 0` |
| `avg_cost_micro` | `bigint` NOT NULL DEFAULT `0` | avg unit cost in millionths of THB; CHECK `>= 0` |
| `last_nonzero_avg_micro` | `bigint` NOT NULL DEFAULT `0` | fallback basis when `qty_on_hand <= 0` (open Q #4) |
| `last_seq` | `bigint` NOT NULL DEFAULT `0` | max `movements.seq` folded in; drift tripwire |
| `updated_at` | `timestamptz` NOT NULL DEFAULT `now()` | |

Reconciliation invariant (job, spec §21): for every product,
`stock_state` == `replayLedger(ACTIVE movements ORDER BY occurred_on, seq)`.
Mismatch → `audit_action` is not written, an alert row goes to `recon_alerts` (below) and
(configurably) the cache is overwritten from the replay.

### 2.12 `recon_alerts`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `detected_at` | `timestamptz` NOT NULL DEFAULT `now()` | |
| `product_id` | `uuid` NOT NULL → `products(id)` | |
| `field` | `text` NOT NULL | `qty_on_hand` / `avg_cost_micro` / … |
| `cached_value` | `text` NOT NULL | |
| `replay_value` | `text` NOT NULL | |
| `healed` | `boolean` NOT NULL DEFAULT `false` | |

### 2.13 `audit_log`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `ts` | `timestamptz` NOT NULL DEFAULT `now()` | |
| `action` | `text` NOT NULL | CHECK in `audit_action` |
| `entity` | `text` NOT NULL | `product` / `sale` / `purchase` / `movement` / `period` / `settings` / `backup` / `fiscal_year` |
| `entity_id` | `text` NOT NULL | |
| `old_value` | `jsonb` NULL | |
| `new_value` | `jsonb` NULL | |
| `reason` | `text` NULL | required for `VOID`, `REOPEN_PERIOD`, over-threshold backdates, `ROLL_FISCAL_YEAR` |

### 2.14 `processed_requests` — idempotency (spec §14.1)

| Column | Type | Notes |
| --- | --- | --- |
| `idempotency_key` | `uuid` PK | |
| `endpoint` | `text` NOT NULL | |
| `request_hash` | `text` NOT NULL | sha256 of the canonical request body |
| `response_json` | `jsonb` NOT NULL | |
| `status_code` | `int` NOT NULL | |
| `created_at` | `timestamptz` NOT NULL DEFAULT `now()` | |

Retention: rows older than 90 days may be pruned by a job (safe — offline queue retries
inside 90 days are unrealistic; documented risk).

### 2.15 `import_batches`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `kind` | `text` NOT NULL | CHECK in `import_kind` |
| `filename` | `text` NOT NULL | |
| `source_file_hash` | `text` NOT NULL | sha256 of uploaded bytes |
| `row_count` | `int` NOT NULL | |
| `valid_count` / `invalid_count` / `duplicate_count` / `create_count` / `update_count` | `int` NULL | filled at preview |
| `status` | `text` NOT NULL DEFAULT `'PREVIEW'` | CHECK in `import_status` |
| `mode` | `text` NULL | CHECK in `import_mode`; set at commit |
| `idempotency_key` | `uuid` NULL UNIQUE | for the commit call |
| `error` | `text` NULL | on `FAILED` |
| `created_at` | `timestamptz` NOT NULL DEFAULT `now()` | |
| `committed_at` | `timestamptz` NULL | |

Index: `CREATE INDEX ix_import_batches_filehash_committed ON import_batches(source_file_hash) WHERE status='COMMITTED';`

### 2.16 `import_rows`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `batch_id` | `uuid` NOT NULL → `import_batches(id)` `ON DELETE CASCADE` | |
| `row_no` | `int` NOT NULL | 1-based source row |
| `raw` | `jsonb` NOT NULL | original cell values |
| `sanitized` | `jsonb` NULL | post-`cleanData`; NULL if sanitize failed |
| `errors` | `jsonb` NOT NULL DEFAULT `'[]'` | `[{field, code, message}]` |
| `source_row_hash` | `text` NOT NULL | sha256 of canonicalized sanitized content |
| `action` | `text` NULL | CHECK in `import_row_action` |
| `committed` | `boolean` NOT NULL DEFAULT `false` | |
| | | UNIQUE `(batch_id, row_no)` |

Index: `CREATE INDEX ix_import_rows_rowhash_committed ON import_rows(source_row_hash) WHERE committed;`

### 2.17 `backups`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `created_at` | `timestamptz` NOT NULL DEFAULT `now()` | |
| `kind` | `text` NOT NULL | CHECK in `backup_kind` |
| `artifact_path` | `text` NOT NULL | local encrypted artifact |
| `artifact_sha256` | `text` NOT NULL | of the encrypted artifact |
| `dump_sha256` | `text` NOT NULL | of the plaintext dump (from manifest) |
| `size_bytes` | `bigint` NOT NULL | |
| `app_version` | `text` NOT NULL | |
| `schema_version` | `text` NOT NULL | latest migration id at backup time |
| `pg_version` | `text` NOT NULL | |
| `row_counts` | `jsonb` NOT NULL | per-table counts |
| `local_status` | `text` NOT NULL | CHECK in `backup_local_status` |
| `cloud_status` | `text` NOT NULL DEFAULT `'NOT_ATTEMPTED'` | CHECK in `backup_cloud_status` |
| `cloud_key` | `text` NULL | object key in the bucket |
| `cloud_last_attempt_at` | `timestamptz` NULL | |
| `verified_at` | `timestamptz` NULL | local verification pass |
| `retention_class` | `text` NULL | `DAILY` / `WEEKLY` / `MONTHLY` |

Rule enforced in app, not DB: never delete the row whose deletion would leave zero
`local_status='LOCAL_BACKUP_SUCCESS'` **and** zero `cloud_status='CLOUD_UPLOAD_SUCCESS'`
rows (spec §16.6).

---

## 3. Indexes (beyond PKs / UNIQUEs above)

```sql
-- movements: the hot paths
CREATE INDEX ix_mov_product_date      ON movements (product_id, occurred_on, seq);
CREATE INDEX ix_mov_type              ON movements (type);
CREATE INDEX ix_mov_status            ON movements (status) WHERE status = 'VOIDED';
CREATE INDEX ix_mov_period            ON movements (period_id);
CREATE INDEX ix_mov_occurred_on       ON movements (occurred_on);
CREATE INDEX ix_mov_source            ON movements (source_kind, source_id);
CREATE INDEX ix_mov_rowhash           ON movements (source_row_hash) WHERE source_row_hash IS NOT NULL;

-- documents
CREATE INDEX ix_pur_product_date      ON purchases (product_id, occurred_on);
CREATE INDEX ix_pur_invoice           ON purchases (invoice_no) WHERE invoice_no IS NOT NULL;
CREATE INDEX ix_sal_product_date      ON sales     (product_id, occurred_on);
CREATE INDEX ix_sal_bill              ON sales     (bill_no) WHERE bill_no IS NOT NULL;
CREATE INDEX ix_ret_product_date      ON returns   (product_id, occurred_on);
CREATE INDEX ix_adj_product_date      ON adjustments (product_id, occurred_on);

-- products / lookups
CREATE INDEX ix_prod_category         ON products (category_id);
CREATE INDEX ix_prod_active           ON products (active);
CREATE INDEX ix_prod_name_trgm        ON products USING gin (name gin_trgm_ops);  -- name search

-- audit
CREATE INDEX ix_audit_entity          ON audit_log (entity, entity_id, ts DESC);
CREATE INDEX ix_audit_ts              ON audit_log (ts DESC);
```

`pg_trgm` extension enabled for `ix_prod_name_trgm`. SKU search uses the `citext` UNIQUE
index directly (exact + prefix).

---

## 4. Transaction patterns

### 4.1 Post a stock-changing document (purchase / sale / return / adjustment)

```
BEGIN;
  SELECT pg_advisory_xact_lock(hashtextextended(product_id::text, 0));
  -- read current state
  SELECT * FROM stock_state WHERE product_id = $1 FOR UPDATE;   -- creates row if missing
  -- validations: period OPEN, PREVENT-mode check, backdate policy
  INSERT INTO <document> (...) RETURNING id;                    -- idempotency_key UNIQUE
  INSERT INTO movements (...);                                  -- one (DAMAGED reason → type DAMAGE)
  -- costing: recompute avg_cost_micro / total_cost_satang; set sales.cogs_satang
  UPDATE stock_state SET qty_on_hand = ..., total_cost_satang = ..., avg_cost_micro = ...,
         last_nonzero_avg_micro = ..., last_seq = ..., updated_at = now()
   WHERE product_id = $1;
  INSERT INTO audit_log (...);
  INSERT INTO processed_requests (idempotency_key, ...);
COMMIT;
```

A duplicate `idempotency_key` → unique violation is caught, the stored
`processed_requests.response_json` is returned, nothing is written.

### 4.2 Void a document

```
BEGIN;
  SELECT pg_advisory_xact_lock(hashtextextended(product_id::text, 0));
  -- reject if period CLOSED
  UPDATE <document> SET status='VOIDED', voided_at=now(), void_reason=$2 WHERE id=$1 AND status='ACTIVE';
  UPDATE movements  SET status='VOIDED', voided_at=now(), void_reason=$2 WHERE source_id=$1;
  -- recompute stock_state for the product by replayLedger (not naive subtraction)
  UPDATE stock_state SET ... WHERE product_id = ...;
  INSERT INTO audit_log (action='VOID', ...);
COMMIT;
```

### 4.3 Import commit (ALL_OR_NOTHING)

One transaction: for each valid, non-duplicate row → the §4.1 body (advisory lock per
product), mark `import_rows.committed = true`, then
`UPDATE import_batches SET status='COMMITTED', committed_at=now()`. Any error → `ROLLBACK`,
`status='FAILED'`, `error` set. `PARTIAL` mode: same, but per-row failures are recorded
and skipped instead of aborting.

### 4.4 Concurrency guarantee

The advisory lock is keyed on `product_id`, so two sales of the same product serialize;
sales of different products run in parallel. Combined with `stock_state ... FOR UPDATE`
this gives the deterministic result required by spec §14.2 (A sells 80 / B sells 50 from
100).

---

## 5. Triggers

```sql
CREATE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_products_updated  BEFORE UPDATE ON products  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_settings_updated  BEFORE UPDATE ON settings  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```

No triggers touch `movements` or `stock_state` — that logic lives in the application
service layer so it is unit-testable and matches `replayLedger`.

---

## 6. Migrations

| Id | Contents |
| --- | --- |
| `0001_init` | extensions (`citext`, `pg_trgm`); all enums-as-CHECK; all tables in §2; all indexes in §3; `set_updated_at` + triggers. |
| `0002_seed` | `settings` seed keys (§2.1); base `units` rows; a default "ทั่วไป" category is **not** created (category is optional). |
| `0003_periods_fy2569` | create the 12 `periods` rows for FY2569 (`2026-01` … `2026-12`), all `OPEN`. |

Forward-only. A migration is never edited after it ships; corrections are a new migration.
`schema_version` recorded in each backup = the latest applied migration id.

---

## 7. Open items feeding this schema

- **#4** (`last_nonzero_avg_micro` fallback) — column present; exact reset rule confirmed
  in `TESTING.md` costing suite. PROVISIONAL.
- **#6** — no schema impact; `total_*_satang` is always server-computed.
- **#8** — no schema impact; re-import logic is in the import service.
- **#13** — no schema impact; `reason_code='DAMAGED'` → `movements.type='DAMAGE'`.
- **#15 / #16** — `backups.cloud_*` columns are provider-agnostic; no change expected.
