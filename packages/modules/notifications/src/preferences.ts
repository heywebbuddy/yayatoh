import type { TenantTx } from '@yayatoh/db';
import { type Ctx, DomainError, requireOrg } from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { type Category, defaultPreference, MEMBER_CATEGORIES, type PreferenceChannel } from './kinds.ts';
import { PREFERENCE_CHANNELS, preferences } from './schema.ts';

export function requireUser(ctx: Ctx): string {
  if (ctx.actor.type !== 'user') throw new DomainError('forbidden', 'A signed-in user is required');
  return ctx.actor.userId;
}

/** Whether this user wants this category on this channel (their row, else the default). */
export async function preferenceEnabledTx(
  tx: TenantTx,
  userId: string,
  category: Category,
  channel: PreferenceChannel,
): Promise<boolean> {
  if (category === 'transactional') return true;
  const [row] = await tx
    .select({ enabled: preferences.enabled })
    .from(preferences)
    .where(
      and(
        eq(preferences.userId, userId),
        eq(preferences.category, category),
        eq(preferences.channel, channel),
      ),
    );
  return row?.enabled ?? defaultPreference(category, channel);
}

export const PreferenceDto = z.object({
  category: z.enum(MEMBER_CATEGORIES),
  channel: z.enum(PREFERENCE_CHANNELS),
  enabled: z.boolean(),
  isDefault: z.boolean(),
});
export type PreferenceDto = z.infer<typeof PreferenceDto>;

/** The signed-in member's grid: every member category × channel, with defaults filled in. */
export const myPreferencesQuery = tenantQuery({
  name: 'notifications.myPreferences',
  input: z.object({}),
  output: z.array(PreferenceDto),
  entitlement: 'core',
  permission: 'org:read',
  handler: async ({ ctx, tx }) => {
    const userId = requireUser(ctx);
    const rows = await tx
      .select({ category: preferences.category, channel: preferences.channel, enabled: preferences.enabled })
      .from(preferences)
      .where(eq(preferences.userId, userId));
    const saved = new Map(rows.map((r) => [`${r.category}:${r.channel}`, r.enabled]));
    return MEMBER_CATEGORIES.flatMap((category) =>
      PREFERENCE_CHANNELS.map((channel) => {
        const s = saved.get(`${category}:${channel}`);
        return {
          category,
          channel,
          enabled: s ?? defaultPreference(category, channel),
          isDefault: s === undefined,
        };
      }),
    );
  },
});

/**
 * Save the signed-in member's whole grid (the preferences form posts every toggle). Only the
 * member's own rows; nobody can change someone else's preferences.
 */
export const setMyPreferencesCommand = tenantCommand({
  name: 'notifications.setMyPreferences',
  input: z.object({
    preferences: z
      .array(
        z.object({
          category: z.enum(MEMBER_CATEGORIES),
          channel: z.enum(PREFERENCE_CHANNELS),
          enabled: z.boolean(),
        }),
      )
      .min(1)
      .max(MEMBER_CATEGORIES.length * PREFERENCE_CHANNELS.length),
  }),
  output: z.object({ saved: z.int() }),
  entitlement: 'core',
  permission: 'org:read',
  handler: async ({ input, ctx, tx }) => {
    const orgId = requireOrg(ctx);
    const userId = requireUser(ctx);
    for (const p of input.preferences)
      await tx
        .insert(preferences)
        .values({ orgId, userId, category: p.category, channel: p.channel, enabled: p.enabled })
        .onConflictDoUpdate({
          target: [preferences.orgId, preferences.userId, preferences.category, preferences.channel],
          set: { enabled: p.enabled, updatedAt: ctx.now },
        });
    return { saved: input.preferences.length };
  },
  audit: (input) => ({
    action: 'notifications.set_preferences',
    targetType: 'notification_preferences',
    targetId: null,
    data: { off: input.preferences.filter((p) => !p.enabled).map((p) => `${p.category}:${p.channel}`) },
  }),
});
