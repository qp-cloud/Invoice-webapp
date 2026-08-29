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

## Phase 4 — Dashboard & master stock table ✅ 2026-08-29 (commit __PENDING__)
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

## Phase 5 — Financial reporting  ◄ HERE NOW
- [ ] Weighted-average costing wired into every costed movement; `avg_cost_micro`.
- [ ] `cogs_satang` computed + stored on sale post (round-half-up).
- [ ] Cost-basis reset rule for `qty_on_hand ≤ 0`; `COST_BASIS_RESET` audit.
- [ ] Void-purchase handling via ledger replay.
- [ ] Fiscal-year rollover: `POST /api/fiscal-year/roll` — require all 12 periods CLOSED,
      mandatory backup, advance `current_fiscal_year`, `ROLL_FISCAL_YEAR` audit; no
      ledger data moved (§6.5).
- [ ] Reports: monthly, low-stock, oversold — SQL-aggregated endpoints.
- [ ] Recharts views for the reports.
      **Verify:** §9.3 costing example; round-half-up test; gross-profit math;
      reset-case test; void-purchase replay test; rollover advances labels + sums to the
      new FY without changing any movement row.

## Phase 6 — Excel / CSV
- [ ] `POST /api/imports`: parse (SheetJS) → sanitize (`cleanData`) → validate →
      duplicate-check → build preview; nothing written.
- [ ] File hash + row hash; `import_batches`, `import_rows` tables.
- [ ] Preview payload (§13.5) + UI table with invalid cells highlighted.
- [ ] `POST /api/imports/:batchId/commit` — single transaction, `ALL_OR_NOTHING`
      default, `PARTIAL` opt-in.
- [ ] Invalid-rows `.xlsx` download with `_error` column.
- [ ] Master Stock 68 re-import effect (§13.8).
- [ ] Exports for every kind in §27 of the brief.
      **Verify:** all §22.1 import cases; 10k-row happy path in one transaction;
      forced-failure rollback leaves DB byte-identical; duplicate file + duplicate row
      detected and not re-applied.

## Phase 7 — Offline & sync
- [ ] Dexie schema: read cache, outbound queue (fields per §12.2), UI prefs.
- [ ] Optimistic offline create for purchase/sale/return/adjustment.
- [ ] Sync engine: FIFO, one-at-a-time, idempotency key generated once + reused,
      exponential backoff, conflict isolation.
- [ ] `POST /api/sync` batch endpoint; `GET /api/sync/state`.
- [ ] Conflict panel UI (retry / edit & retry / discard-with-audit).
      **Verify:** queue FIFO test; retry with same key creates nothing; one conflict
      isolates while the rest proceed; state-machine transitions covered.

## Phase 8 — Backup & recovery
- [ ] Backup pipeline (§16.3): `pg_dump` (custom format) → `manifest.json` (app/schema/pg
      versions, per-table row counts, dump sha256) → compress → **encrypt locally**
      (AES-256-GCM / age, backup passphrase) → sha256 of the artifact → verify
      (re-read + test-decrypt + `pg_restore --list`).
- [ ] `inventory-backup` CLI (callable with app UI closed).
- [ ] Windows Task Scheduler task definition (`.xml`) for daily 02:00; app registers it
      or the owner imports it (open Q #16); app startup catch-up check.
- [ ] App detects + warns when the scheduled task is missing / overdue.
- [ ] Retention (14 daily / 8 weekly / 12 monthly) that **never deletes the last copy**.
- [ ] Three-state status model: `LOCAL_BACKUP_SUCCESS` / `CLOUD_UPLOAD_SUCCESS` /
      `CLOUD_UPLOAD_FAILED`; persistent warning until a failed upload succeeds.
- [ ] Optional S3-compatible cloud upload (open Q #15 for provider): PUT encrypted
      artifact → verify (re-download / HEAD + checksum) → retry on failure. Never upload
      plaintext.
- [ ] Secrets stored separately: app PIN hash / backup passphrase / cloud credentials
      (OS credential store / DPAPI), never in the DB, never logged.
- [ ] Endpoints: `POST /api/backups`, `GET /api/backups`, `GET /api/backups/status`,
      `POST /api/backups/:id/upload`, `DELETE /api/backups/:id` (block last copy),
      `GET /api/backups/:id/download`; UI status card (§16.4).
- [ ] Guarded restore: confirmation phrase, requires backup passphrase, pre-restore
      auto-backup, sha256 check before decrypt, forward-migration on restore, audit
      entry; refuse newer-schema backups.
- [ ] `BACKUP_RECOVERY.md` runbook (incl. cloud + Task Scheduler setup) + DR drill
      scripts for every brief-§33 scenario.
      **Verify:** backup → drop/replace DB → restore → golden query matches; tampered
      backup refused on sha256; cross-migration restore succeeds; newer-schema backup
      refused; simulated cloud-upload failure surfaces + retries; retention keeps ≥ 1
      copy; missing Task Scheduler task raises a warning.

## Phase 9 — Production hardening
- [ ] `scripts/stress-seed.ts` — 10k products, 100k movements.
- [ ] Load + pagination profiling; add/adjust indexes per findings.
- [ ] Concurrency stress (N parallel sales; no lost updates).
- [ ] Import stress (large files, timeout behavior).
- [ ] Full disaster-recovery drill end to end.
- [ ] Security review: input handling, backup encryption, local auth, `npm audit`.
- [ ] Performance report; fill `PROJECT_SPEC.md` §24 checklist.
- [ ] Produce the §24.1 final verification report.
      **Verify:** §21 scale targets met; §24 Definition of Done fully green.
