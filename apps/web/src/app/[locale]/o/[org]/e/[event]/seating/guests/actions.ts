'use server';

import { executeCommand, isDomainError } from '@yayatoh/kernel';
import { seatGuestsCommand, setVipTableCommand, unseatGuestsCommand } from '@yayatoh/seating';
import { loadEvent } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';

/** What the guest seating editor gets back from a change (M4.3a). */
export interface GuestSeatingState {
  readonly ok: boolean;
  readonly code: string | null;
  readonly reason?: string;
  /** `cant_fit`: how many were to be seated, and how many seats are free. */
  readonly asked?: number;
  readonly fits?: number;
  readonly count?: number;
  /** VIP zone warnings (never a refusal). */
  readonly warnings?: readonly { partyId: string; kind: 'vip_outside' | 'not_vip_inside' }[];
}

const fail = (err: unknown): GuestSeatingState => {
  if (!isDomainError(err)) return { ok: false, code: 'internal' };
  const d = (err.details ?? {}) as { reason?: unknown; asked?: unknown; fits?: unknown };
  return {
    ok: false,
    code: err.code,
    reason: typeof d.reason === 'string' ? d.reason : undefined,
    asked: typeof d.asked === 'number' ? d.asked : undefined,
    fits: typeof d.fits === 'number' ? d.fits : undefined,
  };
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** The chart being seated: a sub-event's id from the page, else the event plan. */
const subOf = (v: string | null) => (v && UUID.test(v) ? v : null);

/** Seat guests (a party, a group of parties, one guest, or a move) at a table or row. */
export async function seatGuestsAction(
  org: string,
  event: string,
  subEventId: string | null,
  input: { itemId: string; guestIds: string[] },
): Promise<GuestSeatingState> {
  const { data, event: ev } = await loadEvent(org, event, 'seating');
  try {
    const r = await executeCommand(
      seatGuestsCommand,
      { eventId: ev.id, subEventId: subOf(subEventId), itemId: input.itemId, guestIds: input.guestIds },
      data.ctx,
      ports,
    );
    return { ok: true, code: null, count: r.seated, warnings: r.warnings };
  } catch (err) {
    return fail(err);
  }
}

/** Send guests back to the unseated queue. */
export async function unseatGuestsAction(
  org: string,
  event: string,
  subEventId: string | null,
  guestIds: string[],
): Promise<GuestSeatingState> {
  const { data, event: ev } = await loadEvent(org, event, 'seating');
  try {
    const r = await executeCommand(
      unseatGuestsCommand,
      { eventId: ev.id, subEventId: subOf(subEventId), guestIds },
      data.ctx,
      ports,
    );
    return { ok: true, code: null, count: r.unseated };
  } catch (err) {
    return fail(err);
  }
}

/** Mark or unmark a table as a VIP zone. */
export async function setVipTableAction(
  org: string,
  event: string,
  subEventId: string | null,
  input: { itemId: string; vip: boolean },
): Promise<GuestSeatingState> {
  const { data, event: ev } = await loadEvent(org, event, 'seating');
  try {
    await executeCommand(
      setVipTableCommand,
      { eventId: ev.id, subEventId: subOf(subEventId), itemId: input.itemId, vip: input.vip },
      data.ctx,
      ports,
    );
    return { ok: true, code: null };
  } catch (err) {
    return fail(err);
  }
}
