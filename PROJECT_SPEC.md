# PROJECT_SPEC.md — Single-Owner Inventory Management System

> **Status:** Draft v0.1 — specification only. No application code has been written yet.
> **Owner of this document:** the project owner / operator.
> **Audience:** AI coding agents (Claude Code and similar) and any human maintainer.
> **Authority:** This file is the **single source of truth**. When code, other docs, or an
> agent's assumptions disagree with this file, this file wins until it is explicitly amended.

---

## 0. How to use this document

1. Read this entire file before writing or modifying any code.
2. Then read `TASKS.md` and `PROGRESS.md`.
3. Do the analysis / design work in **§25 First Task** and stop for owner confirmation
   before starting major implementation.
4. Keep this file amended as decisions are made. Every amendment gets a dated line in
   **§27 Change Log**.

Companion documents (created during Phase 1, all subordinate to this file):

| File | Purpose |
| --- | --- |
| `PROJECT_SPEC.md` | Source of truth (this file). |
| `ARCHITECTURE.md` | Expanded architecture, module boundaries, sequence diagrams. |
| `DATABASE.md` | Full schema, migrations, index rationale, constraint list. |
| `API.md` | Every endpoint, request/response shapes, error codes, idempotency contract. |
| `TESTING.md` | Test plan, fixtures, coverage targets, how to run each suite. |
| `BACKUP_RECOVERY.md` | Backup format, schedule, restore runbook, DR drills. |
| `IMPORT_FORMAT.md` | Exact column specs, sample files, validation rules per import type. |
| `PROGRESS.md` | What is implemented and to what verification level. |
| `TASKS.md` | Remaining work, phase-ordered. |

---

## 1. Product goal and non-goals

### 1.1 Goal

A modern, production-grade inventory management application for **one owner/operator**.
It must be fast to operate for a single person and correct enough for real business use.

It manages: master products, opening stock (the "Stock 68" migration), purchases
("Purchases 69"), sales ("Sales 69"), inventory adjustments, customer returns, supplier
returns, stock movements, monthly reports, estimated profit / gross margin, Excel/CSV
import and export, automatic backup and restore, offline capability, data validation, and
audit history.

### 1.2 Non-goals (do not build)

- User invitation, sign-up flows for additional users.
- Role management / permissions matrix / RBAC.
- Team management, organization hierarchy, departments.
- Multi-tenant architecture.
- Anything that assumes more than one human principal.

There is exactly **one principal**: the owner. Authentication exists only to protect the
data at rest on the owner's machine and to hold the backup-encryption passphrase
(see §16), not to distinguish people.

### 1.3 Priority order (use this to break every tie)

```
Data Integrity
  > Correct Inventory
    > Financial Accuracy
      > Backup / Recovery
        > Offline Reliability
          > Testing
            > UX Polish
```

The project is **not** "done" because the dashboard renders. See §24 Definition of Done.

---

## 2. Glossary

| Term | Meaning |
| --- | --- |
| **Movement** | One immutable, signed, auditable change to on-hand quantity for one product. The ledger is the list of movements. |
| **Ledger** | The full ordered list of movements for a product. **The source of truth for stock.** |
| **Document** | A business record (purchase, sale, adjustment, return) that *produces* one or more movements. Documents hold business fields; movements hold the ledger effect. |
| **Fiscal year (FY)** | A Buddhist-year accounting year, e.g. FY2569. Stored in `settings.current_fiscal_year`. The 68/69 view is **rolling**: each year-end it advances (68/69 → 69/70 → 70/71 …). |
| **Stock 68** | The opening balance for the **current** fiscal year — i.e. stock carried in from the prior year (FY2569 → "68" = พ.ศ. 2568 close). Represented as `OPENING` movements. When FY rolls to 2570, "Stock 68" in the UI means the FY2569 closing balance. |
| **Purchases 69 / Sales 69** | Purchase / sale activity **within the current fiscal year**. Labels track `current_fiscal_year` (FY2570 → "Purchases 70 / Sales 70"). |
| **Movement Variance** | `Purchases (current FY) − Sales (current FY)` for a product (net flow in the current-FY view). |
| **Satang** | 1 THB = 100 satang. All money is stored as an integer number of satang. |
| **Period** | A calendar month, displayed with a Buddhist year (e.g. `มกราคม 2569`). A period is `OPEN` or `CLOSED`. |
| **Estimated Gross Profit** | `Sales Revenue − Estimated COGS`, where COGS uses weighted-average cost. Labelled "estimated" until formal accounting rules are defined. |
| **Oversold** | `current_stock < 0`. The absolute value is the *Missing Balance*. |

**Buddhist year mapping:** `Gregorian = Buddhist − 543`. So `2569 → 2026`, `2568 → 2025`.
Dates are **stored** in Gregorian ISO (`YYYY-MM-DD`) and **displayed** in Buddhist years
when the UI is set to Thai dates.

---

## 3. Technology stack (committed)

Decisions below are fixed for the project. Changing one requires a Change Log entry (§27)
and owner sign-off.

### 3.1 Frontend

| Concern | Choice |
| --- | --- |
| Framework | React 18 + Vite + TypeScript (strict) |
| Styling | Tailwind CSS |
| Components | shadcn/ui (Radix under the hood) |
| Icons | lucide-react |
| Client state | Zustand |
| Local persistence | IndexedDB via **Dexie** — used only as an **offline cache + outbound queue + UI prefs**, never as a second source of truth |
| Spreadsheet I/O | SheetJS (`xlsx`) |
| Charts | Recharts (fed pre-aggregated data from the server) |
| Decimal math | `decimal.js` (see §9) |
| Dates | `luxon` for time math + a small dedicated Thai/Buddhist + Excel-serial parser in `cleanData` |

### 3.2 Backend

| Concern | Choice |
| --- | --- |
| Runtime | Node.js 20 LTS + TypeScript (strict) |
| HTTP framework | Fastify |
| DB access | Drizzle ORM + `pg` driver, raw SQL where clarity demands it |
| Database | **PostgreSQL 16** — the single source of truth in production. **Dev/test use [PGlite](https://pglite.dev) (embedded Postgres 16, in-process, no Docker)** — same SQL dialect; see `DATABASE.md` §0 and `TESTING.md` §1 for the fidelity caveats (chiefly: single-connection, so true multi-client concurrency tests run only against real Postgres). |
| Migrations | Hand-written SQL migration files + a small ordered runner (`_migrations` table), forward-only, checked into the repo. Drizzle ORM used for typed queries, not migration codegen. |
| Validation | `zod` schemas shared between server and client |
| Money | integer satang (`BIGINT`), `decimal.js` for intermediate arithmetic, round-half-up to satang on write |
| Background jobs | `node-cron` in-process for the **reconciliation job** and the **backup startup catch-up check**. The daily backup itself is primarily triggered by **Windows Task Scheduler** (§16). |
| Logging | `pino` — structured JSON logs to file; user-facing messages are separate (§17) |

### 3.3 Runtime / deployment model

- The system is **local-first for a single owner**: the Postgres instance, the Node API,
  and the static frontend all run on **the owner's machine** (or a single box the owner
  controls). No public multi-tenant hosting.
- The browser SPA talks to `http://localhost:<port>` (or LAN address) for the API.
- **Multiple devices / tabs** connect to the *same* Postgres via that API. There is **no
  peer-to-peer sync and no second database**. "Sync" (§12) means: a client that was
  offline flushes its queued operations to that one server.
- Owner platform is **Windows**. Optional future packaging as an Electron or Tauri shell
  is allowed but **out of scope for v1**; the spec must not depend on it.
- Automatic backups (§16): **Windows Task Scheduler** is the primary trigger for the daily
  02:00 backup (runs even when the app is closed, by invoking a small backup CLI/endpoint).
  The app **also** performs a **startup catch-up check** and runs a backup immediately if
  the last successful one is older than the configured interval.
- Access to the app is gated by a **local PIN/password**. A **separate** passphrase
  encrypts backups. Optional **cloud (S3-compatible)** credentials are stored separately
  again from the backup passphrase (§16). No user accounts, no roles.
- Currency is **THB only** — all money is integer satang, no currency field, no FX.

---

## 4. Architecture overview

```
┌───────────────────────────────────────────────────────────┐
│  Browser (SPA)                                             │
│                                                           │
│  React ──▶ Zustand (UI + domain state)                     │
│   │                                                        │
│   ├─▶ API client ──────────────┐  (online path)            │
│   │                            │                           │
│   └─▶ Dexie / IndexedDB        │                           │
│        - offline outbound queue│                           │
│        - read cache            │                           │
│        - UI preferences        │                           │
│              │ (on reconnect)  │                           │
│              └───── Sync ───────┤                           │
└───────────────────────────────┼───────────────────────────┘
                                │  HTTP (JSON), idempotency keys
                                ▼
┌───────────────────────────────────────────────────────────┐
│  Node API (Fastify)                                        │
│   - zod validation                                         │
│   - domain services (ledger, costing, import, backup)      │
│   - idempotency middleware (processed_requests table)      │
│   - per-product locking for stock-changing ops            │
│   - node-cron: automatic backup, stock reconciliation      │
└───────────────────────────────┼───────────────────────────┘
                                ▼
┌───────────────────────────────────────────────────────────┐
│  PostgreSQL 16  (SOURCE OF TRUTH)                          │
│   - movements ledger (immutable, append + void)           │
│   - documents, products, periods, audit_log               │
│   - stock_state (derived cache, reconciled on a schedule) │
│   - CHECK constraints, UNIQUE, FK, transactions            │
└───────────────────────────────────────────────────────────┘
                                │
                                ▼
                     Filesystem backups (pg_dump)
                     + optional encrypted offsite copy
```

Key rules:

- **The ledger (`movements`) is authoritative.** `stock_state.qty_on_hand` is a derived
  cache maintained inside the same transaction as each movement, and independently
  recomputed from the ledger by a reconciliation job that raises an alert on any drift.
- **Nothing changes stock without writing a movement.** No endpoint, no import, no admin
  action edits `stock_state` directly in normal operation.
- **IndexedDB is never a source of truth.** It may be wiped at any time without data loss
  beyond un-synced queued operations, which are themselves recoverable from the queue.

---

## 5. Core domain model — inventory

### 5.1 Movement types

```
OPENING           opening / migrated stock (Stock 68)         +
PURCHASE          goods received from supplier                +
SALE              goods sold to customer                      −
CUSTOMER_RETURN   customer returns goods to us                +
SUPPLIER_RETURN   we return goods to supplier                 −
DAMAGE            goods written off as damaged/spoiled        −
ADJUSTMENT        stock count correction, signed              + / −
TRANSFER_IN       received from another location (future)     +
TRANSFER_OUT      sent to another location (future)           −
```

`TRANSFER_IN` / `TRANSFER_OUT` are reserved in the enum but **disabled in the UI for v1**
(no location model yet — see §26 Open Questions). Keep the code paths generic so a
`location_id` can be added later without a data migration of movement semantics.

Every movement stores a **signed** `quantity` (positive adds to stock, negative removes).
The sign is derived from the type by the domain layer, never entered by the user, except
for `ADJUSTMENT` where the user supplies a signed delta.

### 5.2 Stock calculation — full model

```
Current Stock =
    Opening Stock
  + Purchases
  + Customer Returns
  + Transfer In
  − Sales
  − Supplier Returns
  − Damage
  ± Adjustments
  − Transfer Out
```

Which is exactly:

```
current_stock(product) = Σ movements.quantity
                         WHERE product_id = product
                           AND status = 'ACTIVE'
```

(`VOIDED` movements are excluded — see §5.6.)

### 5.3 Stock calculation — current fiscal year (68/69) view

This view is **rolling** (§6.5). `CFY` = `settings.current_fiscal_year` (e.g. 2569).

```
Current Stock (CFY view) =
    Stock 68            (Σ quantity where type = OPENING, up to and incl. CFY−1 close)
  + Purchases (CFY)     (Σ quantity where type = PURCHASE, date within CFY)
  − Sales (CFY)         (Σ |quantity| where type = SALE,   date within CFY)
```

For FY2569 the UI labels read "Stock 68 / Purchases 69 / Sales 69"; after the FY2570
rollover the same view reads "Stock 69 / Purchases 70 / Sales 70" over the new year's
dates. The formula is unchanged.

### 5.4 Movement variance

```
Movement Variance = Purchases 69 − Sales 69
```

### 5.5 Worked example (must be reproduced by an automated test)

```
Stock 68        = 1,000
Purchases 69    = 8,000
Sales 69        = 7,700

Current Stock     = 1,000 + 8,000 − 7,700 = 1,300
Movement Variance = 8,000 − 7,700         = +300
```

### 5.6 Void semantics

- Historical movements and documents are **never hard-deleted** in normal operation.
- Editing a posted document = **void the old one + create a new one**. Both remain.
- A void sets `status = 'VOIDED'`, `voided_at`, `void_reason` on the document **and on
  every movement it produced**.
- Stock and all financial calculations **exclude** `VOIDED` rows.
- Example:

  ```
  SALE #INV-001   Qty: 100
  → VOIDED  reason: "กรอกจำนวนผิด"
  ```

  After the void, the −100 SALE movement no longer counts toward stock.

- Voiding is blocked if the document's period is `CLOSED` (§11) unless the owner
  explicitly reopens the period.

---

## 6. Business rules — stock protection and status

### 6.1 Negative stock protection

Two modes, stored in `settings.negative_stock_mode`:

```
ALLOW    (default) — overselling is permitted; the system warns loudly.
PREVENT           — the server rejects any operation that would drive stock < 0.
```

- Default is **ALLOW** (warning mode).
- In `ALLOW` mode, when `current_stock < 0` the UI shows:

  ```
  🚨 สต็อกติดลบ (ขายเกิน)
  Missing Balance: <abs(current_stock)>
  ```

  Example: `Current Stock: -20` → `Missing Balance: 20`.

- In `PREVENT` mode the sale/return endpoint returns a typed error
  (`STOCK_WOULD_GO_NEGATIVE`) with the shortfall, and no movement is written.
- **Offline caveat (design constraint, not a bug):** a client that is offline cannot
  authoritatively enforce `PREVENT`. Offline sales are queued optimistically; on sync the
  server re-checks. A queued sale that would violate `PREVENT` at sync time is marked
  `CONFLICT` and surfaced to the owner for a decision (§12.3). This limitation must be
  stated in the UI when `PREVENT` mode is on and the device is offline.

### 6.2 Stock status

```
🟢 ปกติ            stock > min_stock
🟡 เตือนสั่งซื้อ     0 ≤ stock ≤ min_stock
🔴 สินค้าหมด / ติดลบ  stock ≤ 0
```

When `stock < 0`, also render the oversold warning and Missing Balance from §6.1.
Boundary rule: `min_stock` itself is amber, `0` is red, exactly at `0` is red.

### 6.3 Backdated transactions

- If a document's date is before "today" (owner's local date), show:

  ```
  ⚠️ รายการย้อนหลัง
  วันที่รายการ: 15/03/2569
  วันที่ปัจจุบัน: 29/08/2569
  ```

- If the gap exceeds `settings.backdate_reason_threshold_days` (default **7**), a
  **reason is required** and is written to the audit log.
- A backdated date whose period is `CLOSED` is rejected (§11).

### 6.4 Monthly periods

- Periods are calendar months keyed `YYYY-MM` (Gregorian), displayed as
  `<เดือน> <พุทธศักราช>`, e.g. `สิงหาคม 2569`.
- Status: `OPEN` or `CLOSED`.
- A `CLOSED` period:
  - blocks new documents dated within it,
  - blocks editing / voiding documents within it,
  - blocks deletion,
  - blocks backdated transactions into it,
  - shows `🔒 ปิดงวด` in the UI.
- Reopening requires an explicit owner action and writes an audit entry
  (`old_value: CLOSED`, `new_value: OPEN`, `reason` required).
- Closing a period should be cheap and reversible; it does **not** snapshot or freeze
  numbers — it only sets a flag that the write paths honour.

### 6.5 Fiscal year rollover (rolling 68/69)

- `settings.current_fiscal_year` (Buddhist year) drives the dashboard/master 68/69 labels
  and the current-FY sums (§5.3, §19.1).
- **Rollover action** (explicit, owner-triggered, audit-logged `action = ROLL_FISCAL_YEAR`):
  1. Require all 12 monthly periods of the outgoing FY to be `CLOSED`.
  2. Take a mandatory backup first (§16).
  3. Advance `current_fiscal_year` by 1.
  4. The outgoing year's **closing balance per product becomes the new "Stock 68"** for
     display purposes. Implementation: this is a *derived* cutoff (`SUM` of movements up
     to the fiscal year start), **not** new `OPENING` movements and **not** a stored
     snapshot table (§26.1 #12) — the ledger stays the only store of truth. `OPENING`
     movements are only ever the very first migration. Historical-year queries are backed
     by the `movements(product_id, date)` index plus an optional cached value.
- No transaction data is moved or rewritten by a rollover.

---

## 7. Data sanitization — `cleanData`

A single centralized module (`packages/shared/src/cleanData/`) is the **only** place that
normalizes input. **Every** manual form submission **and** every imported row passes
through the same functions. There is no second, looser path.

Export a small typed API, e.g.:

```ts
cleanSku(raw: string): string
cleanQuantity(raw: unknown): Decimal            // fractional allowed, ≥ 0 enforced by caller
cleanMoneySatang(raw: unknown): bigint          // integer satang
cleanDate(raw: unknown, opts?: { assumeThaiYear?: boolean }): string  // 'YYYY-MM-DD'
```

Each returns either a clean value or throws a typed `SanitizationError` with a
field-level code. **Callers must never swallow the error and write a partial/corrupt
record.**

### 7.1 SKU

```ts
sku.trim().toUpperCase()
```

Also collapse internal runs of whitespace to a single space. Reject empty result.
SKU is unique (§8, §14). Imports UPSERT on SKU (§8.3).

### 7.2 Numbers (money and quantity)

Accept and normalize all of:

```
1,250.00
฿1,250.00
 1,250.00 ฿
1 250.00        (space as thousands separator)
1250
(1,250.00)      → negative, only where a signed value is allowed (e.g. ADJUSTMENT)
```

Normalization: strip currency symbols (`฿`, `THB`, `บาท`), strip spaces and thousands
separators, treat `.` as the decimal point, map wrapping parentheses to a leading `-`.
Result for the first three examples: `1250.00`.

- **Money** → convert to integer **satang** (`round-half-up` to 2 dp, then ×100). Store as
  `BIGINT`.
- **Quantity** → keep as `Decimal`; fractional values are valid: `0.125`, `1.5`, `10.75`.
  Precision is `NUMERIC(18, 3)` in the DB (3 decimal places). Reject values needing more
  than 3 dp with a typed error (do not silently round quantities).
- Empty / non-numeric / `NaN` / `Infinity` → `SanitizationError`. Never coerce to `0`
  silently.

### 7.3 Dates

Accept:

```
Excel serial number      e.g. 45678        (1900 date system; document the epoch used)
DD/MM/YYYY               e.g. 15/03/2026
YYYY-MM-DD               e.g. 2026-03-15
DD-MM-YYYY               e.g. 15-03-2026
```

Thai Buddhist years: any 4-digit year ≥ 2400 is treated as Buddhist and converted
(`− 543`). So `15/03/2569 → 2026-03-15`. When the year is ambiguous (2-digit or < 2400),
use `opts.assumeThaiYear` from the caller's context; default to Gregorian and flag it in
import preview.

- **Stored** internally as `YYYY-MM-DD` (Gregorian, no time zone — these are business
  dates, not timestamps).
- **Displayed** as Buddhist `DD/MM/พ.ศ.` when `settings.thai_dates = true` (default true).
- Timestamps (`created_at`, `voided_at`, audit `timestamp`) are separate: full
  `timestamptz` in UTC, displayed in the owner's local zone.

### 7.4 Test obligation

`cleanData` has the densest unit-test coverage in the project. See §22 and `TESTING.md`.
Every accepted-format example above is a test case; so is every rejection.

---

## 8. Product master

### 8.1 Fields (minimum)

```
id            uuid, PK
sku           text, UNIQUE, sanitized (§7.1)
name          text, required
category      FK → categories (nullable)
unit          text, FK → units.code
min_stock     NUMERIC(18,3), default 0, ≥ 0
active        boolean, default true
created_at    timestamptz
updated_at    timestamptz
```

### 8.2 Rules

- SKU is unique at the database level (`UNIQUE` constraint, not just app check).
- Soft-deactivate via `active = false`; do not delete products that have movements.
- `name`, `category`, `unit`, `min_stock` are editable; edits write an audit entry.

### 8.3 Import UPSERT

- Master imports match on **sanitized SKU**.
- SKU exists → `UPDATE` the mutable fields. **Never** create a duplicate product.
- SKU absent → `INSERT`.
- The import preview (§13.5) reports counts of "will update" vs "will create".

---

## 9. Financial model

### 9.1 Precision — non-negotiable

- **Money is never a JavaScript `number` and never a float in the DB.**
- Storage: integer **satang** in `BIGINT` columns (`*_satang` suffix).
- Arithmetic: `decimal.js` for any intermediate step (averaging, apportioning), then
  round to integer satang on write with an explicit, documented rounding mode
  (**round-half-up**).
- Quantities may be fractional: `NUMERIC(18,3)` in the DB, `Decimal` in code.
- There must be a test asserting the classic `0.1 + 0.2` class of error cannot occur in
  any money path (i.e. the code path uses integers/Decimal, not `+` on floats).

### 9.2 Costing method — Weighted Average Cost

The running per-product average cost lives in the **`stock_state`** cache row alongside
`qty_on_hand` (a single derived-cache table per product — `DATABASE.md` §2.11; this
folds together what earlier drafts split as `stock_state` + `stock_cost_state`):

```
qty_on_hand             NUMERIC(18,3)
total_cost_satang       BIGINT
avg_cost_micro          BIGINT   -- average unit cost in millionths of a THB
                                 -- (1 THB = 1_000_000 micro), for low drift
last_nonzero_avg_micro  BIGINT   -- fallback basis when qty_on_hand <= 0
```

Updated **inside the same DB transaction** as each movement:

| Movement | Effect on cost state |
| --- | --- |
| `OPENING`, `PURCHASE` | `qty += q`; `total_cost_satang += q * unit_cost_satang`; recompute `avg_cost_micro`. |
| `CUSTOMER_RETURN` | **Owner enters the unit cost** on the return form (prefilled from the linked sale's COGS unit cost when a link exists; owner may override). `qty += q`; `total_cost_satang += q * unit_cost_satang`; recompute `avg_cost_micro`. |
| `SALE` | Record `cogs_satang = round(q * avg_cost_micro)` on the sale row; `qty −= q`; `total_cost_satang −= cogs_satang`. |
| `SUPPLIER_RETURN`, `DAMAGE` | Same as SALE (leave at current average). |
| `ADJUSTMENT` (+) / `FOUND_EXTRA` | **Owner enters the unit cost** on the adjustment form. `qty += q`; `total_cost_satang += q * unit_cost_satang`; recompute `avg_cost_micro`. |
| `ADJUSTMENT` (−) | Treated like `DAMAGE`. |

Edge cases (must be tested):

- `qty_on_hand ≤ 0` when a costed inflow arrives: reset average to the incoming
  `unit_cost_satang` (a purchase) or to the **last known non-zero average** (a return),
  and log a `COST_BASIS_RESET` audit entry.
- Voiding a `PURCHASE` recomputes cost state by **replaying the ledger** for that product
  from the last `OPENING` (see §9.4), not by naive subtraction.

### 9.3 Worked example (must be an automated test)

```
Beginning : 1,000 × ฿100.00   → total 100,000.00, avg 100.00
Purchase  :   500 × ฿120.00   → total 160,000.00 over 1,500 units
Avg cost  : 160,000.00 / 1,500 = ฿106.666… → avg_cost_micro = 106_666_667

Sale of 200 units:
  COGS = round(200 × 106.666667) = ฿21,333.33   (2,133,333 satang)
  (the spec's "≈ ฿21,334" is the un-rounded figure; the system posts the rounded value)

Gross Profit = Sales Revenue − COGS   → label: "กำไรขั้นต้น (ประมาณการ)"
```

> Note: the example in the source brief shows `฿21,334`; with round-half-up on
> `200 × 106.666667` the posted COGS is `฿21,333.33`. The **method** is what is fixed;
> the displayed figure follows the rounding rule. This is called out so an agent does not
> "fix" the test to match the brief's rounded prose.

### 9.4 Ledger replay

A pure function `replayLedger(movements): { qty, avgCostMicro, totalCostSatang, cogsBySaleId }`
recomputes cost state from an ordered movement list. Used by:

- the reconciliation job (§4),
- void handling (§9.2),
- tests (golden-master against the mock dataset, §21).

`stock_cost_state` and `stock_state` are **caches** of what `replayLedger` produces.

### 9.5 Reported financials

Always labelled **estimated** until formal accounting rules are defined:

- `Sales Revenue` = Σ active SALE `total_price_satang`.
- `Estimated COGS` = Σ active SALE `cogs_satang`.
- `Estimated Gross Profit` = `Sales Revenue − Estimated COGS`.
- `Gross Margin %` = `Estimated Gross Profit / Sales Revenue` (guard divide-by-zero).

---

## 10. Documents

Each document type has its own table (business fields) **and** produces movement(s).
All amounts `*_satang` are `BIGINT`; all quantities `NUMERIC(18,3)`.

### 10.1 Purchase

```
date          business date
product_id    FK
quantity
unit_cost_satang
total_cost_satang     -- server computes = round(quantity * unit_cost_satang); see §26
invoice_no
supplier
note
status                -- ACTIVE | VOIDED
voided_at, void_reason
idempotency_key       -- UNIQUE
import_batch_id        -- nullable FK
source_row_hash        -- nullable, for import idempotency
created_at
```

→ one `PURCHASE` movement, `quantity` positive, carrying `unit_cost_satang`.

### 10.2 Sale

```
date
product_id
quantity                 -- quantity sold
unit_price_satang        -- unit selling price
total_price_satang       -- server computes = round(quantity * unit_price_satang)
cogs_satang              -- server computes at post time (§9.2)
bill_no
channel
note
status, voided_at, void_reason
idempotency_key (UNIQUE)
import_batch_id, source_row_hash
created_at
```

→ one `SALE` movement, `quantity` negative.
The transaction UI must **display live current stock before the sale is confirmed**
(§19.3).

### 10.3 Returns

```
kind                 -- CUSTOMER | SUPPLIER
date
product_id
quantity
unit_cost_satang     -- CUSTOMER_RETURN: required (owner-entered; prefilled from the
                     --   linked sale's COGS unit cost when linked). SUPPLIER_RETURN: unused.
linked_sale_id       -- nullable FK (CUSTOMER_RETURN)
linked_purchase_id   -- nullable FK (SUPPLIER_RETURN)
reason
note
status, voided_at, void_reason
idempotency_key (UNIQUE)
created_at
```

- `CUSTOMER_RETURN` → `+` movement, increases stock.
- `SUPPLIER_RETURN` → `−` movement, decreases stock.
- Link to the original document **when known**; the link is optional but encouraged in the
  UI (autocomplete by bill / invoice number).

### 10.4 Adjustment

```
date
product_id
quantity_delta       -- signed; may be negative
reason               -- enum, see below
note
unit_cost_satang     -- REQUIRED when quantity_delta > 0 (owner-entered); ignored when negative
status, voided_at, void_reason
idempotency_key (UNIQUE)
created_at
```

Reason enum (stored as a stable code, displayed in Thai):

```
STOCK_COUNT      ตรวจนับสต็อก
DAMAGED          สินค้าเสียหาย        (posts a DAMAGE movement, not ADJUSTMENT — see note)
LOST             สินค้าหาย
FOUND_EXTRA      พบสินค้าเกิน
CORRECTION       แก้ไขยอด
OTHER            อื่นๆ
```

> Note: `DAMAGED` is offered in the adjustment UI for the owner's convenience but the
> domain layer posts it as a **`DAMAGE`** movement so damage totals are queryable
> separately (the dashboard's "Estimated COGS" and reports treat damage distinctly).
> All other reasons post an `ADJUSTMENT` movement with the signed delta.

Every adjustment writes an audit entry with before/after stock.

---

## 11. Transaction ledger (per product)

Each product has a complete, ordered movement history. The UI path is
**Product → View Ledger**, and it must **show how current stock was calculated**:

```
SKU-001  สินค้า A

01/01/2569   OPENING           +1,000       running: 1,000
05/01/2569   PURCHASE            +500       running: 1,500
07/01/2569   SALE               −120       running: 1,380
08/01/2569   DAMAGE              −10        running: 1,370
10/01/2569   CUSTOMER_RETURN     +20        running: 1,390
------------------------------------------------------------
Current Stock                              1,390
```

- Ordered by `(date, created_at)`.
- `VOIDED` rows are shown struck-through with their reason, and **excluded** from the
  running balance.
- A running-balance column is computed client-side from the returned page; for deep
  history the server can return a starting balance + a page of movements.

---

## 12. Offline capability and sync

### 12.1 What works offline

- Viewing cached products, cached stock, cached ledgers.
- Creating purchases, sales, adjustments, returns — queued locally.
- Editing UI preferences.

What does **not** work offline: import, export, backup/restore, period close/reopen,
reports that need full aggregation, authoritative `PREVENT` overselling (§6.1).

### 12.2 Queue model (client, in IndexedDB)

Every locally-created operation carries:

```
local_id        uuid (client-generated)
server_id       uuid | null (filled after sync)
idempotency_key uuid (client-generated once, reused on every retry)
sync_status     PENDING | SYNCING | SYNCED | FAILED | CONFLICT
retry_count     int
created_at
synced_at | null
payload         the request body
error           last error (for FAILED / CONFLICT)
```

- On reconnect: process the queue **in FIFO order**, one operation at a time, each with
  its `idempotency_key`.
- A `409`/typed conflict → `CONFLICT`, stop that item, keep going with the rest, surface
  to the owner.
- A retriable error (network, 5xx) → increment `retry_count`, exponential backoff, stay
  `PENDING`.
- Duplicate protection during retries is guaranteed by the server's idempotency table
  (§14) — the same `idempotency_key` returns the original result and does **not** create a
  second document/movement.

### 12.3 Conflict resolution UI

A dedicated "รายการรอซิงค์ / ขัดแย้ง" panel lists `CONFLICT` and `FAILED` items with:
the payload, the server's reason, and actions: **retry**, **edit & retry**, **discard**
(writes an audit note). Nothing is silently dropped.

---

## 13. Excel / CSV import

Library: SheetJS (`xlsx`). CSV is parsed through the same pipeline.

### 13.1 Supported import types and columns

**Master Stock 68**

```
sku        (required)
name       (required on create; optional on update)
stock_68   (required, ≥ 0, fractional allowed)
min_stock  (optional, ≥ 0, default 0)
unit       (optional, default 'piece')
```

**Purchases 69**

```
date        (required)
sku         (required, must resolve to an existing product)
quantity    (required, > 0)
unit_cost   (required, ≥ 0)
invoice_no  (optional)
```

**Sales 69**

```
date          (required)
sku           (required, must resolve to an existing product)
quantity      (required, > 0)
selling_price (required, ≥ 0)
channel       (optional)
```

Exact header aliases, sample files, and per-field rules live in `IMPORT_FORMAT.md`.

### 13.2 Pipeline (never commit on upload)

```
UPLOAD → PARSE → SANITIZE → VALIDATE → DUPLICATE CHECK → PREVIEW
       → USER CONFIRMATION → DB TRANSACTION → COMMIT
```

- **PARSE**: read sheet → raw rows.
- **SANITIZE**: every cell through `cleanData` (§7). Failures become row errors, not
  exceptions.
- **VALIDATE**: business rules (SKU resolves, period not closed, quantity > 0, date in
  range, etc.).
- **DUPLICATE CHECK**: file-level and row-level hashing (§15).
- **PREVIEW**: see §13.5. No writes yet.
- **USER CONFIRMATION**: explicit button; the owner may also choose "partial import" mode
  here (opt-in only — see §13.4).
- **DB TRANSACTION / COMMIT**: single transaction (§13.3).

### 13.3 Atomicity — all or nothing (default)

- The entire import runs in **one PostgreSQL transaction**. Any failure → `ROLLBACK`; the
  DB is exactly as before.
- Forbidden outcome: `7,430 rows imported / 2,570 missing` with no explicit partial-mode
  choice.
- A 10,000-row import must either fully succeed or fully roll back.
- Very large imports (> ~50k rows) may use a staging table + set-based `INSERT ... SELECT`
  inside the same transaction for speed, but atomicity is unchanged.

### 13.4 Partial import mode (opt-in)

If — and only if — the owner explicitly selects it in the preview step, invalid rows are
skipped and valid rows are committed. The result screen then lists exactly which rows were
skipped, and offers the invalid-rows download (§13.6). This mode is never the default and
is never auto-selected.

### 13.5 Preview contents

```
Total Rows
Valid Rows
Invalid Rows
Duplicate Rows
Rows That Will Be Updated
Rows That Will Be Created
```

Plus a scrollable table with **invalid cells highlighted** and the specific error per
cell.

### 13.6 Invalid-row export

The owner can download a file of just the invalid rows, **with an added `_error` column**
per row, in the same layout as the source, for offline correction and re-upload.

### 13.7 Import idempotency

See §15.

### 13.8 Effect of a Master Stock 68 re-import

Re-importing `stock_68` for an existing SKU:

- If the product has **no movements other than a single `OPENING`** and the current period
  is `OPEN`: **void the old `OPENING` and post a new one** to the new value (audit-logged).
- Otherwise: post an **`ADJUSTMENT`** for the difference with reason `CORRECTION`
  (audit-logged), leaving history intact.

(Confirm with owner — §26. This is the default until then.)

---

## 14. Idempotent, concurrency-safe API

### 14.1 Idempotency

- **Every transaction-creating endpoint** (purchase, sale, return, adjustment, and the
  import-commit) requires an `Idempotency-Key` header (UUID).
- Server table `processed_requests(idempotency_key PK, endpoint, request_hash,
  response_json, status_code, created_at)`.
- First call: execute, store the response, return it.
- Retry with the same key: return the stored response verbatim, create nothing.
- Mismatched body with a reused key → `422 IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_BODY`.

### 14.2 Concurrency

- Even with one owner, expect multiple tabs/devices against the one Postgres.
- Every stock-changing operation runs in a transaction that first takes a
  **per-product lock**: `SELECT pg_advisory_xact_lock(hashtext(product_id))` (or `SELECT
  ... FOR UPDATE` on the `stock_state` row), then reads current stock, applies the rule
  (e.g. `PREVENT` check), writes the movement, updates `stock_state` + `stock_cost_state`,
  commits.
- Result is deterministic and lost-update-free.
- Required test (§21): starting stock 100; Device A sells 80 and Device B sells 50
  concurrently. Exactly one succeeds in `PREVENT` mode (ending stock 20); in `ALLOW` mode
  both succeed and ending stock is −30 with an oversold flag. No interleaving produces a
  wrong total.

### 14.3 Proposed endpoint map (detail in `API.md`)

```
GET    /api/products                 list + filter + paginate
POST   /api/products                 create
PATCH  /api/products/:id             update mutable fields
GET    /api/products/:id/ledger      movements page + opening balance
GET    /api/products/:id/stock       current stock + status + cost state

POST   /api/purchases                (idempotent)
POST   /api/sales                    (idempotent)
POST   /api/returns                  (idempotent)
POST   /api/adjustments              (idempotent)
POST   /api/documents/:id/void       (idempotent; body: reason)

GET    /api/dashboard                KPI card payload (§18)
GET    /api/reports/monthly?period=  monthly report
GET    /api/reports/low-stock
GET    /api/reports/oversold

GET    /api/periods                  list with status
POST   /api/periods/:ym/close        body: nothing / confirm
POST   /api/periods/:ym/reopen       body: reason (required)

POST   /api/imports                  upload → returns batch_id + preview
POST   /api/imports/:batchId/commit  (idempotent; body: mode = ALL_OR_NOTHING | PARTIAL)
GET    /api/imports/:batchId/invalid-rows.xlsx

GET    /api/exports/:kind.xlsx       kind ∈ current-stock | ledger | purchases | sales |
                                     monthly-report | low-stock | oversold

POST   /api/sync                     batch of queued ops, each with its idempotency key
GET    /api/sync/state               server clock + any server-side notices

POST   /api/backups                  backup now (MANUAL)
GET    /api/backups                  list versions + local/cloud status per version
GET    /api/backups/status           last backup, next scheduled run, Task Scheduler state
POST   /api/backups/:id/restore      restore (guarded; needs passphrase; see §16)
POST   /api/backups/:id/upload       retry cloud upload for this version
DELETE /api/backups/:id              delete a version (blocked for the last copy)
GET    /api/backups/:id/download     stream the local encrypted artifact

GET    /api/audit                    filter by entity / date / action
GET    /api/settings   PATCH /api/settings

POST   /api/fiscal-year/roll         advance current_fiscal_year (guarded; see §6.5)
```

---

## 15. Import idempotency (file & row hashing)

Track:

```
import_batch_id     uuid per upload
source_file_hash    sha256 of the uploaded bytes
source_row_hash     sha256 of the canonicalized (post-sanitize) row content, per row
```

- On upload, if a **committed** batch with the same `source_file_hash` exists, the preview
  header shows:

  ```
  ⚠️ รายการนี้อาจถูกนำเข้าแล้ว
  ```

  and defaults the confirm button to disabled until the owner ticks "import anyway".
- On commit, any row whose `source_row_hash` already exists **committed** for the same
  import kind is reported as a duplicate and **not** re-applied — no duplicate movement is
  created.
- This is independent of, and in addition to, the per-request idempotency key (§14.1).

---

## 16. Backup and restore

Backup is a **first-class feature**, not an afterthought.

### 16.1 Capabilities

```
Backup Now            manual, on demand
Automatic Backup      daily 02:00 local, triggered by Windows Task Scheduler,
                      plus an app startup catch-up check
Restore Backup        from any retained local version
Download Backup       stream the local encrypted backup file to the owner's disk
Cloud Upload          optional, to an S3-compatible bucket (never plaintext)
```

### 16.2 Scheduling architecture

- **Primary:** a **Windows Task Scheduler** task runs a small backup command
  (`inventory-backup` CLI, or a call to a localhost backup endpoint) at **02:00 local
  time daily**. This fires even when the app UI is closed, as long as the machine is on.
- **Catch-up:** on every app start, the server checks the last successful
  `LOCAL_BACKUP_SUCCESS` timestamp; if it is older than the configured interval
  (default 24h), it runs a backup immediately.
- Task Scheduler setup is a one-time step documented in `BACKUP_RECOVERY.md`, and the
  app surfaces whether the scheduled task is registered and when it last ran.

### 16.3 Backup pipeline (every run)

```
1. SNAPSHOT   pg_dump (custom format) → a single consistent database snapshot.
2. MANIFEST   write manifest.json: app version, schema/migration version, pg version,
              per-table row counts, created_at, and the sha256 of the dump.
3. COMPRESS   compress the dump.
4. ENCRYPT    encrypt locally (AES-256-GCM / age) with the BACKUP PASSPHRASE,
              BEFORE it ever leaves the machine. Plaintext dump is shredded.
5. HASH       compute sha256 of the final encrypted artifact; record it.
6. VERIFY     re-read the encrypted artifact, check sha256, and test-decrypt +
              `pg_restore --list` to confirm it parses. → LOCAL_BACKUP_SUCCESS
7. RETAIN     apply retention (below). Never delete the last remaining copy (§16.6).
8. CLOUD?     if cloud upload is enabled: PUT the encrypted artifact to the
              S3-compatible bucket, then re-download (or HEAD + checksum) to verify.
              → CLOUD_UPLOAD_SUCCESS  or  CLOUD_UPLOAD_FAILED (reported, not swallowed).
```

- **Cloud backups must never contain plaintext database data** — only the artifact from
  step 4 is uploaded.
- Local retention (defaults): last **14 daily**, **8 weekly**, **12 monthly**.

### 16.4 Status model

Each backup record carries an explicit status; the three are distinct and independently
reported:

```
LOCAL_BACKUP_SUCCESS    local encrypted artifact created + verified
CLOUD_UPLOAD_SUCCESS    artifact uploaded + verified in the bucket
CLOUD_UPLOAD_FAILED     upload attempted and failed (local copy is still good)
```

UI status card shows:

```
Last Backup:   29/08/2569 02:00
Local:         ✅ สำเร็จ (verified)
Cloud:         ⚠️ อัปโหลดไม่สำเร็จ — will retry
Next run:      30/08/2569 02:00 (Task Scheduler: registered, last ran 29/08 02:00)
Retained:      14 local versions, 3.2 GB
```

A `CLOUD_UPLOAD_FAILED` is retried on the next run and surfaced as a persistent warning
until it succeeds.

### 16.5 Secrets

- **App unlock PIN/password** — gates the UI; stored as a salted hash.
- **Backup encryption passphrase** — used in step 4/restore; stored **separately** from
  the app DB (OS credential store / DPAPI-protected file), never in the DB, never logged.
- **Cloud credentials** (S3 endpoint, key, secret, bucket) — stored **separately again**
  from the backup passphrase (OS credential store / DPAPI). A leak of one must not expose
  the other.

### 16.6 Never destroy the last copy

- Retention pruning must **never** delete a backup if it is the only remaining valid copy
  (local *or* cloud).
- A restore always takes an **automatic pre-restore backup** first.
- Deleting a backup manually requires confirmation and is blocked for the last copy.

### 16.7 Restore guard

- Restore is destructive. The UI requires typing a confirmation phrase and shows what will
  be lost (row-count delta from the manifest).
- Restore needs the **backup passphrase** to decrypt.
- Before restore, take the automatic pre-restore backup (§16.6).
- Integrity is checked (sha256) before decryption; a mismatch **refuses** the restore.
- If the backup's schema/migration version is older than the running app, restore runs
  the pending migrations forward and records this in the audit log.
- A backup whose schema version is **newer** than the running app is refused.
- A restore is itself an audit event (`action = RESTORE`).

Full runbook, cloud setup, and DR drills: `BACKUP_RECOVERY.md`.

---

## 17. Error handling and messaging

- **Nothing fails silently.** Every write path returns either a typed success or a typed
  error, and the UI shows feedback.
- User-facing messages (Thai) are separate from technical logs. Examples:

  ```
  ✅ บันทึกสำเร็จ
  ❌ ไม่สามารถบันทึกข้อมูลได้
  ⚠️ ไม่พบ SKU นี้
  ⚠️ จำนวนสินค้าไม่ถูกต้อง
  ⚠️ รายการนี้ถูกนำเข้าแล้ว
  🚨 สต็อกติดลบ (ขายเกิน)
  🔒 ปิดงวดแล้ว ไม่สามารถแก้ไขได้
  ```

- Technical errors → structured `pino` log (with a correlation id also shown discreetly in
  the UI toast so the owner can reference it).
- Error codes are an enum shared via `zod`/TypeScript between client and server; `API.md`
  lists every code.

---

## 18. Dashboard

### 18.1 KPI cards (Thai labels)

```
สต็อกยกมา (Stock 68)            Total opening quantity
ซื้อเข้า 69 (จำนวน)             Total purchase quantity, FY2569
มูลค่าซื้อเข้า                   Total purchase value (satang → ฿)
ขายออก 69 (จำนวน)              Total sales quantity, FY2569
รายได้จากการขาย                 Total sales revenue
สต็อกคงเหลือรวม                 Total current stock (Σ current_stock, all products)
ต้นทุนขายโดยประมาณ (COGS)       Estimated COGS
กำไรขั้นต้นโดยประมาณ            Estimated Gross Profit
SKU ขายเกินสต็อก               Count of products with stock < 0
SKU ใกล้หมด                    Count of products with 0 ≤ stock ≤ min_stock
```

All figures come from **one** `GET /api/dashboard` call returning pre-aggregated numbers.
No client-side summation over full history.

---

## 19. Master stock dashboard (main table)

### 19.1 Columns

```
SKU | ชื่อสินค้า | หน่วย | Stock 68 | ซื้อเข้า 69 | ขายออก 69 | สต็อกคงเหลือ |
ส่วนต่าง (+/−) | Min Stock | สถานะ | Actions
```

The `68` / `69` in the headers are **dynamic**, derived from
`settings.current_fiscal_year` (§5.3, §6.5): after the FY2570 rollover they render as
`Stock 69` / `ซื้อเข้า 70` / `ขายออก 70`.

`ส่วนต่าง (+/−)` = Movement Variance (§5.4). `สถานะ` = the badge from §6.2 (plus the
oversold sub-line when negative).

### 19.2 Features

- Search by SKU; search by product name.
- Filters: category, stock status, low-stock-only, oversold-only.
- Sortable columns.
- **Server-side pagination** (never load all rows).
- Row actions: **View Ledger** (§11), **Edit Product** (§8), **Adjust Stock** (§10.4).

### 19.3 Transaction UI (modal or side drawer)

**Purchase**

```
Date | SKU (autocomplete) | Quantity | Unit Cost | Total Cost (auto) |
Invoice No | Supplier | Note
```

**Sale**

```
Date | SKU (autocomplete) | Current Stock (live, read-only) | Quantity |
Selling Price | Total Price (auto) | Bill No | Channel | Note
```

- Calculated totals update immediately as the owner types.
- The Sale drawer shows live current stock **before** confirm; if the sale would go
  negative, the drawer shows the §6.1 warning (and blocks, in `PREVENT` mode + online).
- Backdate warning (§6.3) appears inline when the date is in the past.
- The **Customer Return** drawer has a required **Unit Cost** field (§10.3): if the
  return is linked to a sale it is prefilled with that sale's COGS unit cost and stays
  editable; otherwise the owner enters it.
- The **Adjust Stock** drawer shows a required **Unit Cost** field whenever the entered
  quantity delta is positive (§10.4).

### 19.4 Display formatting

- Numbers: `1,234.00` (thousands grouped, 2 dp for money; up to 3 dp for quantity, no
  trailing-zero padding beyond what's significant — decide once in a shared formatter and
  test it).
- Dates: Buddhist year when `settings.thai_dates = true` (default).
- Thai-first copy throughout; desktop-optimized layout, usable on tablet/mobile.
- Design: clean, professional, minimal, fast, responsive.

---

## 20. Audit log

Lightweight, single-owner (no permission model). Table:

```
id
timestamp      timestamptz
action         enum  (CREATE | UPDATE | VOID | REOPEN_PERIOD | CLOSE_PERIOD |
                      ROLL_FISCAL_YEAR | IMPORT_COMMIT | BACKUP | RESTORE |
                      COST_BASIS_RESET | SETTINGS_CHANGE | ...)
entity         text  ('product' | 'sale' | 'purchase' | 'period' | 'settings' | ...)
entity_id      text
old_value      jsonb | null
new_value      jsonb | null
reason         text  | null   (required for backdates over threshold, voids, reopen)
```

Example entries:

```
action=UPDATE entity=movement entity_id=<opening id>
  old_value={"stock_68": 1000}  new_value={"stock_68": 950}
  reason="ตรวจนับสต็อกใหม่"

action=VOID entity=sale entity_id=INV-001
  old_value={"status":"ACTIVE"} new_value={"status":"VOIDED"}
  reason="กรอกจำนวนผิด"
```

The audit view is filterable by entity, entity_id, action, and date range.

---

## 21. Performance and scale

Targets:

```
≥ 10,000 products
≥ 100,000 inventory movements
UI stays responsive; no full-history load into the browser
```

Approach:

- `stock_state` and `stock_cost_state` are maintained incrementally, so "current stock"
  and dashboard KPIs are O(number of products) or better, not O(movements).
- A scheduled **reconciliation job** recomputes stock & cost from the ledger
  (`replayLedger`, §9.4) and raises an alert on any mismatch, then (configurably)
  self-heals the cache.
- Indexes (see `DATABASE.md` for the full list and rationale) at minimum on:

  ```
  products(sku)                    UNIQUE
  movements(product_id, date)
  movements(type)
  movements(status)
  movements(period_id)
  sales(bill_no), purchases(invoice_no)
  processed_requests(idempotency_key)  PK
  import_rows(source_row_hash)
  ```

- All list endpoints are server-paginated with stable ordering.
- Reports aggregate in SQL, return small payloads, feed Recharts.

---

## 22. Testing strategy (summary; full plan in `TESTING.md`)

Verification levels the agent must use in `PROGRESS.md` and the final report:

```
Implemented | Unit tested | Integration tested | E2E tested | Stress tested |
Recovery tested | Not verified
```

### 22.1 Suites

**Sanitization (`cleanData`)** — heaviest coverage:
SKU casing, whitespace, currency symbols (`฿`, `บาท`, trailing/leading), comma & space
thousands separators, parenthesized negatives, decimals, fractional quantities
(`0.125`, `1.5`, `10.75`), invalid/empty/`NaN`/`Infinity` numbers (must throw, not
coerce), Excel serial dates, `DD/MM/YYYY`, `YYYY-MM-DD`, `DD-MM-YYYY`, Thai Buddhist
years (`2569 → 2026`), ambiguous years.

**Inventory ledger**:
`OPENING + PURCHASE − SALE`; customer returns (+); supplier returns (−); damage (−);
signed adjustments; voids excluded from balance; negative stock detection & Missing
Balance; the §5.5 worked example exactly; the §39 mock dataset expected stock & variance
exactly.

**Import**:
valid Excel; invalid Excel (bad headers, bad types); duplicate SKU within a file;
duplicate file re-upload (file hash); duplicate row (row hash); unknown SKU in
purchases/sales; quantity ≤ 0; invalid dates; closed-period rows; partial-failure with
ALL_OR_NOTHING → full rollback (assert DB unchanged); partial mode → only valid rows
committed + skipped list correct; 10,000-row happy path in one transaction.

**Financial**:
integer-satang money paths (no float `+` in money code — static + runtime assertion);
weighted-average cost per §9.3; revenue; COGS; estimated gross profit; rounding mode;
`qty_on_hand ≤ 0` cost-basis reset; void-purchase replay.

**Concurrency**:
the §14.2 A-sells-80 / B-sells-50 scenario in both modes; N parallel sales on one product
never lose an update; idempotency key replay returns original result and creates nothing.

**Recovery**:
backup → destroy/replace database → restore → verify row counts & a golden query;
pre-restore auto-backup exists; restore across a forward migration; corrupted backup file
is detected by sha256 and refused.

**Offline/sync**:
queue FIFO; retry with same idempotency key does not duplicate; conflict item isolated,
rest proceed; `PENDING → SYNCING → SYNCED` / `→ CONFLICT` transitions.

### 22.2 Regression rule

Every bug found gets a failing test first, then the fix. Tests are never deleted or
weakened to go green.

---

## 23. Mock dataset (seed + test fixture)

Preloaded and used by automated tests:

```
SKU-001 | สินค้า A | Stock 68: 1000 | Buy 69: 8000 | Sales 69: 7700 | Min: 500
        → Expected Stock: 1300 | Variance: +300 | Status: 🟢 ปกติ

SKU-002 | สินค้า B | Stock 68: 500  | Buy 69: 5000 | Sales 69: 5350 | Min: 300
        → Expected Stock: 150  | Variance: −350 | Status: 🟡 เตือนสั่งซื้อ

SKU-003 | สินค้า C | Stock 68: 200  | Buy 69: 300  | Sales 69: 500  | Min: 50
        → Expected Stock: 0    | Variance: −200 | Status: 🔴 สินค้าหมด

SKU-004 | สินค้า D | Stock 68: 50   | Buy 69: 0    | Sales 69: 70   | Min: 20
        → Expected Stock: −20  | Variance: −70  | Status: 🔴 ติดลบ / ขายเกิน
                                                  Missing Balance: 20
```

The seed builds these purely from `OPENING` + `PURCHASE` + `SALE` movements (plus enough
purchase cost data to exercise weighted-average costing). A golden-master test asserts
`replayLedger` output for each SKU.

---

## 24. Definition of Done

The project is complete only when **all** of the following hold, each backed by a
passing, committed test:

```
✅ Business logic implemented (all movement types, void, periods, backdate, modes)
✅ Database constraints implemented (UNIQUE, CHECK ≥ 0, FK, idempotency UNIQUE)
✅ Inventory ledger correct (worked example + mock dataset, golden master)
✅ Financial calculations verified (weighted average, COGS, gross profit, satang paths)
✅ Excel import tested (valid, invalid, preview, rollback, partial mode)
✅ Duplicate protection tested (file hash, row hash, idempotency key)
✅ Offline behavior tested (queue, cache, degradation)
✅ Sync tested (FIFO, retry-no-dup, conflict isolation)
✅ Backup tested (manual, scheduled, verify, retention)
✅ Restore tested (guarded, pre-restore backup, cross-migration)
✅ Concurrency tested (A/B oversell, parallel sales, no lost updates)
✅ Stress tested (10k products, 100k movements, paginated, responsive)
✅ Regression tests passing (every fixed bug has a test)
✅ Documentation updated (all §0 companion docs current)
```

### 24.1 Final verification report (the agent must produce this)

```
Tests Run:
Tests Passed:
Tests Failed:
Coverage by area (Implemented / Unit / Integration / E2E / Stress / Recovery / Not verified):
Known Limitations:
Unverified Areas:
Production Risks:
Recommended Next Steps:
```

The agent must **never** claim an area is tested that was not actually executed.

---

## 25. First Task (do this before major implementation, then STOP)

After this file exists:

1. **Analyze** the specification end to end.
2. **List ambiguities** — extend §26 with anything new; do not resolve silently.
3. **List architectural risks** — extend §28.
4. **Propose the database schema** — concrete Postgres DDL in `DATABASE.md`
   (tables, columns, types, constraints, indexes, enums, migration 0001).
5. **Propose the API structure** — expand §14.3 into `API.md` (every endpoint:
   method, path, request zod schema, response shape, error codes, idempotency behavior).
6. **Propose the directory structure** — see §29 as the starting point; refine in
   `ARCHITECTURE.md`.
7. **Create `TASKS.md`** — phase-ordered, checkbox tasks, each with a verify step.
8. **Create `PROGRESS.md`** — table of areas × verification level, all starting at
   "Not started".
9. **Define the testing strategy** — expand §22 into `TESTING.md` (fixtures, runners,
   commands, coverage targets).
10. **Wait for owner confirmation** before starting Phase 1 implementation.

`TASKS.md` and `PROGRESS.md` skeletons are created alongside this file; step 7–8 fill them
in with the post-analysis detail.

---

## 26. Open questions / ambiguities

### 26.1 Resolved (owner-confirmed 2026-08-29 — see §27)

| # | Question | Decision |
| --- | --- | --- |
| 1 | 68/69 semantics | **Rolling fiscal year.** `settings.current_fiscal_year` drives labels + current-FY sums; explicit owner-triggered rollover each year (§6.5). `68 = พ.ศ. 2568 / 2025`, `69 = พ.ศ. 2569 / 2026`. |
| 2 | Cost basis for `CUSTOMER_RETURN` | **Owner enters the unit cost** on the return form; prefilled from the linked sale's COGS unit cost when a link exists (§9.2, §10.3). |
| 3 | Cost basis for positive `ADJUSTMENT` / `FOUND_EXTRA` | **Owner enters the unit cost** on the adjustment form (§9.2, §10.4). |
| 5 | Money rounding | **Round-half-up** to satang, everywhere, on write. |
| 7 | Multi-location | **Single location in v1.** `TRANSFER_IN/OUT` reserved in the enum, hidden in the UI. `location_id` addable later without changing movement semantics. |
| 9 | Authentication | **Local PIN/password** gates the app UI. **Separate** backup-encryption passphrase. **Separate again**: optional S3 cloud credentials. No accounts/roles (§16.5). |
| 10 | Currency | **THB only.** Integer satang, no currency field, no FX. |
| 11 | Backup scheduling | **Windows Task Scheduler is primary** (daily 02:00, fires with app closed). App does a **startup catch-up** check. Local compress+encrypt **before** optional S3-compatible cloud upload; cloud never holds plaintext; distinct `LOCAL_BACKUP_SUCCESS` / `CLOUD_UPLOAD_SUCCESS` / `CLOUD_UPLOAD_FAILED` states; never delete the last remaining copy (§16). |
| 12 | Per-year `OPENING` snapshot on rollover | **No snapshot table.** "Stock 68" for any fiscal year is a **derived cutoff** (`SUM` of movements up to that year's start). Ledger stays the only store of truth; optional cached value for speed (§6.5). |

### 26.2 Still open (resolve during First Task)

4. **`qty_on_hand ≤ 0` costed inflow** — confirm the reset rule in §9.2 (purchase resets
   to its own unit cost; return/adjustment uses the owner-entered cost, and if that is
   absent, last known average).
6. **Purchase/Sale `total` on import** — if the file provides a total that ≠
   `quantity × unit_cost`, the server **recomputes** and flags the mismatch in preview.
   Confirm recompute-wins.
8. **Master Stock 68 re-import effect** — confirm the §13.8 rule (replace OPENING if
   pristine + open period; else ADJUSTMENT).
13. **Damage vs adjustment** — confirm `DAMAGED` reason in the adjustment UI should post a
    `DAMAGE` movement (so damage is separately reportable), per §10.4 note.
14. **Historical fiscal years** — after a rollover, how far back must prior-year 68/69
    views and reports remain viewable? (Assume: all prior years, read-only.)
15. **Cloud provider specifics** — which S3-compatible service (AWS S3, Backblaze B2,
    Cloudflare R2, MinIO, …)? Bucket, region, lifecycle rules. Needed for
    `BACKUP_RECOVERY.md` before Phase 8.
16. **Task Scheduler install** — is the app allowed to register its own Scheduled Task
    (needs elevation once), or will the owner import a provided `.xml` task definition
    manually?

---

## 27. Change log

| Date | Change |
| --- | --- |
| 2026-08-29 | v0.1 — initial specification drafted from the owner's 44-point brief. Committed decisions: PostgreSQL source of truth; integer-satang money + `decimal.js`; local-first single-owner web app (React/Vite + Fastify/Node); IndexedDB as cache/queue only. |
| 2026-08-29 | v0.2 — owner confirmations (§26.1): **rolling fiscal year** (§5.3, §6.5, glossary); `CUSTOMER_RETURN` and positive `ADJUSTMENT` costs are **owner-entered** (§9.2, §10.3, §10.4); **round-half-up** everywhere; **single location** in v1; **local PIN + separate backup passphrase + separate S3 credentials** (§16.5); **THB only**; backup via **Windows Task Scheduler + startup catch-up**, local encrypt-before-cloud, S3-compatible optional cloud, three-state status, never delete last copy (§16 rewritten). New open questions #13–#16. |
| 2026-08-29 | v0.2 — §26.1 #12: fiscal-year opening is a **derived cutoff, no snapshot table** (§6.5). |
| 2026-08-29 | v0.2 — First Task design docs written: `DATABASE.md`, `API.md`, `ARCHITECTURE.md`, `IMPORT_FORMAT.md`, `BACKUP_RECOVERY.md`, `TESTING.md`. Cost cache folded into a single `stock_state` table (§9.2). |
| 2026-08-29 | v0.3 — Dev/test DB switched to **PGlite** (embedded Postgres 16) because Docker/Postgres are unavailable in the build environment; production target stays PostgreSQL 16. Migrations are hand-written SQL + a runner (not Drizzle Kit codegen). `DATABASE.md` §0, `ARCHITECTURE.md` §2, `TESTING.md` §1 amended. Known limitation: multi-client concurrency tests (§14.2) run only against real Postgres. Beginning autonomous build of Phases 1–7. |

---

## 28. Architectural risks (live list — extend during First Task)

1. **Derived-cache drift.** `stock_state` / `stock_cost_state` can diverge from the
   ledger under bugs or partial failures. *Mitigation:* single-transaction updates,
   scheduled `replayLedger` reconciliation with alerting + optional self-heal, golden
   tests.
2. **Offline `PREVENT` overselling is not truly enforceable.** Offline clients post
   optimistically; the server rejects on sync → `CONFLICT`. Inherent; must be visible in
   the UI and covered by tests. Not a defect to "fix".
3. **Backdated offline sync into a now-closed period.** A sale created offline for an
   OPEN period may arrive after that period closes. *Mitigation:* server rejects at sync,
   item goes to `CONFLICT`, owner decides (reopen period or discard).
4. **Weighted-average cost drift / negative on-hand cost basis.** Accumulated rounding and
   `qty ≤ 0` states. *Mitigation:* store average in micro-THB, round only on write,
   documented reset rule, replay-based void handling, golden tests.
5. **Large atomic imports hold locks.** A 10k–100k row transaction can block other writes
   and risks statement timeouts. *Mitigation:* staging table + set-based DML in one
   transaction, tuned `statement_timeout`, progress UI, and a documented practical upper
   bound.
6. **Idempotency across offline retries.** Requires the key to be generated **once** when
   the operation is queued and reused on every retry, plus a server table with a UNIQUE
   constraint. Easy to get subtly wrong; explicit tests required.
7. **Excel/Thai date parsing.** Excel serial epoch quirks, 2-digit years, Buddhist vs
   Gregorian ambiguity, `DD/MM` vs `MM/DD`. *Mitigation:* one parser in `cleanData`,
   exhaustive unit tests, preview-time flagging of assumptions.
8. **Backup depends on the machine being on at 02:00.** Windows Task Scheduler is
   primary (fires with the app closed); the app adds a startup catch-up. Residual gap if
   the machine is off for long stretches. *Mitigation:* catch-up on start, persistent
   "backup overdue" warning, optional cloud copy so a lost machine ≠ lost data.
   Also: the scheduled task can be unregistered/disabled by the OS — the app must detect
   and warn when the task is missing or hasn't run.
9. **Restore compatibility across schema versions.** A backup taken on an older schema.
   *Mitigation:* manifest carries migration version; restore runs forward migrations and
   audits it; refuse restore of a **newer** schema than the running app.
10. **Single machine = single point of failure.** Disk/computer loss. *Mitigation:*
    retained local backups + optional encrypted offsite copy + tested DR runbook
    (`BACKUP_RECOVERY.md`).
11. **`decimal.js` / integer discipline erosion.** A future contributor uses `number`
    math in a money path. *Mitigation:* lint rule / typed `Satang` branded type, code
    review checklist item, runtime assertion in the money module.

---

## 29. Proposed directory structure (starting point; refine in `ARCHITECTURE.md`)

```
inventory/
├── PROJECT_SPEC.md            ← this file (source of truth)
├── ARCHITECTURE.md
├── DATABASE.md
├── API.md
├── TESTING.md
├── BACKUP_RECOVERY.md
├── IMPORT_FORMAT.md
├── PROGRESS.md
├── TASKS.md
├── package.json               ← workspaces root
├── docker-compose.yml         ← local PostgreSQL 16 for dev
│
├── packages/
│   ├── shared/                ← types + zod schemas + cleanData + formatters + replayLedger
│   │   ├── src/
│   │   │   ├── cleanData/     ← sku.ts, number.ts, date.ts, index.ts, __tests__/
│   │   │   ├── domain/        ← movement types, stock formulas, replayLedger.ts
│   │   │   ├── money/         ← Satang branded type, decimal helpers
│   │   │   ├── schemas/       ← zod: product, purchase, sale, return, adjustment, import
│   │   │   ├── format/        ← number/date display (Buddhist year, 1,234.00)
│   │   │   └── errors.ts      ← shared error-code enum
│   │   └── package.json
│   │
│   ├── server/
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── db/            ← drizzle schema, migrations/, client
│   │   │   ├── services/      ← ledger, costing, import, backup, sync, audit, periods
│   │   │   ├── routes/        ← one file per resource group (§14.3)
│   │   │   ├── middleware/    ← idempotency, error mapper, request logging
│   │   │   ├── jobs/          ← cron: backup, reconciliation
│   │   │   └── lib/           ← advisory-lock helper, pg_dump wrapper
│   │   ├── test/              ← integration + concurrency + recovery (testcontainers)
│   │   └── package.json
│   │
│   └── web/
│       ├── src/
│       │   ├── main.tsx
│       │   ├── app/           ← routes/pages: dashboard, master, ledger, imports,
│       │   │                     reports, backups, settings, audit, sync-conflicts
│       │   ├── components/    ← shadcn/ui wrappers + domain components
│       │   ├── stores/        ← zustand slices
│       │   ├── offline/       ← dexie schema, queue, sync engine
│       │   ├── api/           ← typed client (shares zod from packages/shared)
│       │   └── lib/
│       ├── test/              ← component + e2e (Playwright)
│       └── package.json
│
└── scripts/
    ├── seed.ts                ← mock dataset (§23)
    └── stress-seed.ts         ← 10k products / 100k movements (§21)
```

---

## 30. AI coding agent rules (binding)

1. Read `PROJECT_SPEC.md` before modifying code.
2. Read `TASKS.md` and `PROGRESS.md` before starting a work session.
3. Do not rewrite working functionality unnecessarily.
4. Do not remove or weaken tests to make them pass.
5. Do not weaken validation or `cleanData`.
6. Do not bypass or drop database constraints.
7. Do not silently change a business formula (stock, variance, costing, status
   thresholds). Any change is a Change Log entry + owner sign-off.
8. Add a regression test for every bug discovered — failing test first, then fix.
9. Run the relevant test suites after every significant change.
10. Update `PROGRESS.md` after every session.
11. Update the affected companion doc whenever architecture or schema changes.
12. Commit at logical milestones (the working directory is not yet a git repo — run
    `git init` as the first Phase 1 task).
13. Never claim functionality is tested if it was not actually executed.
14. In `PROGRESS.md` and the final report, classify every area as exactly one of:
    Implemented · Unit tested · Integration tested · E2E tested · Stress tested ·
    Recovery tested · Not verified.

---

## 31. Development phases

Ordered by the §1.3 priority (integrity → inventory → finance → backup → offline →
testing → polish). Each phase ends with its tests green and `PROGRESS.md` updated.

### Phase 1 — Foundation
Repo (`git init`), workspaces, TypeScript strict, `docker-compose` Postgres, Drizzle +
migration 0001 skeleton, Fastify boot, error mapper + `pino` logging, shared `errors.ts`,
CI running lint + typecheck + test.
**Verify:** `npm test` runs (empty suites pass), server boots, migration applies, CI green.

### Phase 2 — `cleanData` + Product Master
`cleanData` (sku/number/date) with full unit tests (§22.1); `units`, `categories`,
`products` tables + constraints; product CRUD endpoints; SKU UPSERT helper; product UI
list + edit.
**Verify:** every §22.1 sanitization case passes; SKU UNIQUE enforced by DB; duplicate
SKU create returns typed error.

### Phase 3 — Inventory ledger
`movements` table + `stock_state` + `stock_cost_state`; domain `replayLedger`; per-product
advisory lock; endpoints for purchase, sale, return, adjustment, void; period model
(open/closed) + backdate warning/reason; negative-stock modes.
**Verify:** §5.5 worked example, §23 mock dataset golden master, void excluded from
balance, closed-period writes rejected, A/B concurrency test.

### Phase 4 — Dashboard & master stock table
`GET /api/dashboard`; master table with search/filters/sort/server-pagination; status
badges + oversold sub-line; ledger view showing the calculation; transaction drawers with
live stock + auto totals.
**Verify:** dashboard numbers match a SQL cross-check on the seed; pagination stable;
oversold/low-stock filters correct against the mock dataset.

### Phase 5 — Financial reporting
Weighted-average costing wired into every movement (owner-entered cost on customer
returns + positive adjustments; round-half-up); `cogs_satang` on sales; fiscal-year
rollover action (§6.5); monthly / low-stock / oversold report endpoints; Recharts views.
**Verify:** §9.3 costing example, round-half-up test, gross-profit math, cost-basis-reset
case, void-purchase replay, FY rollover advances labels without touching ledger data.

### Phase 6 — Excel / CSV
Upload → parse → sanitize → validate → duplicate-check → preview → confirm → single
transaction commit; file/row hashing; invalid-row download; partial mode (opt-in);
exports for all §27 report kinds.
**Verify:** all §22.1 import cases including 10k-row happy path and forced-failure
rollback (assert DB unchanged); duplicate file and duplicate row detected.

### Phase 7 — Offline & sync
Dexie schema (cache + queue); optimistic create offline; sync engine (FIFO, backoff,
idempotency key reuse); conflict panel.
**Verify:** queue FIFO test, retry-no-duplicate test, conflict isolates one item,
state-machine transitions.

### Phase 8 — Backup & recovery
Backup pipeline (§16.3): `pg_dump` → manifest → compress → **encrypt locally** → hash →
verify; `inventory-backup` CLI + Windows Task Scheduler task definition (`.xml`) + app
startup catch-up; retention that never deletes the last copy; three-state status
(`LOCAL_BACKUP_SUCCESS` / `CLOUD_UPLOAD_SUCCESS` / `CLOUD_UPLOAD_FAILED`); optional
S3-compatible cloud upload with verify + retry; secrets stored separately (app PIN /
backup passphrase / cloud creds); guarded restore + pre-restore auto-backup;
`BACKUP_RECOVERY.md` runbook + DR drill scripts for every brief-§33 scenario.
**Verify:** backup → drop DB → restore → golden query matches; tampered/corrupted backup
refused on sha256; cross-migration restore; newer-schema backup refused; cloud upload
failure surfaces and retries; retention keeps ≥ 1 copy.

### Phase 9 — Production hardening
`stress-seed` (10k / 100k); load + pagination profiling + indexes; concurrency stress;
import stress; full recovery drill; security review (input, backup encryption, local
auth, dependency audit); performance report.
**Verify:** §21 targets met; §24 Definition of Done checklist fully green; final
verification report (§24.1) produced.

---
```
End of PROJECT_SPEC.md
```
