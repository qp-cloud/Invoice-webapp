import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { AppError } from '@inventory/shared';
import { loadConfig } from '../config.js';
import type { Database } from '../db/client.js';

/**
 * Single-owner unlock gate (spec §16.5). Opt-in: with no PIN configured the API is
 * open (local single-user default). A PIN is configured either by `APP_PIN` in the
 * environment or by a hash stored in `settings.app_pin_hash`. On unlock the client
 * gets an httpOnly cookie whose value is an HMAC derived from the PIN hash + a server
 * secret, so nothing session-related is stored server-side and it survives restarts.
 */

const COOKIE = 'inv_session';

function hashPin(pin: string, salt: Buffer): string {
  return `${salt.toString('hex')}:${scryptSync(pin, salt, 32).toString('hex')}`;
}

export function makePinHash(pin: string): string {
  return hashPin(pin, randomBytes(16));
}

function verifyPinHash(pin: string, stored: string): boolean {
  const [saltHex, keyHex] = stored.split(':');
  if (!saltHex || !keyHex) return false;
  const expected = Buffer.from(keyHex, 'hex');
  const actual = scryptSync(pin, Buffer.from(saltHex, 'hex'), 32);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

async function configuredPinHash(db: Database): Promise<string | null> {
  const envPin = loadConfig().APP_PIN;
  if (envPin && envPin.length > 0) return makePinHashDeterministic(envPin);
  const { rows } = await db.query<{ value: string }>(
    `SELECT value FROM settings WHERE key = 'app_pin_hash'`,
  );
  const v = rows[0]?.value;
  return v ? String(v).replace(/^"|"$/g, '') : null;
}

// For an env PIN we need a stable hash across boots -> fixed salt derived from the PIN.
function makePinHashDeterministic(pin: string): string {
  const salt = createHmac('sha256', 'inv-pin-salt').update(pin).digest().subarray(0, 16);
  return hashPin(pin, salt);
}

export async function authRequired(db: Database): Promise<boolean> {
  return (await configuredPinHash(db)) !== null;
}

function sessionSecret(pinHash: string): string {
  const configured = loadConfig().APP_SESSION_SECRET;
  return configured && configured.length >= 16 ? configured : pinHash;
}

function tokenFor(pinHash: string): string {
  return createHmac('sha256', sessionSecret(pinHash)).update('unlocked').digest('hex');
}

export interface AuthCookie {
  name: string;
  value: string;
  options: { httpOnly: true; sameSite: 'lax'; path: '/'; maxAge: number };
}

/** Verify a PIN; on success return the cookie to set. Throws UNAUTHENTICATED on mismatch. */
export async function unlock(db: Database, pin: string): Promise<AuthCookie> {
  const pinHash = await configuredPinHash(db);
  if (!pinHash) throw new AppError('VALIDATION_FAILED', { userMessage: 'ยังไม่ได้ตั้งรหัสผ่าน' });
  if (!verifyPinHash(pin, pinHash)) {
    throw new AppError('UNAUTHENTICATED', { userMessage: 'รหัสผ่านไม่ถูกต้อง' });
  }
  return {
    name: COOKIE,
    value: tokenFor(pinHash),
    options: { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 30 },
  };
}

export async function isUnlocked(db: Database, cookieValue: string | undefined): Promise<boolean> {
  if (!cookieValue) return false;
  const pinHash = await configuredPinHash(db);
  if (!pinHash) return true;
  const expected = tokenFor(pinHash);
  return (
    cookieValue.length === expected.length &&
    timingSafeEqual(Buffer.from(cookieValue), Buffer.from(expected))
  );
}

export const SESSION_COOKIE = COOKIE;

/** Set / change the stored PIN (spec §16.5). */
export async function setPin(db: Database, pin: string): Promise<void> {
  if (pin.length < 4) {
    throw new AppError('VALIDATION_FAILED', { userMessage: 'รหัสผ่านต้องมีอย่างน้อย 4 ตัว' });
  }
  await db.query(
    `INSERT INTO settings (key, value, updated_at) VALUES ('app_pin_hash', $1::jsonb, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [JSON.stringify(makePinHash(pin))],
  );
}
