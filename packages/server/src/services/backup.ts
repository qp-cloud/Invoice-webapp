import { randomUUID, createHash, createCipheriv, createDecipheriv, scryptSync } from 'node:crypto';
import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { gunzipSync, gzipSync } from 'node:zlib';
import { join } from 'node:path';
import { AppError } from '@inventory/shared';
import { loadConfig } from '../config.js';
import type { Database } from '../db/client.js';
import { currentSchemaVersion, listMigrationFiles } from '../db/migrate.js';
import { logger } from '../logger.js';
import { version as appVersion } from '../version.js';
import { writeAudit } from './audit.js';

/** Forward FK order — parents first (used for INSERT on restore; reversed for DELETE). */
const DUMP_TABLES = [
  'settings', 'units', 'categories', 'periods', '_migrations',
  'products', 'import_batches', 'stock_state',
  'purchases', 'sales', 'returns', 'adjustments', 'movements',
  'import_rows', 'processed_requests', 'audit_log',
] as const;

/** jsonb columns — their values must be re-serialized to JSON text on restore, even scalars. */
const JSONB_COLUMNS: Record<string, Set<string>> = {
  settings: new Set(['value']),
  import_rows: new Set(['raw', 'sanitized', 'errors']),
  audit_log: new Set(['old_value', 'new_value']),
};

const MAGIC = Buffer.from('INVBAK01');
const KDF_SALT_LEN = 16;
const IV_LEN = 12;
const TAG_LEN = 16;

type BackupKind = 'AUTO' | 'MANUAL' | 'PRE_RESTORE';

interface Manifest {
  appVersion: string;
  schemaVersion: string | null;
  pgVersion: string;
  createdAt: string;
  kind: BackupKind;
  tableRowCounts: Record<string, number>;
  dumpSha256: string;
}

export interface BackupRow {
  id: string;
  createdAt: string;
  kind: BackupKind;
  sizeBytes: number;
  schemaVersion: string;
  appVersion: string;
  pgVersion: string;
  localStatus: string;
  cloudStatus: string;
  verifiedAt: string | null;
  rowCounts: Record<string, number>;
}

function backupDir(): string {
  return loadConfig().BACKUP_DIR;
}

function resolvePassphrase(provided?: string): string {
  const pass = provided ?? loadConfig().BACKUP_PASSPHRASE;
  if (!pass || pass.length < 8) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: 'ต้องระบุรหัสผ่านสำรองข้อมูล (อย่างน้อย 8 ตัวอักษร)',
    });
  }
  return pass;
}

/**
 * Integrity digest of the dump. `JSON.stringify` of the in-memory dump and of the
 * round-tripped dump are byte-identical (same key order, dates already serialized to
 * ISO strings, bigints already strings), so a plain stringify is a stable canonical form.
 */
function dumpDigest(data: Record<string, unknown[]>): string {
  return createHash('sha256').update(JSON.stringify(data)).digest('hex');
}

async function pgVersion(db: Database): Promise<string> {
  try {
    const { rows } = await db.query<{ version: string }>('SELECT version() AS version');
    return rows[0]?.version.split(',')[0] ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

async function dumpData(db: Database): Promise<{ data: Record<string, unknown[]>; counts: Record<string, number> }> {
  const data: Record<string, unknown[]> = {};
  const counts: Record<string, number> = {};
  for (const table of DUMP_TABLES) {
    // `movements.seq` is GENERATED ALWAYS AS IDENTITY: omit it and dump in seq order so
    // the identity column regenerates in the same order on restore.
    const select = table === 'movements'
      ? `SELECT * FROM movements ORDER BY seq`
      : `SELECT * FROM ${table}`;
    const { rows } = await db.query<Record<string, unknown>>(select);
    if (table === 'movements') for (const r of rows) delete r.seq;
    data[table] = rows;
    counts[table] = rows.length;
  }
  return { data, counts };
}

function encrypt(plain: Buffer, passphrase: string): Buffer {
  const salt = createHash('sha256').update(randomUUID()).digest().subarray(0, KDF_SALT_LEN);
  const key = scryptSync(passphrase, salt, 32);
  const iv = createHash('sha256').update(randomUUID()).digest().subarray(0, IV_LEN);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([MAGIC, salt, iv, tag, enc]);
}

function decrypt(artifact: Buffer, passphrase: string): Buffer {
  if (!artifact.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new AppError('BACKUP_INTEGRITY_FAILED', { userMessage: 'ไฟล์สำรองไม่ถูกต้อง' });
  }
  let o = MAGIC.length;
  const salt = artifact.subarray(o, (o += KDF_SALT_LEN));
  const iv = artifact.subarray(o, (o += IV_LEN));
  const tag = artifact.subarray(o, (o += TAG_LEN));
  const enc = artifact.subarray(o);
  const key = scryptSync(passphrase, salt, 32);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(enc), decipher.final()]);
  } catch {
    throw new AppError('BAD_PASSPHRASE');
  }
}

function shape(r: Record<string, unknown>): BackupRow {
  return {
    id: r.id as string,
    createdAt: r.created_at as string,
    kind: r.kind as BackupKind,
    sizeBytes: Number(r.size_bytes),
    schemaVersion: r.schema_version as string,
    appVersion: r.app_version as string,
    pgVersion: r.pg_version as string,
    localStatus: r.local_status as string,
    cloudStatus: r.cloud_status as string,
    verifiedAt: (r.verified_at as string | null) ?? null,
    rowCounts: (r.row_counts as Record<string, number>) ?? {},
  };
}

/**
 * Create a verified, encrypted local backup (spec §16.3). Logical dump — schema comes
 * from the migration files, data from `SELECT * FROM <table>` — so it is independent of
 * `pg_dump` and works on both PGlite and real PostgreSQL. Pipeline:
 * dump -> manifest (+ sha256 of the canonical data) -> gzip -> AES-256-GCM ->
 * sha256 of the artifact -> write -> verify (re-read, re-hash, decrypt, re-parse).
 */
export async function createBackup(
  db: Database,
  opts: { kind?: BackupKind; passphrase?: string } = {},
): Promise<BackupRow> {
  const kind = opts.kind ?? 'MANUAL';
  const passphrase = resolvePassphrase(opts.passphrase);
  await mkdir(backupDir(), { recursive: true });

  const { data, counts } = await dumpData(db);
  const dumpSha256 = dumpDigest(data);
  const manifest: Manifest = {
    appVersion,
    schemaVersion: await currentSchemaVersion(db),
    pgVersion: await pgVersion(db),
    createdAt: new Date().toISOString(),
    kind,
    tableRowCounts: counts,
    dumpSha256,
  };

  const payload = Buffer.from(JSON.stringify({ manifest, data }), 'utf8');
  const artifact = encrypt(gzipSync(payload), passphrase);
  const artifactSha256 = createHash('sha256').update(artifact).digest('hex');

  const id = randomUUID();
  const path = join(backupDir(), `${id}.invbak`);
  await writeFile(path, artifact);

  // verify: re-read, re-hash, decrypt, re-parse, compare counts
  const readBack = await readFile(path);
  if (createHash('sha256').update(readBack).digest('hex') !== artifactSha256) {
    throw new AppError('BACKUP_INTEGRITY_FAILED', { userMessage: 'ตรวจสอบไฟล์สำรองไม่ผ่าน' });
  }
  const roundTrip = JSON.parse(gunzipSync(decrypt(readBack, passphrase)).toString('utf8')) as {
    manifest: Manifest;
    data: Record<string, unknown[]>;
  };
  if (
    dumpDigest(roundTrip.data) !== dumpSha256 ||
    DUMP_TABLES.some((t) => (roundTrip.data[t]?.length ?? -1) !== counts[t])
  ) {
    throw new AppError('BACKUP_INTEGRITY_FAILED', { userMessage: 'ตรวจสอบไฟล์สำรองไม่ผ่าน' });
  }

  const inserted = await db.transaction(async (tx) => {
    const res = await tx.query<Record<string, unknown>>(
      `INSERT INTO backups
         (id, kind, artifact_path, artifact_sha256, dump_sha256, size_bytes,
          app_version, schema_version, pg_version, row_counts, local_status, verified_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'LOCAL_BACKUP_SUCCESS', now())
       RETURNING *`,
      [
        id, kind, path, artifactSha256, dumpSha256, artifact.length,
        manifest.appVersion, manifest.schemaVersion ?? 'unknown', manifest.pgVersion,
        JSON.stringify(counts),
      ],
    );
    await tx.query(
      `INSERT INTO settings (key, value, updated_at) VALUES ('last_backup_at', $1::jsonb, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [JSON.stringify(manifest.createdAt)],
    );
    await writeAudit(tx, {
      action: 'BACKUP', entity: 'backup', entityId: id,
      newValue: { kind, sizeBytes: artifact.length, tables: counts },
    });
    return res.rows[0]!;
  });

  logger.info({ id, kind, bytes: artifact.length }, 'backup created + verified');
  return shape(inserted);
}

export async function listBackups(db: Database): Promise<BackupRow[]> {
  const { rows } = await db.query<Record<string, unknown>>(
    `SELECT * FROM backups ORDER BY created_at DESC`,
  );
  return rows.map(shape);
}

export async function backupStatus(db: Database): Promise<{
  lastBackupAt: string | null;
  verifiedCount: number;
  latest: BackupRow | null;
}> {
  const all = await listBackups(db);
  const verified = all.filter((b) => b.localStatus === 'LOCAL_BACKUP_SUCCESS');
  const setting = await db.query<{ value: string }>(
    `SELECT value FROM settings WHERE key = 'last_backup_at'`,
  );
  return {
    lastBackupAt: setting.rows[0] ? String(setting.rows[0].value).replace(/^"|"$/g, '') : null,
    verifiedCount: verified.length,
    latest: all[0] ?? null,
  };
}

export async function readBackupArtifact(db: Database, id: string): Promise<{ path: string; bytes: Buffer }> {
  const { rows } = await db.query<{ artifact_path: string }>(
    `SELECT artifact_path FROM backups WHERE id = $1`, [id],
  );
  if (!rows[0]) throw new AppError('NOT_FOUND', { userMessage: 'ไม่พบไฟล์สำรอง' });
  return { path: rows[0].artifact_path, bytes: await readFile(rows[0].artifact_path) };
}

/** Delete a backup, refusing to remove the only remaining verified copy (spec §16.6). */
export async function deleteBackup(db: Database, id: string): Promise<void> {
  const { rows } = await db.query<{ artifact_path: string; local_status: string }>(
    `SELECT artifact_path, local_status FROM backups WHERE id = $1`, [id],
  );
  if (!rows[0]) throw new AppError('NOT_FOUND', { userMessage: 'ไม่พบไฟล์สำรอง' });

  const verified = await db.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM backups WHERE local_status = 'LOCAL_BACKUP_SUCCESS'`,
  );
  if (rows[0].local_status === 'LOCAL_BACKUP_SUCCESS' && Number(verified.rows[0]!.n) <= 1) {
    throw new AppError('LAST_REMAINING_COPY');
  }
  await db.query(`DELETE FROM backups WHERE id = $1`, [id]);
  try {
    await unlink(rows[0].artifact_path);
  } catch {
    /* file already gone */
  }
}

export interface RestoreResult {
  restoredFrom: string;
  preRestoreBackupId: string;
  tableRowCounts: Record<string, number>;
}

/**
 * Guarded restore (spec §16.7): confirmation phrase, passphrase must decrypt, artifact
 * sha256 must match, the backup's schema must not be newer than the app, and a
 * pre-restore auto-backup is taken first. The data swap runs in one transaction.
 */
export async function restoreBackup(
  db: Database,
  id: string,
  opts: { passphrase?: string; confirm: string },
): Promise<RestoreResult> {
  if (opts.confirm !== 'RESTORE') {
    throw new AppError('VALIDATION_FAILED', { userMessage: 'ต้องพิมพ์ RESTORE เพื่อยืนยัน' });
  }
  const passphrase = resolvePassphrase(opts.passphrase);

  const meta = await db.query<{ artifact_path: string; artifact_sha256: string; schema_version: string }>(
    `SELECT artifact_path, artifact_sha256, schema_version FROM backups WHERE id = $1`, [id],
  );
  if (!meta.rows[0]) throw new AppError('NOT_FOUND', { userMessage: 'ไม่พบไฟล์สำรอง' });

  const artifact = await readFile(meta.rows[0].artifact_path);
  if (createHash('sha256').update(artifact).digest('hex') !== meta.rows[0].artifact_sha256) {
    throw new AppError('BACKUP_INTEGRITY_FAILED');
  }
  const parsed = JSON.parse(gunzipSync(decrypt(artifact, passphrase)).toString('utf8')) as {
    manifest: Manifest;
    data: Record<string, unknown[]>;
  };
  if (dumpDigest(parsed.data) !== parsed.manifest.dumpSha256) {
    throw new AppError('BACKUP_INTEGRITY_FAILED');
  }

  const currentMigrations = (await listMigrationFiles()).map((f) => f.replace(/\.sql$/, ''));
  const latest = currentMigrations[currentMigrations.length - 1] ?? '';
  const backupSchema = meta.rows[0].schema_version || (parsed.manifest.schemaVersion ?? '');
  if (backupSchema > latest) {
    throw new AppError('SCHEMA_NEWER_THAN_APP', { details: { backupSchema, appSchema: latest } });
  }

  const preRestore = await createBackup(db, { kind: 'PRE_RESTORE', passphrase });

  await db.transaction(async (tx) => {
    for (const table of [...DUMP_TABLES].reverse()) {
      await tx.query(`DELETE FROM ${table}`);
    }
    for (const table of DUMP_TABLES) {
      const rows = parsed.data[table] ?? [];
      const jsonbCols = JSONB_COLUMNS[table];
      for (const row of rows) {
        const cols = Object.keys(row as Record<string, unknown>);
        if (cols.length === 0) continue;
        const placeholders = cols.map((_, i) => `$${i + 1}`).join(',');
        const values = cols.map((c) => {
          const v = (row as Record<string, unknown>)[c];
          if (v === null || v === undefined) return null;
          if (jsonbCols?.has(c)) return JSON.stringify(v);
          return typeof v === 'object' ? JSON.stringify(v) : v;
        });
        await tx.query(
          `INSERT INTO ${table} (${cols.map((c) => `"${c}"`).join(',')}) VALUES (${placeholders})`,
          values,
        );
      }
    }
    // ensure the schema-version ledger reflects the current app after a cross-migration restore
    for (const mig of currentMigrations) {
      await tx.query(`INSERT INTO _migrations (id) VALUES ($1) ON CONFLICT (id) DO NOTHING`, [mig]);
    }
    // the pre-restore auto-backup is a fresh verified copy — reflect it as the last backup
    await tx.query(
      `INSERT INTO settings (key, value, updated_at) VALUES ('last_backup_at', $1::jsonb, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [JSON.stringify(preRestore.createdAt)],
    );
    await writeAudit(tx, {
      action: 'RESTORE', entity: 'backup', entityId: id,
      oldValue: { preRestoreBackupId: preRestore.id },
      newValue: { schemaVersion: parsed.manifest.schemaVersion, tables: parsed.manifest.tableRowCounts },
    });
  });

  logger.warn({ id, preRestore: preRestore.id }, 'database restored from backup');
  return {
    restoredFrom: id,
    preRestoreBackupId: preRestore.id,
    tableRowCounts: parsed.manifest.tableRowCounts,
  };
}

/** Startup catch-up check (spec §16.2): is the last backup older than the interval? */
export async function backupOverdue(db: Database, maxAgeHours = 24): Promise<boolean> {
  const s = await backupStatus(db);
  if (!s.lastBackupAt) return true;
  return Date.now() - Date.parse(s.lastBackupAt) > maxAgeHours * 3_600_000;
}

// Referenced for a future scheduled-backup worker; keeps `readdir` import meaningful.
export async function listArtifactFiles(): Promise<string[]> {
  try {
    return (await readdir(backupDir())).filter((f) => f.endsWith('.invbak'));
  } catch {
    return [];
  }
}
