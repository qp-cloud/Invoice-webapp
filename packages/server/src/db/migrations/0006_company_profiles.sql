-- Multi-company seller profiles. Existing settings become the first profile and
-- all existing invoices/counters are attached to it without losing data.
CREATE TABLE company_profiles (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code           text NOT NULL UNIQUE,
  name           text NOT NULL,
  name_en        text NOT NULL DEFAULT '',
  tax_id         text NOT NULL DEFAULT '',
  branch         text NOT NULL DEFAULT 'สำนักงานใหญ่',
  address        text NOT NULL DEFAULT '',
  phone          text NOT NULL DEFAULT '',
  print_settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  active         boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT company_profiles_code_ck CHECK (code ~ '^[A-Za-z0-9_-]{1,20}$'),
  CONSTRAINT company_profiles_tax_id_ck CHECK (tax_id = '' OR tax_id ~ '^[0-9]{13}$')
);

INSERT INTO company_profiles (code, name, name_en, tax_id, branch, address, phone, print_settings)
SELECT
  'MAIN',
  COALESCE((SELECT value #>> '{}' FROM settings WHERE key = 'company_name'), 'บริษัทหลัก'),
  COALESCE((SELECT value #>> '{}' FROM settings WHERE key = 'company_name_en'), ''),
  COALESCE((SELECT value #>> '{}' FROM settings WHERE key = 'company_tax_id'), ''),
  COALESCE((SELECT value #>> '{}' FROM settings WHERE key = 'company_branch'), 'สำนักงานใหญ่'),
  COALESCE((SELECT value #>> '{}' FROM settings WHERE key = 'company_address'), ''),
  COALESCE((SELECT value #>> '{}' FROM settings WHERE key = 'company_phone'), ''),
  COALESCE((SELECT value FROM settings WHERE key = 'print_settings'), '{}'::jsonb);

ALTER TABLE invoices ADD COLUMN company_profile_id uuid;
UPDATE invoices SET company_profile_id = (SELECT id FROM company_profiles WHERE code = 'MAIN');
ALTER TABLE invoices ALTER COLUMN company_profile_id SET NOT NULL;
ALTER TABLE invoices ADD CONSTRAINT invoices_company_profile_fk
  FOREIGN KEY (company_profile_id) REFERENCES company_profiles(id) ON DELETE RESTRICT;

ALTER TABLE invoices ADD COLUMN company_name_snapshot text;
ALTER TABLE invoices ADD COLUMN company_name_en_snapshot text;
ALTER TABLE invoices ADD COLUMN company_tax_id_snapshot text;
ALTER TABLE invoices ADD COLUMN company_branch_snapshot text;
ALTER TABLE invoices ADD COLUMN company_address_snapshot text;
ALTER TABLE invoices ADD COLUMN company_phone_snapshot text;

UPDATE invoices i SET
  company_name_snapshot = p.name,
  company_name_en_snapshot = p.name_en,
  company_tax_id_snapshot = p.tax_id,
  company_branch_snapshot = p.branch,
  company_address_snapshot = p.address,
  company_phone_snapshot = p.phone
FROM company_profiles p
WHERE i.company_profile_id = p.id AND i.status <> 'DRAFT';

ALTER TABLE invoices DROP CONSTRAINT invoices_invoice_number_key;
ALTER TABLE invoices ADD CONSTRAINT invoices_company_number_uq UNIQUE (company_profile_id, invoice_number);
CREATE INDEX ix_invoices_company ON invoices (company_profile_id, issue_date);

ALTER TABLE doc_counters ADD COLUMN company_profile_id uuid;
UPDATE doc_counters SET company_profile_id = (SELECT id FROM company_profiles WHERE code = 'MAIN');
ALTER TABLE doc_counters ALTER COLUMN company_profile_id SET NOT NULL;
ALTER TABLE doc_counters DROP CONSTRAINT doc_counters_pkey;
ALTER TABLE doc_counters ADD CONSTRAINT doc_counters_pkey PRIMARY KEY (company_profile_id, doc_type, year);
ALTER TABLE doc_counters ADD CONSTRAINT doc_counters_company_fk
  FOREIGN KEY (company_profile_id) REFERENCES company_profiles(id) ON DELETE RESTRICT;
