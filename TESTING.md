# TESTING.md — Test Plan

> Subordinate to `PROJECT_SPEC.md` §22, §38, §39. Governs how every area reaches each
> verification level. Tests are never deleted or weakened to pass (spec §30 rule 4).
> Every bug found gets a failing test first, then the fix (spec §22.2).

---

## 1. Tooling

| Layer | Runner | Notes |
| --- | --- | --- |
| `packages/shared` (cleanData, money, domain, replayLedger, format) | **Vitest** | pure unit tests, no I/O, fast; run on every commit |
| `packages/server` services + routes | **Vitest** + **PGlite** (embedded Postgres 16, fresh in-memory DB per test file, migrations applied fresh; no mocking the DB). Swappable to Testcontainers/real Postgres via `TEST_PG_URL`. |
| `packages/server` concurrency | Vitest — serialized calls + simulated interleave against PGlite for the guard/idempotency logic; the **true parallel-client** assertions (spec §14.2) require `TEST_PG_URL` pointing at a real Postgres and are marked **Not verified** until then. |
| `packages/server` recovery (Phase 8) | requires real `pg_dump`/`pg_restore` + real Postgres — out of scope for the Phases 1–7 build; tracked in `TASKS.md` Phase 8. |
| `packages/web` components | Vitest + Testing Library | drawer math, formatters, badge logic |
| End-to-end | **Playwright** | against a built app + throwaway DB; offline via `context.setOffline(true)` |

`npm test` = shared + server + web unit. `npm run test:e2e`, `npm run test:recovery`,
`npm run test:stress` are separate (slower). CI runs `npm test` + `test:e2e` on every
push; `test:recovery` + `test:stress` nightly and on release branches.

Coverage gate: **≥ 95%** lines/branches for `packages/shared/src/{cleanData,money,domain}`;
**≥ 85%** for server `services/`. Routes covered by integration tests, not a % gate.

---

## 2. Golden master — `replayLedger` + mock dataset

`packages/shared/src/domain/__tests__/replayLedger.golden.test.ts`:

- Build the spec §23 mock dataset (SKU-001..004) purely from `OPENING` + `PURCHASE` +
  `SALE` movements, with purchase costs chosen to exercise weighted average.
- Assert, per SKU, `replayLedger(...)` returns exactly:

| SKU | qty | status | notes |
| --- | --- | --- | --- |
| SKU-001 | `1300.000` | `normal` (🟢) | variance `+300` |
| SKU-002 | `150.000` | `low` (🟡) | variance `−350` |
| SKU-003 | `0.000` | `out` (🔴) | variance `−200` |
| SKU-004 | `-20.000` | `out` (🔴) | oversold, missingBalance `20` |

- A committed JSON snapshot (`replayLedger.golden.json`) is the reference; changing it
  requires a spec Change Log entry.
- The same dataset is the DB seed (`scripts/seed.ts`) and an integration test asserts
  `GET /api/products/:id/stock` matches the golden values.

---

## 3. Suites

### 3.1 Sanitization — `cleanData` (spec §7, §22.1)

`packages/shared/src/cleanData/__tests__/`. Table-driven. Every case below is a row.

**SKU** (`sku.test.ts`)

| input | output / result |
| --- | --- |
| `" sku-001 "` | `SKU-001` |
| `"sku 001"` | `SKU 001` (inner space kept, single) |
| `"sku\t\t001"` | `SKU 001` (runs collapsed) |
| `""` / `"   "` | throws `SanitizationError(SKU_REQUIRED)` |

**Numbers** (`number.test.ts`) — money to satang, quantity to Decimal

| input | money satang | quantity |
| --- | --- | --- |
| `"1,250.00"` | `125000` | `1250` |
| `"฿1,250.00"` | `125000` | — |
| `" 1,250.00 ฿"` | `125000` | — |
| `"1 250.00"` | `125000` | — |
| `"1250"` | `125000` | `1250` |
| `"(1,250.00)"` | `-125000` (signed contexts only) | — |
| `"0.125"` | — | `0.125` |
| `"1.5"` / `"10.75"` | — | `1.5` / `10.75` |
| `"10.1234"` | — | throws `QUANTITY_PRECISION` |
| `""` / `"abc"` / `"NaN"` / `"Infinity"` | throws `NOT_A_NUMBER` | same |

Explicit assertion: `cleanMoneySatang` never does float arithmetic — property test with
random 2dp decimals confirms `toSatang(fromSatang(x)) === x`, and `0.1 + 0.2` style
inputs (`"0.1"`, `"0.2"`) sum via the money helpers to exactly `30` satang.

**Dates** (`date.test.ts`) — output ISO `YYYY-MM-DD`

| input | output |
| --- | --- |
| `45678` (Excel serial) | documented epoch → the correct Gregorian date (fixture asserts the exact mapping) |
| `"15/03/2026"` | `2026-03-15` |
| `"2026-03-15"` | `2026-03-15` |
| `"15-03-2026"` | `2026-03-15` |
| `"15/03/2569"` (Buddhist) | `2026-03-15` |
| `"2569-03-15"` | `2026-03-15` |
| `"15/03/69"` | `2069-03-15` + warning `DATE_ASSUMED_GREGORIAN` |
| `"32/01/2026"` / `"foo"` | throws `BAD_DATE` |

### 3.2 Inventory ledger (spec §5, §22.1)

`packages/server/test/ledger/`. Real DB.

- `OPENING(+1000) + PURCHASE(+500) − SALE(120) − DAMAGE(10) + CUSTOMER_RETURN(20)` →
  `1390` (spec §11 example), running balance per row correct.
- Worked example §5.5: `1000 + 8000 − 7700 = 1300`, variance `+300`.
- Each movement type moves stock in the right direction and sign CHECK rejects wrong sign.
- `SUPPLIER_RETURN`, `DAMAGE`, negative `ADJUSTMENT` decrease; `CUSTOMER_RETURN`, positive
  `ADJUSTMENT` increase.
- Void: a voided SALE is excluded from `qtyOnHand` and from the ledger running balance
  (shown struck).
- Negative stock: `ALLOW` mode lets `qtyOnHand` go `-20`; response carries `oversold`,
  `missingBalance: "20.000"`; status badge `out`.
- `PREVENT` mode: the sale that would cross zero returns `422 STOCK_WOULD_GO_NEGATIVE`,
  nothing written (assert `movements` count unchanged).
- Period `CLOSED`: any post/void into it → `409 PERIOD_CLOSED`.
- Backdate: date < today → response `warnings: ["BACKDATED"]`; gap > threshold with no
  reason → `400`; with reason → audit entry has the reason.
- Fiscal-year roll: with 12 periods closed, `POST /api/fiscal-year/roll` advances
  `current_fiscal_year`, `movements` row count and every `qtyOnHand` unchanged, labels
  flip to `70`.

### 3.3 Financial (spec §9, §22.1)

`packages/server/test/costing/` + shared unit tests.

- §9.3 example: opening `1000 × ฿100`, purchase `500 × ฿120` → `avg_cost_micro =
  106_666_667`; sale of `200` → `cogsSatang = 2_133_333` (round-half-up), not `2_133_400`.
- Revenue = Σ active SALE `total_price_satang`; COGS = Σ active SALE `cogs_satang`;
  gross profit = revenue − COGS; margin guards divide-by-zero.
- Customer return uses the **owner-entered** `unitCostSatang` (not current average);
  linked-sale prefill is a UI concern, tested in web.
- Positive adjustment / `FOUND_EXTRA` uses owner-entered `unitCostSatang`.
- `qtyOnHand ≤ 0` then `PURCHASE`: average resets to the purchase unit cost;
  `COST_BASIS_RESET` audit written. (open Q #4, PROVISIONAL — test encodes the default.)
- `qtyOnHand ≤ 0` then costed return/adjustment with owner cost: uses that cost; if
  somehow absent, falls back to `last_nonzero_avg_micro`.
- Void a `PURCHASE`: `stock_state` recomputed by `replayLedger` (not naive subtraction);
  assert equals a fresh replay.
- Rounding: parametric test over many `qty × unitCost` pairs asserts round-half-up at the
  satang.
- No-float guard: a test greps the built `packages/shared/dist` money module for `+`/`*`
  on `number` (or an ESLint rule test) — documents that money math is Decimal/integer.

### 3.4 Import (spec §13–§15, §22.1)

`packages/server/test/imports/` with the fixtures in `IMPORT_FORMAT.md` §8.

- `master_stock_68.xlsx` → 4 products created, openings posted, golden stock after.
- `purchases_69.xlsx` / `sales_69.xlsx` → movements created, dashboard totals match.
- `purchases_69_bad_headers.xlsx` → preview all-invalid, `422` on ALL_OR_NOTHING commit,
  `movements` count unchanged.
- `sales_69_unknown_sku.xlsx` → that row `SKU_NOT_FOUND`; ALL_OR_NOTHING fails cleanly.
- `mixed_invalid.xlsx` → preview totals (valid/invalid/precision/date) exact; PARTIAL
  mode commits only the valid rows and the skipped list matches.
- `duplicate_rows.xlsx` → second row `action = DUPLICATE`, one movement created not two.
- Re-upload `purchases_69.xlsx` after a successful commit → `fileAlreadyImported: true`;
  commit without `acknowledgeDuplicateFile` → `422 IMPORT_FILE_ALREADY_IMPORTED`; with
  it → every row `DUPLICATE`, zero new movements.
- `thai_dates.xlsx` → Buddhist years and Excel serials land on the right Gregorian dates.
- `big_10k.xlsx` → single transaction, all 10,000 land; timing recorded (informational).
- **Rollback:** inject a failure on row 7,431 of a 10,000-row import → `ROLLBACK`; assert
  `products`, `movements`, `import_rows.committed` all unchanged; batch `FAILED`.

### 3.5 Concurrency (spec §14.2, §31)

`packages/server/test/concurrency/`. Real parallel `pg` connections.

- Seed one product at `100`. Fire `sell 80` and `sell 50` simultaneously (Promise.all):
  - `PREVENT` mode → exactly one `201`, one `422`; final `qtyOnHand = 20`.
  - `ALLOW` mode → both `201`; final `qtyOnHand = -30`; oversold flagged.
- 50 parallel `sell 1` on a product at `100` → final `50`, exactly 50 movements, no lost
  update.
- Same `Idempotency-Key` fired 10× in parallel → one movement, 10 identical responses,
  9 marked `_replayed`.
- Two tabs closing the same period concurrently → one `200`, one `409
  PERIOD_ALREADY_CLOSED`.

### 3.6 Offline / sync (spec §12)

`packages/web/test/offline/` + a server integration test for `/api/sync`.

- Queue drains FIFO; order preserved.
- `POST /api/sync` with a batch where op 2 hits `PERIOD_CLOSED` → op 1 and op 3 `SYNCED`,
  op 2 `CONFLICT`; client moves op 2 to the panel, ops 1/3 removed from queue.
- Retry the whole batch with the same keys → previously-synced ops return `replayed:
  true`, create nothing.
- State machine: `PENDING → SYNCING → SYNCED`; on network error `→ PENDING` with
  `retryCount++`; on typed conflict `→ CONFLICT`.
- `PREVENT` mode + offline: the drawer shows the "cannot guarantee" notice (web test).

### 3.7 Recovery (spec §22.1, §33; `BACKUP_RECOVERY.md` §7)

`packages/server/test/recovery/`. Real `pg_dump`/`pg_restore`, real encryption.

- **Round trip:** seed → backup (full pipeline) → assert artifact verified → `DROP
  SCHEMA` → restore → `GET /api/dashboard` + per-SKU stock equal the pre-drop golden.
- **Pre-restore backup:** a restore creates a `PRE_RESTORE` row first.
- **Tamper:** flip a byte in `*.inv.enc` → restore → `422 BACKUP_INTEGRITY_FAILED`, DB
  untouched.
- **Bad passphrase:** wrong passphrase → `401 BAD_PASSPHRASE`.
- **Cross-migration:** take a backup at schema `0003`, add migration `0004`, restore the
  `0003` backup → restore runs `0004` forward; audit records `fromSchema`/`toSchema`.
- **Newer schema:** backup tagged `0099` → `409 SCHEMA_NEWER_THAN_APP`.
- **Retention keeps ≥ 1:** retention config `keep 0` → sweep still leaves the last
  verified copy; `DELETE` of the last copy → `409 LAST_REMAINING_COPY`.
- **Cloud failure:** stub the S3 client to throw on `PUT` → `cloud_status =
  CLOUD_UPLOAD_FAILED`, `local_status = LOCAL_BACKUP_SUCCESS`, status endpoint shows the
  warning; a later `POST /api/backups/:id/upload` succeeds when the stub recovers.
- **DR drill (nightly):** the full §7 drill restoring from the cloud copy.

### 3.8 Stress (spec §21, §35)

`npm run test:stress`, uses `scripts/stress-seed.ts` (10,000 products, 100,000
movements).

- `GET /api/products?page=…` p95 < 300 ms; no full-table scan (assert `EXPLAIN` uses the
  intended index).
- `GET /api/products/:id/ledger` on a product with 5,000 movements paginates < 200 ms.
- `GET /api/dashboard` < 500 ms (served from `stock_state`, not a movements scan).
- Reconciliation job over 10k products completes < 60 s and finds zero drift on a
  clean seed.
- A 50k-row import commits atomically without a statement timeout at the configured
  setting.

### 3.9 E2E (Playwright)

- Create product → post purchase → post sale → ledger shows the calculation → dashboard
  KPIs update.
- Oversell in `ALLOW` mode → red badge + 🚨 + Missing Balance visible.
- Import wizard: upload `mixed_invalid.xlsx` → preview highlights bad cells → download
  invalid rows → PARTIAL commit → result screen counts match.
- Close a period → posting into it is blocked with `🔒 ปิดงวด`.
- Go offline → create a sale → go online → it syncs; force a conflict → it appears in the
  sync panel and can be retried/edited/discarded.
- Backup Now → status card shows `LOCAL_BACKUP_SUCCESS`; restore dialog requires the
  phrase + passphrase.

---

## 4. Fixtures & seeds

| Path | Contents |
| --- | --- |
| `scripts/seed.ts` | mock dataset (spec §23) as OPENING/PURCHASE/SALE movements + a few returns/adjustments to exercise costing |
| `scripts/stress-seed.ts` | 10k products / 100k movements, deterministic RNG seed |
| `packages/server/test/fixtures/imports/` | the Excel files listed in `IMPORT_FORMAT.md` §8 (`big_10k.xlsx` generated by a script, not committed if large) |
| `packages/shared/src/domain/__tests__/replayLedger.golden.json` | the golden snapshot |

---

## 5. Verification levels (for `PROGRESS.md` and the final report)

An area may be recorded at a level only if that level's tests **actually ran and passed**:

| Level | Meaning |
| --- | --- |
| Implemented | code exists, type-checks, wired up |
| Unit tested | Vitest units green (shared / service pure logic) |
| Integration tested | real-DB service/route tests green |
| E2E tested | Playwright flow green |
| Stress tested | `test:stress` green at spec §21 targets |
| Recovery tested | `test:recovery` drills green |
| Not verified | none of the above |

The Phase 9 final report (spec §24.1) lists tests run/passed/failed, per-area level,
known limitations, unverified areas, production risks, next steps.
