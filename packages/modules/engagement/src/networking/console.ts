import type { TenantTx } from '@yayatoh/db';
import { DomainError, requireOrg } from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { and, asc, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  MAX_LOCATION_CAPACITY,
  MAX_LOCATIONS_PER_EVENT,
  MAX_SLOT_MINUTES,
  MAX_SLOTS_PER_EVENT,
  MIN_SLOT_MINUTES,
  slotSeries,
} from '../domain/networking.ts';
import {
  LOCATION_KINDS,
  meetingLocations,
  meetingSlots,
  meetings,
  networkConnections,
  networkProfiles,
  networkReports,
  networkSettings,
} from '../schema.ts';
import { eventOf } from '../state.ts';
import { ConsoleReportDto, NetworkConsoleDto, NetworkSettingsDto } from './dto.ts';
import { hideProfileTx, networkSettingsTx } from './state.ts';

/**
 * Networking for organizers (M5.8a): turn it on, meeting locations (booths and meeting points with
 * a capacity) and time slots, and the report queue. Organizers never see the directory itself or
 * anyone's requests; reports show the two display names, the reason and the reporter's details.
 * Writes need `events:write`, the console `events:read`.
 */
const invalid = (field: string, reason: string) =>
  new DomainError('validation_failed', `Invalid ${field}`, { field, reason });
const refused = (reason: string) => new DomainError('invalid_state', reason, { reason });

const Event = { eventId: z.uuid() };

async function counts(tx: TenantTx, eventId: string) {
  const [p] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(networkProfiles)
    .where(
      and(eq(networkProfiles.eventId, eventId), eq(networkProfiles.optedIn, true), sql`hidden_at is null`),
    );
  const [c] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(networkConnections)
    .where(and(eq(networkConnections.eventId, eventId), eq(networkConnections.status, 'accepted')));
  const [m] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(meetings)
    .where(and(eq(meetings.eventId, eventId), eq(meetings.status, 'accepted')));
  return { optedIn: p?.n ?? 0, connections: c?.n ?? 0, meetings: m?.n ?? 0 };
}

export const networkConsoleQuery = tenantQuery({
  name: 'engagement.networkConsole',
  input: z.object(Event),
  output: NetworkConsoleDto,
  entitlement: 'sessions',
  permission: 'events:read',
  handler: async ({ input, tx }) => {
    await eventOf(tx, input.eventId);
    const s = await networkSettingsTx(tx, input.eventId);
    const booked = await tx
      .select({ locationId: meetings.locationId, slotId: meetings.slotId, n: sql<number>`count(*)::int` })
      .from(meetings)
      .where(and(eq(meetings.eventId, input.eventId), eq(meetings.status, 'accepted')))
      .groupBy(meetings.locationId, meetings.slotId);
    const locations = await tx
      .select()
      .from(meetingLocations)
      .where(eq(meetingLocations.eventId, input.eventId))
      .orderBy(sql`lower(${meetingLocations.name})`);
    const slots = await tx
      .select()
      .from(meetingSlots)
      .where(eq(meetingSlots.eventId, input.eventId))
      .orderBy(asc(meetingSlots.startsAt));
    const reports = await tx
      .select()
      .from(networkReports)
      .where(eq(networkReports.eventId, input.eventId))
      .orderBy(sql`${networkReports.status} <> 'open'`, desc(networkReports.createdAt))
      .limit(200);
    const ids = [...new Set(reports.flatMap((r) => [r.reporterId, r.reportedId]))];
    const people = new Map(
      (ids.length
        ? await tx
            .select({
              id: networkProfiles.id,
              displayName: networkProfiles.displayName,
              hiddenAt: networkProfiles.hiddenAt,
            })
            .from(networkProfiles)
            .where(inArray(networkProfiles.id, ids))
        : []
      ).map((p) => [p.id, p]),
    );
    const hidden = await tx
      .select({ id: networkProfiles.id, displayName: networkProfiles.displayName })
      .from(networkProfiles)
      .where(and(eq(networkProfiles.eventId, input.eventId), sql`hidden_at is not null`))
      .orderBy(sql`lower(${networkProfiles.displayName})`);
    const sum = (f: (b: (typeof booked)[number]) => boolean) => booked.filter(f).reduce((a, b) => a + b.n, 0);
    return {
      settings: {
        enabled: s?.enabled ?? false,
        meetingsEnabled: s?.meetingsEnabled ?? true,
        chatEnabled: s?.chatEnabled ?? true,
      },
      stats: await counts(tx, input.eventId),
      locations: locations.map((l) => ({
        id: l.id,
        name: l.name,
        kind: l.kind as (typeof LOCATION_KINDS)[number],
        capacity: l.capacity,
        booked: sum((b) => b.locationId === l.id),
        peak: Math.max(0, ...booked.filter((b) => b.locationId === l.id).map((b) => b.n)),
      })),
      slots: slots.map((x) => ({
        id: x.id,
        startsAt: x.startsAt,
        endsAt: x.endsAt,
        booked: sum((b) => b.slotId === x.id),
      })),
      reports: reports.map((r) =>
        ConsoleReportDto.parse({
          id: r.id,
          reason: r.reason,
          details: r.details,
          status: r.status,
          createdAt: r.createdAt,
          reporter: { id: r.reporterId, displayName: people.get(r.reporterId)?.displayName ?? '—' },
          reported: {
            id: r.reportedId,
            displayName: people.get(r.reportedId)?.displayName ?? '—',
            hidden: Boolean(people.get(r.reportedId)?.hiddenAt),
          },
        }),
      ),
      hidden,
    };
  },
});

export const UpdateNetworkSettingsInput = z.object({
  ...Event,
  enabled: z.boolean(),
  meetingsEnabled: z.boolean(),
  /** M5.8b: chat on or off (left as it is when omitted). */
  chatEnabled: z.boolean().optional(),
});

export const updateNetworkSettingsCommand = tenantCommand({
  name: 'engagement.updateNetworkSettings',
  input: UpdateNetworkSettingsInput,
  output: NetworkSettingsDto,
  entitlement: 'sessions',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    await eventOf(tx, input.eventId);
    const [row] = await tx
      .insert(networkSettings)
      .values({
        orgId: requireOrg(ctx),
        eventId: input.eventId,
        enabled: input.enabled,
        meetingsEnabled: input.meetingsEnabled,
        ...(input.chatEnabled === undefined ? {} : { chatEnabled: input.chatEnabled }),
      })
      .onConflictDoUpdate({
        target: [networkSettings.orgId, networkSettings.eventId],
        set: {
          enabled: input.enabled,
          meetingsEnabled: input.meetingsEnabled,
          ...(input.chatEnabled === undefined ? {} : { chatEnabled: input.chatEnabled }),
          updatedAt: ctx.now,
        },
      })
      .returning();
    if (!row) throw new DomainError('internal');
    return { enabled: row.enabled, meetingsEnabled: row.meetingsEnabled, chatEnabled: row.chatEnabled };
  },
  audit: (input) => ({
    action: 'engagement.network.settings',
    targetType: 'event',
    targetId: input.eventId,
    data: {
      enabled: input.enabled,
      meetingsEnabled: input.meetingsEnabled,
      ...(input.chatEnabled === undefined ? {} : { chatEnabled: input.chatEnabled }),
    },
  }),
});

/* ---------------------------------------------------------------------------- locations ---- */

export const SaveLocationInput = z.object({
  ...Event,
  locationId: z.uuid().optional(),
  name: z.string().trim().min(1).max(80),
  kind: z.enum(LOCATION_KINDS),
  capacity: z.int().min(1).max(MAX_LOCATION_CAPACITY),
});

/**
 * Add or change a meeting location. Its capacity is how many meetings fit there at once; it can't
 * go below the meetings already accepted in any one slot (`capacity_below_booked`).
 */
export const saveMeetingLocationCommand = tenantCommand({
  name: 'engagement.saveMeetingLocation',
  input: SaveLocationInput,
  output: z.object({ id: z.uuid() }),
  entitlement: 'sessions',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    await eventOf(tx, input.eventId);
    const [taken] = await tx
      .select({ id: meetingLocations.id })
      .from(meetingLocations)
      .where(
        and(
          eq(meetingLocations.eventId, input.eventId),
          sql`lower(${meetingLocations.name}) = lower(${input.name})`,
          input.locationId ? ne(meetingLocations.id, input.locationId) : undefined,
        ),
      );
    if (taken) throw new DomainError('conflict', 'Name taken', { field: 'name' });
    if (input.locationId) {
      const [loc] = await tx
        .select()
        .from(meetingLocations)
        .where(and(eq(meetingLocations.id, input.locationId), eq(meetingLocations.eventId, input.eventId)))
        .for('update');
      if (!loc) throw new DomainError('not_found');
      const [peak] = await tx
        .select({ n: sql<number>`coalesce(max(table_no), 0)::int` })
        .from(meetings)
        .where(and(eq(meetings.locationId, loc.id), eq(meetings.status, 'accepted')));
      if ((peak?.n ?? 0) > input.capacity)
        throw new DomainError('invalid_state', 'Capacity below booked', {
          field: 'capacity',
          reason: 'capacity_below_booked',
        });
      await tx
        .update(meetingLocations)
        .set({ name: input.name, kind: input.kind, capacity: input.capacity, updatedAt: ctx.now })
        .where(eq(meetingLocations.id, loc.id));
      return { id: loc.id };
    }
    const [n] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(meetingLocations)
      .where(eq(meetingLocations.eventId, input.eventId));
    if ((n?.n ?? 0) >= MAX_LOCATIONS_PER_EVENT) throw refused('too_many');
    const [row] = await tx
      .insert(meetingLocations)
      .values({
        orgId: requireOrg(ctx),
        eventId: input.eventId,
        name: input.name,
        kind: input.kind,
        capacity: input.capacity,
      })
      .returning({ id: meetingLocations.id });
    if (!row) throw new DomainError('internal');
    return { id: row.id };
  },
  audit: (input, r) => ({
    action: input.locationId ? 'engagement.network.location_update' : 'engagement.network.location_create',
    targetType: 'meeting_location',
    targetId: r.id,
    data: { eventId: input.eventId, kind: input.kind, capacity: input.capacity },
  }),
});

/** Whether meetings still pending or accepted use this slot or location. */
async function inUse(tx: TenantTx, where: ReturnType<typeof eq>) {
  const [row] = await tx
    .select({ id: meetings.id })
    .from(meetings)
    .where(and(where, inArray(meetings.status, ['pending', 'accepted'])))
    .limit(1);
  return Boolean(row);
}

export const deleteMeetingLocationCommand = tenantCommand({
  name: 'engagement.deleteMeetingLocation',
  input: z.object({ ...Event, locationId: z.uuid() }),
  output: z.object({ ok: z.literal(true) }),
  entitlement: 'sessions',
  permission: 'events:write',
  category: 'delete',
  handler: async ({ input, tx }) => {
    const [loc] = await tx
      .select()
      .from(meetingLocations)
      .where(and(eq(meetingLocations.id, input.locationId), eq(meetingLocations.eventId, input.eventId)))
      .for('update');
    if (!loc) throw new DomainError('not_found');
    if (await inUse(tx, eq(meetings.locationId, loc.id))) throw refused('in_use');
    await tx.delete(meetingLocations).where(eq(meetingLocations.id, loc.id));
    return { ok: true as const };
  },
  audit: (input) => ({
    action: 'engagement.network.location_delete',
    targetType: 'meeting_location',
    targetId: input.locationId,
  }),
});

/* -------------------------------------------------------------------------------- slots ---- */

export const AddSlotsInput = z.object({
  ...Event,
  startsAt: z.date(),
  endsAt: z.date(),
  minutes: z.int().min(MIN_SLOT_MINUTES).max(MAX_SLOT_MINUTES),
});

/**
 * Add back-to-back slots of `minutes` between two times (within the event). Refused when one
 * would overlap a slot the event already has (`overlap`), or the window fits none (`too_short`).
 */
export const addMeetingSlotsCommand = tenantCommand({
  name: 'engagement.addMeetingSlots',
  input: AddSlotsInput,
  output: z.object({ added: z.int().min(1) }),
  entitlement: 'sessions',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    const ev = await eventOf(tx, input.eventId);
    if (input.endsAt <= input.startsAt) throw invalid('endsAt', 'before_start');
    if (input.startsAt < ev.startsAt || input.endsAt > ev.endsAt) throw invalid('startsAt', 'outside_event');
    const series = slotSeries(input.startsAt, input.endsAt, input.minutes);
    if (series.length === 0) throw invalid('minutes', 'too_short');
    // One writer at a time per event (the settings row exists once networking was set up).
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`engagement.slots:${input.eventId}`}))`);
    const existing = await tx.select().from(meetingSlots).where(eq(meetingSlots.eventId, input.eventId));
    if (existing.length + series.length > MAX_SLOTS_PER_EVENT) throw refused('too_many');
    const clash = existing.some((e) => series.some((s) => s.startsAt < e.endsAt && e.startsAt < s.endsAt));
    if (clash) throw refused('overlap');
    await tx
      .insert(meetingSlots)
      .values(series.map((s) => ({ orgId: requireOrg(ctx), eventId: input.eventId, ...s })));
    return { added: series.length };
  },
  audit: (input, r) => ({
    action: 'engagement.network.slots_add',
    targetType: 'event',
    targetId: input.eventId,
    data: { added: r.added, minutes: input.minutes },
  }),
});

export const deleteMeetingSlotCommand = tenantCommand({
  name: 'engagement.deleteMeetingSlot',
  input: z.object({ ...Event, slotId: z.uuid() }),
  output: z.object({ ok: z.literal(true) }),
  entitlement: 'sessions',
  permission: 'events:write',
  category: 'delete',
  handler: async ({ input, tx }) => {
    const [slot] = await tx
      .select()
      .from(meetingSlots)
      .where(and(eq(meetingSlots.id, input.slotId), eq(meetingSlots.eventId, input.eventId)))
      .for('update');
    if (!slot) throw new DomainError('not_found');
    if (await inUse(tx, eq(meetings.slotId, slot.id))) throw refused('in_use');
    await tx.delete(meetingSlots).where(eq(meetingSlots.id, slot.id));
    return { ok: true as const };
  },
  audit: (input) => ({
    action: 'engagement.network.slot_delete',
    targetType: 'meeting_slot',
    targetId: input.slotId,
  }),
});

/* ------------------------------------------------------------------------------ reports ---- */

/**
 * Act on a report: `hide` takes the reported person out of networking at this event (every open
 * report about them closes as hidden; their pending requests and meetings ahead end), `dismiss`
 * closes this report only.
 */
export const resolveReportCommand = tenantCommand({
  name: 'engagement.resolveReport',
  input: z.object({ ...Event, reportId: z.uuid(), action: z.enum(['hide', 'dismiss']) }),
  output: z.object({ ok: z.literal(true) }),
  entitlement: 'sessions',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    const [r] = await tx
      .select()
      .from(networkReports)
      .where(and(eq(networkReports.id, input.reportId), eq(networkReports.eventId, input.eventId)))
      .for('update');
    if (!r) throw new DomainError('not_found');
    if (r.status !== 'open') throw refused('resolved');
    const by = ctx.actor.type === 'user' ? ctx.actor.userId : null;
    if (input.action === 'dismiss') {
      await tx
        .update(networkReports)
        .set({ status: 'dismissed', resolvedAt: ctx.now, resolvedBy: by, updatedAt: ctx.now })
        .where(eq(networkReports.id, r.id));
      return { ok: true as const };
    }
    await hideProfileTx(tx, ctx, r.reportedId, by);
    return { ok: true as const };
  },
  audit: (input) => ({
    action: input.action === 'hide' ? 'engagement.network.report_hide' : 'engagement.network.report_dismiss',
    targetType: 'network_report',
    targetId: input.reportId,
  }),
});

/** Bring a hidden profile back (it is listed again only if the person is still opted in). */
export const restoreProfileCommand = tenantCommand({
  name: 'engagement.restoreNetworkProfile',
  input: z.object({ ...Event, profileId: z.uuid() }),
  output: z.object({ ok: z.literal(true) }),
  entitlement: 'sessions',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    const rows = await tx
      .update(networkProfiles)
      .set({ hiddenAt: null, hiddenBy: null, updatedAt: ctx.now })
      .where(and(eq(networkProfiles.id, input.profileId), eq(networkProfiles.eventId, input.eventId)))
      .returning({ id: networkProfiles.id });
    if (rows.length === 0) throw new DomainError('not_found');
    return { ok: true as const };
  },
  audit: (input) => ({
    action: 'engagement.network.profile_restore',
    targetType: 'network_profile',
    targetId: input.profileId,
  }),
});
