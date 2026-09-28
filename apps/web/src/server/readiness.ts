import 'server-only';
import { eventDetailsQuery, eventSectionsQuery, listOccurrencesQuery } from '@yayatoh/events';
import { executeQuery } from '@yayatoh/kernel';
import { composeNav, isProfileKey } from '@yayatoh/platform';
import { programCountsQuery } from '@yayatoh/program';
import { listTicketTypesQuery } from '@yayatoh/ticketing';
import { cache } from 'react';
import { type ReadinessRule, readinessRules } from '@/lib/readiness.ts';
import { loadEvent } from './console.ts';
import { ports } from './ports.ts';

/** The event's readiness rules (M1.4f), loaded once per request for the layout and pages. */
export const loadReadiness = cache(async (orgSlug: string, eventSlug: string): Promise<ReadinessRule[]> => {
  const { data, event: ev } = await loadEvent(orgSlug, eventSlug);
  const profile = isProfileKey(ev.profile) ? ev.profile : 'other';
  const nav = new Set(composeNav(profile, data.modules).map((i) => i.key));
  const [details, sections, dates, tickets, counts] = await Promise.all([
    executeQuery(eventDetailsQuery, { eventId: ev.id }, data.ctx, ports),
    executeQuery(eventSectionsQuery, { eventId: ev.id }, data.ctx, ports),
    executeQuery(listOccurrencesQuery, { eventId: ev.id }, data.ctx, ports),
    data.modules.has('ticketing')
      ? executeQuery(listTicketTypesQuery, { eventId: ev.id }, data.ctx, ports)
      : Promise.resolve([]),
    executeQuery(programCountsQuery, { eventId: ev.id }, data.ctx, ports),
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
    now,
  });
});
