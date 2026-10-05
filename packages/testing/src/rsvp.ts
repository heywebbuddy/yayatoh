import { createEventCommand } from '@yayatoh/events';
import {
  addPartyGuestCommand,
  addPlusOneCommand,
  createPartyCommand,
  createRsvpLinksCommand,
  createSubEventCommand,
  partyRsvpQuery,
  setInvitationsCommand,
  setRsvpSettingsCommand,
} from '@yayatoh/guests';
import { type Ctx, createCtx, executeCommand, executeQuery, uuidv7 } from '@yayatoh/kernel';
import { ports } from './ports.ts';

export interface RsvpParty {
  readonly id: string;
  readonly name: string;
  readonly token: string;
  readonly pin: string;
}

export interface RsvpScenario {
  readonly eventId: string;
  readonly eventSlug: string;
  readonly eventName: string;
  readonly lookupCode: string;
  /** Luis López (with a placeholder plus-one) and Ana García: ceremony for all, reception for Luis. */
  readonly garcia: RsvpParty;
  /** Mei Chen: the ceremony only. */
  readonly chen: RsvpParty;
}

/**
 * M4.1d e2e/integration data: a wedding (Chicago) with a ceremony (everyone) and a reception
 * (Luis, so his plus-one too), two parties with links and PINs, and the event's RSVP settings
 * (`deadline`: none unless given). Built through the guests commands, as a host would.
 */
export async function rsvpScenario(
  orgId: string,
  opts: { deadline?: Date | null; nameLookup?: boolean; ctx?: Ctx } = {},
): Promise<RsvpScenario> {
  const ctx = opts.ctx ?? createCtx({ orgId, actor: { type: 'system', name: 'fixture' } });
  const tag = uuidv7().slice(-8);
  const start = new Date(Date.now() + 60 * 86_400_000);
  start.setUTCHours(20, 0, 0, 0);
  const at = (h: number) => new Date(start.getTime() + h * 3_600_000).toISOString();
  const eventName = `Lopez Chen Wedding ${tag}`;
  const ev = await executeCommand(
    createEventCommand,
    {
      name: eventName,
      slug: `rsvp-${tag}`,
      profile: 'wedding',
      timezone: 'America/Chicago',
      startsAt: at(0),
      endsAt: at(8),
    },
    ctx,
    ports,
  );
  const party = (name: string) =>
    executeCommand(
      createPartyCommand,
      { eventId: ev.id, name, envelopeName: `The ${name} family` },
      ctx,
      ports,
    );
  const garcia = await party('Garcia');
  const chen = await party('Chen');
  const add = (partyId: string, firstName: string, lastName: string) =>
    executeCommand(addPartyGuestCommand, { eventId: ev.id, partyId, firstName, lastName }, ctx, ports);
  const luis = await add(garcia.id, 'Luis', 'López');
  await add(garcia.id, 'Ana', 'García');
  await add(chen.id, 'Mei', 'Chen');
  await executeCommand(addPlusOneCommand, { eventId: ev.id, hostGuestId: luis.id }, ctx, ports);
  await executeCommand(
    createSubEventCommand,
    {
      eventId: ev.id,
      name: 'Ceremony',
      kind: 'ceremony',
      startsAt: at(0),
      endsAt: at(1),
      place: 'The garden',
      inviteAll: true,
    },
    ctx,
    ports,
  );
  const reception = await executeCommand(
    createSubEventCommand,
    { eventId: ev.id, name: 'Reception', kind: 'reception', startsAt: at(1), endsAt: at(6) },
    ctx,
    ports,
  );
  await executeCommand(
    setInvitationsCommand,
    {
      eventId: ev.id,
      subEventIds: [reception.id],
      target: { kind: 'guests', guestIds: [luis.id] },
      invited: true,
    },
    ctx,
    ports,
  );
  await executeCommand(
    setRsvpSettingsCommand,
    { eventId: ev.id, deadline: opts.deadline ?? null, nameLookup: opts.nameLookup ?? true },
    ctx,
    ports,
  );
  await executeCommand(createRsvpLinksCommand, { eventId: ev.id }, ctx, ports);
  const detail = async (id: string, name: string): Promise<RsvpParty> => {
    const d = await executeQuery(partyRsvpQuery, { eventId: ev.id, partyId: id }, ctx, ports);
    if (!d.token || !d.pin || !d.lookupCode) throw new Error('rsvpScenario: no link');
    return { id, name, token: d.token, pin: d.pin };
  };
  const g = await detail(garcia.id, 'Garcia');
  const c = await detail(chen.id, 'Chen');
  const d = await executeQuery(partyRsvpQuery, { eventId: ev.id, partyId: garcia.id }, ctx, ports);
  return {
    eventId: ev.id,
    eventSlug: ev.slug,
    eventName,
    lookupCode: d.lookupCode as string,
    garcia: g,
    chen: c,
  };
}
