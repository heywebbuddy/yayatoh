import { dayOfQuery } from '@yayatoh/checkin';
import { mealDietaryCountsTx, socialFactsTx } from '@yayatoh/guests';
import { requireOrg } from '@yayatoh/kernel';
import { z } from 'zod';
import { WIDGET_META } from './domain/widgets.ts';
import { defineWidget, type WidgetLoadArgs } from './widgets.ts';

/**
 * The social Command Center pack (M4.6a): RSVP, guest seating, meals and dietary needs, and
 * arrivals for weddings and galas. Numbers come from the modules that own them (guests' RSVP
 * facts, seating's guest plan and check-in's arrivals through its day-of read), so a widget says
 * exactly what the RSVP page, the seating editor and the day-of view say. Allowlists: counts,
 * menu labels, guest and party names; never a dietary or accessibility answer (P4-3) and no money.
 */

const iso = z.iso.datetime({ offset: true });
const Count = z.int().min(0);

/** Shown names in the seating and arrivals lists (the rest as "+n more"). */
export const SOCIAL_LIST_MAX = 8;

const Person = z.object({
  /** Null for an unnamed plus-one: shown as "Guest of {guestOf}". */
  name: z.string().nullable(),
  guestOf: z.string().nullable(),
  partyName: z.string(),
});

export const RsvpWidgetDto = z.object({
  timeZone: z.string(),
  invited: Count,
  pending: Count,
  pendingParties: Count,
  responded: Count,
  notSent: Count,
  attending: Count,
  deadline: iso.nullable(),
  asOf: iso,
});

export const GuestSeatingWidgetDto = z.object({
  hasChart: z.boolean(),
  /** Guests who haven't declined, and those of them without a table. */
  guests: Count,
  unseated: Count,
  list: z.array(Person),
  more: Count,
  asOf: iso,
});

export const MealsWidgetDto = z.object({
  attending: Count,
  options: z.array(z.object({ label: z.string(), notes: z.string().nullable(), count: Count })),
  other: Count,
  none: Count,
  /** Attending guests with a dietary requirement / an accessibility need: counts only. */
  dietary: Count,
  accessibility: Count,
  asOf: iso,
});

export const ArrivalsWidgetDto = z.object({
  timeZone: z.string(),
  expected: Count,
  arrived: Count,
  notArrived: Count,
  recent: z.array(Person.extend({ arrivedAt: iso, source: z.enum(['scanner', 'kiosk', 'host']) })),
  asOf: iso,
});

const dayOfTx = ({ tx, ctx, scope }: WidgetLoadArgs) =>
  dayOfQuery.handler({ input: { eventId: scope.event.id, q: '' }, ctx, tx });

export const rsvpWidget = defineWidget(WIDGET_META.rsvp, RsvpWidgetDto, async ({ tx, ctx, scope }) => {
  const s = await socialFactsTx(tx, scope.event.id);
  return {
    timeZone: scope.event.timezone,
    invited: s.invited,
    pending: s.pending,
    pendingParties: s.pendingParties,
    responded: s.responded,
    notSent: s.notSent,
    attending: s.attending,
    deadline: s.deadline?.toISOString() ?? null,
    asOf: ctx.now.toISOString(),
  };
});

export const guestSeatingWidget = defineWidget(WIDGET_META.guestSeating, GuestSeatingWidgetDto, async (args) => {
  const d = await dayOfTx(args);
  const person = (p: { name: string | null; guestOf: string | null; partyName: string }) => ({
    name: p.name,
    guestOf: p.guestOf,
    partyName: p.partyName,
  });
  return {
    hasChart: d.hasChart,
    guests: d.counts.expected,
    unseated: d.counts.unseated,
    list: d.unseated.slice(0, SOCIAL_LIST_MAX).map(person),
    more: Math.max(0, d.unseated.length - SOCIAL_LIST_MAX),
    asOf: args.ctx.now.toISOString(),
  };
});

export const mealsWidget = defineWidget(WIDGET_META.meals, MealsWidgetDto, async ({ tx, ctx, scope }) => {
  const m = await mealDietaryCountsTx(tx, requireOrg(ctx), scope.event.id);
  return {
    attending: m.attending,
    options: m.options.map((o) => ({ label: o.label, notes: o.notes, count: o.count })),
    other: m.other,
    none: m.none,
    dietary: m.dietary,
    accessibility: m.accessibility,
    asOf: ctx.now.toISOString(),
  };
});

export const arrivalsWidget = defineWidget(WIDGET_META.arrivals, ArrivalsWidgetDto, async (args) => {
  const d = await dayOfTx(args);
  return {
    timeZone: args.scope.event.timezone,
    expected: d.counts.expected,
    arrived: d.counts.arrived,
    notArrived: d.counts.notArrived,
    recent: d.arrivals.slice(0, SOCIAL_LIST_MAX).map((a) => ({
      name: a.name,
      guestOf: a.guestOf,
      partyName: a.partyName,
      arrivedAt: a.arrivedAt.toISOString(),
      source: a.source,
    })),
    asOf: args.ctx.now.toISOString(),
  };
});
