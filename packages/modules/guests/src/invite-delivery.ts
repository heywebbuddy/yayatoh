import type { TenantTx } from '@yayatoh/db';
import { findEventTx } from '@yayatoh/events';
import { messageStatesTx } from '@yayatoh/notifications';
import { defineSubscriber, type Notifier } from '@yayatoh/platform';
import { and, asc, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { isE164 } from './domain/collector.ts';
import { defaultInviteCopy, fillInvite } from './domain/invite-copy.ts';
import { unseal } from './guests.ts';
import { rsvpLinkToken } from './rsvp.ts';
import {
  guests,
  type InviteChannel,
  type InviteMessageKind,
  invitationTemplates,
  inviteMessages,
  parties,
  partyInvites,
  partyRsvp,
  rsvpSettings,
} from './schema.ts';

/**
 * Delivery of a party's invitation and deadline reminders (M4.1f), shared by the guests mailer
 * (invitations and test sends, from `guests.invitation_queued@1`) and the journey runner (RSVP
 * reminders, M3.7a). Messages are transactional (P4-3: never marketing, no contact or consent),
 * not urgent (quiet hours in the event's timezone), addressed to the party's sealed email and
 * phone (the primary guest's first, then anyone's in the party) and carry the party's RSVP link.
 * Each queued message is logged in `invite_messages` with its dedupe key; its delivery state
 * (sent, bounced, failed) is read back from notifications by that key.
 */

export interface DeliveryDeps {
  readonly notifier: Notifier;
  readonly appOrigin: string;
}

export interface PartyMessage {
  readonly orgId: string;
  readonly now: Date;
  readonly eventId: string;
  readonly partyId: string;
  readonly kind: 'invitation' | 'reminder';
  readonly channel: InviteChannel;
  /** The notifications dedupe key (an invitation send's, or the journey action's). */
  readonly dedupeKey: string;
  readonly sentBy?: string | null;
}

export type QueueOutcome =
  | { readonly queued: true }
  | { readonly queued: false; readonly reason: 'party_gone' | 'no_address' | 'no_link' | 'link_expired' };

/** The party's email and (E.164) phone: the primary guest's first, then the others' in order. */
export async function partyAddressesTx(
  tx: TenantTx,
  orgId: string,
  partyId: string,
): Promise<{ email: string | null; phone: string | null }> {
  const list = await tx
    .select({ isPrimary: guests.isPrimary, privateCiphertext: guests.privateCiphertext })
    .from(guests)
    .where(and(eq(guests.partyId, partyId), isNotNull(guests.privateCiphertext)))
    .orderBy(asc(guests.createdAt), asc(guests.id));
  const ordered = [...list.filter((g) => g.isPrimary), ...list.filter((g) => !g.isPrimary)];
  let email: string | null = null;
  let phone: string | null = null;
  for (const g of ordered) {
    if (email && phone) break;
    const s = await unseal(orgId, g.privateCiphertext);
    email ??= s.email ?? null;
    if (!phone && isE164(s.phone ?? null)) phone = s.phone ?? null;
  }
  return { email, phone };
}

async function localeOfTx(tx: TenantTx, partyId: string) {
  const [row] = await tx
    .select({ locale: partyInvites.locale })
    .from(partyInvites)
    .where(eq(partyInvites.partyId, partyId));
  return row?.locale ?? 'en';
}

/** The event's wording in a language: the host's, else the built-in one. */
export async function inviteCopyTx(tx: TenantTx, eventId: string, locale: string) {
  const [row] = await tx
    .select()
    .from(invitationTemplates)
    .where(and(eq(invitationTemplates.eventId, eventId), eq(invitationTemplates.locale, locale)));
  return row
    ? { subject: row.subject, message: row.message, smsText: row.smsText, custom: true }
    : { ...defaultInviteCopy(locale), custom: false };
}

const rsvpUrl = (origin: string, linkId: string) =>
  `${origin.replace(/\/$/, '')}/rsvp/${encodeURIComponent(rsvpLinkToken(linkId))}`;

/** Queue one invitation or reminder for a party on one channel (idempotent by its dedupe key). */
export async function queuePartyMessageTx(
  tx: TenantTx,
  deps: DeliveryDeps,
  m: PartyMessage,
): Promise<QueueOutcome> {
  const [party] = await tx
    .select()
    .from(parties)
    .where(and(eq(parties.id, m.partyId), eq(parties.eventId, m.eventId)));
  const ev = party ? await findEventTx(tx, m.eventId) : null;
  if (!party || !ev) return { queued: false, reason: 'party_gone' };
  const [link] = await tx.select().from(partyRsvp).where(eq(partyRsvp.partyId, party.id));
  if (!link) return { queued: false, reason: 'no_link' };
  if (link.linkExpiresAt.getTime() <= m.now.getTime()) return { queued: false, reason: 'link_expired' };
  const addr = await partyAddressesTx(tx, m.orgId, party.id);
  const address = m.channel === 'email' ? addr.email : addr.phone;
  if (!address) return { queued: false, reason: 'no_address' };
  const locale = await localeOfTx(tx, party.id);
  const partyName = party.envelopeName ?? party.name;
  const url = rsvpUrl(deps.appOrigin, link.linkId);
  const to = {
    ...(m.channel === 'email' ? { email: address } : { phone: address }),
    locale,
    timeZone: ev.timezone,
  };
  if (m.kind === 'invitation') {
    const copy = await inviteCopyTx(tx, m.eventId, locale);
    const values = { party: partyName, event: ev.name };
    await deps.notifier.enqueue(tx, {
      kind: 'guests.invitation',
      channels: [m.channel],
      to,
      params: {
        url,
        subject: fillInvite(copy.subject, values),
        message: fillInvite(copy.message, values),
        eventName: ev.name,
        // A text says the host's short wording (the link follows it).
        ...(m.channel === 'sms' ? { body: fillInvite(copy.smsText, values) } : {}),
      },
      dedupeKey: m.dedupeKey,
      eventId: m.eventId,
    });
  } else {
    const [settings] = await tx
      .select({ deadline: rsvpSettings.deadline })
      .from(rsvpSettings)
      .where(eq(rsvpSettings.eventId, m.eventId));
    const deadline = settings?.deadline
      ? new Intl.DateTimeFormat(locale, {
          dateStyle: 'long',
          timeStyle: 'short',
          timeZone: ev.timezone,
        }).format(settings.deadline)
      : '';
    await deps.notifier.enqueue(tx, {
      kind: 'guests.rsvp-reminder',
      channels: [m.channel],
      to: { ...to, name: partyName },
      params: { url, name: partyName, eventName: ev.name, deadline },
      dedupeKey: m.dedupeKey,
      eventId: m.eventId,
    });
  }
  await tx
    .insert(inviteMessages)
    .values({
      orgId: m.orgId,
      eventId: m.eventId,
      partyId: party.id,
      kind: m.kind,
      channel: m.channel,
      dedupeKey: m.dedupeKey,
      locale,
      sentBy: m.sentBy ?? null,
    })
    .onConflictDoNothing();
  return { queued: true };
}

/** The event's RSVP deadline, if set (the journey's `rsvp_deadline` anchor). */
export async function rsvpDeadlineTx(tx: TenantTx, eventId: string): Promise<Date | null> {
  const [row] = await tx
    .select({ deadline: rsvpSettings.deadline })
    .from(rsvpSettings)
    .where(eq(rsvpSettings.eventId, eventId));
  return row?.deadline ?? null;
}

/** Whether the party answered (its reminders stop). A party that is gone counts as answered. */
export async function partyAnsweredTx(tx: TenantTx, partyId: string): Promise<boolean> {
  const [row] = await tx
    .select({ respondedAt: partyRsvp.respondedAt })
    .from(partyRsvp)
    .where(eq(partyRsvp.partyId, partyId));
  return !row || row.respondedAt !== null;
}

/** Parties whose invitation was sent and who haven't answered (reminders switched on later). */
export async function awaitingPartiesTx(
  tx: TenantTx,
  eventId: string,
): Promise<{ partyId: string; locale: string; sentAt: Date }[]> {
  const rows = await tx
    .select({ partyId: partyRsvp.partyId, sentAt: partyRsvp.sentAt, locale: partyInvites.locale })
    .from(partyRsvp)
    .leftJoin(
      partyInvites,
      and(eq(partyInvites.partyId, partyRsvp.partyId), eq(partyInvites.orgId, partyRsvp.orgId)),
    )
    .where(and(eq(partyRsvp.eventId, eventId), isNotNull(partyRsvp.sentAt), isNull(partyRsvp.respondedAt)));
  return rows.map((r) => ({ partyId: r.partyId, locale: r.locale ?? 'en', sentAt: r.sentAt as Date }));
}

/* ---------------------------------------------------------------------------- read back ---- */

/** Where one queued message is, from the notifications log. */
export const DELIVERY_STATES = [
  'queued',
  'waiting',
  'sent',
  'delivered',
  'bounced',
  'failed',
  'not_sent',
  'canceled',
] as const;
export type DeliveryState = (typeof DELIVERY_STATES)[number];

/** Problems the host should see on the party. */
export const PROBLEM_STATES: ReadonlySet<DeliveryState> = new Set(['bounced', 'failed', 'not_sent']);

export function deliveryState(
  s: { status: string; reason: string | null; delivery: string | null; sendAfter: Date } | undefined,
  now: Date,
): { state: DeliveryState; reason: string | null } {
  if (!s) return { state: 'queued', reason: null };
  if (s.delivery === 'bounced' || s.delivery === 'soft_bounced' || s.delivery === 'complained')
    return { state: 'bounced', reason: s.delivery };
  if (s.status === 'sent') return { state: s.delivery === 'delivered' ? 'delivered' : 'sent', reason: null };
  if (s.status === 'failed') return { state: 'failed', reason: s.reason };
  if (s.status === 'suppressed')
    return { state: s.reason === 'bounced' ? 'bounced' : 'not_sent', reason: s.reason };
  if (s.status === 'canceled') return { state: 'canceled', reason: s.reason };
  return { state: s.sendAfter.getTime() > now.getTime() ? 'waiting' : 'queued', reason: s.reason };
}

export interface LoggedMessage {
  readonly id: string;
  readonly partyId: string | null;
  readonly kind: InviteMessageKind;
  readonly channel: InviteChannel;
  readonly locale: string;
  readonly at: Date;
  readonly state: DeliveryState;
  readonly reason: string | null;
}

/** The logged messages of some parties (newest first) with their delivery state. */
export async function partyMessagesTx(
  tx: TenantTx,
  eventId: string,
  partyIds: readonly string[] | null,
  now: Date,
  limit = 2000,
): Promise<LoggedMessage[]> {
  const rows = await tx
    .select()
    .from(inviteMessages)
    .where(
      and(
        eq(inviteMessages.eventId, eventId),
        partyIds === null
          ? isNotNull(inviteMessages.partyId)
          : inArray(inviteMessages.partyId, partyIds.length ? [...partyIds] : [eventId]),
      ),
    )
    .orderBy(inviteMessages.createdAt)
    .limit(limit);
  const states = await messageStatesTx(
    tx,
    rows.map((r) => r.dedupeKey),
  );
  const byKey = new Map(states.map((s) => [`${s.channel}|${s.dedupeKey}`, s]));
  return rows
    .map((r) => {
      const d = deliveryState(byKey.get(`${r.channel}|${r.dedupeKey}`), now);
      return {
        id: r.id,
        partyId: r.partyId,
        kind: r.kind as InviteMessageKind,
        channel: r.channel as InviteChannel,
        locale: r.locale,
        at: r.createdAt,
        ...d,
      };
    })
    .reverse();
}

/* ------------------------------------------------------------------------------- mailer ---- */

export const INVITATION_QUEUED_EVENT = 'guests.invitation_queued';
export const InvitationQueuedPayload = z.object({
  orgId: z.uuid(),
  eventId: z.uuid(),
  /** Null for a test send (to the host who asked). */
  partyId: z.uuid().nullable(),
  sendId: z.uuid(),
  channels: z.array(z.enum(['email', 'sms'])).min(1),
  kind: z.enum(['invitation', 'test']),
  locale: z.string(),
  /** The member who sent it (test sends go to them). */
  userId: z.uuid().nullable(),
});
export type InvitationQueuedPayload = z.infer<typeof InvitationQueuedPayload>;

export const inviteDedupeKey = (partyId: string, sendId: string) => `guests-invite:${partyId}:${sendId}`;
export const testDedupeKey = (sendId: string) => `guests-invite-test:${sendId}`;

/**
 * Queues what `guests.sendInvitations` and `guests.sendTestInvitation` decided (the command has
 * no notifier): each party's invitation on its channels, or the host's test email in the chosen
 * language (a sample party, the real wording and a link that opens nothing).
 */
export function invitationMailer(deps: DeliveryDeps) {
  return defineSubscriber({
    name: 'guests.invitation-mailer',
    events: [`${INVITATION_QUEUED_EVENT}@1`],
    handle: async (tx, event) => {
      if (event.replayed) return;
      const p = InvitationQueuedPayload.parse(event.payload);
      const now = new Date();
      if (p.kind === 'test') {
        if (!p.userId) return;
        const ev = await findEventTx(tx, p.eventId);
        if (!ev) return;
        const copy = await inviteCopyTx(tx, p.eventId, p.locale);
        const values = { party: 'The Sample family', event: ev.name };
        await deps.notifier.enqueue(tx, {
          kind: 'guests.invitation',
          channels: ['email'],
          to: { userId: p.userId, locale: p.locale, timeZone: ev.timezone },
          params: {
            url: `${deps.appOrigin.replace(/\/$/, '')}/rsvp/test`,
            subject: fillInvite(copy.subject, values),
            message: fillInvite(copy.message, values),
            eventName: ev.name,
          },
          dedupeKey: testDedupeKey(p.sendId),
          eventId: p.eventId,
        });
        await tx
          .insert(inviteMessages)
          .values({
            orgId: p.orgId,
            eventId: p.eventId,
            partyId: null,
            kind: 'test',
            channel: 'email',
            dedupeKey: testDedupeKey(p.sendId),
            locale: p.locale,
            sentBy: p.userId,
          })
          .onConflictDoNothing();
        return;
      }
      if (!p.partyId) return;
      for (const channel of p.channels)
        await queuePartyMessageTx(tx, deps, {
          orgId: p.orgId,
          now,
          eventId: p.eventId,
          partyId: p.partyId,
          kind: 'invitation',
          channel,
          dedupeKey: inviteDedupeKey(p.partyId, p.sendId),
          sentBy: p.userId,
        });
    },
  });
}
