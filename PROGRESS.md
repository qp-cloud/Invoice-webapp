# PROGRESS.md — Implementation Progress

> Governed by `PROJECT_SPEC.md` (source of truth). Update after **every** work session.
> Verification level is exactly one of:
> **Not started · Implemented · Unit tested · Integration tested · E2E tested ·
> Stress tested · Recovery tested**
> "Implemented" alone never means "working" — it means code exists and type-checks.
> Never record a level higher than the tests that were actually executed.

**Last updated:** 2026-08-29 — Spec v0.3 (PGlite for dev/test). **Phase 1 complete and
verified.** Autonomous build of Phases 1–7 in progress; commit per phase.

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
| `cleanData` — SKU | §7.1 | Not started | |
| `cleanData` — numbers / satang / fractional qty | §7.2, §9.1 | Not started | |
| `cleanData` — dates / Excel serial / Thai Buddhist year | §7.3 | Not started | |
| Product master + SKU UNIQUE + UPSERT | §8 | Not started | |
| Units / categories (conversion-ready model) | §8 (brief §8) | Not started | |
| Movement ledger (`movements`, all 9 types) | §5 | Not started | |
| `replayLedger` + golden master | §9.4, §23 | Not started | |
| `stock_state` / `stock_cost_state` caches + reconciliation | §4, §21 | Not started | |
| Stock formulas (full + 68/69) + variance | §5.2–§5.4 | Not started | |
| Rolling fiscal year + rollover action | §5.3, §6.5 | Not started | `settings.current_fiscal_year`, dynamic 68/69 labels |
| Negative-stock modes (ALLOW / PREVENT) | §6.1 | Not started | |
| Stock status badges + oversold / Missing Balance | §6.2 | Not started | |
| Void semantics | §5.6 | Not started | |
| Monthly periods (open / closed / reopen) | §6.4 | Not started | |
| Backdated-transaction warning + reason | §6.3 | Not started | |
| Purchases | §10.1 | Not started | |
| Sales (live stock before confirm) | §10.2, §19.3 | Not started | |
| Customer / supplier returns | §10.3 | Not started | |
| Inventory adjustments (+ reasons) | §10.4 | Not started | |
| Transaction ledger UI (shows the calculation) | §11 | Not started | |
| Audit log | §20 | Not started | |
| Weighted-average costing + COGS (round-half-up) | §9.2, §9.3 | Not started | |
| Owner-entered cost: customer return + positive adjustment | §9.2, §10.3, §10.4 | Not started | prefill return cost from linked sale COGS |
| Cost-basis reset (`qty ≤ 0`) + void-purchase replay | §9.2 | Not started | |
| Estimated gross profit / margin reporting | §9.5 | Not started | |
| Dashboard KPI cards | §18 | Not started | |
| Master stock table (search / filter / sort / paginate) | §19 | Not started | |
| Monthly / low-stock / oversold reports + charts | §21 (brief), Phase 5 | Not started | |
| Excel/CSV import pipeline (parse→sanitize→validate→preview→commit) | §13 | Not started | |
| Import atomicity (all-or-nothing) + partial opt-in | §13.3, §13.4 | Not started | |
| Import idempotency (file hash / row hash) | §15 | Not started | |
| Invalid-row export | §13.6 | Not started | |
| Exports (all report kinds) | §14.3, brief §27 | Not started | |
| Idempotency middleware (`processed_requests`) | §14.1 | Not started | |
| Concurrency safety (per-product lock, no lost updates) | §14.2 | Not started | |
| Offline cache + outbound queue (Dexie) | §12.2 | Not started | |
| Sync engine (FIFO, retry-no-dup, conflict isolation) | §12.2–§12.3 | Not started | |
| Sync conflict UI | §12.3 | Not started | |
| Backup pipeline (dump→manifest→compress→encrypt→hash→verify) | §16.3 | Not started | encrypt locally before any cloud |
| Backup scheduling (Task Scheduler + startup catch-up) | §16.2 | Not started | Windows Task Scheduler primary |
| Backup retention (never delete last copy) | §16.3, §16.6 | Not started | |
| Cloud upload (S3-compatible, verify + retry, 3-state status) | §16.3, §16.4 | Not started | provider TBD (§26.2 #15) |
| Secrets separation (PIN / passphrase / cloud creds) | §16.5 | Not started | OS credential store / DPAPI |
| Restore (guarded / passphrase / pre-restore backup / cross-migration) | §16.7 | Not started | |
| Disaster-recovery runbook + drills | §16, brief §33 | Not started | |
| Database constraints (UNIQUE / CHECK ≥ 0 / FK) | §14, brief §34 | Not started | |
| Performance / scale (10k products, 100k movements) | §21 | Not started | |
| UI/UX (Thai-first, number/date formatting, responsive) | §19.4 | Not started | |
| Stress / corruption / concurrency / recovery hardening | Phase 9 | Not started | |

---

## Test summary

| Suite | Tests | Passed | Failed | Level reached |
| --- | --- | --- | --- | --- |
| Sanitization | 0 | 0 | 0 | Not started |
| Inventory ledger | 0 | 0 | 0 | Not started |
| Import | 0 | 0 | 0 | Not started |
| Financial | 0 | 0 | 0 | Not started |
| Concurrency | 0 | 0 | 0 | Not started |
| Recovery | 0 | 0 | 0 | Not started |
| Offline / sync | 0 | 0 | 0 | Not started |

---

## Known limitations / unverified areas

- Everything. No implementation has begun.
- Offline `PREVENT` overselling is enforceable only at sync time (design constraint,
  `PROJECT_SPEC.md` §6.1, §28.2) — not a defect; must be tested as specified.

---

## Log

| Date | Session summary |
| --- | --- |
| 2026-08-29 | Created `PROJECT_SPEC.md` v0.1, `TASKS.md`, `PROGRESS.md`. Committed stack decisions (Postgres source of truth; integer-satang money; local-first single-owner web app). |
| 2026-08-29 | `PROJECT_SPEC.md` → v0.2. Folded in owner answers to §26 #1,2,3,5,7,9,10,11: rolling fiscal year (§5.3, §6.5), owner-entered return/adjustment cost (§9.2, §10.3, §10.4), round-half-up, single location, local PIN + separate backup passphrase + separate cloud creds (§16.5), THB only, Windows Task Scheduler backup + encrypt-before-cloud + 3-state status + never-delete-last-copy (§16 rewritten). Updated `TASKS.md` (Phases 3/4/5/8) and this file. Open: §26.2 #4,6,8,12–16. |
| 2026-08-29 | First Task design docs written (`DATABASE.md`, `API.md`, `ARCHITECTURE.md`, `IMPORT_FORMAT.md`, `BACKUP_RECOVERY.md`, `TESTING.md`). §26.2 #12 resolved (derived cutoff). |
| 2026-08-29 | Env check: no Docker / no Postgres. Spec → v0.3: dev/test DB = PGlite (embedded PG16). Owner OK'd autonomous build of Phases 1–7. |
| 2026-08-29 | **Phase 1 done** (commit 07c6fdf). Workspaces, PGlite client + Database interface, SQL migrations 0001–0003 + runner, Fastify + pino + error mapper, /api/health, web scaffold, CI. typecheck/lint/test green. Known limitation: true multi-client concurrency (spec §14.2) needs real Postgres. |
