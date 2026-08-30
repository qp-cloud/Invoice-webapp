-- 0005_print_settings.sql
-- Customisable tax-invoice print layout. One JSON blob in `settings`;
-- shape + defaults enforced by printSettingsSchema in @inventory/shared.
INSERT INTO settings (key, value) VALUES
  ('print_settings', '{
    "paperSize": "A4",
    "marginMm": 12,
    "fontPx": 13,
    "logoDataUrl": "",
    "showLogo": true,
    "showEnLabels": true,
    "showSignatures": true,
    "showCopyBadge": true,
    "showReference": true,
    "showVatLine": true,
    "footerText": "",
    "showBahtWords": true
  }'::jsonb)
ON CONFLICT (key) DO NOTHING;
