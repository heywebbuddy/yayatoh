import { DomainError, requireOrg } from '@yayatoh/kernel';
import { tenantCommand } from '@yayatoh/platform';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { callerScopeTx } from './access.ts';
import { EVENT_MODES } from './domain/modes.ts';
import { WIDGET_KEYS, WIDGET_META, widgetAllowed } from './domain/widgets.ts';
import { eventModeTx } from './view.ts';
import { layouts, modeOverrides } from './schema.ts';

const Keys = z
  .array(z.enum(WIDGET_KEYS))
  .max(WIDGET_KEYS.length)
  .refine((k) => new Set(k).size === k.length, 'A widget is listed twice');

/**
 * Save the member's arrangement of an event's Command Center (M3.2): the widget order and the
 * widgets they hid. Only widgets the registry allows their role may be listed (a door member can't
 * store the revenue widget); the row is theirs alone (per user, per event).
 */
export const saveLayoutCommand = tenantCommand({
  name: 'commandCenter.saveLayout',
  input: z.object({ eventId: z.uuid(), order: Keys, hidden: Keys }),
  output: z.object({ order: z.array(z.enum(WIDGET_KEYS)), hidden: z.array(z.enum(WIDGET_KEYS)) }),
  entitlement: 'core',
  permission: 'events:read',
  handler: async ({ input, ctx, tx }) => {
    const scope = await callerScopeTx(tx, ctx, input.eventId);
    for (const k of [...input.order, ...input.hidden])
      if (!widgetAllowed(WIDGET_META[k], scope))
        throw new DomainError('forbidden', 'This widget is not available to your role');
    await tx
      .insert(layouts)
      .values({
        orgId: requireOrg(ctx),
        eventId: scope.event.id,
        userId: scope.userId,
        widgetOrder: input.order,
        hiddenWidgets: input.hidden,
      })
      .onConflictDoUpdate({
        target: [layouts.orgId, layouts.eventId, layouts.userId],
        set: { widgetOrder: input.order, hiddenWidgets: input.hidden, updatedAt: ctx.now },
      });
    return { order: input.order, hidden: input.hidden };
  },
  audit: (input) => ({
    action: 'commandCenter.layout.save',
    targetType: 'event',
    targetId: input.eventId,
    data: { order: input.order, hidden: input.hidden },
  }),
});

/** Back to the role's default layout (the member's own row is removed). */
export const resetLayoutCommand = tenantCommand({
  name: 'commandCenter.resetLayout',
  input: z.object({ eventId: z.uuid() }),
  output: z.object({ reset: z.boolean() }),
  entitlement: 'core',
  permission: 'events:read',
  handler: async ({ input, ctx, tx }) => {
    const scope = await callerScopeTx(tx, ctx, input.eventId);
    const rows = await tx
      .delete(layouts)
      .where(and(eq(layouts.eventId, scope.event.id), eq(layouts.userId, scope.userId)))
      .returning({ id: layouts.id });
    return { reset: rows.length > 0 };
  },
  audit: (input) => ({ action: 'commandCenter.layout.reset', targetType: 'event', targetId: input.eventId }),
});

/**
 * Set the event's mode by hand (e.g. doors opened early), or clear it (`mode: null`) to follow
 * the clock again. Owners, admins, managers and the event's managers (`events:write`); audited
 * with the computed mode it overrode.
 */
export const setModeOverrideCommand = tenantCommand({
  name: 'commandCenter.setMode',
  input: z.object({ eventId: z.uuid(), mode: z.enum(EVENT_MODES).nullable() }),
  output: z.object({ mode: z.enum(EVENT_MODES), computed: z.enum(EVENT_MODES), override: z.enum(EVENT_MODES).nullable() }),
  entitlement: 'core',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    const scope = await callerScopeTx(tx, ctx, input.eventId);
    if (!scope.canWrite) throw new DomainError('forbidden', 'Not allowed');
    if (input.mode === null) {
      await tx.delete(modeOverrides).where(eq(modeOverrides.eventId, scope.event.id));
    } else {
      await tx
        .insert(modeOverrides)
        .values({ orgId: requireOrg(ctx), eventId: scope.event.id, mode: input.mode, setBy: scope.userId })
        .onConflictDoUpdate({
          target: [modeOverrides.orgId, modeOverrides.eventId],
          set: { mode: input.mode, setBy: scope.userId, setAt: ctx.now, updatedAt: ctx.now },
        });
    }
    const m = await eventModeTx(tx, ctx, scope.event);
    return { mode: m.mode, computed: m.computed, override: m.override };
  },
  audit: (input, r) => ({
    action: input.mode ? 'commandCenter.mode.override' : 'commandCenter.mode.clear',
    targetType: 'event',
    targetId: input.eventId,
    data: { mode: input.mode, computed: r?.computed ?? null },
  }),
});
