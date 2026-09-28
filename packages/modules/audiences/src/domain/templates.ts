import { SEGMENT_VERSION, type SegmentDefinition } from '@yayatoh/crm/client';

/**
 * The vision's three audiences (docs/vision.md §8) as templates: each fills the builder with an
 * ordinary definition the organizer can still change. They are pure, so the browser and the
 * server build the same definition.
 */
export const TEMPLATE_KEYS = ['vipsWithoutSeats', 'lastYearNotThisYear', 'registeredNotCheckedIn'] as const;
export type TemplateKey = (typeof TEMPLATE_KEYS)[number];

/** What each template needs chosen before it can be built. */
export const TEMPLATE_PARAMS: Readonly<Record<TemplateKey, readonly ('eventId' | 'ticketTypeIds')[]>> = {
  vipsWithoutSeats: ['eventId', 'ticketTypeIds'],
  lastYearNotThisYear: ['eventId'],
  registeredNotCheckedIn: ['eventId'],
};

export interface TemplateParams {
  readonly eventId: string;
  readonly ticketTypeIds?: readonly string[];
}

const base = {
  negate: false,
  role: 'attendee' as const,
  ticketTypeIds: [] as string[],
  seated: null,
  checkedIn: null,
  registeredFrom: null,
  registeredTo: null,
};

export function templateDefinition(key: TemplateKey, p: TemplateParams): SegmentDefinition {
  switch (key) {
    // "VIP attendees who purchased tickets but have not selected their seats": holders of the
    // chosen ticket types at the event without a seat (bought or assigned).
    case 'vipsWithoutSeats':
      return {
        version: SEGMENT_VERSION,
        root: {
          type: 'group',
          op: 'and',
          conditions: [
            {
              type: 'participation',
              ...base,
              scope: { kind: 'event', eventId: p.eventId },
              ticketTypeIds: [...(p.ticketTypeIds ?? [])],
              seated: false,
            },
          ],
        },
      };
    // "People who attended last year's event but have not registered this year": checked in at
    // the previous edition of the event's series, and not on this event's list.
    case 'lastYearNotThisYear':
      return {
        version: SEGMENT_VERSION,
        root: {
          type: 'group',
          op: 'and',
          conditions: [
            {
              type: 'participation',
              ...base,
              scope: { kind: 'previousEdition', eventId: p.eventId },
              checkedIn: true,
            },
            { type: 'participation', ...base, scope: { kind: 'event', eventId: p.eventId }, negate: true },
          ],
        },
      };
    // "Registered attendees who have not checked in yet".
    case 'registeredNotCheckedIn':
      return {
        version: SEGMENT_VERSION,
        root: {
          type: 'group',
          op: 'and',
          conditions: [
            {
              type: 'participation',
              ...base,
              scope: { kind: 'event', eventId: p.eventId },
              checkedIn: false,
            },
          ],
        },
      };
  }
}
