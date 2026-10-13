import { normalizeEmail } from '@yayatoh/crm';
import { type TenantTx, withoutTenant, withTenant } from '@yayatoh/db';
import { type CommandPorts, createCtx, DomainError, executeCommand, requireOrg } from '@yayatoh/kernel';
import { tenantCommand } from '@yayatoh/platform';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { APNS_TOKEN_RE } from './providers/apns.ts';
import { MAX_PUSH_DEVICES } from './push.ts';
import { isValidTimeZone } from './quiet-hours.ts';
import { pushTokens } from './schema.ts';

/**
 * Native app devices (M7.2c). A phone belongs to a person, identified by their verified email, and
 * is stored once per org where that person has a sold order or an active ticket (the same keying
 * as a guest buyer's browser, `registerOrderPushCommand`): `email_norm` set, `user_id` null,
 * `source = 'app'`. An org where they have nothing never holds the phone, so it can never push
 * to it. Buying from a new org later copies the phone there (`followAppDevicesTx`); signing out
 * deletes it everywhere (`removeAppDevice`).
 */
export const APP_PUSH_PLATFORMS = ['fcm', 'apns'] as const;

const AppId = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{2,154}$/);
const Locale = z
  .string()
  .trim()
  .regex(/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})?$/);
/** The platform's own token shapes: APNs tokens are hex, FCM registration tokens are url-safe text. */
const FCM_TOKEN_RE = /^[A-Za-z0-9_:.-]{20,4096}$/;

export const AppDeviceInput = z
  .object({
    platform: z.enum(APP_PUSH_PLATFORMS),
    token: z.string().trim().min(8).max(4096),
    appId: AppId,
    appVersion: z
      .string()
      .trim()
      .regex(/^[0-9A-Za-z][0-9A-Za-z.+_-]{0,39}$/),
    locale: Locale,
    timeZone: z.string().trim().max(64).optional(),
    /** APNs: which environment issued the token (a development build's token is `sandbox`). */
    environment: z.enum(['sandbox', 'production']).optional(),
  })
  .refine((v) => (v.platform === 'apns' ? APNS_TOKEN_RE.test(v.token) : FCM_TOKEN_RE.test(v.token)), {
    message: 'Invalid device token',
    path: ['token'],
  });
export type AppDeviceInput = z.infer<typeof AppDeviceInput>;

/** `PUSH_APP_IDS` (comma-separated), when set, lists the only app ids a device may register with. */
export function allowedAppIds(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string[] | null {
  const ids = (env.PUSH_APP_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return ids.length ? ids : null;
}

const columnsOf = (d: AppDeviceInput) => ({
  appId: d.appId,
  appVersion: d.appVersion,
  locale: d.locale,
  timeZone: d.timeZone && isValidTimeZone(d.timeZone) ? d.timeZone : null,
  environment: d.platform === 'apns' ? (d.environment ?? 'production') : null,
});

/**
 * Store (or refresh) one phone for a person in the current org. Registering again re-enables a
 * token the provider had reported gone. A person has at most `MAX_PUSH_DEVICES` phones per org: a
 * new one beyond that replaces the least recently seen (reinstalls leave stale tokens behind).
 * A row owned by an org member's account (`user_id`) is never taken over.
 */
export async function upsertAppDeviceTx(
  tx: TenantTx,
  orgId: string,
  emailNorm: string,
  device: AppDeviceInput,
  now: Date,
): Promise<{ id: string } | null> {
  const [existing] = await tx
    .select({ id: pushTokens.id, userId: pushTokens.userId })
    .from(pushTokens)
    .where(and(eq(pushTokens.platform, device.platform), eq(pushTokens.token, device.token)));
  if (existing?.userId) return null;
  if (!existing) {
    const mine = await tx
      .select({ id: pushTokens.id })
      .from(pushTokens)
      .where(
        and(eq(pushTokens.emailNorm, emailNorm), eq(pushTokens.source, 'app'), isNull(pushTokens.disabledAt)),
      )
      .orderBy(asc(pushTokens.lastSeenAt), asc(pushTokens.id));
    const surplus = mine.length - (MAX_PUSH_DEVICES - 1);
    if (surplus > 0)
      await tx.delete(pushTokens).where(
        inArray(
          pushTokens.id,
          mine.slice(0, surplus).map((r) => r.id),
        ),
      );
  }
  const cols = columnsOf(device);
  const [row] = await tx
    .insert(pushTokens)
    .values({
      orgId,
      userId: null,
      emailNorm,
      platform: device.platform,
      token: device.token,
      source: 'app',
      ...cols,
    })
    .onConflictDoUpdate({
      target: [pushTokens.orgId, pushTokens.platform, pushTokens.token],
      set: { emailNorm, ...cols, source: 'app', lastSeenAt: now, disabledAt: null, updatedAt: now },
      setWhere: sql`${pushTokens.userId} is null`,
    })
    .returning({ id: pushTokens.id });
  return row ?? null;
}

/**
 * One org's part of a registration: the command pipeline (freeze, audit) around the upsert. The
 * email is the signed-in person's verified address (the caller's job); it is never audited.
 */
export const registerAppDeviceCommand = tenantCommand({
  name: 'notifications.registerAppDevice',
  input: z.object({ email: z.email().max(320), device: AppDeviceInput }),
  output: z.object({ stored: z.boolean() }),
  entitlement: null,
  permission: 'public:app-device',
  handler: async ({ input, ctx, tx }) => {
    const row = await upsertAppDeviceTx(
      tx,
      requireOrg(ctx),
      normalizeEmail(input.email),
      input.device,
      ctx.now,
    );
    return { stored: Boolean(row), deviceId: row?.id ?? null };
  },
  present: (r) => ({ stored: r.stored }),
  audit: (input, r) => ({
    action: 'notifications.register_app_device',
    targetType: 'push_token',
    targetId: r.deviceId,
    data: { platform: input.device.platform },
  }),
});

/** The orgs where this address has a sold order or an active ticket (SECURITY DEFINER lookup). */
export async function orgsWithAppAccess(emailNorm: string): Promise<string[]> {
  const rows = await withoutTenant((tx) =>
    tx.execute<{ org_id: string }>(sql`select org_id from notifications.app_orgs_by_email(${emailNorm})`),
  );
  return [...new Set([...rows].map((r) => r.org_id))];
}

export interface RegisterAppDeviceResult {
  /** In how many orgs the phone is now stored. */
  readonly orgs: number;
}

/**
 * `POST /v1/me/devices`: store the phone in every org where the signed-in person has an order or
 * a ticket, and remove it from anyone else it was registered to (the phone changed hands). An
 * optional `afterOrg` runs in each org's transaction after the phone is stored (the orders module
 * queues the person's reminders there). Nothing is stored for a person with no order or ticket.
 */
export async function registerAppDevice(args: {
  readonly email: string;
  readonly device: AppDeviceInput;
  readonly ports: CommandPorts<TenantTx>;
  readonly now?: Date;
  readonly afterOrg?: (tx: TenantTx, orgId: string, emailNorm: string) => Promise<void>;
}): Promise<RegisterAppDeviceResult> {
  const device = AppDeviceInput.parse(args.device);
  const allowed = allowedAppIds();
  if (allowed && !allowed.includes(device.appId))
    throw new DomainError('validation_failed', 'Unknown app', { field: 'appId' });
  const emailNorm = normalizeEmail(args.email);
  await releaseAppDevice(device.platform, device.token, emailNorm);
  let orgs = 0;
  for (const orgId of await orgsWithAppAccess(emailNorm)) {
    const ctx = createCtx({
      orgId,
      actor: { type: 'system', name: 'notifications.app-devices' },
      ...(args.now ? { now: args.now } : {}),
    });
    // An org that refuses writes (suspended, a read-only freeze) just doesn't hold the phone yet.
    const r = await executeCommand(
      registerAppDeviceCommand,
      { email: emailNorm, device },
      ctx,
      args.ports,
    ).catch((err: unknown) => {
      if (err instanceof DomainError) return { stored: false };
      throw err;
    });
    if (r.stored) orgs += 1;
    if (r.stored && args.afterOrg)
      await withTenant(ctx, (tx) =>
        (args.afterOrg as NonNullable<typeof args.afterOrg>)(tx, orgId, emailNorm),
      );
  }
  return { orgs };
}

/** The phone changed hands: other people's app rows for this token go, in every org. */
export async function releaseAppDevice(
  platform: AppDeviceInput['platform'],
  token: string,
  emailNorm: string,
): Promise<number> {
  const rows = await withoutTenant((tx) =>
    tx.execute<{ n: number }>(
      sql`select notifications.app_device_release(${platform}, ${token}, ${emailNorm}) as n`,
    ),
  );
  return rows[0]?.n ?? 0;
}

/** `DELETE /v1/me/devices/{token}` (sign-out): this person's rows for the token, in every org. */
export async function removeAppDevice(email: string, token: string): Promise<number> {
  const rows = await withoutTenant((tx) =>
    tx.execute<{ n: number }>(
      sql`select notifications.app_device_remove(${normalizeEmail(email)}, ${token}) as n`,
    ),
  );
  return rows[0]?.n ?? 0;
}

/** Account deletion or "sign out everywhere": all of this person's app devices, in every org. */
export async function purgeAppDevices(email: string): Promise<number> {
  const rows = await withoutTenant((tx) =>
    tx.execute<{ n: number }>(sql`select notifications.app_devices_purge(${normalizeEmail(email)}) as n`),
  );
  return rows[0]?.n ?? 0;
}

/**
 * The person bought from (or was given a ticket in) this org: copy their phones here, so the new
 * org can reach them. Runs in that org's transaction (an order or ticket subscriber). A phone this
 * org already has keeps its state (a token this org's provider reported gone stays disabled until
 * the app registers again).
 */
export async function followAppDevicesTx(
  tx: TenantTx,
  orgId: string,
  email: string,
  now: Date,
): Promise<number> {
  const emailNorm = normalizeEmail(email);
  const devices = await tx.execute<{
    platform: 'fcm' | 'apns';
    token: string;
    app_id: string | null;
    app_version: string | null;
    locale: string | null;
    time_zone: string | null;
    environment: string | null;
  }>(sql`select * from notifications.app_devices_by_email(${emailNorm})`);
  let n = 0;
  for (const d of devices) {
    const inserted = await tx
      .insert(pushTokens)
      .values({
        orgId,
        userId: null,
        emailNorm,
        platform: d.platform,
        token: d.token,
        source: 'app',
        appId: d.app_id,
        appVersion: d.app_version,
        locale: d.locale,
        timeZone: d.time_zone,
        environment: d.environment,
        lastSeenAt: now,
      })
      .onConflictDoNothing()
      .returning({ id: pushTokens.id });
    n += inserted.length;
  }
  return n;
}

/** The person's active app devices in the current org (platform and token only; for the orders module). */
export async function hasAppDeviceTx(tx: TenantTx, email: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: pushTokens.id })
    .from(pushTokens)
    .where(
      and(
        eq(pushTokens.emailNorm, normalizeEmail(email)),
        eq(pushTokens.source, 'app'),
        isNull(pushTokens.disabledAt),
      ),
    )
    .limit(1);
  return Boolean(row);
}
