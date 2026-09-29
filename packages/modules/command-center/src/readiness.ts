import type { TenantTx } from '@yayatoh/db';
import { type EventDto, eventDetailsQuery, eventSectionsQuery, listOccurrencesQuery } from '@yayatoh/events';
import type { Ctx } from '@yayatoh/kernel';
import { composeNav, type ProfileKey } from '@yayatoh/platform';
import { programCountsQuery } from '@yayatoh/program';
import { listTicketTypesQuery } from '@yayatoh/ticketing';
import { type ReadinessRule, readinessRules } from './domain/readiness.ts';

/**
 * The readiness engine's facts about one event (M1.4f rules), read inside the caller's tenant
 * transaction through the owning modules' exported queries. The same facts the event home and the
 * setup guide use, so the Command Center's score and their checklist never disagree.
 */
export async function readinessRulesTx(
  tx: TenantTx,
  ctx: Ctx,
  scope: { event: EventDto; profile: ProfileKey; modules: ReadonlySet<string> },
): Promise<ReadinessRule[]> {
  const ev = scope.event;
  const input = { eventId: ev.id };
  const nav = new Set(composeNav(scope.profile, scope.modules).map((i) => i.key));
  const details = await eventDetailsQuery.handler({ input, ctx, tx });
  const sections = await eventSectionsQuery.handler({ input, ctx, tx });
  const dates = await listOccurrencesQuery.handler({ input, ctx, tx });
  const tickets = scope.modules.has('ticketing')
    ? await listTicketTypesQuery.handler({ input, ctx, tx })
    : [];
  const counts = await programCountsQuery.handler({ input, ctx, tx });
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
    upcomingDates: dates.filter((d) => d.status === 'scheduled' && d.endsAt > ctx.now).length,
    ticketTypes: tickets.length,
    sessions: counts.sessions,
    speakers: counts.speakers,
    nav,
    now: ctx.now,
  });
}
