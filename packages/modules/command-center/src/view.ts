import type { TenantTx } from '@yayatoh/db';
import { EventDto, listEventsQuery, listOccurrencesQuery } from '@yayatoh/events';
import type { Ctx } from '@yayatoh/kernel';
import { tenantQuery } from '@yayatoh/platform';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { callerScopeTx, orgScopeTx, profileOf } from './access.ts';
import {
  computeEventMode,
  EVENT_MODES,
  type EventMode,
  isEventMode,
  type ModeResult,
} from './domain/modes.ts';
import { readinessScore } from './domain/readiness.ts';
import { CC_ROLES } from './domain/roles.ts';
import { resolveLayout, WIDGET_KEYS, WIDGET_META, WIDGET_SIZES, widgetAllowed } from './domain/widgets.ts';
import { readinessRulesTx } from './readiness.ts';
import { layouts, modeOverrides } from './schema.ts';

const iso = z.iso.datetime({ offset: true });

export const ModeDto = z.object({
  /** The mode in force: the override when one is set, else the computed one. */
  mode: z.enum(EVENT_MODES),
  computed: z.enum(EVENT_MODES),
  override: z.enum(EVENT_MODES).nullable(),
  occurrenceId: z.uuid().nullable(),
  startsAt: iso,
  endsAt: iso,
  preShowAt: iso,
  liveAt: iso,
  liveEndsAt: iso,
  wrapEndsAt: iso,
  nextChangeAt: iso.nullable(),
  nextMode: z.enum(EVENT_MODES).nullable(),
  settled: z.boolean(),
});
export type ModeDto = z.infer<typeof ModeDto>;

function modeDto(r: ModeResult, override: EventMode | null): ModeDto {
  const w = r.window;
  return {
    mode: override ?? r.mode,
    computed: r.mode,
    override,
    occurrenceId: w.occurrenceId,
    startsAt: w.startsAt.toISOString(),
    endsAt: w.endsAt.toISOString(),
    preShowAt: w.preShowAt.toISOString(),
    liveAt: w.liveAt.toISOString(),
    liveEndsAt: w.liveEndsAt.toISOString(),
    wrapEndsAt: w.wrapEndsAt.toISOString(),
    nextChangeAt: r.nextChangeAt?.toISOString() ?? null,
    nextMode: r.nextMode,
    settled: r.settled,
  };
}

async function overrideTx(tx: TenantTx, eventId: string): Promise<EventMode | null> {
  const [row] = await tx
    .select({ mode: modeOverrides.mode })
    .from(modeOverrides)
    .where(eq(modeOverrides.eventId, eventId));
  return row && isEventMode(row.mode) ? row.mode : null;
}

/** The event's mode now (the event's IANA zone, its current date), with any manual override. */
export async function eventModeTx(tx: TenantTx, ctx: Ctx, event: EventDto): Promise<ModeDto> {
  const occurrences = await listOccurrencesQuery.handler({ input: { eventId: event.id }, ctx, tx });
  const computed = computeEventMode({
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    timeZone: event.timezone,
    occurrences,
    now: ctx.now,
  });
  return modeDto(computed, await overrideTx(tx, event.id));
}

export const LayoutSlotDto = z.object({
  key: z.enum(WIDGET_KEYS),
  size: z.enum(WIDGET_SIZES),
  hidden: z.boolean(),
});

export const EventViewDto = z.object({
  eventId: z.uuid(),
  role: z.enum(CC_ROLES),
  timeZone: z.string(),
  mode: ModeDto,
  layout: z.array(LayoutSlotDto),
  /** The member saved their own arrangement (else the role's default for the mode). */
  customized: z.boolean(),
  /** May set or clear the manual mode (owner and staff who can edit the event). */
  canOverride: z.boolean(),
});
export type EventViewDto = z.infer<typeof EventViewDto>;

/** The member's own saved arrangement for one event (RLS scopes the org). */
export async function savedLayoutTx(tx: TenantTx, eventId: string, userId: string) {
  const [row] = await tx
    .select({ order: layouts.widgetOrder, hidden: layouts.hiddenWidgets })
    .from(layouts)
    .where(and(eq(layouts.eventId, eventId), eq(layouts.userId, userId)));
  return row ?? null;
}

/**
 * One event's Command Center for the signed-in member: their role, the mode (computed in the
 * event's time zone, or the manual override) and their layout for that mode.
 */
export const eventViewQuery = tenantQuery({
  name: 'commandCenter.eventView',
  input: z.object({ eventId: z.uuid() }),
  output: EventViewDto,
  entitlement: 'core',
  permission: 'events:read',
  handler: async ({ input, ctx, tx }) => {
    const scope = await callerScopeTx(tx, ctx, input.eventId);
    const mode = await eventModeTx(tx, ctx, scope.event);
    const saved = await savedLayoutTx(tx, scope.event.id, scope.userId);
    return {
      eventId: scope.event.id,
      role: scope.role,
      timeZone: scope.event.timezone,
      mode,
      layout: resolveLayout(WIDGET_META, scope, mode.mode, saved),
      customized: saved !== null,
      canOverride: scope.canWrite,
    };
  },
});

export const OverviewEventDto = z.object({
  eventId: z.uuid(),
  slug: z.string(),
  name: z.string(),
  status: z.string(),
  timeZone: z.string(),
  startsAt: iso,
  mode: z.enum(EVENT_MODES),
  overridden: z.boolean(),
  nextChangeAt: iso.nullable(),
  /** Readiness score for roles with the readiness widget (planning and pre-show only). */
  readiness: z.int().min(0).max(100).nullable(),
});

export const OrgOverviewDto = z.object({
  role: z.enum(CC_ROLES),
  events: z.array(OverviewEventDto),
});
export type OrgOverviewDto = z.infer<typeof OrgOverviewDto>;

const MODE_ORDER: Readonly<Record<EventMode, number>> = { live: 0, pre_show: 1, planning: 2, wrap: 3 };
const OVERVIEW_LIMIT = 30;

/**
 * The multi-event overview (M3.2): the org's events that are live, in pre-show, being planned or
 * wrapping up (not settled, cancelled or archived), live first, then by start. No money here.
 */
export const orgOverviewQuery = tenantQuery({
  name: 'commandCenter.orgOverview',
  input: z.object({}),
  output: OrgOverviewDto,
  entitlement: 'core',
  permission: 'events:read',
  handler: async ({ ctx, tx }) => {
    const org = await orgScopeTx(tx, ctx);
    const all = (await listEventsQuery.handler({ input: {}, ctx, tx })).map((e) => EventDto.parse(e));
    // An event whose last date ended more than the wrap ago is settled: skip it before any query.
    const recent = all.filter(
      (e) =>
        !['cancelled', 'archived'].includes(e.status) &&
        e.endsAt.getTime() > ctx.now.getTime() - 9 * 24 * 3_600_000,
    );
    const rows: (z.infer<typeof OverviewEventDto> & { settled: boolean })[] = [];
    for (const ev of recent) {
      const mode = await eventModeTx(tx, ctx, ev);
      if (mode.settled && !mode.override) continue;
      const scope = { role: org.role, profile: profileOf(ev), modules: org.modules };
      const showReadiness =
        widgetAllowed(WIDGET_META.readiness, scope) && WIDGET_META.readiness.modes.includes(mode.mode);
      rows.push({
        eventId: ev.id,
        slug: ev.slug,
        name: ev.name,
        status: ev.status,
        timeZone: ev.timezone,
        startsAt: mode.startsAt,
        mode: mode.mode,
        overridden: mode.override !== null,
        nextChangeAt: mode.nextChangeAt,
        readiness: null,
        settled: mode.settled,
        ...(showReadiness
          ? { readiness: readinessScore(await readinessRulesTx(tx, ctx, { event: ev, ...scope })).score }
          : {}),
      });
    }
    rows.sort((a, b) => MODE_ORDER[a.mode] - MODE_ORDER[b.mode] || a.startsAt.localeCompare(b.startsAt));
    return { role: org.role, events: rows.slice(0, OVERVIEW_LIMIT).map(({ settled: _, ...r }) => r) };
  },
});
