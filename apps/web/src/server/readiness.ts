import 'server-only';
import { eventDetailsQuery, eventSectionsQuery, listOccurrencesQuery } from '@yayatoh/events';
import { guestCountQuery } from '@yayatoh/guests';
import { executeQuery } from '@yayatoh/kernel';
import { composeNav, PROFILES } from '@yayatoh/platform';
import { programCountsQuery } from '@yayatoh/program';
import { eventSeatingQuery } from '@yayatoh/seating';
import { listTicketTypesQuery } from '@yayatoh/ticketing';
import { cache } from 'react';
import { type ReadinessRule, readinessRules } from '@/lib/readiness.ts';
import { loadEventBase } from './console.ts';
import { ports } from './ports.ts';

/** The event's readiness rules (M1.4f), loaded once per request for the layout and pages. */
export const loadReadiness = cache(async (orgSlug: string, eventSlug: string): Promise<ReadinessRule[]> => {
  const { data, event: ev, profile, can } = await loadEventBase(orgSlug, eventSlug);
  const nav = new Set(composeNav(profile, data.modules).map((i) => i.key));
  const checklist = PROFILES[profile].checklist ?? [];
  const [details, sections, dates, tickets, counts, seating, guestList] = await Promise.all([
    executeQuery(eventDetailsQuery, { eventId: ev.id }, data.ctx, ports),
    executeQuery(eventSectionsQuery, { eventId: ev.id }, data.ctx, ports),
    executeQuery(listOccurrencesQuery, { eventId: ev.id }, data.ctx, ports),
    data.modules.has('ticketing')
      ? executeQuery(listTicketTypesQuery, { eventId: ev.id }, data.ctx, ports)
      : Promise.resolve([]),
    executeQuery(programCountsQuery, { eventId: ev.id }, data.ctx, ports),
    checklist.includes('floorPlanChosen') && data.modules.has('seating')
      ? executeQuery(eventSeatingQuery, { eventId: ev.id }, data.ctx, ports)
      : Promise.resolve(null),
    // M4.1a: the guest list's count (the checklist's "add your guests", for those who may read it).
    checklist.includes('guestsAdded') && data.modules.has('guests') && can('guests:read')
      ? executeQuery(guestCountQuery, { eventId: ev.id }, data.ctx, ports)
      : Promise.resolve(null),
  ]);
  const now = new Date();
  return readinessRules({
    name: ev.name,
    status: ev.status,
    startsAt: ev.startsAt,
    endsAt: ev.endsAt,
    venueName: ev.venueName,
    attendanceMode: details.attendanceMode,
    tagline: ev.tagline,
    descriptionSections: sections.filter((s) => s.kind === 'text' && s.visible).length,
    totalDates: dates.length,
    upcomingDates: dates.filter((d) => d.status === 'scheduled' && d.endsAt > now).length,
    ticketTypes: tickets.length,
    sessions: counts.sessions,
    speakers: counts.speakers,
    nav,
    checklist,
    floorPlan: seating !== null,
    guests: guestList?.guests ?? 0,
    now,
  });
});
