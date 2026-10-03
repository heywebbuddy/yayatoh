import {
  armLevelCommand,
  assignPaddleCommand,
  closeCallCommand,
  confirmEntriesCommand,
  createCampaignCommand,
  createLevelCommand,
  recordPaddlesCommand,
} from '@yayatoh/donations';
import {
  addPartyGuestCommand,
  createPartyCommand,
  createRsvpLinksCommand,
  partyRsvpQuery,
} from '@yayatoh/guests';
import { createCtx, executeCommand, executeQuery, uuidv7 } from '@yayatoh/kernel';
import { ports } from './ports.ts';

export interface PledgeParty {
  readonly id: string;
  readonly name: string;
  /** The party's own link (its QR code on the table). */
  readonly token: string;
  readonly paddle: number;
}

export interface PledgeScenario {
  readonly campaignId: string;
  /** Pledged the $1,000 level. */
  readonly rivera: PledgeParty;
  /** Pledged the $1,000 level. */
  readonly nakamura: PledgeParty;
  /** Pledged the $250 level. */
  readonly okafor: PledgeParty;
}

/**
 * M4.8e e2e data on a published gala of a connected org: a campaign "Fund-a-need" with two levels
 * ($1,000 "Fund a classroom", $250 "A school day"), three parties with a guest, a link and a
 * paddle each, and a paddle raise that confirmed their pledges (Rivera and Nakamura $1,000,
 * Okafor $250). The night is not closed: the host does that in the console.
 */
export async function pledgeScenario(orgId: string, eventId: string): Promise<PledgeScenario> {
  const ctx = createCtx({ orgId, actor: { type: 'system', name: 'fixture' } });
  const campaign = await executeCommand(
    createCampaignCommand,
    {
      eventId,
      name: 'Fund-a-need',
      goalMinor: 5_000_000,
    },
    ctx,
    ports,
  );
  const level = async (name: string, amountMinor: number) =>
    (
      await executeCommand(
        createLevelCommand,
        { eventId, campaignId: campaign.id, name, amountMinor },
        ctx,
        ports,
      )
    ).id;
  const gold = await level('Fund a classroom', 100_000);
  const day = await level('A school day', 25_000);
  const tag = uuidv7().slice(-4);
  const parties: { id: string; name: string }[] = [];
  for (const [name, first] of [
    ['Rivera', 'Sofia'],
    ['Nakamura', 'Ken'],
    ['Okafor', 'Ada'],
  ] as const) {
    const p = await executeCommand(createPartyCommand, { eventId, name: `${name} ${tag}` }, ctx, ports);
    await executeCommand(
      addPartyGuestCommand,
      { eventId, partyId: p.id, firstName: first, lastName: name },
      ctx,
      ports,
    );
    parties.push({ id: p.id, name: `${name} ${tag}` });
  }
  await executeCommand(createRsvpLinksCommand, { eventId }, ctx, ports);
  const out: PledgeParty[] = [];
  for (const p of parties) {
    const paddle = await executeCommand(assignPaddleCommand, { eventId, partyId: p.id }, ctx, ports);
    const d = await executeQuery(partyRsvpQuery, { eventId, partyId: p.id }, ctx, ports);
    if (!d.token) throw new Error('pledgeScenario: no link');
    out.push({ ...p, token: d.token, paddle: paddle.number });
  }
  const [rivera, nakamura, okafor] = out as [PledgeParty, PledgeParty, PledgeParty];
  const raise = async (levelId: string, paddles: number[]) => {
    const call = await executeCommand(
      armLevelCommand,
      { eventId, campaignId: campaign.id, levelId },
      ctx,
      ports,
    );
    await executeCommand(
      recordPaddlesCommand,
      {
        eventId,
        entries: paddles.map((paddle) => ({
          clientId: uuidv7(),
          callId: call.id,
          paddle,
          recordedAt: new Date(),
        })),
      },
      ctx,
      ports,
    );
    await executeCommand(closeCallCommand, { eventId, callId: call.id }, ctx, ports);
    await executeCommand(confirmEntriesCommand, { eventId, callId: call.id }, ctx, ports);
  };
  await raise(gold, [rivera.paddle, nakamura.paddle]);
  await raise(day, [okafor.paddle]);
  return { campaignId: campaign.id, rivera, nakamura, okafor };
}
