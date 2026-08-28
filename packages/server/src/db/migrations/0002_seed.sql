-- 0002_seed — settings defaults (DATABASE.md §2.1) and base units (spec §8, brief §8).

INSERT INTO settings (key, value) VALUES
  ('negative_stock_mode',            '"ALLOW"'::jsonb),
  ('current_fiscal_year',            '2569'::jsonb),
  ('thai_dates',                     'true'::jsonb),
  ('backdate_reason_threshold_days', '7'::jsonb),
  ('backup_interval_hours',          '24'::jsonb),
  ('cloud_backup_enabled',           'false'::jsonb),
  ('recon_autoheal',                 'true'::jsonb);

-- Base units (no conversion in v1; factor/base left NULL).
INSERT INTO units (code, name_th) VALUES
  ('piece',  'ชิ้น'),
  ('box',    'กล่อง'),
  ('pack',   'แพ็ค'),
  ('bag',    'ถุง'),
  ('bottle', 'ขวด'),
  ('set',    'ชุด'),
  ('kg',     'กิโลกรัม'),
  ('g',      'กรัม'),
  ('meter',  'เมตร'),
  ('liter',  'ลิตร'),
  ('roll',   'ม้วน'),
  ('dozen',  'โหล');
