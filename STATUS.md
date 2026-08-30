# STATUS — as of 2026-08-30

Single-owner inventory + tax-invoice system for มีชัยอะไหล่ หนองคาย (Thai auto-parts B2B,
buys Bangkok, sells to Lao garages across the border). Local-first, single process.

> Governance: `PROJECT_SPEC.md` is the spec, `PROGRESS.md` the verification ledger,
> `TASKS.md` the phase list, `DEPLOY.md` how to run it. This file is the one-glance
> snapshot.

---

## Stack

- **Monorepo** — npm workspaces: `@inventory/shared` (money/cleanData/domain/zod),
  `@inventory/server` (Fastify + hand-written SQL migrations), `@inventory/web`
  (React 18 + Vite 5 + Tailwind 3, single-page).
- **DB** — PGlite (embedded Postgres 16, a file directory) by default; a real
  PostgreSQL via `DATABASE_URL` (node-postgres adapter, `db/pg.ts`). Tests run on
  PGlite by default, on a real embedded Postgres 17 with `TEST_PG=1`.
- **Money** — integer satang (`BIGINT`), `decimal.js`, round-half-up everywhere.
- **One process** serves the API and the built web UI (`WEB_DIST_DIR`).

## Tests — all green

| suite | count | notes |
| --- | --- | --- |
| shared | 105 | cleanData / money / vat / domain / replayLedger |
| server | 81 (+2 skipped) | 83 under `TEST_PG=1` (adds the scale/concurrency stress suite) |
| web | 5 | render smoke + offline sync engine |

`npm test` (PGlite) · `npm run test:pg` (real Postgres) · lint + typecheck clean ·
`vite build` clean.

## Migrations

```
0001_init            17 tables — products, movements ledger, purchases/sales/returns/
                     adjustments, periods, stock_state cache, processed_requests, imports, backups
0002_seed            settings + 12 units
0003_periods_fy2569  12 monthly periods (2026), all OPEN
0004_tax_invoices    contacts, invoices + invoice_items, doc_counters, company profile,
                     movements.source_kind += INVOICE, products += vat_applicable/prices
```

Runner applies any new `NNNN_*.sql` on boot, in one transaction, idempotent.

---

## What's built

### Inventory core (Phases 1–9)
- **Ledger** — `movements` is the source of truth; `stock_state` is a derived cache
  updated in the same transaction. Void = mark VOIDED + replay. 9 movement types.
- **Costing** — weighted average at micro-THB; COGS booked on every outflow;
  cost-basis reset when a costed inflow lands while qty < 0.
- **Docs** — single-line purchases / sales / returns / adjustments + openings, all
  idempotent (`Idempotency-Key` header, `runIdempotent` = work + `processed_requests`
  in one tx; parallel same-key serialised by a per-key advisory lock).
- **Periods** — OPEN / CLOSED / reopen; writes into a closed period rejected.
- **Backdate** — warning; reason required past a threshold.
- **Negative stock** — ALLOW (default, flags oversold + missingBalance) / PREVENT (422).
- **Fiscal year** — rolling 68/69 labels from `settings.current_fiscal_year`;
  `POST /api/fiscal-year/roll` guarded (all periods closed + backup taken). Stock 68 is
  a derived ledger cutoff, no snapshot table.
- **Dashboard** — `GET /api/dashboard`, all figures SQL-aggregated.
- **Master table** — search / status+category filter / low+oversold toggle / sortable /
  server pagination / per-row 68-69 view.
- **Reports** — monthly / low-stock / oversold, SQL-aggregated, CSV export.
- **Import** — Excel/CSV pipeline: parse → cleanData sanitize → validate → file+row
  sha256 dedup → preview → one-transaction commit (ALL_OR_NOTHING default, PARTIAL
  opt-in). Recognises real Thai MASTER_STOCK headers (รหัสสินค้า / ชื่อสินค้า /
  หน่วยนับ / ราคา / ยอดคงเหลือ); unknown unit labels fall back to `piece` with a
  warning; `ราคา` sets the opening cost.
- **Exports** — `/api/exports/:kind.xlsx` for 9 kinds.
- **Offline** — Dexie outbound queue; `TransactionDrawer` enqueues when offline;
  `POST /api/sync` batch flush (FIFO, typed 4xx → CONFLICT + continue); `SyncPage`.
- **Backup / restore** — logical dump (schema from migration files + `SELECT *`), gzip,
  AES-256-GCM (scrypt), sha256, verify. Guarded restore (confirm phrase, passphrase,
  integrity, refuse newer schema, pre-restore auto-backup, one-tx swap). Never deletes
  the last verified copy. `BackupPage`.
- **Reconcile** — `POST /api/reconcile` replays every ledger vs `stock_state`, reports
  drift, optional auto-heal.
- **Auth** — opt-in PIN gate. `APP_PIN` unset = open; set = every `/api` route except
  health + `/api/auth/*` needs an unlock cookie. `UnlockScreen`.

### Tax-invoice / VAT module (`0004`)
- **contacts** — SUPPLIER / CUSTOMER / BOTH, 13-digit เลขประจำตัวผู้เสียภาษี, branch.
- **invoices + invoice_items** — multi-line BUY / SELL documents. DRAFT (editable) →
  CONFIRMED (number assigned, one `movement` per line, totals + contact snapshot
  frozen, COGS summed for SELL) → VOID (movements reversed, stock recomputed, number
  kept).
- **Numbering** — gapless `BUY-YYYY-NNNN` / `SELL-YYYY-NNNN` per type per year, counter
  bumped under a row lock inside the confirm transaction; a rolled-back confirm reclaims
  the number.
- **VAT** — per-line `vat_rate` 7 or 0. 7% standard; 0% for zero-rated export to Laos
  (subtotal counts, VAT does not). All money recomputed server-side at confirm.
- **VAT reports** — `GET /api/vat-reports/{purchase,sales}?ym=` — ภ.พ.30-style rows
  (date, number, name, tax id, branch, value, VAT) + totals. CSV via
  `/api/exports/vat-{purchase,sales}.xlsx`.
- **Print** — `InvoicePrint` full-screen ใบกำกับภาษี: seller from the company profile,
  buyer from the invoice snapshot, TH/EN labels, ต้นฉบับ / สำเนา switch, browser print
  (Save-as-PDF), `@media print` hides the chrome.
- **Web** — nav tabs **ใบกำกับภาษี** (list + multi-line editor), **ผู้ติดต่อ**,
  **รายงานภาษี** (+ collapsible company-profile editor).
- **Company profile** — `company_name / _en / _tax_id / _branch / _address / _phone` in
  `settings`, editable via `PATCH /api/settings` or the รายงานภาษี tab.

---

## Running it

### Local (dev-style)
```bash
npm ci && npm run build
cp .env.example .env       # already have a .env: PIN 285332, a backup passphrase
./run.sh
```
→ http://localhost:4000 · PIN **285332** (in `.env`; unset `APP_PIN` there to disable
the gate).

### Always-on service (WSL has systemd)
`deploy/inventory.service` — see `DEPLOY.md` §2. `sudo systemctl enable --now inventory`
+ a Task Scheduler at-logon task to boot WSL.

### Docker
`Dockerfile` + `docker-compose.yml` — `docker compose up -d --build`. Volumes
`inventory-data` (/data) + `inventory-backups` (/backups). Secrets from `.env` at
runtime, not baked in.

### LAN access
`.wslconfig` written for mirrored networking; `HOST=0.0.0.0` in `.env`; add a Windows
Firewall rule for the port. Other PCs → `http://<this-PC-LAN-IP>:4000` (was
`192.168.1.177`). Full steps in `DEPLOY.md`.

---

## Data directories (gitignored)

| dir | what |
| --- | --- |
| `packages/server/data/` | has the **281 real products** imported from the supplier CSV |
| `data/` (repo root) | a second, near-empty cluster from a `run.sh` run — ignore/delete |
| `packages/server/backups/` , `packages/server/pglite-data/` | runtime, ignored |

`PGLITE_DATA_DIR` in `.env` chooses which. To test with the 281 products, point it at
`packages/server/data`; migration `0004` applies on the next boot.

**Secrets** (local only, `.env` gitignored): PIN `285332`, backup passphrase
`F4lPw1PuWhvnCMAVNYT84umCAEI3lf` (also `scratchpad/secrets.txt`). Change both before real
use; a passphrase change invalidates existing backups — take a fresh one after.

---

## Open / not done

- **Company profile must be filled** before printing real invoices (tax id, address) —
  รายงานภาษี tab → "ตั้งค่าข้อมูลบริษัท".
- No amount-in-Thai-words on the printed invoice (บาทถ้วน) — add if the accountant wants it.
- VAT report lists CONFIRMED only; VOID invoices are excluded from the figures.
- Phase 8 gaps: **cloud backup** (open Q #15, no provider) and **Windows Task Scheduler
  auto-backup** (open Q #16) — local encrypted backups work, off-machine copy is manual.
- No real full-scale (10k/100k) load profiling; index set is complete but unprofiled.
- `xlsx@0.18.5` carries a prototype-pollution advisory (no registry fix) — server-side
  parsing of owner files only. `vitest`/`vite`/`esbuild` dev-only advisories.
- All UI is typechecked + `vite build`-clean + API-proven but **not clicked through in a
  real browser** in this environment.
- `BACKUP_RECOVERY.md` still describes the original `pg_dump` design; the implementation
  is a logical dump.

---

## Recent commits

```
0ad8285 docs: tax-invoice / VAT module in PROGRESS.md
4cafbaf feat(invoices): web UI — contacts, editor, print, VAT report
770688a feat(invoices): buy/sell tax-invoice + VAT module (server)
ec547c7 deploy: Dockerfile + docker-compose
9a24bb6 deploy: systemd unit + always-on service docs
516305c deploy: single-process serve, opt-in PIN gate, build/run scripts + DEPLOY.md
202e11e import: accept real-world Thai MASTER_STOCK headers
862302f Phase 9 (partial) — reconciliation, seed + stress, audit triage
4de76c8 Phase 8 — local backup + guarded restore (logical dump)
ca00c1a test-infra: real PostgreSQL via embedded-postgres; fix idempotency race
1da676d..07c6fdf  Phases 7 → 1
```
