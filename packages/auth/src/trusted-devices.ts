import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { identityDatabase } from '@yayatoh/db/identity';
import { uuidv7 } from '@yayatoh/kernel';
import { and, desc, eq, gt, isNull } from 'drizzle-orm';
import { normalizeHandoffHost } from './handoff.ts';
import { securityEvents, trustedDevices } from './schema.ts';

/**
 * Trusted devices (M1.2f). After the second sign-in step a person may tick "Trust this device for
 * 30 days": the browser gets a host-only cookie `<id>.<secret>` (256 random bits; only the
 * SHA-256 of the secret is stored), and later sign-ins on that browser and host skip the second
 * step. Trust is fixed at 30 days from when it was given (using it does not extend it). Revoked
 * by the person (account security), by a password change or reset, and by account deletion.
 */
export const TRUSTED_DEVICE_TTL_MS = 30 * 24 * 60 * 60_000;

/** The cookie name: `__Host-` on HTTPS (Secure, Path=/, no Domain), like the session cookie. */
export const trustedDeviceCookie = (https: boolean) => (https ? '__Host-yy.trusted' : 'yy.trusted');

export type TrustedDeviceRevocation = 'revoked' | 'password_changed' | 'account_deleted';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SECRET = /^[A-Za-z0-9_-]{43}$/;

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** The cookie's two parts, or null if it isn't one of ours. */
export function parseTrustedDeviceCookie(
  value: string | null | undefined,
): { id: string; secret: string } | null {
  if (!value || value.length > 100) return null;
  const dot = value.indexOf('.');
  if (dot < 0) return null;
  const id = value.slice(0, dot);
  const secret = value.slice(dot + 1);
  return UUID.test(id) && SECRET.test(secret) ? { id, secret } : null;
}

/**
 * A short, human label for a device from its user agent ("Chrome on macOS"). Only this label is
 * kept, never the raw header.
 */
export function deviceLabel(userAgent: string | null | undefined): string {
  const ua = userAgent ?? '';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\//.test(ua)
      ? 'Opera'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Chrome\//.test(ua) || /HeadlessChrome\//.test(ua)
          ? 'Chrome'
          : /Safari\//.test(ua)
            ? 'Safari'
            : null;
  const os = /iPhone|iPad|iPod/.test(ua)
    ? 'iOS'
    : /Android/.test(ua)
      ? 'Android'
      : /Mac OS X|Macintosh/.test(ua)
        ? 'macOS'
        : /Windows/.test(ua)
          ? 'Windows'
          : /CrOS/.test(ua)
            ? 'ChromeOS'
            : /Linux/.test(ua)
              ? 'Linux'
              : null;
  if (browser && os) return `${browser} on ${os}`;
  return browser ?? os ?? 'Unknown device';
}

async function audit(userId: string, action: string, data: Record<string, unknown>, now: Date) {
  await identityDatabase()
    .insert(securityEvents)
    .values({ id: uuidv7(), userId, action, data, createdAt: now });
}

/** Trust this browser (after a passed second step). Returns the cookie value and its expiry. */
export async function trustDevice(input: {
  userId: string;
  host: string;
  userAgent?: string | null;
  now?: Date;
}): Promise<{ id: string; cookie: string; expiresAt: Date }> {
  const host = normalizeHandoffHost(input.host);
  if (!host) throw new Error('trustDevice: invalid host');
  const now = input.now ?? new Date();
  const id = uuidv7();
  const secret = randomBytes(32).toString('base64url');
  const expiresAt = new Date(now.getTime() + TRUSTED_DEVICE_TTL_MS);
  const label = deviceLabel(input.userAgent);
  await identityDatabase()
    .insert(trustedDevices)
    .values({ id, userId: input.userId, secretHash: sha256(secret), host, label, createdAt: now, expiresAt });
  await audit(input.userId, 'trusted_device.added', { id, label, host }, now);
  return { id, cookie: `${id}.${secret}`, expiresAt };
}

/**
 * Whether this browser's cookie trusts it for this person on this host: the right secret, not
 * revoked, not expired. A match is recorded (last used, audited). Constant-time comparison.
 */
export async function isTrustedDevice(input: {
  cookie: string | null | undefined;
  userId: string;
  host: string;
  now?: Date;
}): Promise<boolean> {
  const parsed = parseTrustedDeviceCookie(input.cookie);
  const host = normalizeHandoffHost(input.host);
  if (!parsed || !host) return false;
  const now = input.now ?? new Date();
  const db = identityDatabase();
  const [row] = await db
    .select()
    .from(trustedDevices)
    .where(
      and(
        eq(trustedDevices.id, parsed.id),
        eq(trustedDevices.userId, input.userId),
        isNull(trustedDevices.revokedAt),
        gt(trustedDevices.expiresAt, now),
      ),
    );
  if (!row || row.host !== host) return false;
  const a = Buffer.from(sha256(parsed.secret));
  const b = Buffer.from(row.secretHash);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  await db.update(trustedDevices).set({ lastUsedAt: now }).where(eq(trustedDevices.id, row.id));
  await audit(input.userId, 'trusted_device.used', { id: row.id, host }, now);
  return true;
}

export interface TrustedDeviceItem {
  readonly id: string;
  readonly label: string;
  readonly host: string;
  readonly createdAt: Date;
  readonly lastUsedAt: Date | null;
  readonly expiresAt: Date;
}

/** The person's live trusted devices (newest first). */
export async function listTrustedDevices(
  userId: string,
  now: Date = new Date(),
): Promise<TrustedDeviceItem[]> {
  return identityDatabase()
    .select({
      id: trustedDevices.id,
      label: trustedDevices.label,
      host: trustedDevices.host,
      createdAt: trustedDevices.createdAt,
      lastUsedAt: trustedDevices.lastUsedAt,
      expiresAt: trustedDevices.expiresAt,
    })
    .from(trustedDevices)
    .where(
      and(
        eq(trustedDevices.userId, userId),
        isNull(trustedDevices.revokedAt),
        gt(trustedDevices.expiresAt, now),
      ),
    )
    .orderBy(desc(trustedDevices.createdAt));
}

/** Revoke one of the person's own devices (another person's id does nothing). */
export async function revokeTrustedDevice(
  userId: string,
  id: string,
  now: Date = new Date(),
): Promise<boolean> {
  if (!UUID.test(id)) return false;
  const rows = await identityDatabase()
    .update(trustedDevices)
    .set({ revokedAt: now, revokedReason: 'revoked' })
    .where(
      and(eq(trustedDevices.id, id), eq(trustedDevices.userId, userId), isNull(trustedDevices.revokedAt)),
    )
    .returning({ id: trustedDevices.id });
  if (rows.length === 0) return false;
  await audit(userId, 'trusted_device.revoked', { id }, now);
  return true;
}

/** Revoke all of the person's trusted devices (a password change, "revoke all"). */
export async function revokeAllTrustedDevices(
  userId: string,
  reason: TrustedDeviceRevocation,
  now: Date = new Date(),
): Promise<number> {
  const rows = await identityDatabase()
    .update(trustedDevices)
    .set({ revokedAt: now, revokedReason: reason })
    .where(and(eq(trustedDevices.userId, userId), isNull(trustedDevices.revokedAt)))
    .returning({ id: trustedDevices.id });
  if (rows.length > 0)
    await audit(userId, 'trusted_devices.revoked_all', { reason, count: rows.length }, now);
  return rows.length;
}
