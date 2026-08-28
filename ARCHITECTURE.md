# ARCHITECTURE.md — Modules, Boundaries, Flows

> Subordinate to `PROJECT_SPEC.md`. Expands spec §3–§4 and §29.

---

## 1. Shape

A local-first, single-owner system that runs entirely on the owner's Windows machine:

```
 Browser SPA  ──HTTP(JSON)──►  Node API (Fastify)  ──SQL──►  PostgreSQL 16
     │                              │                            │
  Dexie/IndexedDB              node-cron jobs               pg_dump artifacts
  (cache + queue)          (reconcile, backup catch-up)     (local, encrypted)
                                    │                            │
                          Windows Task Scheduler ──► inventory-backup CLI ──► (optional) S3-compatible cloud
```

Three deployable units, one repo (npm workspaces): `packages/web`, `packages/server`,
`packages/shared`. `shared` is the contract layer both others import.

---

## 2. Layering (server)

```
routes/            thin HTTP handlers: parse → zod validate → call a service → map result
  │                never contain business rules
  ▼
services/          all business logic; transaction boundaries live here
  ├─ ledger        post movement, void, current stock, ledger page
  ├─ costing       weighted-average, COGS, replayLedger wrapper
  ├─ products      CRUD, SKU upsert
  ├─ periods       open/close/reopen, fiscal-year roll
  ├─ imports       parse/sanitize/validate/preview/commit
  ├─ exports       query → SheetJS workbook
  ├─ backup        pipeline, retention, restore, cloud
  ├─ sync          batch flush ordering
  └─ audit         write audit_log entries
  │
  ▼
db/                drizzle schema (typed queries), SQL migrations + ordered runner,
                   a `getDb()` that returns PGlite in dev/test or `pg` Pool when
                   `DATABASE_URL` points at real Postgres, advisory-lock helper
lib/               pg_dump/pg_restore wrappers, crypto (age/AES-GCM), OS credential store,
                   Task Scheduler probe, correlation-id, error→HTTP mapping
jobs/              node-cron registrations: reconcile, backup-catchup
```

Rules:

- A route never opens a transaction. A service method owns exactly one transaction (or
  none). Nested service calls that each need a transaction are refactored so the
  outermost owns it.
- Every stock mutation goes through `services/ledger.postMovement(...)`. There is no
  second write path. Imports call the same function in a loop inside one transaction.
- `costing` and `ledger` share the pure `replayLedger` from `packages/shared` — the same
  code computes live state and reconciliation state.

---

## 3. `packages/shared` (the contract)

```
schemas/       zod: product, purchase, sale, return, adjustment, opening, import rows,
               settings, sync batch — the single definition, imported by server + client
domain/
  movementTypes.ts    the 9 types, inflow/outflow sign map
  stockFormula.ts     current stock, 68/69 view, movement variance (pure)
  replayLedger.ts     ordered movements → { qty, avgCostMicro, totalCostSatang, cogsBySaleId }
  status.ts           stock status badge thresholds (spec §6.2)
money/
  satang.ts           branded `Satang` type; toSatang / fromSatang; roundHalfUp
  decimal.ts          decimal.js re-export + helpers; NO float arithmetic anywhere
cleanData/
  sku.ts  number.ts  date.ts  index.ts   (spec §7) + __tests__
format/
  number.ts           "1,234.00" display
  date.ts             Buddhist-year display / parse boundary
errors.ts             error-code enum + type
```

`money` and `cleanData` have the strictest tests (`TESTING.md`). A lint rule forbids
`+ - * /` on anything typed as money outside `money/`.

---

## 4. `packages/web`

```
app/            route components
  dashboard/    KPI cards (spec §18)
  master/       stock table: search, filters, sort, server pagination (spec §19)
  ledger/       per-product ledger with running balance (spec §11)
  txn/          purchase / sale / return / adjust drawers (spec §19.3)
  imports/      upload → preview table → confirm
  reports/      monthly / low-stock / oversold + Recharts
  periods/      open/close, fiscal-year roll
  backups/      status card, list, restore dialog, config
  audit/        filterable log
  sync/         conflict panel (spec §12.3)
  settings/
stores/         zustand slices: session, ui-prefs, sync-queue view, cached lookups
offline/
  db.ts         Dexie schema: cache tables + outbound queue + prefs
  queue.ts      enqueue, FIFO drain, state machine (PENDING→SYNCING→SYNCED/FAILED/CONFLICT)
  sync.ts       online detection, backoff, calls POST /api/sync with reused keys
api/            typed fetch client; shares zod from packages/shared
lib/            formatters, hooks
```

Offline model: the queue holds `{ localId, idempotencyKey, endpoint, body, status,
retryCount, ... }`. `idempotencyKey` is generated **once** at enqueue and never
regenerated. Reads are served from the Dexie cache when offline and refreshed on
reconnect. `localStorage` holds only UI prefs (theme, last filter) — never domain data.

---

## 5. Key flows

### 5.1 Post a sale (online)

```
Drawer submit
  → POST /api/sales  (Idempotency-Key: uuid)
    → route: zod validate
    → services/ledger.postMovement({ type: SALE, ... }) :
        BEGIN
        advisory_xact_lock(product_id)
        SELECT stock_state ... FOR UPDATE
        assert period OPEN ; backdate policy
        if mode=PREVENT and qty_on_hand - q < 0 → ROLLBACK, throw STOCK_WOULD_GO_NEGATIVE
        INSERT sales ; INSERT movements(type=SALE, -q)
        costing: cogs = roundHalfUp(q * avg_cost_micro) ; update stock_state
        INSERT audit_log(CREATE, sale)
        INSERT processed_requests(key, response)
        COMMIT
    → 201 { id, totalPriceSatang, cogsSatang, stockAfter, oversold? }
  → drawer shows ✅ ; master row + dashboard refetch
```

### 5.2 Post a sale (offline)

```
Drawer submit (navigator offline)
  → offline/queue.enqueue({ endpoint:/api/sales, body, idempotencyKey })  [status PENDING]
  → optimistic: adjust cached stock_state for immediate UI feedback (flagged "pending")
Reconnect
  → sync.ts drains FIFO: POST /api/sync { operations:[ {localId, idempotencyKey, endpoint, body}, ... ] }
  → per result: SYNCED → replace optimistic with server data ; CONFLICT → move to sync panel
```

### 5.3 Import commit (ALL_OR_NOTHING)

```
POST /api/imports/:id/commit { mode: ALL_OR_NOTHING }
  → services/imports.commit :
      assert no unresolved invalid rows (else 422)
      BEGIN
        for each row where action in (CREATE, UPDATE):
           advisory_xact_lock(product_id)
           MASTER_STOCK → products upsert (+ opening logic, spec §13.8)
           PURCHASES/SALES → services/ledger.postMovement(...)
           import_rows.committed = true
        import_batches.status = COMMITTED, committed_at = now()
        audit_log(IMPORT_COMMIT, batch)
      COMMIT   (any throw → ROLLBACK, status=FAILED, error set)
```

### 5.4 Reconciliation job (node-cron, e.g. hourly)

```
for each product (batched):
   replay = replayLedger(SELECT * FROM movements WHERE product_id=$1 AND status='ACTIVE' ORDER BY occurred_on, seq)
   if replay != stock_state row:
      INSERT recon_alerts(...)
      if settings.recon_autoheal: UPDATE stock_state FROM replay
   log a structured warning
```

Cheap pre-filter: compare `stock_state.last_seq` to `MAX(movements.seq)` per product;
only full-replay the ones that differ or are randomly sampled.

### 5.5 Backup (Task Scheduler path)

```
Windows Task Scheduler 02:00 → inventory-backup CLI
  → services/backup.run({ kind: AUTO }) :
      pg_dump -Fc                         → dump.bin
      write manifest.json (versions, row counts, sha256(dump))
      gzip                                → dump.bin.gz
      encrypt (AES-256-GCM, passphrase)   → <ts>.inv.enc   ; shred plaintext
      sha256(artifact) ; test-decrypt + pg_restore --list  → verify
      INSERT backups(local_status=LOCAL_BACKUP_SUCCESS, ...)
      retention sweep (never delete last verified copy)
      if cloud.enabled:
         PUT <ts>.inv.enc to bucket ; HEAD + checksum verify
         UPDATE backups.cloud_status = CLOUD_UPLOAD_SUCCESS | CLOUD_UPLOAD_FAILED
App startup: if now - lastLocalSuccessAt > backup_interval_hours → services/backup.run({ kind: AUTO })
```

### 5.6 Restore

```
POST /api/backups/:id/restore { confirmPhrase, passphrase }
  → assert confirmPhrase matches ; assert schema_version <= app latest (else 409)
  → services/backup.run({ kind: PRE_RESTORE })          (auto safety backup)
  → decrypt artifact with passphrase (401 on failure) ; verify sha256 (422 on mismatch)
  → drop + recreate schema ; pg_restore
  → run forward migrations to app latest
  → audit_log(RESTORE, backup id, { fromSchema, toSchema })
  → force re-login
```

---

## 6. Cross-cutting

| Concern | Where |
| --- | --- |
| Validation | `zod` in `shared/schemas`, enforced at the route edge; DB `CHECK`/`UNIQUE` as the real backstop. |
| Money safety | `shared/money` only; lint rule + a runtime assert in `toSatang`. |
| Idempotency | `lib` middleware wraps `(idempotent)` routes; `processed_requests` table. |
| Concurrency | `db/advisoryLock.ts` + `SELECT ... FOR UPDATE` on `stock_state`. |
| Errors | services throw typed `AppError(code, details)`; `lib/errorMapper` → HTTP + Thai message + `correlationId`; `pino` logs the technical detail. |
| Logging | `pino` JSON to `logs/app.log` (rotated); user messages never come from log strings. |
| Time | server clock is authoritative; business dates never derive from the client. |
| Config secrets | OS credential store (DPAPI) via `lib/credentials.ts`; never in `settings`/DB/logs. |

---

## 7. What is deliberately NOT here

- No message queue / broker — `node-cron` + the DB are enough for one owner.
- No Redis — Postgres advisory locks + `processed_requests` cover locking and idempotency.
- No container orchestration — one Node process, one Postgres, one machine.
- No Electron/Tauri in v1 (spec §3.3) — the SPA is served by Fastify as static files.
- No ORM lock-in in the hot path — costing/ledger use hand-written SQL where clarity
  matters; Drizzle for the CRUD majority.
