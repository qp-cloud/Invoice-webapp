-- 0003_periods_fy2569 — the 12 monthly periods of fiscal year 2569 (Gregorian 2026),
-- all OPEN. Later fiscal years create their periods lazily / at rollover (spec §6.5).

INSERT INTO periods (ym, status) VALUES
  ('2026-01', 'OPEN'),
  ('2026-02', 'OPEN'),
  ('2026-03', 'OPEN'),
  ('2026-04', 'OPEN'),
  ('2026-05', 'OPEN'),
  ('2026-06', 'OPEN'),
  ('2026-07', 'OPEN'),
  ('2026-08', 'OPEN'),
  ('2026-09', 'OPEN'),
  ('2026-10', 'OPEN'),
  ('2026-11', 'OPEN'),
  ('2026-12', 'OPEN');
