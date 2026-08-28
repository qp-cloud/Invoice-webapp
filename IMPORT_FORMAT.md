# IMPORT_FORMAT.md — Excel / CSV Import Specifications

> Subordinate to `PROJECT_SPEC.md` (§7 sanitization, §13 import, §15 idempotency).
> Library: SheetJS (`xlsx`). CSV goes through the same pipeline (UTF-8; comma or the
> sheet's detected delimiter). First sheet only unless a sheet named `data` exists.
> Header row = row 1. Header matching is **case-insensitive**, trimmed, and accepts the
> aliases listed. Extra columns are ignored. Column order does not matter.

---

## 1. Common rules (all import kinds)

Every cell passes through `packages/shared/src/cleanData` (spec §7):

- **SKU**: `trim` → collapse inner whitespace → `toUpperCase`. Empty → row error
  `SKU_REQUIRED`.
- **Numbers**: strip `฿`, `THB`, `บาท`, spaces, thousands separators; `.` = decimal
  point; `(1,234)` → `-1234`. Empty / non-numeric → row error `NOT_A_NUMBER`.
  - money → integer satang, round-half-up to 2 dp.
  - quantity → `Decimal`, ≤ 3 dp; more precision → `QUANTITY_PRECISION`.
- **Dates**: accept Excel serial, `DD/MM/YYYY`, `YYYY-MM-DD`, `DD-MM-YYYY`. Year ≥ 2400 →
  treated as Buddhist, `− 543`. Stored as `YYYY-MM-DD` Gregorian. Unparseable →
  `BAD_DATE`. Ambiguous 2-digit year → parsed as Gregorian **and flagged**
  `DATE_ASSUMED_GREGORIAN` (warning, not a hard error).

Row-level checks after sanitization are in each section below.

The server **always computes** `total_cost` / `total_price` from `quantity × unit_*`. If
the file contains a total column and it differs from the computed value by > 1 satang, the
row gets a **warning** `TOTAL_MISMATCH` (not an error); the computed value is used
(spec §26.2 #6, PROVISIONAL).

---

## 2. `MASTER_STOCK` — Master Stock 68

| Column | Aliases | Required | Rules |
| --- | --- | --- | --- |
| `sku` | `รหัสสินค้า`, `code`, `product_code` | yes | unique within the file; duplicates in-file → later row `DUPLICATE_SKU_IN_FILE` |
| `name` | `ชื่อสินค้า`, `product_name`, `description` | on create | required if the SKU is new; optional on update |
| `stock_68` | `stock68`, `opening`, `opening_stock`, `ยอดยกมา`, `สต็อก68` | yes | `≥ 0`, fractional allowed |
| `min_stock` | `minstock`, `min`, `safety_stock`, `ขั้นต่ำ` | no | `≥ 0`; default `0` |
| `unit` | `หน่วย`, `uom` | no | must exist in `units`; default `piece`; unknown → `UNKNOWN_UNIT` |

Behaviour:

- Match on sanitized `sku` (UPSERT, spec §8.3).
  - new SKU → `CREATE` product; then set opening stock.
  - existing SKU → `UPDATE` `name?`, `min_stock?`, `unit?`.
- Opening stock effect (spec §13.8, open Q #8, PROVISIONAL):
  - product has exactly one `ACTIVE` `OPENING`, no other movements, current period `OPEN`
    → **void old `OPENING`, post new** at `stock_68`.
  - otherwise → post an **`ADJUSTMENT`** (`reason_code = CORRECTION`) for
    `stock_68 − current_qty_on_hand`; requires an opening `unit_cost` — see next.
- `unit_cost` for the opening: not a column in this template. v1 posts the opening/adjust
  at `unit_cost_satang = 0` **unless** the product already has an average cost, in which
  case the positive adjustment uses that average. Flagged `OPENING_COST_ZERO` (warning).
  *(If the owner needs real opening costs, add a `unit_cost` column — tracked as a
  follow-up, not v1.)*

Sample (`samples/master_stock_68.xlsx`):

```
sku       | name       | stock_68 | min_stock | unit
SKU-001   | สินค้า A   | 1000     | 500       | piece
SKU-002   | สินค้า B   | 500      | 300       | box
```

---

## 3. `PURCHASES` — Purchases 69

| Column | Aliases | Required | Rules |
| --- | --- | --- | --- |
| `date` | `วันที่`, `doc_date`, `purchase_date` | yes | see §1 date rules; period must be `OPEN` → else `PERIOD_CLOSED` |
| `sku` | `รหัสสินค้า`, `code` | yes | must resolve to an existing product → else `SKU_NOT_FOUND` |
| `quantity` | `qty`, `จำนวน` | yes | `> 0` → else `QUANTITY_NOT_POSITIVE` |
| `unit_cost` | `cost`, `price`, `ราคาทุน`, `ต้นทุนต่อหน่วย` | yes | `≥ 0` |
| `invoice_no` | `invoice`, `เลขที่บิล`, `เลขที่ใบกำกับ` | no | free text |
| `supplier` | `ผู้ขาย`, `vendor` | no | free text |
| `note` | `หมายเหตุ`, `remark` | no | |

Each valid row → one `purchases` row + one `PURCHASE` movement (spec §10.1).
`total_cost_satang` = `roundHalfUp(quantity × unit_cost_satang)`.

Sample (`samples/purchases_69.xlsx`):

```
date        | sku      | quantity | unit_cost | invoice_no
05/01/2569  | SKU-001  | 500      | 120.00    | PV-014
07/01/2569  | SKU-002  | 300      | 85        | PV-015
```

---

## 4. `SALES` — Sales 69

| Column | Aliases | Required | Rules |
| --- | --- | --- | --- |
| `date` | `วันที่`, `doc_date`, `sale_date` | yes | date rules; period `OPEN` |
| `sku` | `รหัสสินค้า`, `code` | yes | must resolve → else `SKU_NOT_FOUND` |
| `quantity` | `qty`, `จำนวน`, `จำนวนขาย` | yes | `> 0` |
| `selling_price` | `price`, `unit_price`, `ราคาขาย` | yes | `≥ 0` |
| `channel` | `ช่องทาง`, `sales_channel` | no | free text |
| `bill_no` | `bill`, `เลขที่บิล`, `receipt_no` | no | free text |
| `note` | `หมายเหตุ`, `remark` | no | |

Each valid row → one `sales` row + one `SALE` movement; `cogs_satang` computed from the
weighted average **at commit time, in file order** (so intra-file purchase→sale ordering
matters — rows are processed by `(date, row_no)`).

- `PREVENT` mode + a row would drive stock negative → row error
  `STOCK_WOULD_GO_NEGATIVE`. In `ALL_OR_NOTHING` this fails the whole import unless the
  owner switches that row's product to `ALLOW` or removes the row.
- `ALLOW` mode → committed; product ends oversold; dashboard flags it.

Sample (`samples/sales_69.xlsx`):

```
date        | sku      | quantity | selling_price | channel
06/01/2569  | SKU-001  | 120      | 150.00        | หน้าร้าน
09/01/2569  | SKU-002  | 350      | 110           | ออนไลน์
```

---

## 5. Validation error / warning codes

| Code | Level | Meaning |
| --- | --- | --- |
| `SKU_REQUIRED` | error | empty SKU cell |
| `NAME_REQUIRED_ON_CREATE` | error | new SKU with no name (MASTER_STOCK) |
| `NOT_A_NUMBER` | error | number cell could not be parsed |
| `QUANTITY_PRECISION` | error | quantity with > 3 decimal places |
| `QUANTITY_NOT_POSITIVE` | error | quantity ≤ 0 where `> 0` required |
| `NEGATIVE_NOT_ALLOWED` | error | negative money value |
| `BAD_DATE` | error | date cell unparseable |
| `SKU_NOT_FOUND` | error | purchases/sales SKU not in `products` |
| `UNKNOWN_UNIT` | error | unit not in `units` |
| `PERIOD_CLOSED` | error | row date falls in a closed period |
| `DUPLICATE_SKU_IN_FILE` | error | second+ occurrence of a SKU in MASTER_STOCK |
| `STOCK_WOULD_GO_NEGATIVE` | error | sales row blocked by `PREVENT` |
| `ROW_ALREADY_IMPORTED` | duplicate | `source_row_hash` already committed for this kind |
| `FILE_ALREADY_IMPORTED` | duplicate | `source_file_hash` already committed (batch-level) |
| `DATE_ASSUMED_GREGORIAN` | warning | 2-digit / ambiguous year parsed as Gregorian |
| `TOTAL_MISMATCH` | warning | file total ≠ computed total (computed value used) |
| `OPENING_COST_ZERO` | warning | opening/adjust posted at zero unit cost |

`action` per row: `CREATE` (new document/product), `UPDATE` (MASTER_STOCK existing SKU),
`SKIP` (has an error, PARTIAL mode), `DUPLICATE` (row/file hash match — never re-applied).

---

## 6. Idempotency (spec §15)

- `import_batches.source_file_hash` = sha256 of the uploaded bytes. A prior `COMMITTED`
  batch with the same hash → preview shows `fileAlreadyImported: true`; commit needs
  `acknowledgeDuplicateFile: true` or returns `422 IMPORT_FILE_ALREADY_IMPORTED`.
- `import_rows.source_row_hash` = sha256 of the canonicalized sanitized row (kind + all
  business fields, normalized). A row whose hash is already `committed` for the same kind
  → `action = DUPLICATE`, not re-applied. No duplicate movement is created.
- Re-uploading a corrected file: unchanged rows are `DUPLICATE` (skipped), only the fixed
  rows import.

---

## 7. Atomicity (spec §13.3 / §25)

- `ALL_OR_NOTHING` (default): one Postgres transaction; any error → full `ROLLBACK`,
  batch `FAILED`. A 10,000-row file either fully lands or not at all.
- `PARTIAL` (opt-in at the confirm step only): valid rows commit, invalid rows are
  recorded as `SKIP`; the result screen lists every skipped row and offers the
  invalid-rows download.
- Very large files (> ~50k rows) use a staging temp table + set-based DML inside the same
  transaction; atomicity is unchanged.

---

## 8. Sample files

Committed under `packages/server/test/fixtures/imports/`:

```
master_stock_68.xlsx          valid, 4 SKUs (the mock dataset, spec §23)
purchases_69.xlsx             valid
sales_69.xlsx                 valid
purchases_69_bad_headers.xlsx wrong header names
sales_69_unknown_sku.xlsx     one SKU-999 row
mixed_invalid.xlsx            bad number, bad date, qty=0, 3dp+ qty
duplicate_rows.xlsx           two identical purchase rows
thai_dates.xlsx               dates as 2569 Buddhist + Excel serials
big_10k.xlsx                  10,000 valid purchase rows (generated by a fixture script)
```
