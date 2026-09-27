import type { TenantTx } from '@yayatoh/db';
import { requireOrg } from '@yayatoh/kernel';
import { tenantCommand } from '@yayatoh/platform';
import { z } from 'zod';
import { requireUser } from './preferences.ts';
import { PUSH_PLATFORMS, pushTokens } from './schema.ts';

const Token = z.string().trim().min(8).max(4096);

/** A signed-in user registers this device (app: FCM/APNs; browser: a web push subscription). */
export const registerPushTokenCommand = tenantCommand({
  name: 'notifications.registerPushToken',
  input: z.object({ platform: z.enum(PUSH_PLATFORMS), token: Token }),
  output: z.object({ registered: z.boolean() }),
  entitlement: 'core',
  permission: 'org:read',
  handler: async ({ input, ctx, tx }) => {
    const orgId = requireOrg(ctx);
    const userId = requireUser(ctx);
    await tx
      .insert(pushTokens)
      .values({
        orgId,
        userId,
        platform: input.platform,
        token: input.token,
        source: input.platform === 'webpush' ? 'web' : 'app',
      })
      .onConflictDoUpdate({
        target: [pushTokens.orgId, pushTokens.platform, pushTokens.token],
        set: { userId, lastSeenAt: ctx.now, disabledAt: null, updatedAt: ctx.now },
      });
    return { registered: true };
  },
  audit: (input) => ({
    action: 'notifications.register_push_token',
    targetType: 'push_token',
    targetId: null,
    data: { platform: input.platform },
  }),
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
