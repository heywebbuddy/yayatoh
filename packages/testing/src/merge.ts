import { catchUpParticipation, saveSegmentCommand } from '@yayatoh/audiences';
import {
  createJourneyCommand,
  journeySubscribers,
  setJourneyEnabledCommand,
  visionTemplate,
} from '@yayatoh/automations';
import {
  campaignsTimeline,
  createCampaignCommand,
  runOrgCampaigns,
  saveCampaignCommand,
  sendNowCommand,
  setAudienceCommand,
} from '@yayatoh/campaigns';
import { checkinTimeline, scanTicketCommand } from '@yayatoh/checkin';
import { contactIdByEmailTx, recordConsentTx, setContactPhoneTx } from '@yayatoh/crm';
import { withTenant } from '@yayatoh/db';
import { createEventCommand, transitionEventCommand } from '@yayatoh/events';
import { type Ctx, createCtx, executeCommand, uuidv7 } from '@yayatoh/kernel';
import { messagingTimeline } from '@yayatoh/messaging';
import { createNotifier } from '@yayatoh/notifications';
import { orderByManageToken, ordersTimeline, startCheckoutCommand, ticketMailer } from '@yayatoh/orders';
import { catchUpSubscriber, type Subscriber } from '@yayatoh/platform';
import { surveysTimeline } from '@yayatoh/surveys';
import { createTicketTypeCommand } from '@yayatoh/ticketing';
import { sql } from 'drizzle-orm';
import { ports } from './ports.ts';

/** The M6.1a timeline subscribers, composed like the worker's. */
export const TIMELINE_SUBSCRIBERS = (): Subscriber[] => [
  ordersTimeline(),
  checkinTimeline(),
  messagingTimeline(),
  surveysTimeline(),
  campaignsTimeline(),
];

/** Apply one org's outbox to the person timeline (e2e and tests; the worker does this live). */
export async function catchUpTimeline(orgId: string): Promise<number> {
  let n = 0;
  for (const s of TIMELINE_SUBSCRIBERS()) n += await catchUpSubscriber(s, orgId);
  return n;
}

export const MERGE_EDITIONS = {
  summit: {
    startsAt: '2027-05-01T15:00:00Z',
    endsAt: '2027-05-01T23:00:00Z',
    during: '2027-05-01T16:00:00Z',
  },
  gala: { startsAt: '2027-09-10T23:00:00Z', endsAt: '2027-09-11T03:00:00Z' },
} as const;

export interface MergePerson {
  readonly contactId: string;
  readonly email: string;
  readonly name: string;
}

export interface MergeScenario {
  readonly tag: string;
  readonly summit: string;
  readonly summitName: string;
  readonly gala: string;
  readonly galaName: string;
  /** The older record: bought the Summit, checked in, opted in to email; got "Summit news". */
  readonly keep: MergePerson;
  /** The newer duplicate (same Gmail mailbox): Summit and Gala, a phone and company, opted out. */
  readonly dup: MergePerson;
  /** Someone else entirely (never a candidate). */
  readonly other: MergePerson;
  readonly journeyId: string;
  readonly summitCampaign: string;
  readonly galaCampaign: string;
}

/**
 * The M6.1a merge scenario, through the real commands in one org (integration tests and e2e
 * share it). Taylor Reed bought a Summit pass as `taylorreed.<tag>@gmail.com`, checked in and
 * opted in to email marketing; later "Taylor.Reed.<tag>+vip@googlemail.com" (the same Gmail
 * mailbox) bought Summit and Gala passes, gave a phone and company, and opted out. A journey on
 * the Summit enrolled both, ticket emails went to both, "Summit news" reached the opted-in
 * record and "Gala news" (Gala buyers) reached Jordan Blake and excluded the opted-out duplicate. The projections catch up.
 */
export async function mergeScenario(
  orgId: string,
  ctx: Ctx = createCtx({ orgId, actor: { type: 'system', name: 'fixture' } }),
): Promise<MergeScenario> {
  const tag = uuidv7().slice(-8);
  const E = MERGE_EDITIONS;
  const event = async (name: string, when: { startsAt: string; endsAt: string }) => {
    const e = await executeCommand(
      createEventCommand,
      { name, timezone: 'America/Chicago', startsAt: when.startsAt, endsAt: when.endsAt },
      ctx,
      ports,
    );
    return e.id;
  };
  const summitName = `Lakeside Summit ${tag}`;
  const galaName = `Harbor Gala ${tag}`;
  const summit = await event(summitName, E.summit);
  const gala = await event(galaName, E.gala);
  const pass = async (eventId: string) =>
    (
      await executeCommand(
        createTicketTypeCommand,
        { eventId, name: 'Pass', priceMinor: 0, quantityTotal: 50 },
        ctx,
        ports,
      )
    ).id;
  const summitPass = await pass(summit);
  const galaPass = await pass(gala);
  for (const id of [summit, gala])
    await executeCommand(transitionEventCommand, { eventId: id, transition: 'publish' }, ctx, ports);
  const copy = visionTemplate({
    confirmation: { subject: 'You are in, {name}', body: 'See you at {event}.' },
    week: { subject: 'One week to {event}', body: 'Seven days left.' },
    day: { subject: 'Tomorrow: {event}', body: 'Doors at nine.' },
    eventDay: { subject: 'Today: {event}', body: 'See you soon.' },
  });
  const journey = async (name: string, eventId: string) => {
    const { id } = await executeCommand(
      createJourneyCommand,
      { name, eventId, template: 'vision', ...copy },
      ctx,
      ports,
    );
    await executeCommand(setJourneyEnabledCommand, { journeyId: id, enabled: true }, ctx, ports);
    return id;
  };
  // Both records enroll in the Summit journey (one run per person: a clash on merge); only the
  // duplicate in the Gala's.
  const journeyId = await journey(`Summit welcome ${tag}`, summit);
  await journey(`Gala welcome ${tag}`, gala);

  const buy = async (eventId: string, ticketTypeId: string, email: string, name: string) => {
    const r = await executeCommand(
      startCheckoutCommand,
      { eventId, items: [{ ticketTypeId, quantity: 1 }], buyer: { email, name } },
      createCtx({ orgId }),
      ports,
    );
    return (await orderByManageToken(r.manageToken))?.tickets ?? [];
  };
  const contactOf = async (email: string) =>
    (await withTenant(ctx, (tx) => contactIdByEmailTx(tx, email))) as string;

  const keepEmail = `taylorreed.${tag}@gmail.com`;
  const [keepTicket] = await buy(summit, summitPass, keepEmail, 'Taylor Reed');
  const keepId = await contactOf(keepEmail);
  await executeCommand(
    scanTicketCommand,
    { eventId: summit, code: keepTicket?.code ?? '' },
    { ...ctx, now: new Date(E.summit.during) },
    ports,
  );
  const dupEmail = `Taylor.Reed.${tag}+vip@googlemail.com`;
  await buy(summit, summitPass, dupEmail, 'Taylor Reed');
  await buy(gala, galaPass, dupEmail, 'Taylor Reed');
  const dupId = await contactOf(dupEmail);
  const otherEmail = `jordan.blake.${tag}@example.test`;
  await buy(gala, galaPass, otherEmail, 'Jordan Blake');
  const otherId = await contactOf(otherEmail);
  const phone = `+1312555${String(Number.parseInt(tag.slice(-4), 16) % 10_000).padStart(4, '0')}`;
  // The duplicate changed last (its phone and company), now.
  const now = { ...ctx, now: new Date() };
  await withTenant(now, async (tx) => {
    await setContactPhoneTx(tx, now, dupId, phone);
    await tx.execute(
      sql`update crm.contacts set company = 'Lakeside Partners', updated_at = now() where id = ${dupId}`,
    );
    await recordConsentTx(tx, ctx, {
      contactId: keepId,
      channel: 'email',
      purpose: 'marketing',
      status: 'granted',
      evidence: 'fixture: checkout opt-in',
    });
    await recordConsentTx(tx, ctx, {
      contactId: otherId,
      channel: 'email',
      purpose: 'marketing',
      status: 'granted',
      evidence: 'fixture: checkout opt-in',
    });
    await recordConsentTx(tx, ctx, {
      contactId: dupId,
      channel: 'email',
      purpose: 'marketing',
      status: 'withdrawn',
      evidence: 'fixture: unsubscribe link',
    });
  });

  // Journeys enroll on purchase; ticket emails are queued (both with the buyer's contact).
  const notifier = createNotifier();
  for (const s of [...journeySubscribers(), ticketMailer({ notifier, appOrigin: 'http://localhost:3100' })])
    await catchUpSubscriber(s, orgId);
  await catchUpParticipation(orgId);

  const campaign = async (name: string, conditions: unknown[]) => {
    const c = await executeCommand(createCampaignCommand, { name }, ctx, ports);
    await executeCommand(
      saveCampaignCommand,
      {
        campaignId: c.id,
        name,
        locale: 'en',
        content: {
          subject: `${name} for {{first_name|you}}`,
          preheader: '',
          font: 'sans',
          smsBody: '',
          blocks: [
            { id: 'b1', type: 'heading', text: 'Hello {{first_name|there}}' },
            { id: 'b2', type: 'footer', postalAddress: '1 Lake St, Chicago IL 60601', note: '' },
          ],
        },
      },
      ctx,
      ports,
    );
    const seg = await executeCommand(
      saveSegmentCommand,
      { name: `${name} people`, definition: { version: 1, root: { type: 'group', op: 'and', conditions } } },
      ctx,
      ports,
    );
    await executeCommand(
      setAudienceCommand,
      { campaignId: c.id, audience: { kind: 'segment', segmentId: seg.id } },
      ctx,
      ports,
    );
    await executeCommand(
      sendNowCommand,
      { campaignId: c.id },
      { ...ctx, idempotencyKey: `merge-${c.id}` },
      ports,
    );
    return c.id;
  };
  const summitCampaign = await campaign(`Summit news ${tag}`, [
    { type: 'consent', channel: 'email', granted: true },
    { type: 'participation', scope: { kind: 'event', eventId: summit } },
  ]);
  const galaCampaign = await campaign(`Gala news ${tag}`, [
    { type: 'participation', scope: { kind: 'event', eventId: gala }, role: 'buyer' },
  ]);
  await runOrgCampaigns(orgId, ports);
  await catchUpTimeline(orgId);
  return {
    tag,
    summit,
    summitName,
    gala,
    galaName,
    keep: { contactId: keepId, email: keepEmail, name: 'Taylor Reed' },
    // Checkout stores addresses lower-cased.
    dup: { contactId: dupId, email: dupEmail.toLowerCase(), name: 'Taylor Reed' },
    other: { contactId: otherId, email: otherEmail, name: 'Jordan Blake' },
    journeyId,
    summitCampaign,
    galaCampaign,
  };
}
