-- 0001_init — full schema (DATABASE.md §2, §3).
-- PGlite-conservative: no CREATE EXTENSION, no plpgsql triggers.
-- `sku` is plain text + UNIQUE; case-insensitivity is guaranteed by cleanData
-- upper-casing every SKU before write and before lookup (spec §7.1).
-- `updated_at` is maintained by the application layer (a DB trigger backstop is
-- added only on the production PostgreSQL target).

------------------------------------------------------------------------------
-- settings : key/value owner configuration
------------------------------------------------------------------------------
CREATE TABLE settings (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

------------------------------------------------------------------------------
-- categories
------------------------------------------------------------------------------
CREATE TABLE categories (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

------------------------------------------------------------------------------
-- units : conversion-ready; v1 business logic must not read `factor`
------------------------------------------------------------------------------
CREATE TABLE units (
  code           text PRIMARY KEY,
  name_th        text NOT NULL,
  base_unit_code text REFERENCES units(code),
  factor         numeric(18,6),
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT units_factor_ck CHECK (
    (base_unit_code IS NULL AND factor IS NULL) OR
    (base_unit_code IS NOT NULL AND factor > 0)
  )
);

------------------------------------------------------------------------------
-- products
------------------------------------------------------------------------------
CREATE TABLE products (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sku         text NOT NULL UNIQUE,
  name        text NOT NULL,
  category_id uuid REFERENCES categories(id) ON DELETE SET NULL,
  unit_code   text NOT NULL REFERENCES units(code),
  min_stock   numeric(18,3) NOT NULL DEFAULT 0,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT products_min_stock_ck CHECK (min_stock >= 0)
);
CREATE INDEX ix_prod_category ON products (category_id);
CREATE INDEX ix_prod_active   ON products (active);
CREATE INDEX ix_prod_name_low ON products (lower(name));

------------------------------------------------------------------------------
-- periods : calendar months, Gregorian key YYYY-MM
------------------------------------------------------------------------------
CREATE TABLE periods (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ym              text NOT NULL UNIQUE,
  status          text NOT NULL DEFAULT 'OPEN',
  closed_at       timestamptz,
  closed_reason   text,
  reopened_at     timestamptz,
  reopened_reason text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT periods_ym_ck     CHECK (ym ~ '^[0-9]{4}-[0-9]{2}$'),
  CONSTRAINT periods_status_ck CHECK (status IN ('OPEN','CLOSED')),
  CONSTRAINT periods_closed_ck CHECK (status <> 'CLOSED' OR closed_at IS NOT NULL)
);

------------------------------------------------------------------------------
-- movements : the ledger, source of truth
------------------------------------------------------------------------------
CREATE TABLE movements (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seq              bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  product_id       uuid NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  type             text NOT NULL,
  quantity         numeric(18,3) NOT NULL,
  occurred_on      date NOT NULL,
  period_id        uuid NOT NULL REFERENCES periods(id) ON DELETE RESTRICT,
  unit_cost_satang bigint,
  source_kind      text NOT NULL,
  source_id        uuid,
  status           text NOT NULL DEFAULT 'ACTIVE',
  voided_at        timestamptz,
  void_reason      text,
  import_batch_id  uuid,
  source_row_hash  text,
  local_id         uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mov_type_ck CHECK (type IN
    ('OPENING','PURCHASE','SALE','CUSTOMER_RETURN','SUPPLIER_RETURN','DAMAGE',
     'ADJUSTMENT','TRANSFER_IN','TRANSFER_OUT')),
  CONSTRAINT mov_source_kind_ck CHECK (source_kind IN
    ('OPENING','PURCHASE','SALE','RETURN','ADJUSTMENT')),
  CONSTRAINT mov_status_ck CHECK (status IN ('ACTIVE','VOIDED')),
  CONSTRAINT mov_qty_nonzero_ck CHECK (quantity <> 0),
  CONSTRAINT mov_sign_ck CHECK (
    (type IN ('OPENING','PURCHASE','CUSTOMER_RETURN','TRANSFER_IN') AND quantity > 0) OR
    (type IN ('SALE','SUPPLIER_RETURN','DAMAGE','TRANSFER_OUT')     AND quantity < 0) OR
    (type = 'ADJUSTMENT')
  ),
  CONSTRAINT mov_cost_present_ck CHECK (
    type NOT IN ('OPENING','PURCHASE') OR unit_cost_satang IS NOT NULL
  ),
  CONSTRAINT mov_cost_nonneg_ck CHECK (unit_cost_satang IS NULL OR unit_cost_satang >= 0),
  CONSTRAINT mov_void_ck CHECK (
    status = 'ACTIVE' OR (voided_at IS NOT NULL AND void_reason IS NOT NULL)
  )
);
CREATE INDEX ix_mov_product_date ON movements (product_id, occurred_on, seq);
CREATE INDEX ix_mov_type         ON movements (type);
CREATE INDEX ix_mov_voided       ON movements (status) WHERE status = 'VOIDED';
CREATE INDEX ix_mov_period       ON movements (period_id);
CREATE INDEX ix_mov_occurred_on  ON movements (occurred_on);
CREATE INDEX ix_mov_source       ON movements (source_kind, source_id);
CREATE INDEX ix_mov_rowhash      ON movements (source_row_hash) WHERE source_row_hash IS NOT NULL;
CREATE UNIQUE INDEX ux_mov_one_active_opening
  ON movements (product_id) WHERE type = 'OPENING' AND status = 'ACTIVE';

------------------------------------------------------------------------------
-- import_batches : created before documents (purchases/sales FK it)
------------------------------------------------------------------------------
CREATE TABLE import_batches (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind             text NOT NULL,
  filename         text NOT NULL,
  source_file_hash text NOT NULL,
  row_count        integer NOT NULL,
  valid_count      integer,
  invalid_count    integer,
  duplicate_count  integer,
  create_count     integer,
  update_count     integer,
  status           text NOT NULL DEFAULT 'PREVIEW',
  mode             text,
  idempotency_key  uuid UNIQUE,
  error            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  committed_at     timestamptz,
  CONSTRAINT ib_kind_ck   CHECK (kind IN ('MASTER_STOCK','PURCHASES','SALES')),
  CONSTRAINT ib_status_ck CHECK (status IN ('PREVIEW','COMMITTED','DISCARDED','FAILED')),
  CONSTRAINT ib_mode_ck   CHECK (mode IS NULL OR mode IN ('ALL_OR_NOTHING','PARTIAL'))
);
CREATE INDEX ix_ib_filehash_committed
  ON import_batches (source_file_hash) WHERE status = 'COMMITTED';

------------------------------------------------------------------------------
-- documents
------------------------------------------------------------------------------
CREATE TABLE purchases (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_on       date NOT NULL,
  product_id        uuid NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  quantity          numeric(18,3) NOT NULL,
  unit_cost_satang  bigint NOT NULL,
  total_cost_satang bigint NOT NULL,
  invoice_no        text,
  supplier          text,
  note              text,
  status            text NOT NULL DEFAULT 'ACTIVE',
  voided_at         timestamptz,
  void_reason       text,
  idempotency_key   uuid NOT NULL UNIQUE,
  import_batch_id   uuid REFERENCES import_batches(id),
  source_row_hash   text,
  local_id          uuid,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pur_status_ck CHECK (status IN ('ACTIVE','VOIDED')),
  CONSTRAINT pur_qty_ck    CHECK (quantity > 0),
  CONSTRAINT pur_uc_ck     CHECK (unit_cost_satang >= 0),
  CONSTRAINT pur_tc_ck     CHECK (total_cost_satang >= 0)
);
CREATE INDEX ix_pur_product_date ON purchases (product_id, occurred_on);
CREATE INDEX ix_pur_invoice      ON purchases (invoice_no) WHERE invoice_no IS NOT NULL;

CREATE TABLE sales (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_on        date NOT NULL,
  product_id         uuid NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  quantity           numeric(18,3) NOT NULL,
  unit_price_satang  bigint NOT NULL,
  total_price_satang bigint NOT NULL,
  cogs_satang        bigint NOT NULL DEFAULT 0,
  bill_no            text,
  channel            text,
  note               text,
  status             text NOT NULL DEFAULT 'ACTIVE',
  voided_at          timestamptz,
  void_reason        text,
  idempotency_key    uuid NOT NULL UNIQUE,
  import_batch_id    uuid REFERENCES import_batches(id),
  source_row_hash    text,
  local_id           uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sal_status_ck CHECK (status IN ('ACTIVE','VOIDED')),
  CONSTRAINT sal_qty_ck    CHECK (quantity > 0),
  CONSTRAINT sal_up_ck     CHECK (unit_price_satang >= 0),
  CONSTRAINT sal_tp_ck     CHECK (total_price_satang >= 0),
  CONSTRAINT sal_cogs_ck   CHECK (cogs_satang >= 0)
);
CREATE INDEX ix_sal_product_date ON sales (product_id, occurred_on);
CREATE INDEX ix_sal_bill         ON sales (bill_no) WHERE bill_no IS NOT NULL;

CREATE TABLE returns (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind               text NOT NULL,
  occurred_on        date NOT NULL,
  product_id         uuid NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  quantity           numeric(18,3) NOT NULL,
  unit_cost_satang   bigint,
  linked_sale_id     uuid REFERENCES sales(id),
  linked_purchase_id uuid REFERENCES purchases(id),
  reason             text,
  note               text,
  status             text NOT NULL DEFAULT 'ACTIVE',
  voided_at          timestamptz,
  void_reason        text,
  idempotency_key    uuid NOT NULL UNIQUE,
  local_id           uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ret_kind_ck    CHECK (kind IN ('CUSTOMER','SUPPLIER')),
  CONSTRAINT ret_status_ck  CHECK (status IN ('ACTIVE','VOIDED')),
  CONSTRAINT ret_qty_ck     CHECK (quantity > 0),
  CONSTRAINT ret_uc_ck      CHECK (unit_cost_satang IS NULL OR unit_cost_satang >= 0),
  CONSTRAINT ret_cust_cost_ck CHECK (kind <> 'CUSTOMER' OR unit_cost_satang IS NOT NULL),
  CONSTRAINT ret_cust_link_ck CHECK (kind <> 'CUSTOMER' OR linked_purchase_id IS NULL),
  CONSTRAINT ret_sup_link_ck  CHECK (kind <> 'SUPPLIER' OR (linked_sale_id IS NULL AND unit_cost_satang IS NULL))
);
CREATE INDEX ix_ret_product_date ON returns (product_id, occurred_on);

CREATE TABLE adjustments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_on      date NOT NULL,
  product_id       uuid NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  quantity_delta   numeric(18,3) NOT NULL,
  reason_code      text NOT NULL,
  unit_cost_satang bigint,
  note             text,
  status           text NOT NULL DEFAULT 'ACTIVE',
  voided_at        timestamptz,
  void_reason      text,
  idempotency_key  uuid NOT NULL UNIQUE,
  local_id         uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT adj_status_ck CHECK (status IN ('ACTIVE','VOIDED')),
  CONSTRAINT adj_reason_ck CHECK (reason_code IN
    ('STOCK_COUNT','DAMAGED','LOST','FOUND_EXTRA','CORRECTION','OTHER')),
  CONSTRAINT adj_delta_ck  CHECK (quantity_delta <> 0),
  CONSTRAINT adj_uc_ck     CHECK (unit_cost_satang IS NULL OR unit_cost_satang >= 0),
  CONSTRAINT adj_pos_cost_ck CHECK (quantity_delta < 0 OR unit_cost_satang IS NOT NULL)
);
CREATE INDEX ix_adj_product_date ON adjustments (product_id, occurred_on);

------------------------------------------------------------------------------
-- stock_state : derived cache (qty + weighted-average cost), one row per product
------------------------------------------------------------------------------
CREATE TABLE stock_state (
  product_id             uuid PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
  qty_on_hand            numeric(18,3) NOT NULL DEFAULT 0,
  total_cost_satang      bigint NOT NULL DEFAULT 0,
  avg_cost_micro         bigint NOT NULL DEFAULT 0,
  last_nonzero_avg_micro bigint NOT NULL DEFAULT 0,
  last_seq               bigint NOT NULL DEFAULT 0,
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ss_total_ck CHECK (total_cost_satang >= 0),
  CONSTRAINT ss_avg_ck   CHECK (avg_cost_micro >= 0)
);

CREATE TABLE recon_alerts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  detected_at  timestamptz NOT NULL DEFAULT now(),
  product_id   uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  field        text NOT NULL,
  cached_value text NOT NULL,
  replay_value text NOT NULL,
  healed       boolean NOT NULL DEFAULT false
);

------------------------------------------------------------------------------
-- audit_log
------------------------------------------------------------------------------
CREATE TABLE audit_log (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ts        timestamptz NOT NULL DEFAULT now(),
  action    text NOT NULL,
  entity    text NOT NULL,
  entity_id text NOT NULL,
  old_value jsonb,
  new_value jsonb,
  reason    text,
  CONSTRAINT audit_action_ck CHECK (action IN
    ('CREATE','UPDATE','VOID','CLOSE_PERIOD','REOPEN_PERIOD','ROLL_FISCAL_YEAR',
     'IMPORT_COMMIT','BACKUP','RESTORE','COST_BASIS_RESET','SETTINGS_CHANGE'))
);
CREATE INDEX ix_audit_entity ON audit_log (entity, entity_id, ts DESC);
CREATE INDEX ix_audit_ts     ON audit_log (ts DESC);

------------------------------------------------------------------------------
-- processed_requests : idempotency (API.md §2.1)
------------------------------------------------------------------------------
CREATE TABLE processed_requests (
  idempotency_key uuid PRIMARY KEY,
  endpoint        text NOT NULL,
  request_hash    text NOT NULL,
  response_json   jsonb NOT NULL,
  status_code     integer NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

------------------------------------------------------------------------------
-- import_rows
------------------------------------------------------------------------------
CREATE TABLE import_rows (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id        uuid NOT NULL REFERENCES import_batches(id) ON DELETE CASCADE,
  row_no          integer NOT NULL,
  raw             jsonb NOT NULL,
  sanitized       jsonb,
  errors          jsonb NOT NULL DEFAULT '[]'::jsonb,
  source_row_hash text NOT NULL,
  action          text,
  committed       boolean NOT NULL DEFAULT false,
  UNIQUE (batch_id, row_no),
  CONSTRAINT ir_action_ck CHECK (action IS NULL OR action IN ('CREATE','UPDATE','SKIP','DUPLICATE'))
);
CREATE INDEX ix_ir_rowhash_committed ON import_rows (source_row_hash) WHERE committed;

------------------------------------------------------------------------------
-- backups (Phase 8 populates this; table created now for FK/manifest stability)
------------------------------------------------------------------------------
CREATE TABLE backups (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at            timestamptz NOT NULL DEFAULT now(),
  kind                  text NOT NULL,
  artifact_path         text NOT NULL,
  artifact_sha256       text NOT NULL,
  dump_sha256           text NOT NULL,
  size_bytes            bigint NOT NULL,
  app_version           text NOT NULL,
  schema_version        text NOT NULL,
  pg_version            text NOT NULL,
  row_counts            jsonb NOT NULL,
  local_status          text NOT NULL,
  cloud_status          text NOT NULL DEFAULT 'NOT_ATTEMPTED',
  cloud_key             text,
  cloud_last_attempt_at timestamptz,
  verified_at           timestamptz,
  retention_class       text,
  CONSTRAINT bk_kind_ck  CHECK (kind IN ('AUTO','MANUAL','PRE_RESTORE')),
  CONSTRAINT bk_local_ck CHECK (local_status IN ('LOCAL_BACKUP_SUCCESS','LOCAL_BACKUP_FAILED')),
  CONSTRAINT bk_cloud_ck CHECK (cloud_status IN ('NOT_ATTEMPTED','CLOUD_UPLOAD_SUCCESS','CLOUD_UPLOAD_FAILED')),
  CONSTRAINT bk_ret_ck   CHECK (retention_class IS NULL OR retention_class IN ('DAILY','WEEKLY','MONTHLY'))
);
