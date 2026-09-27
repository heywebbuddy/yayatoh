import type { EventDto } from '@yayatoh/events';

/**
 * Readiness v1 (roadmap M1.4 "readiness engine v1"): rules computed from the event itself.
 * Ticketing, seating and branding rules join as those modules land.
 */
export function readinessRules(e: EventDto): { key: string; done: boolean }[] {
  return [
    { key: 'detailsAdded', done: e.name.length > 0 && e.endsAt > e.startsAt },
    { key: 'venueSet', done: Boolean(e.venueName) },
    { key: 'taglineWritten', done: Boolean(e.tagline) },
    { key: 'published', done: ['published', 'postponed', 'completed'].includes(e.status) },
  ];
}
