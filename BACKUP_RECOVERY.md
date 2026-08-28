# BACKUP_RECOVERY.md — Backup, Restore, Disaster Recovery

> Subordinate to `PROJECT_SPEC.md` §16 and §33. Platform: Windows (owner's machine).
> Two open items, marked **TBD**: the S3-compatible cloud provider (spec §26.2 #15) and
> whether the app self-registers its Scheduled Task or the owner imports a `.xml`
> (§26.2 #16). Everything else here is settled.

---

## 1. Principles

1. The **movements ledger in PostgreSQL** is the only source of truth; a backup is a
   consistent copy of that database.
2. A backup is useless unless restored — every backup is **verified** immediately, and DR
   is **drilled** (§7).
3. Backups leave the machine **only encrypted** (§3 step 4). The cloud never holds
   plaintext.
4. The system **never deletes the last remaining verified copy** (spec §16.6).
5. Secrets are separated: app PIN, backup passphrase, cloud credentials — three stores
   (§6).

---

## 2. Scheduling

| Path | Mechanism | Runs when |
| --- | --- | --- |
| Primary | **Windows Task Scheduler** task → `inventory-backup` CLI | daily **02:00** local, even with the app UI closed, machine on |
| Catch-up | app startup check in `services/backup` | on every app start, if `now − lastLocalSuccessAt > backup_interval_hours` (default 24) |
| Manual | `POST /api/backups {kind:"MANUAL"}` / "Backup Now" button | on demand |
| Pre-restore | automatic, inside the restore flow | before any restore |

**Task registration (TBD #16):**

- Option A — the app registers the task on first run (one elevation prompt), using a
  bundled template. It writes `%LOCALAPPDATA%\Inventory\backup-task.xml` and calls
  `schtasks /Create /XML ...`.
- Option B — the installer ships `backup-task.xml`; the owner runs a one-line
  `schtasks /Create /TN "InventoryBackup" /XML backup-task.xml` documented here.

Task action (both options): `inventory-backup.exe --kind AUTO --config "%LOCALAPPDATA%\Inventory\config.json"`.

The app probes the task (`schtasks /Query /TN InventoryBackup`) and surfaces
`taskSchedulerRegistered` / `taskSchedulerLastRunAt` on `GET /api/backups/status`. If the
task is missing or hasn't run in > 2 intervals, the UI shows a persistent
**"การสำรองข้อมูลอัตโนมัติไม่ทำงาน"** warning.

---

## 3. Backup pipeline (every run)

Implemented in `services/backup.run()`; the CLI is a thin wrapper.

| # | Step | Detail | Failure → |
| --- | --- | --- | --- |
| 1 | **Snapshot** | `pg_dump -Fc -Z0` → `dump.bin` (custom format, uncompressed; we compress in step 3) | abort, `local_status = LOCAL_BACKUP_FAILED`, alert |
| 2 | **Manifest** | `manifest.json`: `appVersion`, `schemaVersion` (latest migration id), `pgVersion`, per-table `rowCounts`, `createdAt`, `sha256(dump.bin)` | abort |
| 3 | **Compress** | gzip `dump.bin` + `manifest.json` into `bundle.tar.gz` | abort |
| 4 | **Encrypt (local, before anything leaves)** | AES-256-GCM (via `age` or Node `crypto`), key derived from the **backup passphrase** (scrypt). Output `YYYYMMDD-HHmmss.inv.enc`. Plaintext `dump.bin` / `bundle.tar.gz` shredded. | abort |
| 5 | **Hash** | `sha256(*.inv.enc)` → stored in `backups.artifact_sha256` | abort |
| 6 | **Verify** | re-read artifact, check sha256; test-decrypt to a temp dir; `pg_restore --list bundle` parses; row-count sanity vs manifest | `local_status = LOCAL_BACKUP_FAILED`, keep artifact, alert |
| 7 | **Record + retain** | `INSERT backups(... local_status = LOCAL_BACKUP_SUCCESS, verified_at = now())`; run retention (§4) | — |
| 8 | **Cloud (optional)** | if `cloud.enabled`: `PUT` the `.inv.enc` to the bucket; then `HEAD` + compare `ETag`/checksum (or re-`GET` a byte range). `cloud_status = CLOUD_UPLOAD_SUCCESS` or `CLOUD_UPLOAD_FAILED` (recorded, surfaced, retried next run) | never blocks local success |

`audit_log(action = BACKUP, entity = backup, entity_id, new_value = {localStatus, cloudStatus, sizeBytes})`.

Artifact layout on disk (default `%LOCALAPPDATA%\Inventory\backups\`):

```
20260829-020000.inv.enc      # AES-256-GCM(bundle.tar.gz)   ← the only file uploaded
20260829-020000.meta.json    # non-secret: id, sha256, sizes, statuses, versions (for offline listing)
```

---

## 4. Retention

Classes assigned at creation: newest of the day = `DAILY`; first backup of an ISO week
also `WEEKLY`; first of a month also `MONTHLY`.

| Class | Keep |
| --- | --- |
| DAILY | last 14 |
| WEEKLY | last 8 |
| MONTHLY | last 12 |

Retention sweep runs after step 7. A candidate for deletion is skipped if deleting it
would leave **zero** rows with (`local_status = LOCAL_BACKUP_SUCCESS` OR
`cloud_status = CLOUD_UPLOAD_SUCCESS`). Manual `DELETE /api/backups/:id` enforces the same
rule (`409 LAST_REMAINING_COPY`).

Cloud-side lifecycle rules (TBD #15) should mirror this; document the exact bucket policy
once the provider is chosen.

---

## 5. Restore

`POST /api/backups/:id/restore { confirmPhrase, passphrase }` — or the CLI
`inventory-restore --id <id>` for the "app won't start" case.

1. **Guards:** `confirmPhrase` must equal the shown phrase (e.g. `RESTORE <id-short>`);
   `schemaVersion` of the backup must be `≤` the app's latest migration
   (`409 SCHEMA_NEWER_THAN_APP`).
2. **Pre-restore backup:** `services/backup.run({kind: PRE_RESTORE})` — if it fails,
   restore aborts unless `--force`.
3. **Integrity:** `sha256(artifact)` vs `backups.artifact_sha256`
   (`422 BACKUP_INTEGRITY_FAILED`).
4. **Decrypt** with `passphrase` (`401 BAD_PASSPHRASE`) → `bundle.tar.gz` → `dump.bin` +
   `manifest.json`.
5. **Replace:** terminate app DB connections; `DROP SCHEMA public CASCADE; CREATE SCHEMA
   public;`; `pg_restore -d inventory dump.bin`.
6. **Migrate forward** to the app's latest migration.
7. **Audit:** `audit_log(action = RESTORE, new_value = {backupId, fromSchema, toSchema,
   preRestoreBackupId})`.
8. Force re-login; recommend an immediate `MANUAL` backup.

CLI restore path (no app running): reads `config.json` for DB creds + backup dir, prompts
for the passphrase on stdin, performs steps 3–6, prints the audit summary.

---

## 6. Secrets

| Secret | Store | Notes |
| --- | --- | --- |
| App PIN | salted hash in `settings` (`auth_pin_hash`, not returned by `GET /api/settings`) | scrypt; rate-limited unlock |
| Backup passphrase | Windows Credential Manager (DPAPI) via `lib/credentials.ts`, target `Inventory/BackupPassphrase` | set by `PUT /api/backups/config/passphrase`; never logged, never returned; changing it does not re-encrypt old artifacts — warn to keep the old one |
| Cloud credentials | Credential Manager target `Inventory/Cloud` (separate entry) | set by `PUT /api/backups/config/cloud`; `GET` returns only endpoint/region/bucket/enabled/hasCredentials |

A leak of any one store must not expose the others. The `config.json` used by the CLIs
holds **only** non-secret paths + DB DSN; the passphrase is always fetched from DPAPI or
prompted.

---

## 7. Disaster recovery scenarios & drills

Each has an automated drill in `packages/server/test/recovery/` (spec §22.1 Recovery,
§38). "Drill" = a test that actually performs the destruction and recovery against a
throwaway database.

| # | Scenario | Recovery path | Drill assertion |
| --- | --- | --- | --- |
| 1 | **Database corruption** | restore latest verified backup (§5) | golden query + row counts match manifest |
| 2 | **Application crash** | none needed — DB intact; app restarts, runs startup catch-up backup | app boots; `stock_state` reconciles clean |
| 3 | **Computer failure / disk failure** | new machine → install app → `inventory-restore` from cloud (or external-drive) artifact | data equals pre-failure golden snapshot |
| 4 | **Accidental deletion** (e.g. wrong void spree) | voids are reversible in an OPEN period; otherwise restore to a point-in-time backup | targeted rows return; audit shows the void + the restore |
| 5 | **Bad Excel import** | `ALL_OR_NOTHING` means nothing committed; if `PARTIAL` was used, void the batch's movements (linked by `import_batch_id`) or restore | DB unchanged after a failed ALL_OR_NOTHING; batch-void removes exactly the imported movements |
| 6 | **Failed migration** | migrations run in a transaction; a failure rolls back. If a bad migration shipped: restore the pre-upgrade backup, patch, re-run | schema back to prior version; data intact |
| 7 | **Offline sync failure** | queued ops persist in IndexedDB; conflicts go to the sync panel; nothing is lost server-side (idempotency keys prevent dupes) | replayed keys create nothing; conflict item isolated |
| 8 | **Power loss mid-write** | Postgres WAL recovery on restart; in-flight transaction rolled back; `processed_requests` means the client's retry is safe | no half-written movement; `stock_state` reconciles clean |

Full DR drill (run before declaring Phase 8 done): take a backup → snapshot a golden
report → `DROP DATABASE` → restore from the **cloud** copy on a clean data dir → re-run
the golden report → assert byte-identical.

---

## 8. Runbook: "the app won't open"

1. Don't panic; the data is in PostgreSQL, not the app.
2. Check Postgres is running (`services.msc` → `postgresql-x64-16`).
3. If Postgres is fine: reinstall/repair the app; it will reconnect.
4. If the database is gone/corrupt:
   - locate the newest `*.inv.enc` (local `backups\` dir, or download from the bucket),
   - run `inventory-restore --artifact <path>` and enter the backup passphrase,
   - the tool takes a pre-restore backup, restores, migrates, prints a summary,
   - open the app, verify the dashboard against the last figures you remember,
   - take a fresh `MANUAL` backup.
5. If you don't have the passphrase: the encrypted backups cannot be recovered. This is
   by design. Keep the passphrase somewhere offline and separate.
