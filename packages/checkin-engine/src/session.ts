/**
 * Session check-in (M5.6a): the three gates a session checkpoint applies after the event rules,
 * shared by the server and offline devices.
 *
 * 1. `enrollment` — the ticket is a registrant of the event (an admission pass) and, when the
 *    session needs enrollment (optional with a capacity, P5-9), holds a place in it.
 * 2. `admission_level` — the registrant's items give the session (an admission item that lists
 *    nothing gives every session; listed sessions as listed; add-ons only what they list).
 * 3. `capacity` — fewer people are in the room than it holds.
 *
 * Each refusal names its gate; staff may override a gate with a reason (audited, online only).
 */

export const SESSION_GATES = ['enrollment', 'admission_level', 'capacity'] as const;
export type SessionGate = (typeof SESSION_GATES)[number];

/** The scan result a refused gate gives. */
export const GATE_RESULT = {
  enrollment: 'not_enrolled',
  admission_level: 'admission_level',
  capacity: 'capacity',
} as const satisfies Record<SessionGate, string>;
export type SessionRefusal = (typeof GATE_RESULT)[SessionGate];

/** The gate behind a refusal result (null for any other result). */
export function gateOf(result: string): SessionGate | null {
  for (const g of SESSION_GATES) if (GATE_RESULT[g] === result) return g;
  return null;
}

/** What a session checkpoint checks (signed into a v3 manifest's scope). */
export interface SessionGateRule {
  readonly sessionId: string;
  /** How many people the room holds (the checkpoint's own number, else the room's); null = no limit. */
  readonly capacity: number | null;
  /** Optional sessions with a capacity need an enrollment (P5-9). */
  readonly enrollmentRequired: boolean;
}

/** What a ticket may do at sessions (from registration; null = unknown, e.g. a pass issued after the last sync). */
export interface SessionAccessFacts {
  /** An admission pass of the event's registration (or any pass at an event without registration). */
  readonly registrant: boolean;
  /** The sessions the pass gives; null = every session. */
  readonly sessionIds: readonly string[] | null;
  /** The sessions the registrant holds a place in. */
  readonly enrolled: boolean;
}

/**
 * The first gate a ticket fails at a session, or `ok`. `overrides` lists gates staff chose to
 * waive (the remaining ones still apply). `occupied` is how many are in the room now.
 */
export function sessionGateResult(i: {
  readonly rule: SessionGateRule;
  readonly access: SessionAccessFacts | null;
  readonly occupied: number;
  readonly overrides?: readonly SessionGate[];
}): 'ok' | SessionRefusal {
  const waived = new Set(i.overrides ?? []);
  const a = i.access;
  if (!waived.has('enrollment')) {
    // An unknown pass can't show an enrollment; it only passes where none is needed.
    if (a ? !a.registrant || (i.rule.enrollmentRequired && !a.enrolled) : i.rule.enrollmentRequired)
      return GATE_RESULT.enrollment;
  }
  if (!waived.has('admission_level') && a && a.sessionIds !== null && !a.sessionIds.includes(i.rule.sessionId))
    return GATE_RESULT.admission_level;
  if (!waived.has('capacity') && i.rule.capacity !== null && i.occupied >= i.rule.capacity)
    return GATE_RESULT.capacity;
  return 'ok';
}

/** Key of a ticket being in a session's room (the device's in-room set). */
export const inRoomKey = (ticketId: string, sessionId: string) => `${ticketId}@${sessionId}`;

/** Milliseconds spent in a room over the visits given (an open visit counts until `until`). */
export function dwellMs(
  visits: readonly { readonly inAt: Date; readonly outAt: Date | null }[],
  until: Date,
): number {
  let total = 0;
  for (const v of visits) {
    const end = v.outAt ?? until;
    if (end.getTime() > v.inAt.getTime()) total += end.getTime() - v.inAt.getTime();
  }
  return total;
}
