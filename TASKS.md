# TASKS.md — Remaining Work

> Phase-ordered task list. Governed by `PROJECT_SPEC.md` (source of truth).
> Each task has a **Verify** line — the task is not done until that check passes.
> Update the checkbox and add a date when a task is completed.
> This is a **skeleton**. It is filled in with post-analysis detail during
> `PROJECT_SPEC.md` §25 First Task (steps 4–9), before Phase 1 implementation begins.

Legend: `[ ]` not started · `[~]` in progress · `[x]` done (add date)

---

## First Task (design & analysis — do before any Phase 1 code)

- [x] 2026-08-29 — Re-read `PROJECT_SPEC.md`; §26/§28 extended during analysis.
- [x] 2026-08-29 — Owner answers to `PROJECT_SPEC.md` §26 questions #1,2,3,5,7,9,10,11,12
      (recorded in §26.1 + §27 Change Log v0.2).
- [ ] Get owner answers to the remaining §26.2 questions (#4, #6, #8, #13–#16). #15
      (cloud provider) and #16 (Task Scheduler install method) block Phase 8; the rest
      have PROVISIONAL defaults baked into the docs and block only their own phase.
      **Verify:** answers recorded in §26.1 + §27 Change Log.
- [x] 2026-08-29 — `DATABASE.md`: enums, 17 tables, constraints, indexes, transaction
      patterns, migrations `0001`–`0003`.
- [x] 2026-08-29 — `API.md`: auth, all endpoints, idempotency contract, error catalogue.
- [x] 2026-08-29 — `ARCHITECTURE.md`: layering, `shared` contract, directory tree,
      sequence flows (sale online/offline, import commit, reconcile, backup, restore).
- [x] 2026-08-29 — `TESTING.md`: runners, golden master, 9 suites mapped to §22.1,
      coverage gates, verification levels.
- [x] 2026-08-29 — `IMPORT_FORMAT.md`: headers + aliases + rules + codes + sample files
      for MASTER_STOCK / PURCHASES / SALES.
- [x] 2026-08-29 — `BACKUP_RECOVERY.md`: scheduling, 8-step pipeline, retention, restore,
      secrets separation, 8 DR scenarios with drills, runbook.
- [x] 2026-08-29 — `TASKS.md` per-phase detail + `PROGRESS.md` area table updated.
- [x] 2026-08-29 — **STOP / owner confirmation** — owner OK'd autonomous build of
      Phases 1–7 (spec Change Log v0.3).

---

## Phase 1 — Foundation ✅ 2026-08-29 (commit 07c6fdf)
- [x] `git init`; base `.gitignore`; first commit.
- [x] npm workspaces: `packages/shared`, `packages/server`, `packages/web`.
- [x] TypeScript strict everywhere; shared `tsconfig` base.
- [x] ~~`docker-compose.yml` with PostgreSQL 16~~ → **PGlite** (embedded PG16) for
      dev/test; no Docker in env (spec v0.3). `pg` adapter path documented for prod.
- [x] Hand-written SQL migrations `0001`–`0003` + ordered runner + `migrate` script.
      (Drizzle Kit codegen not used; Drizzle ORM reserved for typed queries.)
- [x] Fastify boots; health route; structured `pino` logging.
- [x] Central error mapper (typed error code → HTTP + user message); shared `errors.ts`.
- [x] CI: install, lint, typecheck, test on every push.
      **Verified:** `npm test` green, server boots, migrations apply to fresh DB.

## Phase 2 — cleanData + Product Master ✅ 2026-08-29 (commit 7269c20)
- [x] `packages/shared/src/cleanData/`: `sku.ts`, `number.ts`, `date.ts`, `index.ts`.
- [x] Unit tests for every `PROJECT_SPEC.md` §22.1 sanitization case (74).
- [x] `units`, `categories`, `products` tables + constraints (SKU UNIQUE, min_stock ≥ 0).
- [x] Product CRUD endpoints + zod schemas.
- [x] SKU UPSERT helper (match on sanitized SKU).
- [x] Web: product list + create/edit form.
      **Verified:** all sanitization cases pass; DB rejects duplicate SKU (any case);
      duplicate-create returns typed 409; UPSERT updates, never duplicates.

## Phase 3 — Inventory ledger ✅ 2026-08-29 (commit 92a5d09)
- [x] `movements` table (signed qty CHECK, type enum-as-CHECK, status, void fields,
      `idempotency_key`, `period_id`, import fields, `seq` identity, one-active-OPENING
      partial-unique) + constraints.
- [x] Merged `stock_state` cache (qty + cost columns); `stock_cost_state` folded in.
- [x] `replayLedger` + pure `costStep` in `packages/shared`.
- [x] Per-product advisory lock helper (`pg_advisory_xact_lock`); `postMovementTx` = one
      write path: lock → read (`FOR UPDATE`) → check → write movement → update cache.
- [x] Endpoints: `POST /openings`, `/purchases`, `/sales`, `/returns`, `/adjustments`,
      `/documents/:id/void` — all idempotent (`Idempotency-Key` header).
- [x] `periods` table + open/close/reopen endpoints; write path honours CLOSED.
- [x] `settings.current_fiscal_year` + current-FY sum helpers; `GET /fiscal-year`
      dynamic 68/69 labels.
- [x] Backdate warning + reason-required-over-threshold; audit entry.
- [x] Negative-stock modes (`ALLOW` default / `PREVENT`); `PATCH /settings`.
- [x] Owner-entered `unit_cost_satang` on customer returns and positive adjustments
      (schema refine enforces it); round-half-up helper in `packages/shared/money`.
      **Verified:** §5.5 worked example; §23 mock dataset golden master (stock + variance
      + status + oversold + missingBalance per SKU); §9.3 COGS golden; §11 running
      balance + void exclusion; closed-period write → 409; backdate reason-required →
      400 + audit; idempotency replay + different-body 422; §14.2 A/B concurrency both
      modes (serialized under PGlite — multi-client deferred to real Postgres).

## Phase 4 — Dashboard & master stock table ✅ 2026-08-29 (commit 0ce3265)
- [x] `GET /api/dashboard` — pre-aggregated KPI payload (§18.1), `services/dashboard.ts`.
- [x] Master table: columns per §19.1; search (SKU, name); filters (category, status,
      low-stock, oversold); sortable headers; **server-side pagination** (page size 20).
      `GET /api/products` now also returns per-row `fyView` + dynamic `labels`.
- [x] Status badges (🟢/🟡/🔴) + oversold sub-line + Missing Balance.
- [x] Ledger drawer showing opening balance + running-balance calculation (§11),
      voided rows struck through, paginated.
- [x] Purchase / Sale drawers: live current stock, auto totals, backdate warning,
      projected balance, oversell warning on Sale.
- [x] Customer Return drawer (required Unit Cost) and Adjust Stock drawer (Unit Cost
      required when delta > 0, reason codes); dynamic 68/69 column labels from
      `current_fiscal_year`. **Return prefill from linked sale COGS deferred to Phase 5
      (needs a sale-lookup endpoint).**
      **Verified (automated):** dashboard figures cross-checked against raw SQL on a
      built dataset; `fyView` + labels asserted; oversold-only / low-stock-only filters
      correct against the mock dataset. **Not verified:** drawers in a real browser
      (no display in this environment).

## Phase 5 — Financial reporting ✅ 2026-08-29 (commit 76d0ae7)
- [x] Weighted-average costing wired into every costed movement; `avg_cost_micro`
      (done in Phase 3; explicit `financial.test.ts` coverage added here).
- [x] `cogs_satang` computed + stored on sale post (round-half-up) — Phase 3;
      cross-checked in `reports.test.ts` totals vs raw SQL.
- [x] Cost-basis reset rule for `qty_on_hand < 0`; `COST_BASIS_RESET` audit —
      `financial.test.ts` asserts avg resets to the inflow cost + one audit row.
- [x] Void-purchase handling via ledger replay — `financial.test.ts` asserts the
      cost basis reverts and `stock_state` matches an ACTIVE-only replay.
- [x] Fiscal-year rollover: `POST /api/fiscal-year/roll` (`services/fiscalYear.ts`) —
      `confirm` required, all 12 periods of the outgoing year CLOSED else
      `FY_PERIODS_OPEN`, backup guard (`backupConfirmed` / `settings.last_backup_at`,
      real backup wiring lands in Phase 8) else `BACKUP_REQUIRED`, advances
      `current_fiscal_year`, opens the 12 new-year periods, `ROLL_FISCAL_YEAR` audit,
      no movement rows touched. **Stock 68 is now a derived ledger cutoff** (OPENING
      movements OR `occurred_on < CFY start`) across `currentFyView` / dashboard /
      master list, so a rollover makes it the prior-year closing balance with no
      snapshot table (§6.5).
- [x] Reports: `GET /api/reports/monthly?ym=` (per-SKU opening / purchases qty+value /
      sales qty+revenue / est. COGS / est. gross profit / margin % / closing + totals,
      divide-by-zero guarded), `/reports/low-stock`, `/reports/oversold` — all
      SQL-aggregated (`services/reports.ts`).
- [x] Recharts views (`ReportsPage.tsx`): per-SKU purchases/sales/profit bar chart +
      monthly table with totals footer + low-stock + oversold tables; month picker;
      new "รายงาน" nav tab. **UI not browser-verified (no display).**
      **Verified (automated):** §9.3 COGS golden (Phase 3) + gross-profit + margin math +
      divide-by-zero; cost-basis reset; void-purchase replay; rollover guard + advance +
      "no movement row changed" + derived Stock 68 = prior-year close. 45 server tests.

## Phase 6 — Excel / CSV ✅ 2026-08-29 (commit a880b21)
- [x] `POST /api/imports` (multipart, `@fastify/multipart`): parse (`xlsx`/SheetJS) →
      sanitize (`cleanData`) → validate (SKU resolves, closed period, in-file dup SKU,
      name-on-create) → duplicate-check (file + row hash) → build preview; only
      `import_batches` (PREVIEW) + `import_rows` written, no ledger.
- [x] File hash (`sha256` of bytes) + row hash (`sha256` of canonicalized sanitized
      row per kind); reuses the existing `import_batches` / `import_rows` tables.
- [x] Preview payload (§13.5: totalRows / validRows / invalidRows / duplicateRows /
      willCreate / willUpdate + per-row action + errors + warnings); `GET /imports/:id`
      re-fetch (`?invalidOnly=true`); `POST /imports/:id/discard`.
- [x] `POST /api/imports/:batchId/commit` (idempotent) — one transaction via
      `runIdempotent`; `ALL_OR_NOTHING` default (any SKIP row → `422
      IMPORT_HAS_INVALID_ROWS`, nothing written), `PARTIAL` opt-in (valid rows commit,
      skipped listed). File-hash dup → `422 IMPORT_FILE_ALREADY_IMPORTED` unless
      `acknowledgeDuplicateFile`. Rows processed in `(date, row_no)` order.
- [x] Invalid-rows `.xlsx` download with a trailing `_error` column
      (`GET /imports/:id/invalid-rows.xlsx`).
- [x] Master Stock 68 re-import effect (§13.8): pristine (single ACTIVE OPENING) → void
      + re-post OPENING; otherwise → `ADJUSTMENT` (`CORRECTION`) for the delta, positive
      delta costed at the product's current average.
- [x] `GET /api/exports/:kind.xlsx` for current-stock / ledger / purchases / sales /
      monthly-report / low-stock / oversold (`services/exports.ts`).
- [x] Web `ImportPage` — kind + file picker → preview table (action-coloured, invalid
      cells + warnings shown) → mode radios + duplicate-file ack → commit + result; plus
      export buttons + a monthly-report month picker. New "นำเข้า/ส่งออก" nav tab.
      **Verified (automated):** `import.test.ts` (8) — MASTER_STOCK create + openings;
      re-upload → file-dup flag + all rows DUPLICATE + 422 without ack + ack commits
      nothing; PURCHASES commit + movements; bad headers → 400 BAD_HEADERS; SALES
      unknown SKU → ALL_OR_NOTHING 422 + `sales` count unchanged; mixed-invalid PARTIAL
      commits the 1 valid + lists 4 skipped + invalid-rows.xlsx has `_error`; row-level
      dedup (identical rows commit once, corrected re-upload lands only new rows);
      exports return spreadsheetml buffers with the expected columns.
      **Not covered:** true 10k-row happy path (tests use small sheets — PGlite is slow;
      spec's 10k target deferred to the Phase 9 stress pass); a mid-write rollback needs
      deliberate fault injection (the pre-write 422 path already proves "nothing
      written"). UI not browser-verified.

## Phase 7 — Offline & sync ✅ 2026-08-29 (commit 1da676d)
- [x] Dexie schema (`web/src/offline/db.ts`): `queue` store with every §12.2 field
      (localId / serverId / idempotencyKey / syncStatus / retryCount / createdAt /
      syncedAt / payload / error) + a `prefs` kv store. `hasStorage()` guard so
      IndexedDB-less contexts (tests/SSR) treat the queue as a no-op.
- [x] Optimistic offline create: `TransactionDrawer` routes through `isOnline()` —
      online = `api.postTxn`, offline = `enqueue(endpoint, body)` then close. Same
      camelCase body shape works on both the direct endpoints and `/api/sync`.
- [x] Sync engine (`web/src/offline/engine.ts`): `flush()` sends the whole due set
      (PENDING + FAILED, sorted by createdAt = FIFO) to `POST /api/sync`; per-result
      apply — SYNCED sets serverId + syncedAt, CONFLICT parks with the code+message;
      network/5xx parks the batch PENDING and bumps `retryCount` (caller backs off).
      Idempotency key generated once at `enqueue`, reused on every retry;
      `editAndRetry` mints a fresh key. `store.ts` wires `online`/`offline` events +
      an initial flush.
- [x] `POST /api/sync` (`services/sync.ts` + route): `{ operations: [{ localId,
      idempotencyKey, endpoint, body }] }`, processed in array order one at a time;
      allowed endpoints `/purchases` `/sales` `/returns` `/adjustments`; typed 4xx →
      `{ status: 'CONFLICT', code, message, details }` and the batch continues; 5xx →
      throws so the client retries the remainder. `GET /api/sync/state` →
      `{ serverTime, currentFiscalYear, openPeriods, negativeStockMode }`.
- [x] Conflict panel (`SyncPage`): lists PENDING/SYNCING/FAILED/CONFLICT items with the
      payload + server reason + retry / discard; "ซิงค์เดี๋ยวนี้" button; nav badge with
      the queued count; offline banner. (Edit-and-retry exists in the engine;
      discard-writes-audit is a server-side follow-up — the offline item never reached
      the server so there is nothing to audit yet.)
      **Verified (automated):** server `sync.test.ts` (5) — state payload; FIFO batch
      with a serverId per synced op; same-key re-flush replays and creates nothing;
      closed-period CONFLICT isolated while the rest sync; PREVENT-oversell CONFLICT
      isolated. web `engine.test.ts` (4) — PENDING enqueue with a reused key; FIFO
      order in the request + per-item SYNCED/CONFLICT apply; network failure → PENDING +
      retryCount bump; retry of a conflicted item succeeds. **Not verified:** the flow
      in a real browser with actual connectivity toggling; exponential-backoff timing
      (retryCount is tracked; the delay schedule is the caller's to apply).

## Phase 8 — Backup & recovery ✅ 2026-08-29 (commit __PENDING8__) — cloud + scheduler deferred
- [x] Backup pipeline (`services/backup.ts`): **logical dump** (schema from the migration
      files, data via `SELECT * FROM <table>`) instead of `pg_dump` — the trimmed
      `@embedded-postgres` bundle has no `pg_dump`, and a logical dump is driver-agnostic
      (runs on PGlite and real Postgres). manifest (app / schema / pg version, per-table
      row counts, dump sha256) → gzip → **AES-256-GCM** (scrypt-derived key, per-artifact
      salt + iv + auth tag) → sha256 of the artifact → verify (re-read, re-hash, decrypt,
      re-parse, compare row counts). `movements.seq` (GENERATED ALWAYS) is dumped in seq
      order and omitted so the identity regenerates on restore.
- [x] Retention floor: `deleteBackup` refuses to remove the only remaining verified copy
      → `LAST_REMAINING_COPY`. (Full 14/8/12 daily/weekly/monthly rotation not built —
      `retention_class` column is there; a rotation job is a follow-up.)
- [x] Status model: `local_status` = `LOCAL_BACKUP_SUCCESS` / `LOCAL_BACKUP_FAILED`;
      `cloud_status` stays `NOT_ATTEMPTED`. `settings.last_backup_at` stamped on every
      successful backup and after a restore — this is what the fiscal-year-roll
      `BACKUP_REQUIRED` guard now checks for real.
- [x] Secrets: passphrase from the request or `BACKUP_PASSPHRASE` env, never stored in
      the DB, redacted in logs. (OS credential store / DPAPI integration is deployment
      packaging, out of scope here.)
- [x] Endpoints: `POST /api/backups`, `GET /api/backups`, `GET /api/backups/status`,
      `DELETE /api/backups/:id` (blocks last copy), `GET /api/backups/:id/download`,
      `POST /api/backups/:id/restore`. Web `BackupPage` status card + list + backup-now +
      guarded restore + delete + download; new "สำรองข้อมูล" nav tab.
- [x] Guarded restore (`restoreBackup`): `confirm: "RESTORE"` phrase, passphrase must
      decrypt (else `BAD_PASSPHRASE`), artifact sha256 must match + dump digest must
      match (else `BACKUP_INTEGRITY_FAILED`), backup schema not newer than the app
      (else `SCHEMA_NEWER_THAN_APP`), a `PRE_RESTORE` auto-backup taken first, the data
      swap (DELETE all in reverse FK order → INSERT all in forward order) in one
      transaction, `_migrations` topped up to the current set, `RESTORE` audit row.
      **Verified (automated, both PGlite + `TEST_PG=1`):** `backup.test.ts` (8) — backup →
      wipe movements/sales/stock_state → restore → stock golden query matches + a fresh
      movement still posts; `last_backup_at` set + overdue flag clears; tampered artifact
      → `BACKUP_INTEGRITY_FAILED`; wrong passphrase → `BAD_PASSPHRASE`; newer schema →
      `SCHEMA_NEWER_THAN_APP`; missing confirm phrase → `VALIDATION_FAILED`; delete last
      verified copy → `LAST_REMAINING_COPY`; HTTP `POST /api/backups` + `GET
      /api/backups/status`.
- [ ] **Deferred (blocked / out of scope):** S3-compatible cloud upload (open Q #15 —
      no provider chosen), Windows Task Scheduler `.xml` + install + missing-task warning
      (open Q #16), `inventory-backup` standalone CLI, full retention rotation, the
      `BACKUP_RECOVERY.md` runbook refresh for the logical-dump format.

## Phase 9 — Production hardening  ◄ HERE NOW
- [ ] `scripts/stress-seed.ts` — 10k products, 100k movements.
- [ ] Load + pagination profiling; add/adjust indexes per findings.
- [ ] Concurrency stress (N parallel sales; no lost updates).
- [ ] Import stress (large files, timeout behavior).
- [ ] Full disaster-recovery drill end to end.
- [ ] Security review: input handling, backup encryption, local auth, `npm audit`.
- [ ] Performance report; fill `PROJECT_SPEC.md` §24 checklist.
- [ ] Produce the §24.1 final verification report.
      **Verify:** §21 scale targets met; §24 Definition of Done fully green.
