import type { CampaignContent } from '@yayatoh/campaigns/client';
import { SEGMENT_VERSION, type SegmentDefinition } from '@yayatoh/crm/client';
import type { EventSnapshot } from '@yayatoh/templates';
import type { FANOUT_AUDIENCES, FANOUT_TARGET_STATUSES, PrivatePart } from './schema.ts';

/**
 * Pure rules of agency v2 operations (M6.8b).
 */

/**
 * The part of an agency template a client receives: everything except the parts the agency keeps
 * private (checkout questions, the seating plan). Private notes live in another table and are
 * never part of a snapshot.
 */
export function publicSnapshot(snapshot: EventSnapshot, privateParts: readonly PrivatePart[]): EventSnapshot {
  const hide = new Set(privateParts);
  return {
    ...snapshot,
    questions: hide.has('questions') ? null : snapshot.questions,
    seating: hide.has('seating') ? null : snapshot.seating,
  };
}

export type FanoutAudience = (typeof FANOUT_AUDIENCES)[number];

/**
 * The audience a fan-out creates in each client, in the client's own segment DSL: everyone, or
 * people who attended any of the client's events. Consent is not part of it: each client's send
 * applies its own consent and suppression rules at snapshot time.
 */
export function fanoutSegment(audience: FanoutAudience): SegmentDefinition {
  if (audience === 'everyone')
    return { version: SEGMENT_VERSION, root: { type: 'group', op: 'and', conditions: [] } };
  return {
    version: SEGMENT_VERSION,
    root: {
      type: 'group',
      op: 'and',
      conditions: [
        {
          type: 'participation',
          scope: { kind: 'any' },
          negate: false,
          role: 'attendee',
          ticketTypeIds: [],
          seated: null,
          checkedIn: null,
          registeredFrom: null,
          registeredTo: null,
        },
      ],
    },
  } as SegmentDefinition;
}

/**
 * A client's campaign content from the agency's message: a heading and a paragraph, then the
 * client's **own** footer (its postal address): sender rules stay the client's.
 */
export function fanoutContent(
  postalAddress: string,
  message: { subject: string; heading: string; body: string },
): CampaignContent {
  return {
    subject: message.subject,
    preheader: '',
    font: 'sans',
    smsBody: '',
    blocks: [
      { id: 'b1', type: 'heading', text: message.heading },
      { id: 'b2', type: 'text', text: message.body },
      { id: 'b3', type: 'footer', postalAddress: postalAddress.trim(), note: '' },
    ],
  };
}

/** True when a client has a usable postal address for the footer (CAN-SPAM: needed to send). */
export function hasPostalAddress(postalAddress: string): boolean {
  return postalAddress.trim().length >= 5;
}

/** A day-of pass's default window: three hours before the event to three hours after, at most 72 h. */
export const DAY_OF_LEAD_MS = 3 * 3_600_000;
export const DAY_OF_MAX_MS = 72 * 3_600_000;

export function dayOfWindow(event: { startsAt: Date; endsAt: Date }): { startsAt: Date; endsAt: Date } {
  const startsAt = new Date(event.startsAt.getTime() - DAY_OF_LEAD_MS);
  const end = event.endsAt.getTime() + DAY_OF_LEAD_MS;
  return { startsAt, endsAt: new Date(Math.min(end, startsAt.getTime() + DAY_OF_MAX_MS)) };
}

/** Is a day-of pass in force at `now` (start inclusive, end exclusive)? */
export function passActive(p: { startsAt: Date | null; endsAt: Date | null }, now: Date): boolean {
  return !!p.startsAt && !!p.endsAt && p.startsAt <= now && now < p.endsAt;
}

export type FanoutTargetStatus = (typeof FANOUT_TARGET_STATUSES)[number];

/** Counts per status for a fan-out's summary line. */
export function fanoutTotals(
  targets: readonly { status: FanoutTargetStatus }[],
): Record<FanoutTargetStatus, number> {
  const out: Record<FanoutTargetStatus, number> = {
    pending: 0,
    draft: 0,
    sent: 0,
    needs_address: 0,
    failed: 0,
    detached: 0,
  };
  for (const t of targets) out[t.status] += 1;
  return out;
}

/** A stable short error code from any thrown error (stored, shown through translations). */
export function errorCodeOf(err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === 'string' && /^[a-z_]{1,40}$/.test(code) ? code : 'internal';
}
