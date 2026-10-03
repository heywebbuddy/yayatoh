import { type TenantTx, withoutTenant, withTenant } from '@yayatoh/db';
import { createCtx, DomainError, requireOrg } from '@yayatoh/kernel';
import { onlineGivingTx } from '@yayatoh/orders';
import { publishRealtimeTx, tenantCommand, tenantQuery } from '@yayatoh/platform';
import { asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { campaignOfEventTx } from './campaigns.ts';
import { paddleEventTx } from './paddles.ts';
import {
  GIVING_SCREEN_CHANNEL,
  SaveScreenInput,
  ScreenSettingsDto,
  type ScreenStateDto,
} from './screen-dto.ts';
import { verifyScreenToken } from './screen-link.ts';
import { publishScreenStateTx, screenRowTx, screenStateTx } from './screen-live.ts';
import { campaigns } from './schema.ts';
import { screens } from './schema-screens.ts';

/**
 * The live giving screen (M4.8d): a thermometer for the room's projectors, opened from a signed
 * link with no sign-in, kept current over its realtime channel. The host chooses the campaign it
 * follows (its QR code opens that campaign's giving page) and whether donors who asked for it are
 * thanked by name; replacing the link stops every screen open on the old one.
 */

/** Set the screen up, or change its campaign or names setting (the link stays the same). */
export const saveScreenCommand = tenantCommand({
  name: 'donations.saveScreen',
  input: SaveScreenInput,
  output: z.object({ version: z.int() }),
  entitlement: 'donations',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    const event = await paddleEventTx(tx, input.eventId);
    const campaign = await campaignOfEventTx(tx, event.id, input.campaignId);
    const [row] = await tx
      .insert(screens)
      .values({
        orgId: requireOrg(ctx),
        eventId: event.id,
        campaignId: campaign.id,
        showNames: input.showNames,
      })
      .onConflictDoUpdate({
        target: [screens.orgId, screens.eventId],
        set: { campaignId: campaign.id, showNames: input.showNames, updatedAt: ctx.now },
      })
      .returning({ version: screens.version });
    if (!row) throw new DomainError('internal');
    await publishScreenStateTx(tx, requireOrg(ctx), event.id);
    return { version: row.version };
  },
  audit: (input) => ({
    action: 'donations.screen.save',
    targetType: 'event',
    targetId: input.eventId,
    data: { campaignId: input.campaignId, showNames: input.showNames },
  }),
});

/** Replace the screen's link: every screen open on an earlier link stops (it shows "link replaced"). */
export const rotateScreenLinkCommand = tenantCommand({
  name: 'donations.rotateScreenLink',
  input: z.object({ eventId: z.uuid() }),
  output: z.object({ version: z.int() }),
  entitlement: 'donations',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    const event = await paddleEventTx(tx, input.eventId);
    const [row] = await tx
      .update(screens)
      .set({ version: sql`${screens.version} + 1`, updatedAt: ctx.now })
      .where(eq(screens.eventId, event.id))
      .returning({ version: screens.version });
    if (!row) throw new DomainError('not_found', 'Set the screen up first', { reason: 'no_screen' });
    await publishRealtimeTx(tx, requireOrg(ctx), GIVING_SCREEN_CHANNEL, {
      eventId: event.id,
      event: 'link',
      data: { version: row.version },
    });
    return { version: row.version };
  },
  audit: (input, r) => ({
    action: 'donations.screen.rotate',
    targetType: 'event',
    targetId: input.eventId,
    data: { version: r?.version ?? null },
  }),
});

/** The host's screen page: the settings, the event's campaigns and what the screen shows now. */
export const screenSettingsQuery = tenantQuery({
  name: 'donations.screenSettings',
  input: z.object({ eventId: z.uuid() }),
  output: ScreenSettingsDto,
  entitlement: 'donations',
  permission: 'orders:read',
  handler: async ({ input, tx }) => {
    const event = await paddleEventTx(tx, input.eventId);
    const row = await screenRowTx(tx, event.id);
    const list = await tx
      .select({ id: campaigns.id, name: campaigns.name, status: campaigns.status })
      .from(campaigns)
      .where(eq(campaigns.eventId, event.id))
      .orderBy(asc(campaigns.position), asc(campaigns.createdAt));
    return {
      screen: row
        ? {
            campaignId: row.campaignId,
            showNames: row.showNames,
            version: row.version,
            updatedAt: row.updatedAt,
          }
        : null,
      campaigns: list,
      eventSlug: event.slug,
      state: await screenStateTx(tx, event.id),
    };
  },
});

/**
 * The org and event a screen link opens, or null: a forged token, a replaced link (its version
 * moved on), no screen, or an org that is not live. The org comes from the signed token;
 * `donations.screen_target` (SECURITY DEFINER) answers the version only.
 */
export async function displayScreen(
  token: string,
  secret: string,
): Promise<{ orgId: string; eventId: string; version: number } | null> {
  const claim = verifyScreenToken(token, secret);
  if (!claim) return null;
  const rows = await withoutTenant((tx) =>
    tx.execute<{ version: number }>(
      sql`select version from donations.screen_target(${claim.orgId}::uuid, ${claim.eventId}::uuid)`,
    ),
  );
  const r = rows[0];
  if (!r || Number(r.version) !== claim.version) return null;
  return claim;
}

export interface PublicScreen {
  readonly eventName: string;
  readonly eventSlug: string;
  readonly campaignId: string;
  /** The campaign takes gifts online now (an enabled connected account, P4-9; campaign open). */
  readonly givingOpen: boolean;
  readonly state: ScreenStateDto;
}

/**
 * What a screen link shows (the org and event come from the verified link, never the request).
 * Read as the system actor `donations.screen`; totals and opted-in names only.
 */
export async function publicScreen(orgId: string, eventId: string): Promise<PublicScreen | null> {
  const ctx = createCtx({ orgId, actor: { type: 'system', name: 'donations.screen' } });
  return withTenant(ctx, async (tx: TenantTx) => {
    const row = await screenRowTx(tx, eventId);
    if (!row) return null;
    const event = await paddleEventTx(tx, eventId).catch(() => null);
    if (!event) return null;
    const [campaign] = await tx
      .select({ status: campaigns.status })
      .from(campaigns)
      .where(eq(campaigns.id, row.campaignId));
    const { connected } = await onlineGivingTx(tx);
    return {
      eventName: event.name,
      eventSlug: event.slug,
      campaignId: row.campaignId,
      givingOpen: connected && campaign?.status === 'open',
      state: await screenStateTx(tx, eventId),
    };
  });
}

/** The screen's snapshot inside the realtime stream's transaction. */
export const screenSnapshotTx = screenStateTx;
