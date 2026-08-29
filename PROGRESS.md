# PROGRESS.md — Implementation Progress

> Governed by `PROJECT_SPEC.md` (source of truth). Update after **every** work session.
> Verification level is exactly one of:
> **Not started · Implemented · Unit tested · Integration tested · E2E tested ·
> Stress tested · Recovery tested**
> "Implemented" alone never means "working" — it means code exists and type-checks.
> Never record a level higher than the tests that were actually executed.

**Last updated:** 2026-08-29 — Spec v0.3. **Phases 1–8 complete** (P8: local logical
backup only — cloud + Task Scheduler deferred, open Q #15/#16). A real PostgreSQL 17
backend is now available for tests via `embedded-postgres` (`npm run test:pg`). 176
tests green (shared 105, server 66, web 5); the 66 server tests also pass under
`TEST_PG=1` against real Postgres. Phase 4–8 UI not browser-verified. Phase 9 remains.

---

## Current state

- [x] `PROJECT_SPEC.md` drafted — v0.1, then v0.2 with owner confirmations (§26.1, §27).
- [x] `TASKS.md` skeleton created.
- [x] `PROGRESS.md` skeleton created.
- [x] Owner answers to §26 questions #1,2,3,5,7,9,10,11,12 recorded.
- [ ] Owner answers to §26.2 remaining questions (#4, #6, #8, #13–#16) — pending;
      PROVISIONAL defaults are baked into the docs.
- [x] First Task design docs written: `DATABASE.md`, `API.md`, `ARCHITECTURE.md`,
      `TESTING.md`, `IMPORT_FORMAT.md`, `BACKUP_RECOVERY.md`.
- [ ] Phase 1 implementation — **blocked** on owner confirmation (per §25 step 10).

---

## Area status

| Area | Spec ref | Level | Notes |
| --- | --- | --- | --- |
| Repo / workspaces / tooling | §3, §29, Phase 1 | Integration tested | npm workspaces, TS strict, ESLint, CI; PGlite dev/test |
| PostgreSQL schema + migrations | §5–§20, DATABASE.md | Integration tested | 0001 full schema + 0002 seed + 0003 periods; runner idempotent; CHECK/partial-unique verified on PGlite |
| Error handling + logging | §17, Phase 1 | Integration tested | single Fastify error handler, typed codes, Thai msg + correlationId; pino w/ redaction |
| `cleanData` — SKU | §7.1 | Unit tested | cleanSku: trim/collapse/upper; SKU_REQUIRED |
| `cleanData` — numbers / satang / fractional qty | §7.2, §9.1 | Unit tested | strip ฿/THB/บาท/commas/spaces, parens-neg, round-half-up; QUANTITY_PRECISION >3dp; 0.1+0.2 test |
| `cleanData` — dates / Excel serial / Thai Buddhist year | §7.3 | Unit tested | serial @1899-12-30, DD/MM/YYYY, YYYY-MM-DD, DD-MM-YYYY, BE≥2400→−543, 2-digit warn |
| Money (satang integers, micro-THB avg, round-half-up) | §9.1, §9.2 | Unit tested | branded Satang; §9.3 COGS golden (2,133,333) |
| Product master + SKU UNIQUE + UPSERT | §8 | Integration tested | create/update/list; dup SKU any-case → 409; UPSERT no-dup |
| Units / categories (conversion-ready model) | §8 (brief §8) | Integration tested | 12 seeded units; category delete blocked when in use |
| Audit log (write path) | §20 | Integration tested | writeAudit; product CREATE/UPDATE rows asserted |
| Movement ledger (`movements`, all 9 types) | §5 | Integration tested | signed qty CHECK, one-active-OPENING partial-unique, seq identity; postMovementTx single write path |
| `replayLedger` + golden master | §9.4, §23 | Unit tested | pure `costStep`/`replayLedger`; §9.3 / §11 / §23 golden asserted |
| `stock_state` / `stock_cost_state` caches + reconciliation | §4, §21 | Integration tested | merged `stock_state` (qty + cost cols) updated in same tx; `recomputeStockState` full replay; recon job Phase 9 |
| Stock formulas (full + 68/69) + variance | §5.2–§5.4 | Integration tested | `currentFyView` (stock68 / purchasesCfy / salesCfy / variance) |
| Rolling fiscal year + rollover action | §5.3, §6.5 | Integration tested | `POST /api/fiscal-year/roll` (`services/fiscalYear.ts`): confirm + all-12-CLOSED (`FY_PERIODS_OPEN`) + backup guard (`BACKUP_REQUIRED`, real wiring Phase 8) + advance + open new periods + `ROLL_FISCAL_YEAR` audit + no movement rows touched. Stock 68 now a derived ledger cutoff so a rollover yields prior-year close with no snapshot |
| Negative-stock modes (ALLOW / PREVENT) | §6.1 | Integration tested | ALLOW warns + oversold + missingBalance; PREVENT → 422, nothing written |
| Stock status badges + oversold / Missing Balance | §6.2 | Integration tested | domain `stockStatus` / `isOversold` / `missingBalance`; surfaced in product stock block |
| Void semantics | §5.6 | Integration tested | `voidDocumentTx` marks doc + movements VOIDED, recompute; excluded from calc; VOID audit |
| Monthly periods (open / closed / reopen) | §6.4 | Integration tested | `ensurePeriod` lazy OPEN; `assertPeriodOpen` → PERIOD_CLOSED; close / reopen(reason) |
| Backdated-transaction warning + reason | §6.3 | Integration tested | `checkBackdate`: BACKDATED warning; gap > threshold → VALIDATION_FAILED w/o reason; reason → audit |
| Purchases | §10.1 | Integration tested | `createPurchase` via `runIdempotent`; PURCHASE movement + audit |
| Sales (live stock before confirm) | §10.2, §19.3 | Integration tested (API) | `createSale`; SALE movement + `cogs_satang`; live-stock UI = Phase 4 |
| Customer / supplier returns | §10.3 | Integration tested | `createReturn`; CUSTOMER requires unitCostSatang (schema refine); SUPPLIER outflow |
| Inventory adjustments (+ reasons) | §10.4 | Integration tested | `createAdjustment`; DAMAGED + negative → DAMAGE movement; else ADJUSTMENT signed delta |
| Transaction ledger UI (shows the calculation) | §11 | Implemented (UI unverified) | `LedgerDrawer`: opening balance + per-row running balance + current stock; voided rows struck through; paginated. API path integration tested |
| Audit log | §20 | Integration tested | CREATE / VOID / SETTINGS_CHANGE / COST_BASIS_RESET rows asserted |
| Weighted-average costing + COGS (round-half-up) | §9.2, §9.3 | Unit + integration tested | micro-THB avg; `costStep` books COGS; §9.3 golden (2,133,333 satang) |
| Owner-entered cost: customer return + positive adjustment | §9.2, §10.3, §10.4 | Integration tested | schema refine enforces unitCostSatang; prefill-from-sale-COGS = Phase 4 UI |
| Cost-basis reset (`qty < 0`) + void-purchase replay | §9.2 | Unit + integration tested | strict `qty.lt(0)` reset branch; `costBasisResets` index list; void → `recomputeStockState` replay |
| Estimated gross profit / margin reporting | §9.5 | Integration tested | `monthlyReport` totals: revenue − COGS = gross profit, margin % `toFixed(2)`, divide-by-zero → null; cross-checked vs raw SQL |
| Dashboard KPI cards | §18 | Integration tested (API) + UI implemented | `GET /api/dashboard` SQL-aggregated, cross-checked vs raw SQL; `DashboardPage` renders all 10 §18.1 cards with dynamic FY labels. UI not browser-verified |
| Master stock table (search / filter / sort / paginate) | §19 | Integration tested (API) + UI implemented | `GET /api/products` + per-row `fyView` + dynamic labels; `StockPage` search / status+category filters / low+oversold toggles / sortable headers / server pagination / row action buttons. UI not browser-verified |
| Transaction UI drawers (Purchase / Sale / Return / Adjust) | §19.3 | Implemented (UI unverified) | `TransactionDrawer`: live current stock, auto totals, backdate warning + reason, projected balance, oversell warning. Return prefill-from-sale-COGS still deferred (needs sale-lookup endpoint) |
| Monthly / low-stock / oversold reports + charts | §21 (brief), §9.5 | Integration tested (API) + UI implemented | `GET /api/reports/monthly?ym=` + `/low-stock` + `/oversold` SQL-aggregated (`services/reports.ts`); `ReportsPage` bar chart + monthly table + two lists. UI not browser-verified |
| Excel/CSV import pipeline (parse→sanitize→validate→preview→commit) | §13 | Integration tested | `services/import/*` (headers/parse/sanitize/hash/pipeline/commit); `POST /api/imports` multipart preview, `GET /imports/:id`, `/commit`, `/discard`. 8 tests |
| Import atomicity (all-or-nothing) + partial opt-in | §13.3, §13.4 | Integration tested | one tx via `runIdempotent`; ALL_OR_NOTHING any-SKIP → 422 nothing written; PARTIAL commits valid + lists skipped. Mid-write rollback fault-injection deferred to Phase 9; 10k-row target deferred to Phase 9 stress |
| Import idempotency (file hash / row hash) | §15 | Integration tested | file sha256 → `fileAlreadyImported` + `IMPORT_FILE_ALREADY_IMPORTED` w/o ack; row sha256 → `ROW_ALREADY_IMPORTED` / `DUPLICATE`, never re-applied |
| Invalid-row export | §13.6 | Integration tested | `GET /imports/:id/invalid-rows.xlsx` — source layout + trailing `_error` column |
| Exports (all report kinds) | §14.3, brief §27 | Integration tested | `GET /api/exports/:kind.xlsx` — current-stock / ledger / purchases / sales / monthly-report / low-stock / oversold |
| Idempotency middleware (`processed_requests`) | §14.1 | Integration tested | `runIdempotent` atomic (work + processed_requests in one tx); replay `_replayed:true`; different body → 422; doc tables carry `idempotency_key UNIQUE` |
| Concurrency safety (per-product lock, no lost updates) | §14.2 | Integration tested (real Postgres) | `pg_advisory_xact_lock` per product + per-idempotency-key + `SELECT … FOR UPDATE`. A/B 80/50 ALLOW/PREVENT + 5× parallel-same-key all pass under `TEST_PG=1` with a real connection pool. Real parallelism exposed + fixed an idempotency race PGlite had masked |
| Offline cache + outbound queue (Dexie) | §12.2 | Unit tested | `web/src/offline/db.ts` queue store with all §12.2 fields + `hasStorage()` guard; `TransactionDrawer` enqueues when `!isOnline()` |
| Sync engine (FIFO, retry-no-dup, conflict isolation) | §12.2–§12.3 | Unit + integration tested | client `engine.flush` FIFO + per-item apply + network-park + retry; server `POST /api/sync` array-order, typed 4xx → CONFLICT + continue, 5xx → abort; same-key replay creates nothing |
| Sync conflict UI | §12.3 | Implemented (UI unverified) | `SyncPage`: PENDING/CONFLICT/FAILED list + retry / discard + "ซิงค์เดี๋ยวนี้"; nav badge + offline banner. `editAndRetry` in engine; discard-with-audit is a server follow-up |
| Backup pipeline (dump→manifest→compress→encrypt→hash→verify) | §16.3 | Integration tested (both backends) | `services/backup.ts` logical dump (no `pg_dump`) → manifest → gzip → AES-256-GCM (scrypt) → sha256 → verify. `backup.test.ts` |
| Backup scheduling (Task Scheduler + startup catch-up) | §16.2 | Partial | `backupOverdue()` helper for a startup check; Windows Task Scheduler `.xml` + install + missing-task warning deferred (open Q #16) |
| Backup retention (never delete last copy) | §16.3, §16.6 | Integration tested | `deleteBackup` → `LAST_REMAINING_COPY` when it would leave zero verified copies. Full 14/8/12 rotation not built |
| Cloud upload (S3-compatible, verify + retry, 3-state status) | §16.3, §16.4 | Not started | provider TBD (open Q #15); `cloud_status` column stays `NOT_ATTEMPTED` |
| Secrets separation (PIN / passphrase / cloud creds) | §16.5 | Partial | passphrase from request / `BACKUP_PASSPHRASE` env, never in DB, redacted in logs. OS credential store / DPAPI = deployment packaging |
| Restore (guarded / passphrase / pre-restore backup / cross-migration) | §16.7 | Integration tested (both backends) | `restoreBackup`: confirm phrase + `BAD_PASSPHRASE` + `BACKUP_INTEGRITY_FAILED` + `SCHEMA_NEWER_THAN_APP` + PRE_RESTORE auto-backup + one-tx swap + `_migrations` top-up + `RESTORE` audit |
| Disaster-recovery runbook + drills | §16, brief §33 | Not started | `BACKUP_RECOVERY.md` still describes the `pg_dump` design; needs a rewrite for the logical-dump format |
| Database constraints (UNIQUE / CHECK ≥ 0 / FK) | §14, brief §34 | Integration tested (real Postgres) | full schema now also verified on real PG17 via `TEST_PG=1` — CHECK / partial-unique / FK / GENERATED IDENTITY all enforced |
| Performance / scale (10k products, 100k movements) | §21 | Not started | Phase 9 — stress seed + profiling on embedded PG |
| UI/UX (Thai-first, number/date formatting, responsive) | §19.4 | Not started | |
| Stress / corruption / concurrency / recovery hardening | Phase 9 | Not started | |

---

## Test summary

| Suite | Tests | Passed | Failed | Level reached |
| --- | --- | --- | --- | --- |
| Sanitization (shared) | 74 | 74 | 0 | Unit tested |
| Money / format / domain + replayLedger (shared) | 31 | 31 | 0 | Unit tested |
| Foundation + migrations + health (server) | 7 | 7 | 0 | Integration tested |
| Product master + lookups (server) | 11 | 11 | 0 | Integration tested |
| Inventory ledger (server) | 10 | 10 | 0 | Integration tested |
| Concurrency (server, serialized under PGlite) | 3 | 3 | 0 | Integration tested (multi-client deferred to real Postgres) |
| Dashboard + master-table 68/69 view (server) | 4 | 4 | 0 | Integration tested (raw-SQL cross-check) |
| Financial reports — monthly / low-stock / oversold (server) | 4 | 4 | 0 | Integration tested (raw-SQL cross-check) |
| Fiscal-year rollover (server) | 4 | 4 | 0 | Integration tested |
| Financial — void-purchase replay + cost-basis reset (server) | 2 | 2 | 0 | Integration tested |
| Excel/CSV import + exports (server) | 8 | 8 | 0 | Integration tested |
| Offline sync batch (server) | 5 | 5 | 0 | Integration tested |
| Offline sync engine (web, fake-indexeddb) | 4 | 4 | 0 | Unit tested |
| Backup + restore (server, both backends) | 8 | 8 | 0 | Integration tested |
| Web (shell + dashboard/stock/reports/import/sync/backup nav) | 1 | 1 | 0 | Component tested (all page UIs not browser-verified) |

---

## Known limitations / unverified areas

- **Concurrency (spec §14.2):** now verified against real PostgreSQL — `npm run test:pg`
  boots an `embedded-postgres` instance and runs the whole server suite with a real
  connection pool. This is how the idempotency advisory-lock race was found and fixed.
  Default `npm test` still uses PGlite for speed.
- **Backup uses a logical dump, not `pg_dump`** — the trimmed `@embedded-postgres` binary
  bundle ships only `postgres`/`initdb`/`pg_ctl`. The logical dump (schema from the
  migration files, data via `SELECT *`) is driver-agnostic and fully tested, but it is
  not a byte-for-byte `pg_dump` artifact: it captures the 16 app tables + `_migrations`,
  not roles, extensions, or `backups` itself.
- **Cloud backup + Windows Task Scheduler are not built** (open Q #15 provider, #16
  install method). `cloud_status` stays `NOT_ATTEMPTED`; there is a `backupOverdue()`
  helper but nothing schedules backups yet. The fiscal-year-roll `BACKUP_REQUIRED` guard
  is now satisfied for real by a successful `createBackup` (it stamps
  `settings.last_backup_at`).
- `BACKUP_RECOVERY.md` still documents the original `pg_dump` design and needs a rewrite
  for the logical-dump format.
- Phase 4/5 UI (dashboard, master table, 4 transaction drawers, ledger drawer,
  edit-product drawer, reports page + Recharts) is **built and typechecks + `vite build`
  succeeds + a render smoke test passes, but has not been run in a real browser** — no
  display in this environment. Golden-path + edge-case click-through still owed.
- Web bundle is ~640 kB (recharts is heavy); acceptable for a local single-owner app,
  revisit with code-splitting in Phase 9 if needed.
- `npm audit`: `esbuild` (vite dev server), `drizzle-orm` (<0.45.2, not yet used for
  queries), and `xlsx` 0.18.5 (prototype-pollution / ReDoS advisories — the registry
  build; SheetJS's fix is only on their CDN, unreachable here). `xlsx` parses only
  owner-supplied files server-side. Revisit all three in the Phase 9 security review.
- Import: the 10,000-row single-transaction target (§13.3) is **not** yet exercised —
  moved to the Phase 9 stress pass (now runnable against real Postgres). A genuine
  mid-write rollback test needs deliberate fault injection; the pre-write 422 path
  already proves "invalid file writes nothing".
- Customer-return **Unit Cost prefill from the linked sale's COGS** (spec §19.3) still not
  wired — needs a sale-lookup endpoint.
- Offline `PREVENT` overselling is enforceable only at sync time (design constraint,
  `PROJECT_SPEC.md` §6.1, §28.2) — the sync path returns it as a `CONFLICT`
  (`STOCK_WOULD_GO_NEGATIVE`), tested in `sync.test.ts`.
- Offline sync: the engine tracks `retryCount` but does not itself schedule the
  exponential-backoff delay — the caller (a future `setTimeout` loop / service worker)
  applies the wait. No read-through cache yet: offline viewing of products/ledgers
  (§12.1) is not implemented; only the outbound write queue is.
- Sync **discard-with-audit** (§12.3): discarding a queued item just deletes it locally;
  it never reached the server, so there is no server-side audit row. If an audit trail of
  discards is wanted, add a client-side log or a `POST /api/sync/discard` note endpoint.

---

## Log

| Date | Session summary |
| --- | --- |
| 2026-08-29 | Created `PROJECT_SPEC.md` v0.1, `TASKS.md`, `PROGRESS.md`. Committed stack decisions (Postgres source of truth; integer-satang money; local-first single-owner web app). |
| 2026-08-29 | `PROJECT_SPEC.md` → v0.2. Folded in owner answers to §26 #1,2,3,5,7,9,10,11: rolling fiscal year (§5.3, §6.5), owner-entered return/adjustment cost (§9.2, §10.3, §10.4), round-half-up, single location, local PIN + separate backup passphrase + separate cloud creds (§16.5), THB only, Windows Task Scheduler backup + encrypt-before-cloud + 3-state status + never-delete-last-copy (§16 rewritten). Updated `TASKS.md` (Phases 3/4/5/8) and this file. Open: §26.2 #4,6,8,12–16. |
| 2026-08-29 | First Task design docs written (`DATABASE.md`, `API.md`, `ARCHITECTURE.md`, `IMPORT_FORMAT.md`, `BACKUP_RECOVERY.md`, `TESTING.md`). §26.2 #12 resolved (derived cutoff). |
| 2026-08-29 | Env check: no Docker / no Postgres. Spec → v0.3: dev/test DB = PGlite (embedded PG16). Owner OK'd autonomous build of Phases 1–7. |
| 2026-08-29 | **Phase 1 done** (commit 07c6fdf). Workspaces, PGlite client + Database interface, SQL migrations 0001–0003 + runner, Fastify + pino + error mapper, /api/health, web scaffold, CI. typecheck/lint/test green. Known limitation: true multi-client concurrency (spec §14.2) needs real Postgres. |
| 2026-08-29 | **Phase 2 done** (commit 7269c20). shared: cleanData (sku/number/date) + money (satang/micro) + format + domain + zod schemas, 99 unit tests. server: product master CRUD + SKU UNIQUE + UPSERT + categories + units + audit, 18 integration tests. web: minimal products page. Fixed decimal.js import (named `{ Decimal }`, not default) under verbatimModuleSyntax. |
| 2026-08-29 | **Phase 3 done** (commit 92a5d09). shared: `replayLedger` split into pure `costStep`; transaction zod schemas. server: `services/ledger` (postMovementTx single write path, recomputeStockState, voidDocumentTx, getLedger, currentFyView), `services/documents` (createPurchase/Sale/Return/Adjustment/Opening + voidDocument, all via `runIdempotent`), `services/idempotency` (atomic work + processed_requests), `services/periods` / `services/settings` (+ route) / `services/backdate`, `db/lock` (advisory xact lock), PGlite date-OID parser. Routes: transactions / periods / settings + products ledger & stock. Tests: ledger 10, concurrency 3 (serialized under PGlite, multi-client deferred). 137 green total. Docs recorded in commit 0556cfc. |
| 2026-08-29 | **Phase 4 done** (commit 0ce3265). server: `services/dashboard` + `GET /api/dashboard` (§18.1, SQL-aggregated); `listProducts` extended with per-row `fyView` (68/69 + variance via LATERAL) and dynamic `labels`. web: rebuilt shell (`App` nav dashboard/stock), `DashboardPage` (10 KPI cards), `StockPage` (search / status+category filter / low+oversold toggle / sortable headers / server pagination / row actions), `Drawer` + `TransactionDrawer` (purchase/sale/return/adjust: live stock, auto totals, backdate warning, oversell warning) + `LedgerDrawer` + `EditProductDrawer`; `api.postTxn` sends a fresh Idempotency-Key; `lib/fmt` wraps shared formatters. Tests: dashboard 4 (raw-SQL cross-check + fyView + filters), web smoke updated. 141 green. UI not browser-verified (no display). |
| 2026-08-29 | **Test infra + idempotency fix.** `db/pg.ts` node-postgres adapter (same `Database` interface); `test/globalSetup.ts` boots one `embedded-postgres` PG17 under `TEST_PG=1`, `makeTestDb()` provisions a fresh DB per file; `npm run test:pg`. Running with real parallel clients exposed an idempotency race PGlite had hidden (5 concurrent same-key → 4× 409 instead of replay); fixed by a per-key `pg_advisory_xact_lock` + re-check inside `runIdempotent`'s transaction. 58 server tests pass on both backends. |
| 2026-08-29 | **Phase 8 done** (local backup only). `services/backup.ts`: driver-agnostic **logical** dump (schema from migration files, data via `SELECT *`) — no `pg_dump` in the embedded bundle. Pipeline dump → manifest → gzip → AES-256-GCM (scrypt) → sha256 → verify. `restoreBackup` guarded (confirm phrase, `BAD_PASSPHRASE`, `BACKUP_INTEGRITY_FAILED`, `SCHEMA_NEWER_THAN_APP`, PRE_RESTORE auto-backup, one-tx DELETE-all→INSERT-all, `_migrations` top-up). `deleteBackup` → `LAST_REMAINING_COPY`. `settings.last_backup_at` stamped → real FY-roll guard. Routes `/api/backups*`; web `BackupPage` + nav tab. `backup.test.ts` 8, green on PGlite + real PG. Deferred: cloud upload (#15), Task Scheduler (#16), CLI, full retention rotation, `BACKUP_RECOVERY.md` rewrite. |
| 2026-08-29 | **Phase 7 done.** server: `services/sync` + `POST /api/sync` (array-order batch, typed 4xx → CONFLICT + continue, 5xx → abort; allowed endpoints purchases/sales/returns/adjustments) + `GET /api/sync/state`. web: `dexie` + `fake-indexeddb` (dev); `offline/db.ts` (queue store, §12.2 fields) + `offline/engine.ts` (`enqueue` reused idempotency key, `flush` FIFO + per-item apply + network-park + `retryItem`/`editAndRetry`/`discardItem`) + `offline/store.ts` (zustand + online/offline listeners + initial flush); `TransactionDrawer` enqueues when offline; `SyncPage` conflict panel + nav badge + offline banner; `initOffline()` in `main.tsx`. Tests: `sync.test.ts` 5, `engine.test.ts` 4. 168 green. Autonomous Phases 1–7 complete. |
| 2026-08-29 | **Phase 6 done.** server: `@fastify/multipart` + `xlsx`; `services/import/` (headers alias resolver, workbook parse, per-row `cleanData` sanitize, file+row sha256, `pipeline.createImport` preview, `commit.commitImport` one-tx idempotent apply with §13.8 Master Stock re-import effect); routes `POST /imports` (multipart) / `GET /imports/:id` / `/commit` / `/discard` / `/invalid-rows.xlsx`; `services/exports` + `GET /api/exports/:kind.xlsx` (7 kinds). web: `ImportPage` (preview table + mode radios + dup-file ack + result + export buttons) + nav tab. Tests: `import.test.ts` 8. 159 green. UI not browser-verified. Deferred: 10k-row stress + mid-write rollback fault injection → Phase 9. |
| 2026-08-29 | **Phase 5 done.** server: `services/fiscalYear` + `POST /api/fiscal-year/roll` (confirm + all-12-CLOSED + backup guard + advance + open new periods + `ROLL_FISCAL_YEAR` audit, no movement rows touched); Stock 68 reworked to a derived ledger cutoff (`type='OPENING' OR occurred_on < CFY start`) in `currentFyView` / dashboard / `listProducts` so a rollover yields the prior-year close with no snapshot; `services/reports` + `GET /api/reports/monthly?ym=` / `/low-stock` / `/oversold` (SQL-aggregated, margin divide-by-zero guarded). web: `ReportsPage` (recharts bar chart + monthly table w/ totals footer + low-stock + oversold lists + month picker) + "รายงาน" nav tab; added `recharts` dep. Tests: `fiscalYear` 4, `reports` 4, `financial` 2 (void-purchase replay + cost-basis reset). 151 green. `vite build` OK. UI not browser-verified. |
