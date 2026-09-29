import { defineSerializer } from '@yayatoh/contracts';
import type { TenantTx } from '@yayatoh/db';
import { findEventTx } from '@yayatoh/events';
import { type Ctx, DomainError, requireOrg } from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { memberRoleTx, ORG_ROLES, roleCan } from '@yayatoh/tenancy';
import { and, asc, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  ACTIVE_STATES,
  ALERT_CATEGORIES,
  ALERT_STATES,
  type AlertCategory,
  DEFAULT_ROUTING,
  fixPath,
  HISTORY_ACTIONS,
  isRuleKey,
  ROUTING_CHANNELS,
  RULE_KEYS,
  RULES,
  type RuleKey,
  routeFor,
  SEVERITIES,
  THRESHOLDS,
} from './domain/config.ts';
import { alertLifecycle } from './domain/lifecycle.ts';
import { publishAlertTx, savedRoutingTx } from './engine.ts';
import { alertHistory, alerts, memberSettings, routing, salesTargets } from './schema.ts';

/** One alert as the console shows it (allowlist: numbers, states and the fixing page; no people). */
export const AlertDto = z.object({
  id: z.uuid(),
  rule: z.enum(RULE_KEYS),
  category: z.enum(ALERT_CATEGORIES),
  severity: z.enum(SEVERITIES),
  state: z.enum(ALERT_STATES),
  count: z.int(),
  params: z.record(z.string(), z.number()),
  eventId: z.uuid().nullable(),
  eventSlug: z.string().nullable(),
  eventName: z.string().nullable(),
  /** Org-relative console path of the page (bulk action) that fixes it. */
  fixPath: z.string(),
  firstFiredAt: z.date(),
  openedAt: z.date(),
  acknowledgedAt: z.date().nullable(),
  snoozedUntil: z.date().nullable(),
  resolvedAt: z.date().nullable(),
  reopenCount: z.int(),
});
export type AlertDto = z.infer<typeof AlertDto>;
export const alertSerializer = defineSerializer('alerts.alert', AlertDto);

export const AlertHistoryEntryDto = z.object({
  action: z.enum(HISTORY_ACTIONS),
  state: z.enum(ALERT_STATES),
  count: z.int(),
  /** A team member did it (acknowledged, snoozed); otherwise the engine. */
  byPerson: z.boolean(),
  /** The caller did it. */
  byYou: z.boolean(),
  at: z.date(),
});
export type AlertHistoryEntryDto = z.infer<typeof AlertHistoryEntryDto>;

const callerUserId = (ctx: Ctx) => (ctx.actor.type === 'user' ? ctx.actor.userId : null);

/** The rules the caller may see: by their org role (members), or all of them (system callers). */
async function visibleRulesTx(tx: TenantTx, ctx: Ctx): Promise<RuleKey[]> {
  const userId = callerUserId(ctx);
  if (!userId) return [...RULE_KEYS];
  const role = await memberRoleTx(tx, userId);
  if (!role) return [];
  return RULE_KEYS.filter((k) => roleCan(role, RULES[k].permission));
}

async function toDtosTx(tx: TenantTx, rows: (typeof alerts.$inferSelect)[]): Promise<AlertDto[]> {
  const ids = [...new Set(rows.flatMap((r) => (r.eventId ? [r.eventId] : [])))];
  const byId = new Map<string, { slug: string; name: string }>();
  for (const id of ids) {
    const e = await findEventTx(tx, id);
    if (e) byId.set(id, { slug: e.slug, name: e.name });
  }
  return rows.flatMap((r) => {
    if (!isRuleKey(r.rule)) return [];
    const e = r.eventId ? byId.get(r.eventId) : undefined;
    return [
      alertSerializer.serialize({
        id: r.id,
        rule: r.rule,
        category: r.category as AlertCategory,
        severity: r.severity as AlertDto['severity'],
        state: r.state as AlertDto['state'],
        count: r.count,
        // Numbers only (the allowlist): anything else in the column never leaves.
        params: Object.fromEntries(
          Object.entries(r.params ?? {}).filter((e): e is [string, number] => typeof e[1] === 'number'),
        ),
        eventId: r.eventId,
        eventSlug: e?.slug ?? null,
        eventName: e?.name ?? null,
        fixPath: fixPath(r.rule, e?.slug ?? null),
        firstFiredAt: r.firstFiredAt,
        openedAt: r.openedAt,
        acknowledgedAt: r.acknowledgedAt,
        snoozedUntil: r.snoozedUntil,
        resolvedAt: r.resolvedAt,
        reopenCount: r.reopenCount,
      }),
    ];
  });
}

const SEVERITY_ORDER = sql`case ${alerts.severity} when 'critical' then 0 when 'warning' then 1 else 2 end`;

/**
 * The org's alerts (M3.2b): active ones (open, acknowledged, snoozed; most severe first) or
 * resolved ones (newest first), optionally for one event. Each member sees the rules their role
 * may see (a viewer sees no payout alerts; finance sees no seating alerts).
 */
export const listAlertsQuery = tenantQuery({
  name: 'alerts.list',
  input: z.object({
    status: z.enum(['active', 'resolved']).default('active'),
    eventId: z.uuid().nullable().default(null),
    limit: z.int().min(1).max(200).default(100),
  }),
  output: z.array(AlertDto),
  entitlement: 'core',
  permission: 'events:read',
  handler: async ({ input, ctx, tx }) => {
    const rules = await visibleRulesTx(tx, ctx);
    if (rules.length === 0) return [];
    const active = input.status === 'active';
    const rows = await tx
      .select()
      .from(alerts)
      .where(
        and(
          inArray(alerts.rule, rules),
          active ? inArray(alerts.state, [...ACTIVE_STATES]) : eq(alerts.state, 'resolved'),
          ...(input.eventId ? [eq(alerts.eventId, input.eventId)] : []),
        ),
      )
      .orderBy(
        ...(active
          ? [asc(SEVERITY_ORDER), desc(alerts.openedAt)]
          : [desc(alerts.resolvedAt), desc(alerts.id)]),
      )
      .limit(input.limit);
    return toDtosTx(tx, rows);
  },
});

/** Open (not yet acknowledged or snoozed) alerts the caller may see: the console badge. */
export const alertCountQuery = tenantQuery({
  name: 'alerts.count',
  input: z.object({}),
  output: z.object({ open: z.int(), critical: z.int() }),
  entitlement: 'core',
  permission: 'events:read',
  handler: async ({ ctx, tx }) => {
    const rules = await visibleRulesTx(tx, ctx);
    if (rules.length === 0) return { open: 0, critical: 0 };
    const [r] = await tx
      .select({
        open: sql<number>`count(*)::int`,
        critical: sql<number>`count(*) filter (where ${alerts.severity} = 'critical')::int`,
      })
      .from(alerts)
      .where(and(inArray(alerts.rule, rules), eq(alerts.state, 'open')));
    return { open: r?.open ?? 0, critical: r?.critical ?? 0 };
  },
});

/** One alert's history, oldest first (who acknowledged or snoozed it is reduced to "a member"/"you"). */
export const alertHistoryQuery = tenantQuery({
  name: 'alerts.history',
  input: z.object({ alertId: z.uuid() }),
  output: z.array(AlertHistoryEntryDto),
  entitlement: 'core',
  permission: 'events:read',
  handler: async ({ input, ctx, tx }) => {
    await loadVisibleTx(tx, ctx, input.alertId);
    const me = callerUserId(ctx);
    const rows = await tx
      .select()
      .from(alertHistory)
      .where(eq(alertHistory.alertId, input.alertId))
      .orderBy(asc(alertHistory.at), asc(alertHistory.id))
      .limit(500);
    return rows.map((r) => ({
      action: r.action as AlertHistoryEntryDto['action'],
      state: r.state as AlertHistoryEntryDto['state'],
      count: r.count,
      byPerson: r.actorUserId !== null,
      byYou: me !== null && r.actorUserId === me,
      at: r.at,
    }));
  },
});

async function loadVisibleTx(tx: TenantTx, ctx: Ctx, alertId: string) {
  const [row] = await tx.select().from(alerts).where(eq(alerts.id, alertId));
  const rules = await visibleRulesTx(tx, ctx);
  if (!row || !rules.includes(row.rule as RuleKey)) throw new DomainError('not_found', 'Alert not found');
  return row;
}

/**
 * Acknowledge an alert (M3.2b): someone is on it. It stays until the condition clears; if it is
 * still firing after the acknowledgement timeout (60 min, 10 when live-critical) it opens again
 * and is sent again. Viewers and scanners can't (`alerts:manage`).
 */
export const acknowledgeAlertCommand = tenantCommand({
  name: 'alerts.acknowledge',
  input: z.object({ alertId: z.uuid() }),
  output: AlertDto,
  entitlement: 'core',
  permission: 'alerts:manage',
  handler: async ({ input, ctx, tx }) => {
    const row = await loadVisibleTx(tx, ctx, input.alertId);
    alertLifecycle.next(row.state as never, 'acknowledge');
    const [updated] = await tx
      .update(alerts)
      .set({
        state: 'acknowledged',
        acknowledgedAt: ctx.now,
        acknowledgedBy: callerUserId(ctx),
        updatedAt: ctx.now,
      })
      .where(and(eq(alerts.id, row.id), eq(alerts.state, 'open')))
      .returning();
    if (!updated) throw new DomainError('conflict', 'The alert changed meanwhile; reload and try again');
    await tx.insert(alertHistory).values({
      orgId: requireOrg(ctx),
      alertId: updated.id,
      action: 'acknowledged',
      state: updated.state,
      count: updated.count,
      actorUserId: callerUserId(ctx),
      at: ctx.now,
    });
    await publishAlertTx(tx, requireOrg(ctx), updated, ctx.now);
    const [dto] = await toDtosTx(tx, [updated]);
    return dto as AlertDto;
  },
  audit: (input) => ({ action: 'alerts.acknowledge', targetType: 'alert', targetId: input.alertId }),
});

/** Snooze an alert for 1 hour, 4 hours or a day; it comes back then if it still holds. */
export const snoozeAlertCommand = tenantCommand({
  name: 'alerts.snooze',
  input: z.object({
    alertId: z.uuid(),
    minutes: z.coerce
      .number()
      .int()
      .refine((m) => (THRESHOLDS.snoozeMinutes as readonly number[]).includes(m), 'Choose how long'),
  }),
  output: AlertDto,
  entitlement: 'core',
  permission: 'alerts:manage',
  handler: async ({ input, ctx, tx }) => {
    const row = await loadVisibleTx(tx, ctx, input.alertId);
    alertLifecycle.next(row.state as never, 'snooze');
    const until = new Date(ctx.now.getTime() + input.minutes * 60_000);
    const [updated] = await tx
      .update(alerts)
      .set({ state: 'snoozed', snoozedUntil: until, updatedAt: ctx.now })
      .where(and(eq(alerts.id, row.id), inArray(alerts.state, ['open', 'acknowledged'])))
      .returning();
    if (!updated) throw new DomainError('conflict', 'The alert changed meanwhile; reload and try again');
    await tx.insert(alertHistory).values({
      orgId: requireOrg(ctx),
      alertId: updated.id,
      action: 'snoozed',
      state: updated.state,
      count: updated.count,
      actorUserId: callerUserId(ctx),
      at: ctx.now,
    });
    await publishAlertTx(tx, requireOrg(ctx), updated, ctx.now);
    const [dto] = await toDtosTx(tx, [updated]);
    return dto as AlertDto;
  },
  audit: (input) => ({
    action: 'alerts.snooze',
    targetType: 'alert',
    targetId: input.alertId,
    data: { minutes: input.minutes },
  }),
});

const RoutingCell = z.object({
  role: z.enum(ORG_ROLES),
  category: z.enum(ALERT_CATEGORIES),
  channels: z.array(z.enum(ROUTING_CHANNELS)).max(ROUTING_CHANNELS.length),
});
export const RoutingDto = z.array(RoutingCell.extend({ isDefault: z.boolean() }));
export type RoutingDto = z.infer<typeof RoutingDto>;

/** Who hears about which alerts, per role and group (saved over the defaults). */
export const alertRoutingQuery = tenantQuery({
  name: 'alerts.routing',
  input: z.object({}),
  output: RoutingDto,
  entitlement: 'core',
  permission: 'members:read',
  handler: async ({ tx }) => {
    const saved = await savedRoutingTx(tx);
    return ORG_ROLES.flatMap((role) =>
      ALERT_CATEGORIES.map((category) => ({
        role,
        category,
        channels: [...routeFor(saved, role, category)],
        isDefault: !saved.has(`${role}:${category}`),
      })),
    );
  },
});

/** Owners and admins set the routing (members still only hear about alerts their role may see). */
export const setAlertRoutingCommand = tenantCommand({
  name: 'alerts.setRouting',
  input: z.object({
    cells: z
      .array(RoutingCell)
      .min(1)
      .max(ORG_ROLES.length * ALERT_CATEGORIES.length),
  }),
  output: z.object({ saved: z.int() }),
  entitlement: 'core',
  permission: 'members:manage',
  handler: async ({ input, ctx, tx }) => {
    let saved = 0;
    for (const c of input.cells) {
      const channels = [...new Set(c.channels)].sort();
      const same = [...(DEFAULT_ROUTING[c.role]?.[c.category] ?? [])].sort().join(',') === channels.join(',');
      if (same) {
        // Back to the default: no row, so a later change of defaults applies.
        await tx.delete(routing).where(and(eq(routing.role, c.role), eq(routing.category, c.category)));
        continue;
      }
      await tx
        .insert(routing)
        .values({
          orgId: requireOrg(ctx),
          role: c.role,
          category: c.category,
          channels,
          updatedBy: callerUserId(ctx),
        })
        .onConflictDoUpdate({
          target: [routing.orgId, routing.role, routing.category],
          set: { channels, updatedBy: callerUserId(ctx), updatedAt: ctx.now },
        });
      saved += 1;
    }
    return { saved };
  },
  audit: (input, r) => ({
    action: 'alerts.setRouting',
    targetType: 'organization',
    targetId: null,
    data: { cells: input.cells.length, saved: r.saved },
  }),
});

export const Phone = z
  .string()
  .transform((s) => s.replace(/[\s().-]/g, ''))
  .pipe(z.string().regex(/^\+[1-9][0-9]{6,14}$/, 'Use the international format, like +1 555 010 0199'));

/** The caller's own alert settings in this org. */
export const myAlertSettingsQuery = tenantQuery({
  name: 'alerts.mySettings',
  input: z.object({}),
  output: z.object({ smsPhone: z.string().nullable() }),
  entitlement: 'core',
  permission: 'org:read',
  handler: async ({ ctx, tx }) => {
    const userId = callerUserId(ctx);
    if (!userId) return { smsPhone: null };
    const [row] = await tx.select().from(memberSettings).where(eq(memberSettings.userId, userId));
    return { smsPhone: row?.smsPhone ?? null };
  },
});

/** Set (or clear) the number the caller's alert texts go to. Their own setting only. */
export const setMyAlertPhoneCommand = tenantCommand({
  name: 'alerts.setMyPhone',
  input: z.object({ smsPhone: Phone.nullable() }),
  output: z.object({ smsPhone: z.string().nullable() }),
  entitlement: 'core',
  permission: 'org:read',
  handler: async ({ input, ctx, tx }) => {
    const userId = callerUserId(ctx);
    if (!userId) throw new DomainError('forbidden', 'Only members have alert settings');
    await tx
      .insert(memberSettings)
      .values({ orgId: requireOrg(ctx), userId, smsPhone: input.smsPhone })
      .onConflictDoUpdate({
        target: [memberSettings.orgId, memberSettings.userId],
        set: { smsPhone: input.smsPhone, updatedAt: ctx.now },
      });
    return { smsPhone: input.smsPhone };
  },
  // The number itself stays out of the audit log.
  audit: (input) => ({
    action: 'alerts.setMyPhone',
    targetType: 'member',
    targetId: null,
    data: { set: input.smsPhone !== null },
  }),
});

/** An event's ticket target (the sales pace rule), or null. */
export const salesTargetQuery = tenantQuery({
  name: 'alerts.salesTarget',
  input: z.object({ eventId: z.uuid() }),
  output: z.object({ tickets: z.int().nullable() }),
  entitlement: 'core',
  permission: 'orders:read',
  handler: async ({ input, tx }) => {
    const [row] = await tx.select().from(salesTargets).where(eq(salesTargets.eventId, input.eventId));
    return { tickets: row?.tickets ?? null };
  },
});

/** Set or clear an event's ticket target: sales at 70 % or less of its straight line raise an alert. */
export const setSalesTargetCommand = tenantCommand({
  name: 'alerts.setSalesTarget',
  input: z.object({ eventId: z.uuid(), tickets: z.coerce.number().int().min(1).max(10_000_000).nullable() }),
  output: z.object({ tickets: z.int().nullable() }),
  entitlement: 'core',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    if (!(await findEventTx(tx, input.eventId))) throw new DomainError('not_found', 'Event not found');
    if (input.tickets === null) {
      await tx.delete(salesTargets).where(eq(salesTargets.eventId, input.eventId));
      return { tickets: null };
    }
    await tx
      .insert(salesTargets)
      .values({
        orgId: requireOrg(ctx),
        eventId: input.eventId,
        tickets: input.tickets,
        updatedBy: callerUserId(ctx),
      })
      .onConflictDoUpdate({
        target: [salesTargets.orgId, salesTargets.eventId],
        set: { tickets: input.tickets, updatedBy: callerUserId(ctx), updatedAt: ctx.now },
      });
    return { tickets: input.tickets };
  },
  audit: (input) => ({
    action: 'alerts.setSalesTarget',
    targetType: 'event',
    targetId: input.eventId,
    data: { tickets: input.tickets },
  }),
});

/** Is any alert of this rule active for this event? (Tests and the console's empty states.) */
export async function activeAlertTx(tx: TenantTx, rule: RuleKey, eventId: string | null) {
  const [row] = await tx
    .select()
    .from(alerts)
    .where(and(eq(alerts.rule, rule), eq(alerts.scopeKey, eventId ?? 'org'), ne(alerts.state, 'resolved')));
  return row ?? null;
}
