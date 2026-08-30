-- Operational fields visible on the full tax-invoice/receipt form.
ALTER TABLE invoices ADD COLUMN attention text;
ALTER TABLE invoices ADD COLUMN salesperson text;
ALTER TABLE invoices ADD COLUMN due_date date;
ALTER TABLE invoices ADD COLUMN payment_method text;
ALTER TABLE invoices ADD COLUMN bank_name text;
ALTER TABLE invoices ADD COLUMN bank_branch text;
ALTER TABLE invoices ADD COLUMN cheque_no text;
ALTER TABLE invoices ADD COLUMN payment_date date;
ALTER TABLE invoices ADD COLUMN payment_amount_satang bigint;
ALTER TABLE invoices ADD COLUMN collector text;

ALTER TABLE invoices ADD CONSTRAINT invoices_payment_method_ck
  CHECK (payment_method IS NULL OR payment_method IN ('CHEQUE','TRANSFER','CASH'));
ALTER TABLE invoices ADD CONSTRAINT invoices_payment_amount_ck
  CHECK (payment_amount_satang IS NULL OR payment_amount_satang >= 0);
