-- Tax-invoice / VAT module (ใบกำกับภาษี, รายงานภาษีซื้อ-ขาย for ภ.พ.30).
-- Multi-line buy/sell invoice documents on top of the existing `movements` ledger.

-- ---------------------------------------------------------------- contacts
CREATE TABLE contacts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind        text NOT NULL,                 -- SUPPLIER | CUSTOMER | BOTH
  name        text NOT NULL,
  tax_id      text,                          -- 13-digit เลขประจำตัวผู้เสียภาษี (nullable: walk-in)
  branch      text,                          -- 'สำนักงานใหญ่' or '00001' ...
  address     text,
  phone       text,
  note        text,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contacts_kind_ck CHECK (kind IN ('SUPPLIER','CUSTOMER','BOTH')),
  CONSTRAINT contacts_taxid_ck CHECK (tax_id IS NULL OR tax_id ~ '^[0-9]{13}$')
);
CREATE INDEX ix_contacts_kind ON contacts (kind) WHERE active;
CREATE INDEX ix_contacts_name ON contacts (lower(name));

-- --------------------------------------------------- gapless document numbers
-- One row per (doc_type, year). The confirm transaction bumps next_seq under a
-- row lock, so a rolled-back confirm reclaims the number -> no gaps.
CREATE TABLE doc_counters (
  doc_type  text NOT NULL,                   -- BUY | SELL
  year      integer NOT NULL,
  next_seq  integer NOT NULL DEFAULT 1,
  PRIMARY KEY (doc_type, year),
  CONSTRAINT doc_counters_type_ck CHECK (doc_type IN ('BUY','SELL'))
);

-- ---------------------------------------------------------------- invoices
CREATE TABLE invoices (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_type               text NOT NULL,      -- BUY | SELL
  invoice_number         text UNIQUE,        -- NULL while DRAFT; BUY-2026-0001 on confirm
  contact_id             uuid NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,
  issue_date             date NOT NULL,      -- invoice date = tax point
  status                 text NOT NULL DEFAULT 'DRAFT',  -- DRAFT | CONFIRMED | VOID
  -- money, integer satang, always recomputed server-side at confirm
  subtotal_satang        bigint NOT NULL DEFAULT 0,      -- Σ line net (ex-VAT)
  vat_satang             bigint NOT NULL DEFAULT 0,
  total_satang           bigint NOT NULL DEFAULT 0,
  total_cogs_satang      bigint,                         -- SELL only, from the ledger
  -- counterparty snapshot frozen at confirm (report/print stability)
  contact_name_snapshot     text,
  contact_tax_id_snapshot   text,
  contact_branch_snapshot   text,
  contact_address_snapshot  text,
  reference_no           text,              -- supplier's own invoice no, for BUY
  note                   text,
  idempotency_key        uuid UNIQUE,
  confirmed_at           timestamptz,
  voided_at              timestamptz,
  void_reason            text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inv_type_ck   CHECK (doc_type IN ('BUY','SELL')),
  CONSTRAINT inv_status_ck CHECK (status IN ('DRAFT','CONFIRMED','VOID')),
  CONSTRAINT inv_money_ck  CHECK (subtotal_satang >= 0 AND vat_satang >= 0 AND total_satang >= 0),
  CONSTRAINT inv_number_ck CHECK (
    (status = 'DRAFT' AND invoice_number IS NULL) OR
    (status IN ('CONFIRMED','VOID') AND invoice_number IS NOT NULL)
  ),
  CONSTRAINT inv_void_ck CHECK (status <> 'VOID' OR (voided_at IS NOT NULL AND void_reason IS NOT NULL))
);
CREATE INDEX ix_invoices_type_status ON invoices (doc_type, status);
CREATE INDEX ix_invoices_issue_date  ON invoices (issue_date);
CREATE INDEX ix_invoices_contact     ON invoices (contact_id);

-- ---------------------------------------------------------------- invoice_items
CREATE TABLE invoice_items (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id        uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  line_no           integer NOT NULL,
  product_id        uuid NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  description       text,                    -- defaults to product name, editable
  quantity          numeric(18,3) NOT NULL,
  unit_price_satang bigint NOT NULL,         -- ex-VAT unit price
  vat_rate          integer NOT NULL DEFAULT 7,   -- 7 (standard) or 0 (zero-rated export to Laos)
  line_net_satang   bigint NOT NULL,         -- roundHalfUp(quantity * unit_price_satang)
  line_vat_satang   bigint NOT NULL,         -- roundHalfUp(line_net * vat_rate/100)
  line_total_satang bigint NOT NULL,         -- net + vat
  UNIQUE (invoice_id, line_no),
  CONSTRAINT ii_qty_ck   CHECK (quantity > 0),
  CONSTRAINT ii_price_ck CHECK (unit_price_satang >= 0),
  CONSTRAINT ii_vat_ck   CHECK (vat_rate IN (0, 7)),
  CONSTRAINT ii_money_ck CHECK (line_net_satang >= 0 AND line_vat_satang >= 0 AND line_total_satang >= 0)
);
CREATE INDEX ix_ii_invoice ON invoice_items (invoice_id);
CREATE INDEX ix_ii_product ON invoice_items (product_id);

-- ------------------------------------------- movements: allow an INVOICE source
ALTER TABLE movements DROP CONSTRAINT mov_source_kind_ck;
ALTER TABLE movements ADD  CONSTRAINT mov_source_kind_ck CHECK (source_kind IN
  ('OPENING','PURCHASE','SALE','RETURN','ADJUSTMENT','INVOICE'));

-- ------------------------------------------- products: pricing + VAT flag
ALTER TABLE products ADD COLUMN vat_applicable             boolean NOT NULL DEFAULT true;
ALTER TABLE products ADD COLUMN default_sell_price_satang  bigint;
ALTER TABLE products ADD COLUMN default_cost_price_satang  bigint;
ALTER TABLE products ADD CONSTRAINT prod_sell_price_ck CHECK (default_sell_price_satang IS NULL OR default_sell_price_satang >= 0);
ALTER TABLE products ADD CONSTRAINT prod_cost_price_ck CHECK (default_cost_price_satang IS NULL OR default_cost_price_satang >= 0);

-- ------------------------------------------- company profile (seller identity)
INSERT INTO settings (key, value) VALUES
  ('company_name',     '"มีชัยอะไหล่ หนองคาย"'),
  ('company_name_en',  '"Meechai Auto Parts Nong Khai"'),
  ('company_tax_id',   '""'),
  ('company_branch',   '"สำนักงานใหญ่"'),
  ('company_address',  '""'),
  ('company_phone',    '""'),
  ('vat_rate_default', '7')
ON CONFLICT (key) DO NOTHING;
