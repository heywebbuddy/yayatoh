import { createHash } from 'node:crypto';
import { normalizeEmail } from '@yayatoh/crm';
import type { TenantTx } from '@yayatoh/db';
import { DomainError, requireOrg } from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { and, count, desc, eq, isNull, or, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { requireUser } from './preferences.ts';
import { isValidTimeZone } from './quiet-hours.ts';
import { PUSH_PLATFORMS, pushTokens } from './schema.ts';
import { FAKE_PUSH_PATH, isAllowedPushEndpoint, normalizeSubscriptionKeys } from './web-push.ts';

const Token = z.string().trim().min(8).max(4096);

/** At most this many active devices per person and org (a browser re-subscribing reuses its row). */
export const MAX_PUSH_DEVICES = 10;

/** A device label as the person sees it in their list ("Chrome on Android"): plain, short text. */
export const DeviceLabel = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[^<>\p{Cc}]+$/u);

/** Web push subscription as the browser gives it (`PushSubscription.toJSON()`), plus a label. */
export const WebPushDeviceInput = z.object({
  endpoint: z.url().max(2048),
  keys: z.object({ p256dh: z.string().max(100), auth: z.string().max(40) }),
  label: DeviceLabel.optional(),
  /** The browser's IANA timezone: quiet hours for push follow the device. */
  timeZone: z.string().max(64).optional(),
});
export type WebPushDeviceInput = z.infer<typeof WebPushDeviceInput>;

/** Dev/CI (dev auth, never production): the fake push service's endpoints may be registered. */
export function fakePushAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.YAYATOH_DEV_AUTH === '1' && env.VERCEL_ENV !== 'production';
}

function isRegistrableEndpoint(endpoint: string): boolean {
  if (isAllowedPushEndpoint(endpoint)) return true;
  if (!fakePushAllowed()) return false;
  try {
    const u = new URL(endpoint);
    return isAllowedPushEndpoint(endpoint, { fakeOrigin: u.origin }) && u.pathname.startsWith(FAKE_PUSH_PATH);
  } catch {
    return false;
  }
}

/** A short, stable reference to an endpoint: lets a browser find "this device" in its list. */
export function endpointRef(endpoint: string): string {
  return createHash('sha256').update(endpoint).digest('base64url').slice(0, 22);
}

export type PushOwner = { readonly userId: string } | { readonly email: string };

function ownerWhere(owner: PushOwner): SQL {
  return 'userId' in owner
    ? eq(pushTokens.userId, owner.userId)
    : eq(pushTokens.emailNorm, normalizeEmail(owner.email));
}

/**
 * Store (or refresh) a web push subscription for a member or a guest buyer. The endpoint must be
 * a known push service; the keys must decode to a P-256 point and a 16-byte secret. The same
 * browser subscribing again reuses its row (and moves to the latest owner).
 */
export async function upsertWebPushTx(
  tx: TenantTx,
  orgId: string,
  owner: PushOwner,
  device: WebPushDeviceInput,
  now: Date,
): Promise<{ id: string }> {
  if (!isRegistrableEndpoint(device.endpoint))
    throw new DomainError('validation_failed', 'Unsupported push service', { reason: 'endpoint' });
  const keys = normalizeSubscriptionKeys(device.keys);
  if (!keys) throw new DomainError('validation_failed', 'Invalid subscription keys', { reason: 'keys' });
  const [existing] = await tx
    .select({ id: pushTokens.id })
    .from(pushTokens)
    .where(and(eq(pushTokens.platform, 'webpush'), eq(pushTokens.token, device.endpoint)));
  if (!existing) {
    const [n] = await tx
      .select({ n: count() })
      .from(pushTokens)
      .where(and(ownerWhere(owner), isNull(pushTokens.disabledAt)));
    if ((n?.n ?? 0) >= MAX_PUSH_DEVICES)
      throw new DomainError('invalid_state', 'Too many devices', { reason: 'too_many_devices' });
  }
  const ownerCols =
    'userId' in owner
      ? { userId: owner.userId, emailNorm: null }
      : { userId: null, emailNorm: normalizeEmail(owner.email) };
  const timeZone = device.timeZone && isValidTimeZone(device.timeZone) ? device.timeZone : null;
  const [row] = await tx
    .insert(pushTokens)
    .values({
      orgId,
      ...ownerCols,
      platform: 'webpush',
      token: device.endpoint,
      p256dh: keys.p256dh,
      authSecret: keys.auth,
      label: device.label ?? null,
      timeZone,
      source: 'web',
    })
    .onConflictDoUpdate({
      target: [pushTokens.orgId, pushTokens.platform, pushTokens.token],
      set: {
        ...ownerCols,
        p256dh: keys.p256dh,
        authSecret: keys.auth,
        label: device.label ?? null,
        timeZone,
        lastSeenAt: now,
        disabledAt: null,
        updatedAt: now,
      },
    })
    .returning({ id: pushTokens.id });
  if (!row) throw new DomainError('internal');
  return row;
}

/** Remove one of the owner's devices, by id (the device list) or endpoint (this browser). */
export async function removePushDeviceTx(
  tx: TenantTx,
  owner: PushOwner,
  which: { readonly deviceId?: string; readonly endpoint?: string },
): Promise<string | null> {
  const target = which.deviceId
    ? eq(pushTokens.id, which.deviceId)
    : which.endpoint
      ? and(eq(pushTokens.platform, 'webpush'), eq(pushTokens.token, which.endpoint))
      : undefined;
  if (!target) return null;
  const [row] = await tx
    .delete(pushTokens)
    .where(and(target, ownerWhere(owner)))
    .returning({ id: pushTokens.id });
  return row?.id ?? null;
}

export const PushDeviceDto = z.object({
  id: z.uuid(),
  platform: z.enum(PUSH_PLATFORMS),
  label: z.string().nullable(),
  /** Matches `endpointRef` of this browser's subscription (web push only). */
  ref: z.string().nullable(),
  since: z.date(),
  lastSeenAt: z.date(),
});
export type PushDeviceDto = z.infer<typeof PushDeviceDto>;

/** The owner's active devices, newest first (allowlisted: never the endpoint or keys). */
export async function pushDevicesTx(tx: TenantTx, owner: PushOwner): Promise<PushDeviceDto[]> {
  const rows = await tx
    .select()
    .from(pushTokens)
    .where(and(ownerWhere(owner), isNull(pushTokens.disabledAt)))
    .orderBy(desc(pushTokens.createdAt), desc(pushTokens.id))
    .limit(MAX_PUSH_DEVICES * 2);
  return rows.map((r) =>
    PushDeviceDto.parse({
      id: r.id,
      platform: r.platform,
      label: r.label,
      ref: r.platform === 'webpush' ? endpointRef(r.token) : null,
      since: r.createdAt,
      lastSeenAt: r.lastSeenAt,
    }),
  );
}

/** Whether the recipient has at least one active device (members by user, buyers by email). */
export async function hasPushDeviceTx(
  tx: TenantTx,
  to: { readonly userId?: string | null; readonly email?: string | null },
): Promise<boolean> {
  const owners = [
    ...(to.userId ? [eq(pushTokens.userId, to.userId)] : []),
    ...(to.email ? [eq(pushTokens.emailNorm, normalizeEmail(to.email))] : []),
  ];
  if (owners.length === 0) return false;
  const [row] = await tx
    .select({ id: pushTokens.id })
    .from(pushTokens)
    .where(and(or(...owners), isNull(pushTokens.disabledAt)))
    .limit(1);
  return Boolean(row);
}

const RegisterInput = z.discriminatedUnion('platform', [
  z.object({ platform: z.enum(['fcm', 'apns']), token: Token }),
  z.object({ platform: z.literal('webpush'), subscription: WebPushDeviceInput }),
]);

/**
 * A signed-in member registers this device (app: FCM/APNs token; browser: a web push
 * subscription with its keys, M1.10e). Guest buyers register from their order page through
 * `registerOrderPushCommand` (orders), which stores through the same `upsertWebPushTx`.
 */
export const registerPushTokenCommand = tenantCommand({
  name: 'notifications.registerPushToken',
  input: RegisterInput,
  output: z.object({ registered: z.boolean(), deviceId: z.uuid() }),
  entitlement: 'core',
  permission: 'org:read',
  handler: async ({ input, ctx, tx }) => {
    const orgId = requireOrg(ctx);
    const userId = requireUser(ctx);
    if (input.platform === 'webpush') {
      const { id } = await upsertWebPushTx(tx, orgId, { userId }, input.subscription, ctx.now);
      return { registered: true, deviceId: id };
    }
    const [row] = await tx
      .insert(pushTokens)
      .values({ orgId, userId, platform: input.platform, token: input.token, source: 'app' })
      .onConflictDoUpdate({
        target: [pushTokens.orgId, pushTokens.platform, pushTokens.token],
        set: { userId, emailNorm: null, lastSeenAt: ctx.now, disabledAt: null, updatedAt: ctx.now },
      })
      .returning({ id: pushTokens.id });
    if (!row) throw new DomainError('internal');
    return { registered: true, deviceId: row.id };
  },
  audit: (input, r) => ({
    action: 'notifications.register_push_token',
    targetType: 'push_token',
    targetId: r.deviceId,
    data: { platform: input.platform },
  }),
});

export const RemoveDeviceInput = z
  .object({ deviceId: z.uuid().optional(), endpoint: z.url().max(2048).optional() })
  .refine((v) => Boolean(v.deviceId) !== Boolean(v.endpoint), { message: 'deviceId or endpoint' });

/** A member removes one of their own devices (the list, or "turn off on this device"). */
export const removePushTokenCommand = tenantCommand({
  name: 'notifications.removePushToken',
  input: RemoveDeviceInput,
  output: z.object({ removed: z.boolean() }),
  entitlement: 'core',
  permission: 'org:read',
  handler: async ({ input, ctx, tx }) => {
    const id = await removePushDeviceTx(tx, { userId: requireUser(ctx) }, input);
    if (!id && input.deviceId) throw new DomainError('not_found', 'No such device');
    return { removed: Boolean(id), deviceId: id };
  },
  present: (r) => ({ removed: r.removed }),
  audit: (_input, r) => ({
    action: 'notifications.remove_push_token',
    targetType: 'push_token',
    targetId: r.deviceId,
    data: {},
  }),
});

/** The signed-in member's devices in this org. */
export const myPushDevicesQuery = tenantQuery({
  name: 'notifications.myPushDevices',
  input: z.object({}),
  output: z.array(PushDeviceDto),
  entitlement: 'core',
  permission: 'org:read',
  handler: async ({ ctx, tx }) => pushDevicesTx(tx, { userId: requireUser(ctx) }),
});

export interface LegacyDeviceRow {
  readonly userId: string;
  /** Legacy `fcm_token` (Android and iOS FCM registrations). */
  readonly fcmToken?: string | null;
  /** Legacy `apn_token`: an APNs device token the legacy app wrongly sent through FCM. */
  readonly apnToken?: string | null;
}

/**
 * Migration (roadmap M1.10: "FCM v1 and APNs with migrated tokens"): legacy device rows become
 * push tokens on the platform they really belong to, so an APNs token goes to APNs. Idempotent.
 */
export async function importLegacyPushTokensTx(
  tx: TenantTx,
  orgId: string,
  rows: readonly LegacyDeviceRow[],
): Promise<number> {
  const values = rows.flatMap((r) => [
    ...(r.fcmToken ? [{ platform: 'fcm' as const, token: r.fcmToken.trim(), userId: r.userId }] : []),
    ...(r.apnToken ? [{ platform: 'apns' as const, token: r.apnToken.trim(), userId: r.userId }] : []),
  ]);
  let n = 0;
  for (const v of values) {
    if (!Token.safeParse(v.token).success) continue;
    const inserted = await tx
      .insert(pushTokens)
      .values({ orgId, ...v, source: 'legacy' })
      .onConflictDoNothing()
      .returning({ id: pushTokens.id });
    n += inserted.length;
  }
  return n;
}
