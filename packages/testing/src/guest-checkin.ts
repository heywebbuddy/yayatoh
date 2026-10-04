import {
  addPartyGuestCommand,
  guestListQuery,
  recordSubEventResponseCommand,
  subEventsQuery,
  updatePartyCommand,
  updatePartyGuestCommand,
} from '@yayatoh/guests';
import { type Ctx, createCtx, executeCommand, executeQuery } from '@yayatoh/kernel';
import { type GuestSeatScenario, guestSeatScenario } from './guest-seat-finder.ts';
import { ports } from './ports.ts';

export interface GuestCheckinScenario extends GuestSeatScenario {
  /** Guest ids by full name ("Luis López", …); the plus-one is `plusOne`. */
  readonly ids: Readonly<Record<string, string>>;
  readonly plusOne: string;
  readonly okaforId: string;
}

/**
 * M4.4b e2e/integration data, on the M4.4a wedding: Garcia (Luis López + his plus-one, Ana García;
 * labels Bride, Family) and Chen (Mei Chen; Groom) at table 1, Okafor (Ada Okafor; Bride) at
 * table 2, plus Kofi Okafor not seated. Luis and Ana said yes to the ceremony (Luis: Beef, Ana:
 * Fish), Mei declined it; everyone else hasn't answered.
 */
export async function guestCheckinScenario(
  orgId: string,
  opts: { ctx?: Ctx } = {},
): Promise<GuestCheckinScenario> {
  const ctx = opts.ctx ?? createCtx({ orgId, actor: { type: 'system', name: 'fixture' } });
  const s = await guestSeatScenario(orgId, { ctx });
  const list = await executeQuery(guestListQuery, { eventId: s.eventId, limit: 50 }, ctx, ports);
  const party = (name: string) => {
    const p = list.parties.find((x) => x.name === name);
    if (!p) throw new Error(`guestCheckinScenario: no party ${name}`);
    return p;
  };
  const tag = async (name: string, tags: string[]) => {
    const p = party(name);
    await executeCommand(
      updatePartyCommand,
      { eventId: s.eventId, partyId: p.id, name: p.name, envelopeName: p.envelopeName, tags },
      ctx,
      ports,
    );
  };
  await tag('Garcia', ['Bride', 'Family']);
  await tag('Chen', ['Groom']);
  await tag('Okafor', ['Bride']);
  await executeCommand(
    addPartyGuestCommand,
    { eventId: s.eventId, partyId: party('Okafor').id, firstName: 'Kofi', lastName: 'Okafor' },
    ctx,
    ports,
  );
  const ids: Record<string, string> = {};
  let plusOne = '';
  const fresh = await executeQuery(guestListQuery, { eventId: s.eventId, limit: 50 }, ctx, ports);
  for (const p of fresh.parties)
    for (const g of p.guests) {
      if (g.kind === 'plus_one') plusOne = g.id;
      else ids[`${g.firstName ?? ''} ${g.lastName ?? ''}`.trim()] = g.id;
    }
  const ceremony = (await executeQuery(subEventsQuery, { eventId: s.eventId }, ctx, ports)).find(
    (x) => x.name === 'Ceremony',
  );
  if (!ceremony) throw new Error('guestCheckinScenario: no ceremony');
  const answer = (name: string, status: 'attending' | 'declined') =>
    executeCommand(
      recordSubEventResponseCommand,
      { eventId: s.eventId, guestId: ids[name] ?? '', subEventId: ceremony.id, status },
      ctx,
      ports,
    );
  await answer('Luis López', 'attending');
  await answer('Ana García', 'attending');
  await answer('Mei Chen', 'declined');
  const meal = (name: string, value: string, firstName: string, lastName: string) =>
    executeCommand(
      updatePartyGuestCommand,
      { eventId: s.eventId, guestId: ids[name] ?? '', firstName, lastName, meal: value },
      ctx,
      ports,
    );
  await meal('Luis López', 'Beef', 'Luis', 'López');
  await meal('Ana García', 'Fish', 'Ana', 'García');
  return { ...s, ids, plusOne, okaforId: party('Okafor').id };
}
