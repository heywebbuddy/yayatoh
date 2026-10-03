import { kiosksOfflineTx, sessionsInRoomTx } from '@yayatoh/checkin';
import type { TenantTx } from '@yayatoh/db';
import { exhibitorStaffingTx, sessionFillTx, sponsorTierCountsTx } from '@yayatoh/program';
import { sessionWaitlistsTx } from '@yayatoh/registration';
import { z } from 'zod';
import {
  fillPct,
  KIOSK_IN_USE_MS,
  SESSION_NEAR_PCT,
  sessionLevel,
  WAITLIST_MAX,
} from './domain/conference.ts';
import { WIDGET_META } from './domain/widgets.ts';
import { defineWidget } from './widgets.ts';

/**
 * M5.9a conference Command Center pack: session attendance live (on M3.3a's live mode and M5.6a's
 * session doors), session fill and waiting lines, exhibitor activity and sponsor activity. Counts,
 * session titles and exhibitor/sponsor names only: no people, no money, so the door may see the
 * attendance tile and none of them is revenue. Leads (M5.6b) and sponsor deliverables (M5.4b)
 * come through the app's ports; without one the tile says the source isn't connected.
 */

const iso = z.iso.datetime({ offset: true });
const Count = z.int().min(0);
const Level = z.enum(['none', 'ok', 'near', 'over']);

/** How far ahead the attendance tile shows the next sessions. */
export const ATTENDANCE_AHEAD_MS = 60 * 60_000;
const MAX_ROWS = 8;

export const SessionAttendanceWidgetDto = z.object({
  timeZone: z.string(),
  nearPct: z.int(),
  /** Sessions running now (all of them, also those beyond the rows). */
  running: Count,
  /** Of the running ones, at or over the "nearly full" line. */
  nearlyFull: Count,
  /** Running sessions first (fullest first), then the next hour's, by start. */
  sessions: z.array(
    z.object({
      id: z.uuid(),
      title: z.string(),
      startsAt: iso,
      endsAt: iso,
      room: z.string().nullable(),
      inRoom: Count,
      /** The session's places, else its room's (null = no limit). */
      capacity: Count.nullable(),
      level: Level,
      running: z.boolean(),
    }),
  ),
  more: Count,
  /** Kiosks locked to this event that went quiet. */
  kiosksOffline: Count,
  asOf: iso,
});

export const sessionAttendanceWidget = defineWidget(
  WIDGET_META.sessionAttendance,
  SessionAttendanceWidgetDto,
  async ({ tx, ctx, scope }) => {
    const now = ctx.now.getTime();
    const [fill, inRoom, kiosks] = await Promise.all([
      sessionFillTx(tx, scope.event.id),
      sessionsInRoomTx(tx, scope.event.id),
      kiosksOfflineTx(tx, scope.event.id, ctx.now, KIOSK_IN_USE_MS),
    ]);
    const rows = fill
      .filter((s) => s.endsAt.getTime() > now && s.startsAt.getTime() <= now + ATTENDANCE_AHEAD_MS)
      .map((s) => {
        const capacity = s.capacity ?? s.roomCapacity;
        const n = inRoom.get(s.sessionId) ?? 0;
        return {
          id: s.sessionId,
          title: s.title,
          startsAt: s.startsAt.toISOString(),
          endsAt: s.endsAt.toISOString(),
          room: s.roomName,
          inRoom: n,
          capacity,
          level: sessionLevel(n, capacity),
          running: s.startsAt.getTime() <= now,
          pct: fillPct(n, capacity),
        };
      })
      .sort((a, b) =>
        a.running !== b.running
          ? a.running
            ? -1
            : 1
          : a.running
            ? b.pct - a.pct || a.title.localeCompare(b.title)
            : a.startsAt.localeCompare(b.startsAt),
      );
    const running = rows.filter((r) => r.running);
    return {
      timeZone: scope.event.timezone,
      nearPct: SESSION_NEAR_PCT,
      running: running.length,
      nearlyFull: running.filter((r) => r.level === 'near' || r.level === 'over').length,
      sessions: rows.slice(0, MAX_ROWS).map(({ pct: _pct, ...r }) => r),
      more: Math.max(0, rows.length - MAX_ROWS),
      kiosksOffline: kiosks,
      asOf: ctx.now.toISOString(),
    };
  },
);

export const SessionFillWidgetDto = z.object({
  nearPct: z.int(),
  waitlistMax: z.int(),
  /** Sessions with a limit on places. */
  limited: Count,
  nearlyFull: Count,
  full: Count,
  /** People waiting over all lines, and lines longer than the threshold. */
  waiting: Count,
  longLines: Count,
  roomsTooSmall: Count,
  /** The fullest sessions (at most 5). */
  top: z.array(
    z.object({
      id: z.uuid(),
      title: z.string(),
      enrolled: Count,
      capacity: Count,
      waiting: Count,
      level: Level,
      roomTooSmall: z.boolean(),
    }),
  ),
});

export const sessionFillWidget = defineWidget(
  WIDGET_META.sessionFill,
  SessionFillWidgetDto,
  async ({ tx, scope }) => {
    const [fill, lines] = await Promise.all([
      sessionFillTx(tx, scope.event.id),
      sessionWaitlistsTx(tx, scope.event.id),
    ]);
    const limited = fill.flatMap((s) =>
      s.capacity !== null
        ? [
            {
              ...s,
              capacity: s.capacity,
              level: sessionLevel(s.enrolled, s.capacity),
              waiting: lines.get(s.sessionId) ?? 0,
              roomTooSmall: s.roomCapacity !== null && s.enrolled > s.roomCapacity,
            },
          ]
        : [],
    );
    const waiting = [...lines.values()];
    return {
      nearPct: SESSION_NEAR_PCT,
      waitlistMax: WAITLIST_MAX,
      limited: limited.length,
      nearlyFull: limited.filter((s) => s.level === 'near' || s.level === 'over').length,
      full: limited.filter((s) => s.level === 'over').length,
      waiting: waiting.reduce((a, b) => a + b, 0),
      longLines: waiting.filter((n) => n > WAITLIST_MAX).length,
      roomsTooSmall: fill.filter((s) => s.roomCapacity !== null && s.enrolled > s.roomCapacity).length,
      top: limited
        .filter((s) => s.enrolled > 0 || s.waiting > 0)
        .sort(
          (a, b) =>
            fillPct(b.enrolled, b.capacity) - fillPct(a.enrolled, a.capacity) ||
            b.waiting - a.waiting ||
            a.title.localeCompare(b.title),
        )
        .slice(0, 5)
        .map((s) => ({
          id: s.sessionId,
          title: s.title,
          enrolled: s.enrolled,
          capacity: s.capacity,
          waiting: s.waiting,
          level: s.level,
          roomTooSmall: s.roomTooSmall,
        })),
    };
  },
);

/**
 * Leads per exhibitor of an event (M5.6b lead retrieval; the app's port), exhibitor id → count;
 * null when no lead source serves the event.
 */
export type ExhibitorLeads = (tx: TenantTx, eventId: string) => Promise<ReadonlyMap<string, number> | null>;

export const ExhibitorActivityWidgetDto = z.object({
  exhibitors: Count,
  /** Exhibitors with at least one live portal person (admin or staff). */
  staffed: Count,
  /** Live portal people over all exhibitors. */
  people: Count,
  /** Null: no lead source connected yet. */
  leads: z
    .object({
      total: Count,
      withoutLeads: Count,
      /** The most active exhibitors (at most 5, leads > 0). */
      top: z.array(z.object({ name: z.string(), leads: Count })),
    })
    .nullable(),
});

export const exhibitorActivityWidget = (leads: ExhibitorLeads | null) =>
  defineWidget(WIDGET_META.exhibitorActivity, ExhibitorActivityWidgetDto, async ({ tx, ctx, scope }) => {
    const list = await exhibitorStaffingTx(tx, scope.event.id, ctx.now);
    const byId = leads ? await leads(tx, scope.event.id) : null;
    const counted = list.map((e) => ({ ...e, leads: byId?.get(e.exhibitorId) ?? 0 }));
    return {
      exhibitors: list.length,
      staffed: list.filter((e) => e.people > 0).length,
      people: list.reduce((a, e) => a + e.people, 0),
      leads: byId
        ? {
            total: counted.reduce((a, e) => a + e.leads, 0),
            withoutLeads: counted.filter((e) => e.leads === 0).length,
            top: counted
              .filter((e) => e.leads > 0)
              .sort((a, b) => b.leads - a.leads || a.name.localeCompare(b.name))
              .slice(0, 5)
              .map((e) => ({ name: e.name, leads: e.leads })),
          }
        : null,
    };
  });

/** Open sponsor deliverables past due for an event (M5.4b; the app's port); null when not served. */
export type OverdueDeliverables = (tx: TenantTx, eventId: string, now: Date) => Promise<number | null>;

export const SponsorActivityWidgetDto = z.object({
  sponsors: Count,
  tiers: z.array(z.object({ tier: z.string(), sponsors: Count })),
  /** Null: no deliverables source connected yet. */
  deliverablesOverdue: Count.nullable(),
});

export const sponsorActivityWidget = (deliverables: OverdueDeliverables | null) =>
  defineWidget(WIDGET_META.sponsorActivity, SponsorActivityWidgetDto, async ({ tx, ctx, scope }) => {
    const tiers = await sponsorTierCountsTx(tx, scope.event.id);
    return {
      sponsors: tiers.reduce((a, t) => a + t.sponsors, 0),
      tiers,
      deliverablesOverdue: (await deliverables?.(tx, scope.event.id, ctx.now)) ?? null,
    };
  });
