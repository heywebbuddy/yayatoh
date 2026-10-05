import { transitionEventCommand } from '@yayatoh/events';
import { quickLayout } from '@yayatoh/floorplan';
import { addPartyGuestCommand, createPartyCommand, guestListQuery } from '@yayatoh/guests';
import { type Ctx, createCtx, executeCommand, executeQuery } from '@yayatoh/kernel';
import { seatGuestsCommand, setEventLayoutCommand, setFinderSettingsCommand } from '@yayatoh/seating';
import { ports } from './ports.ts';
import { type RsvpScenario, rsvpScenario } from './rsvp.ts';

export interface GuestSeatScenario extends RsvpScenario {
  /** Table "1" and table "2" of the plan. */
  readonly t1: string;
  readonly t2: string;
}

/**
 * M4.4a e2e data: the M4.1d wedding (Garcia: Luis López, his plus-one, Ana García; Chen: Mei Chen)
 * plus Okafor (Ada Okafor), a plan of two round tables of 6, Garcia and Mei at table 1, Ada at
 * table 2. `finder`: open the seat finder in that mode (default closed). `publish`: publish the
 * event so its public seat finder page exists.
 */
export async function guestSeatScenario(
  orgId: string,
  opts: { finder?: 'code' | 'name' | 'pin' | null; publish?: boolean; seat?: boolean; ctx?: Ctx } = {},
): Promise<GuestSeatScenario> {
  const ctx = opts.ctx ?? createCtx({ orgId, actor: { type: 'system', name: 'fixture' } });
  const s = await rsvpScenario(orgId, { ctx });
  const okafor = await executeCommand(createPartyCommand, { eventId: s.eventId, name: 'Okafor' }, ctx, ports);
  await executeCommand(
    addPartyGuestCommand,
    { eventId: s.eventId, partyId: okafor.id, firstName: 'Ada', lastName: 'Okafor' },
    ctx,
    ports,
  );
  const doc = quickLayout({ rows: 0, seatsPerRow: 1, tables: 2, seatsPerTable: 6, stage: false });
  await executeCommand(setEventLayoutCommand, { eventId: s.eventId, doc }, ctx, ports);
  const [t1 = '', t2 = ''] = doc.items.map((i) => i.id);
  if (opts.seat !== false) {
    const list = await executeQuery(guestListQuery, { eventId: s.eventId, limit: 50 }, ctx, ports);
    const ids = (party: string) => list.parties.find((p) => p.name === party)?.guests.map((g) => g.id) ?? [];
    const seat = (itemId: string, guestIds: string[]) =>
      executeCommand(
        seatGuestsCommand,
        { eventId: s.eventId, subEventId: null, itemId, guestIds },
        ctx,
        ports,
      );
    await seat(t1, [...ids('Garcia'), ...ids('Chen')]);
    await seat(t2, ids('Okafor'));
  }
  if (opts.finder)
    await executeCommand(
      setFinderSettingsCommand,
      { eventId: s.eventId, publicMap: true, mode: opts.finder },
      ctx,
      ports,
    );
  if (opts.publish)
    await executeCommand(transitionEventCommand, { eventId: s.eventId, transition: 'publish' }, ctx, ports);
  return { ...s, t1, t2 };
}
