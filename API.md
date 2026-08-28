# API.md — HTTP API Reference

> Subordinate to `PROJECT_SPEC.md`. Transport: JSON over HTTP, served by Fastify on
> `http://localhost:<port>` (or LAN). Single owner; auth is a local session (§1).
> Request and response bodies are validated by `zod` schemas defined in
> `packages/shared/src/schemas/` and imported by both server and client.
> All money fields are integer **satang**. All quantity fields are decimal strings
> (e.g. `"10.75"`) to avoid float parsing — the client sends strings, the server parses
> with `decimal.js`.

---

## 1. Auth & session

Local PIN gate (spec §26.1 #9). Not a user system.

| Method | Path | Body | Notes |
| --- | --- | --- | --- |
| `POST` | `/api/auth/unlock` | `{ pin }` | Sets an HTTP-only session cookie. Rate-limited: 5 attempts / 15 min, then lockout. |
| `POST` | `/api/auth/lock` | — | Clears the session. |
| `GET` | `/api/auth/status` | — | `{ unlocked: boolean, pinSet: boolean }` |
| `POST` | `/api/auth/set-pin` | `{ currentPin?, newPin }` | First run: `currentPin` omitted. |

All routes below require an unlocked session except `/api/health`.

The **backup passphrase** and **cloud credentials** are never sent over this API in
plaintext responses; they are set via dedicated write-only endpoints (§10) and stored in
the OS credential store.

---

## 2. Conventions

### 2.1 Idempotency

`POST` endpoints marked **(idempotent)** require header `Idempotency-Key: <uuid>`.

- First call with a key: executed, response persisted in `processed_requests`, returned.
- Repeat with the same key **and** the same body hash: the stored response is returned
  verbatim, status `200` (originally `201` is preserved in the body's `_replayed: true`).
- Same key, different body: `422 IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_BODY`.
- The client generates the key once when queuing an operation and reuses it on every
  retry (spec §12.2).

### 2.2 Error shape

```json
{
  "error": {
    "code": "STOCK_WOULD_GO_NEGATIVE",
    "message": "ไม่สามารถบันทึกได้ สต็อกจะติดลบ",
    "details": { "productId": "…", "currentStock": "12.000", "requested": "20.000", "shortfall": "8.000" },
    "correlationId": "01J…"
  }
}
```

`message` is Thai, user-facing. `code` is a stable enum (shared TS type). `correlationId`
also appears in the `pino` log line. HTTP status per §11.

### 2.3 Pagination

List endpoints accept `?page=1&pageSize=50&sort=<field>&dir=asc|desc` plus endpoint-
specific filters. Response:

```json
{ "rows": [ … ], "page": 1, "pageSize": 50, "total": 12873, "totalPages": 258 }
```

`pageSize` max 200. Sort is always stable (ties broken by `id` or `seq`).

### 2.4 Dates

Request/response business dates are ISO `YYYY-MM-DD` (Gregorian). The client converts
to/from Buddhist display. Timestamps are ISO 8601 UTC.

---

## 3. Products

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/api/products` | Filters: `q` (SKU or name), `categoryId`, `status` (`normal`/`low`/`out`), `lowStockOnly`, `oversoldOnly`, `active`. Row = product + `stock` block (see below). Server-paginated. |
| `POST` | `/api/products` | Body: `{ sku, name, categoryId?, unitCode, minStock }`. `sku` is sanitized server-side again. `409 SKU_ALREADY_EXISTS` on duplicate. |
| `GET` | `/api/products/:id` | Full product. |
| `PATCH` | `/api/products/:id` | Body: any of `{ name, categoryId, unitCode, minStock, active }`. Writes `audit_log` `UPDATE`. SKU is **not** editable. |
| `GET` | `/api/products/:id/stock` | `{ qtyOnHand, status, missingBalance, avgCostSatang, minStock, fyView: { stock68, purchasesCfy, salesCfy, variance } }`. |
| `GET` | `/api/products/:id/ledger` | Paginated movements, oldest→newest, with `runningBalance` per row and an `openingBalance` for the page. Filters: `from`, `to`, `type`, `includeVoided` (default true, shown struck). |

`stock.status` ∈ `normal` (🟢) / `low` (🟡) / `out` (🔴) per spec §6.2. `missingBalance` =
`abs(qtyOnHand)` when `qtyOnHand < 0`, else `0`.

---

## 4. Categories & Units

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/api/categories` | All. |
| `POST` | `/api/categories` | `{ name }`. `409` on duplicate name. |
| `PATCH` | `/api/categories/:id` | `{ name }`. |
| `DELETE` | `/api/categories/:id` | Allowed only if unused; else `409 CATEGORY_IN_USE`. Products' `categoryId` would `SET NULL` otherwise — we block instead for clarity. |
| `GET` | `/api/units` | All (with `baseUnitCode`, `factor` — informational in v1). |
| `POST` | `/api/units` | `{ code, nameTh, baseUnitCode?, factor? }`. |

---

## 5. Documents (stock-changing)

All **(idempotent)**. All run the transaction in `DATABASE.md` §4.1. All respect:
period must be `OPEN`; backdate policy (spec §6.3); negative-stock mode (spec §6.1).

### 5.1 Purchase

`POST /api/purchases` (idempotent)

```jsonc
// request
{
  "occurredOn": "2026-05-05",
  "productId": "…",
  "quantity": "500",
  "unitCostSatang": 12000,          // ฿120.00
  "invoiceNo": "PV-2026-014",       // optional
  "supplier": "…",                  // optional
  "note": "…"                       // optional
}
// response 201
{
  "id": "…",
  "totalCostSatang": 6000000,       // server-computed, round-half-up
  "movementId": "…",
  "stockAfter": { "qtyOnHand": "1500.000", "avgCostSatang": 10667 }
}
```

### 5.2 Sale

`POST /api/sales` (idempotent)

```jsonc
// request
{
  "occurredOn": "2026-05-07",
  "productId": "…",
  "quantity": "120",
  "unitPriceSatang": 15000,
  "billNo": "INV-001",             // optional
  "channel": "หน้าร้าน",           // optional
  "note": "…"
}
// response 201
{
  "id": "…",
  "totalPriceSatang": 1800000,
  "cogsSatang": 1280040,           // from weighted average at post time
  "movementId": "…",
  "stockAfter": { "qtyOnHand": "1380.000" }
}
```

- `PREVENT` mode + would go negative → `422 STOCK_WOULD_GO_NEGATIVE` (details carry
  `shortfall`), nothing written.
- `ALLOW` mode + goes negative → `201`, response includes `"oversold": true`,
  `"missingBalance": "20.000"`.

### 5.3 Return

`POST /api/returns` (idempotent)

```jsonc
{
  "kind": "CUSTOMER",                 // or "SUPPLIER"
  "occurredOn": "2026-05-10",
  "productId": "…",
  "quantity": "20",
  "unitCostSatang": 10667,            // REQUIRED when kind=CUSTOMER (spec §10.3)
  "linkedSaleId": "…",               // optional; when set, UI prefilled unitCostSatang from its COGS
  "linkedPurchaseId": null,
  "reason": "…", "note": "…"
}
```

`kind=CUSTOMER` → `CUSTOMER_RETURN` movement (`+`). `kind=SUPPLIER` → `SUPPLIER_RETURN`
(`−`); `422` if it would violate `PREVENT`.

### 5.4 Adjustment

`POST /api/adjustments` (idempotent)

```jsonc
{
  "occurredOn": "2026-05-12",
  "productId": "…",
  "quantityDelta": "-10",            // signed, non-zero
  "reasonCode": "DAMAGED",           // STOCK_COUNT|DAMAGED|LOST|FOUND_EXTRA|CORRECTION|OTHER
  "unitCostSatang": null,            // REQUIRED when quantityDelta > 0
  "note": "…"
}
```

- `reasonCode=DAMAGED` → posts a **`DAMAGE`** movement (spec §10.4 note, open Q #13).
- All other reasons → `ADJUSTMENT` movement with the signed delta.
- Writes `audit_log` with before/after `qtyOnHand`.

### 5.5 Void

`POST /api/documents/:id/void` (idempotent)

```jsonc
{ "kind": "sale", "reason": "กรอกจำนวนผิด" }   // kind ∈ purchase|sale|return|adjustment
```

- `404` if not found for that `kind`; `409 ALREADY_VOIDED`; `409 PERIOD_CLOSED`.
- Marks document + its movement(s) `VOIDED`, recomputes `stock_state` via `replayLedger`,
  writes `audit_log` `VOID` (reason required).

### 5.6 Set opening stock (migration / manual)

`POST /api/openings` (idempotent) — creates or replaces the `OPENING` movement.

```jsonc
{ "productId": "…", "quantity": "1000", "unitCostSatang": 10000, "occurredOn": "2026-01-01" }
```

- If the product has exactly one `ACTIVE` `OPENING` and no other movements and its period
  is `OPEN` → void old, post new (spec §13.8, open Q #8).
- Otherwise → `409 OPENING_LOCKED` with guidance to use an adjustment.

---

## 6. Periods & fiscal year

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/api/periods` | `[{ ym, status, closedAt, label }]`. `label` = Thai `เดือน พ.ศ.`. |
| `POST` | `/api/periods/:ym/close` | `{}`. `409 PERIOD_ALREADY_CLOSED`. Writes `CLOSE_PERIOD` audit. |
| `POST` | `/api/periods/:ym/reopen` | `{ reason }` (required). Writes `REOPEN_PERIOD` audit. |
| `GET` | `/api/fiscal-year` | `{ currentFiscalYear, labels: { stock, purchases, sales }, periodsClosed: 11, periodsTotal: 12 }`. |
| `POST` | `/api/fiscal-year/roll` | `{ confirm: true }`. Guarded: all 12 periods of the outgoing FY `CLOSED`, else `409 FY_PERIODS_OPEN`; forces a backup first (`409 BACKUP_REQUIRED` if it fails); advances `settings.current_fiscal_year`; writes `ROLL_FISCAL_YEAR` audit. Moves no ledger data (spec §6.5). |

---

## 7. Dashboard & reports

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/api/dashboard` | One aggregated payload (spec §18.1). All numbers server-computed. |
| `GET` | `/api/reports/monthly?ym=2026-05` | Per-SKU + totals: opening, purchases qty/value, sales qty/revenue, COGS, est. gross profit, closing. |
| `GET` | `/api/reports/low-stock` | Products with `0 ≤ qtyOnHand ≤ minStock`. |
| `GET` | `/api/reports/oversold` | Products with `qtyOnHand < 0` + `missingBalance`. |

Dashboard payload:

```jsonc
{
  "fiscalYear": 2569,
  "stock68Qty": "…",
  "purchasesCfyQty": "…",
  "purchasesCfyValueSatang": 0,
  "salesCfyQty": "…",
  "salesRevenueSatang": 0,
  "currentStockQty": "…",
  "estimatedCogsSatang": 0,
  "estimatedGrossProfitSatang": 0,
  "oversoldSkuCount": 0,
  "lowStockSkuCount": 0,
  "asOf": "2026-08-29T19:00:00Z"
}
```

---

## 8. Import

| Method | Path | Notes |
| --- | --- | --- |
| `POST` | `/api/imports` | `multipart/form-data`: `file` + `kind` (`MASTER_STOCK`/`PURCHASES`/`SALES`). Runs parse→sanitize→validate→duplicate-check. Persists `import_batches` + `import_rows`. Returns the **preview**. **No** ledger writes. |
| `GET` | `/api/imports/:batchId` | Re-fetch preview (paginated rows, `?invalidOnly=true`). |
| `POST` | `/api/imports/:batchId/commit` | (idempotent) `{ mode: "ALL_OR_NOTHING" | "PARTIAL", acknowledgeDuplicateFile?: boolean }`. One DB transaction (`DATABASE.md` §4.3). |
| `GET` | `/api/imports/:batchId/invalid-rows.xlsx` | Invalid rows + `_error` column, source layout. |
| `POST` | `/api/imports/:batchId/discard` | Marks batch `DISCARDED`. |

Preview response:

```jsonc
{
  "batchId": "…",
  "kind": "PURCHASES",
  "fileAlreadyImported": false,        // same source_file_hash previously COMMITTED
  "totals": {
    "totalRows": 10000, "validRows": 9995, "invalidRows": 3,
    "duplicateRows": 2, "willCreate": 9990, "willUpdate": 5
  },
  "rows": [
    { "rowNo": 7, "action": "CREATE", "sanitized": { … }, "errors": [] },
    { "rowNo": 42, "action": "SKIP", "sanitized": null,
      "errors": [ { "field": "quantity", "code": "NOT_A_NUMBER", "message": "…" } ] },
    { "rowNo": 88, "action": "DUPLICATE", "errors": [ { "field": "_row", "code": "ROW_ALREADY_IMPORTED" } ] }
  ]
}
```

Commit response:

```jsonc
{
  "status": "COMMITTED",              // or "FAILED"
  "committedRows": 9990,
  "skippedRows": 5,                   // PARTIAL mode only
  "createdProducts": 0,
  "updatedProducts": 5,
  "movementsCreated": 9990,
  "error": null
}
```

`ALL_OR_NOTHING` + any invalid row that the owner did not resolve → `422 IMPORT_HAS_INVALID_ROWS`
(nothing written). Column specs: `IMPORT_FORMAT.md`.

---

## 9. Export

`GET /api/exports/:kind.xlsx` — streamed Excel.

`kind` ∈ `current-stock` · `ledger` (requires `?productId=`) · `purchases` · `sales` ·
`monthly-report` (requires `?ym=`) · `low-stock` · `oversold`.

Common filters: `from`, `to`, `categoryId`. Response `Content-Type:
application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`.

---

## 10. Backup & restore

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/api/backups` | List, newest first. Each: `id, createdAt, kind, sizeBytes, localStatus, cloudStatus, retentionClass, verifiedAt`. |
| `GET` | `/api/backups/status` | `{ lastLocalSuccessAt, lastCloudSuccessAt, nextScheduledAt, taskSchedulerRegistered, taskSchedulerLastRunAt, overdue: bool, retainedCount, totalSizeBytes }`. |
| `POST` | `/api/backups` | (idempotent) `{ kind: "MANUAL" }`. Runs the full pipeline (`BACKUP_RECOVERY.md` §3). Returns the `backups` row. |
| `POST` | `/api/backups/:id/upload` | Retry cloud upload for this artifact. `409 CLOUD_DISABLED` if not configured. |
| `POST` | `/api/backups/:id/restore` | `{ confirmPhrase, passphrase }`. Guarded (spec §16.7): phrase match, passphrase decrypts, sha256 verified, auto pre-restore backup taken, forward-migrate, `RESTORE` audit. `409 SCHEMA_NEWER_THAN_APP`, `422 BACKUP_INTEGRITY_FAILED`, `401 BAD_PASSPHRASE`. |
| `DELETE` | `/api/backups/:id` | `{ confirm: true }`. `409 LAST_REMAINING_COPY` if it would leave no verified local or cloud copy (spec §16.6). |
| `GET` | `/api/backups/:id/download` | Streams the local **encrypted** artifact. |
| `PUT` | `/api/backups/config/passphrase` | Write-only `{ passphrase }`. Stored in OS credential store; never returned. Changing it does **not** re-encrypt old backups — warns the owner to keep the old phrase. |
| `PUT` | `/api/backups/config/cloud` | Write-only `{ endpoint, region, bucket, accessKeyId, secretAccessKey, enabled }`. Stored separately from the passphrase. `GET /api/backups/config/cloud` returns only `{ endpoint, region, bucket, enabled, hasCredentials }`. |

---

## 11. Settings

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/api/settings` | All non-secret keys (`DATABASE.md` §2.1). |
| `PATCH` | `/api/settings` | Partial. Writes `SETTINGS_CHANGE` audit with old/new. Validates: `negativeStockMode` ∈ enum, `currentFiscalYear` int, etc. `currentFiscalYear` is **not** settable here — use `/api/fiscal-year/roll`. |

---

## 12. Audit

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/api/audit` | Filters: `entity`, `entityId`, `action`, `from`, `to`. Paginated, newest first. |

---

## 13. Offline sync

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/api/sync/state` | `{ serverTime, currentFiscalYear, openPeriods: ["2026-08", …], negativeStockMode }` — lets the client warn before queuing (e.g. `PREVENT` + offline). |
| `POST` | `/api/sync` | Batch flush. Body: `{ operations: [ { localId, idempotencyKey, endpoint, body } ] }`. Server processes **in array order**, one at a time. |

Sync response:

```jsonc
{
  "results": [
    { "localId": "…", "status": "SYNCED",   "serverId": "…", "response": { … } },
    { "localId": "…", "status": "SYNCED",   "serverId": "…", "response": { … }, "replayed": true },
    { "localId": "…", "status": "CONFLICT", "code": "PERIOD_CLOSED",
      "message": "งวดถูกปิดแล้ว", "details": { … } }
  ]
}
```

- `replayed: true` = idempotency key already seen; original result returned, nothing
  created.
- On `CONFLICT` the server continues with the remaining operations (spec §12.2). The
  client moves that item to the conflict panel.
- Retriable server/network failures are not represented here — the client simply retries
  the whole `/api/sync` call with the unsynced remainder, reusing keys.

---

## 14. Health

`GET /api/health` → `{ ok: true, db: "up", schemaVersion: "0003_periods_fy2569", appVersion, pgVersion }`.
No auth.

---

## 15. Error code catalogue (initial)

| Code | HTTP | Meaning |
| --- | --- | --- |
| `VALIDATION_FAILED` | 400 | zod schema rejected the body (`details.issues`). |
| `UNAUTHENTICATED` | 401 | No / expired session. |
| `BAD_PASSPHRASE` | 401 | Backup passphrase does not decrypt. |
| `SKU_ALREADY_EXISTS` | 409 | Duplicate SKU on create. |
| `PERIOD_CLOSED` | 409 | Write/void into a closed period. |
| `PERIOD_ALREADY_CLOSED` / `PERIOD_NOT_CLOSED` | 409 | Period state transition invalid. |
| `FY_PERIODS_OPEN` | 409 | Fiscal-year roll attempted with open periods. |
| `BACKUP_REQUIRED` | 409 | A guarded action needs a successful backup first. |
| `ALREADY_VOIDED` | 409 | Void of an already-voided document. |
| `OPENING_LOCKED` | 409 | Opening cannot be replaced (has history). |
| `CATEGORY_IN_USE` | 409 | Delete blocked. |
| `LAST_REMAINING_COPY` | 409 | Backup delete would leave zero verified copies. |
| `CLOUD_DISABLED` | 409 | Cloud action with no cloud config. |
| `SCHEMA_NEWER_THAN_APP` | 409 | Restore of a newer-schema backup. |
| `STOCK_WOULD_GO_NEGATIVE` | 422 | `PREVENT` mode block (`details.shortfall`). |
| `IMPORT_HAS_INVALID_ROWS` | 422 | `ALL_OR_NOTHING` commit with unresolved invalid rows. |
| `IMPORT_FILE_ALREADY_IMPORTED` | 422 | Same `source_file_hash` committed before and `acknowledgeDuplicateFile` not set. |
| `BACKUP_INTEGRITY_FAILED` | 422 | sha256 mismatch on a backup artifact. |
| `IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_BODY` | 422 | Key collision with a different payload. |
| `NOT_FOUND` | 404 | Unknown id. |
| `RATE_LIMITED` | 429 | Auth attempts exceeded. |
| `INTERNAL` | 500 | Unhandled; `correlationId` in logs. |
