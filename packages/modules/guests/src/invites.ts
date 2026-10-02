import { type Ctx, DomainError, requireOrg, uuidv7 } from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import {
  DEFAULT_INVITE_COPY,
  fillInvite,
  INVITE_LOCALES,
  MESSAGE_MAX,
  SMS_MAX,
  SUBJECT_MAX,
} from './domain/invite-copy.ts';
import { isE164, normalizeEmail, normalizePhone } from './domain/collector.ts';
import { recordHistoryTx, seal, unseal } from './guests.ts';
import {
  DELIVERY_STATES,
  INVITATION_QUEUED_EVENT,
  type InvitationQueuedPayload,
  inviteCopyTx,
  PROBLEM_STATES,
  partyAddressesTx,
  partyMessagesTx,
} from './invite-delivery.ts';
import { partyLocalesTx, setPartyLocaleTx } from './invites-state.ts';
import { ensurePartyRsvpTx, ensureSettingsTx, eventOfTx, partyOfTx } from './rsvp-state.ts';
import {
  INVITE_CHANNELS,
  INVITE_MESSAGE_KINDS,
  type InviteChannel,
  guests,
  invitationTemplates,
  parties,
  partyRsvp,
} from './schema.ts';

/**
 * Invitations by email and text (M4.1f). The host writes the event's wording per language (or
 * keeps the built-in one), previews it, sends a test to themselves, then sends every party (or
 * the chosen ones) its invitation with its own RSVP link. Sending marks the party `sent`
 * (M4.1d's states); opening the link marks it `viewed`. Bounces and failures show on the party
 * (`partyInvitesQuery`). Transactional only, never marketing (P4-3). The command decides and
 * logs; the guests mailer (`invitationMailer`) queues the messages from the outbox.
 */

const userOf = (ctx: Ctx) => (ctx.actor.type === 'user' ? ctx.actor.userId : null);

const Locale = z.enum(INVITE_LOCALES);
const Channels = z
  .array(z.enum(INVITE_CHANNELS))
  .min(1)
  .max(2)
  .transform((c) => [...new Set(c)]);

/* ------------------------------------------------------------------------------ wording ---- */

export const InvitationTemplateDto = z.object({
  locale: Locale,
  subject: z.string(),
  message: z.string(),
  smsText: z.string(),
  /** False: the built-in wording of that language. */
  custom: z.boolean(),
});
export type InvitationTemplateDto = z.infer<typeof InvitationTemplateDto>;

/** The event's wording in every language (the host's where written, else the built-in one). */
export const invitationTemplatesQuery = tenantQuery({
  name: 'guests.invitationTemplates',
  input: z.object({ eventId: z.uuid() }),
  output: z.array(InvitationTemplateDto),
  entitlement: 'guests',
  permission: 'guests:read',
  handler: async ({ input, tx }) => {
    const rows = await tx
      .select()
      .from(invitationTemplates)
      .where(eq(invitationTemplates.eventId, input.eventId));
    const mine = new Map(rows.map((r) => [r.locale, r]));
    return INVITE_LOCALES.map((locale) => {
      const r = mine.get(locale);
      return r
        ? { locale, subject: r.subject, message: r.message, smsText: r.smsText, custom: true }
        : { locale, ...DEFAULT_INVITE_COPY[locale], custom: false };
    });
  },
});

/** Write the event's wording for one language. */
export const setInvitationTemplateCommand = tenantCommand({
  name: 'guests.setInvitationTemplate',
  input: z.object({
    eventId: z.uuid(),
    locale: Locale,
    subject: z.string().trim().min(1).max(SUBJECT_MAX),
    message: z.string().trim().min(1).max(MESSAGE_MAX),
    smsText: z.string().trim().min(1).max(SMS_MAX),
  }),
  output: z.object({ ok: z.literal(true) }),
  entitlement: 'guests',
  permission: 'guests:write',
  handler: async ({ input, ctx, tx }) => {
    await eventOfTx(tx, input.eventId);
    const { eventId, locale, subject, message, smsText } = input;
    await tx
      .insert(invitationTemplates)
      .values({ orgId: requireOrg(ctx), eventId, locale, subject, message, smsText })
      .onConflictDoUpdate({
        target: [invitationTemplates.orgId, invitationTemplates.eventId, invitationTemplates.locale],
        set: { subject, message, smsText, updatedAt: ctx.now },
      });
    return { ok: true as const };
  },
  audit: (input) => ({
    action: 'guests.invitation_template.set',
    targetType: 'event',
    targetId: input.eventId,
    data: { locale: input.locale },
  }),
});

/** Go back to the built-in wording of one language. */
export const resetInvitationTemplateCommand = tenantCommand({
  name: 'guests.resetInvitationTemplate',
  input: z.object({ eventId: z.uuid(), locale: Locale }),
  output: z.object({ ok: z.literal(true) }),
  entitlement: 'guests',
  permission: 'guests:write',
  handler: async ({ input, tx }) => {
    await eventOfTx(tx, input.eventId);
    await tx
      .delete(invitationTemplates)
      .where(
        and(eq(invitationTemplates.eventId, input.eventId), eq(invitationTemplates.locale, input.locale)),
      );
    return { ok: true as const };
  },
  audit: (input) => ({
    action: 'guests.invitation_template.reset',
    targetType: 'event',
    targetId: input.eventId,
    data: { locale: input.locale },
  }),
});

/**
 * What an invitation in this language will say, filled for one party (or a sample household):
 * the email's subject and message and the text message (the RSVP link follows each).
 */
export const invitationPreviewQuery = tenantQuery({
  name: 'guests.invitationPreview',
  input: z.object({ eventId: z.uuid(), locale: Locale, partyId: z.uuid().optional() }),
  output: z.object({ subject: z.string(), message: z.string(), smsText: z.string(), partyName: z.string() }),
  entitlement: 'guests',
  permission: 'guests:read',
  handler: async ({ input, tx }) => {
    const ev = await eventOfTx(tx, input.eventId);
    const party = input.partyId ? await partyOfTx(tx, input.eventId, input.partyId) : null;
    const partyName = party ? (party.envelopeName ?? party.name) : '';
    const copy = await inviteCopyTx(tx, input.eventId, input.locale);
    const values = { party: partyName || '…', event: ev.name };
    return {
      subject: fillInvite(copy.subject, values),
      message: fillInvite(copy.message, values),
      smsText: fillInvite(copy.smsText, values),
      partyName,
    };
  },
});

/** A party's invitation language. */
export const setPartyLocaleCommand = tenantCommand({
  name: 'guests.setPartyLocale',
  input: z.object({ eventId: z.uuid(), partyId: z.uuid(), locale: Locale }),
  output: z.object({ ok: z.literal(true) }),
  entitlement: 'guests',
  permission: 'guests:write',
  handler: async ({ input, ctx, tx }) => {
    await partyOfTx(tx, input.eventId, input.partyId);
    await setPartyLocaleTx(tx, ctx, input.eventId, input.partyId, input.locale);
    return { ok: true as const };
  },
  audit: (input) => ({
    action: 'guests.party_locale.set',
    targetType: 'party',
    targetId: input.partyId,
    data: { eventId: input.eventId, locale: input.locale },
  }),
});

/* ------------------------------------------------------------------- contact details ---- */

const invalid = (field: string, reason: string) =>
  new DomainError('validation_failed', `Invalid ${field}`, { field, reason });

export const PartyContactDto = z.object({
  /** The guest who holds the party's contact details (its primary contact), if any. */
  guestId: z.uuid().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
});
export type PartyContactDto = z.infer<typeof PartyContactDto>;

/** The party's email and phone (sealed on its primary guest), for the host. */
export const partyContactQuery = tenantQuery({
  name: 'guests.partyContact',
  input: z.object({ eventId: z.uuid(), partyId: z.uuid() }),
  output: PartyContactDto,
  entitlement: 'guests',
  permission: 'guests:read',
  handler: async ({ input, ctx, tx }) => {
    await partyOfTx(tx, input.eventId, input.partyId);
    const list = await tx
      .select()
      .from(guests)
      .where(eq(guests.partyId, input.partyId))
      .orderBy(asc(guests.createdAt), asc(guests.id));
    const primary = list.find((g) => g.isPrimary) ?? list.find((g) => g.kind === 'guest') ?? null;
    if (!primary) return { guestId: null, email: null, phone: null };
    const s = await unseal(requireOrg(ctx), primary.privateCiphertext);
    return { guestId: primary.id, email: s.email ?? null, phone: s.phone ?? null };
  },
});

/**
 * The party's email and phone for invitations (sealed on its primary guest, P4-3). Empty clears.
 * A text needs an international number (`+` and the country code).
 */
export const setPartyContactCommand = tenantCommand({
  name: 'guests.setPartyContact',
  input: z.object({
    eventId: z.uuid(),
    partyId: z.uuid(),
    email: z.string().trim().max(254).default(''),
    phone: z.string().trim().max(40).default(''),
  }),
  output: PartyContactDto,
  entitlement: 'guests',
  permission: 'guests:write',
  handler: async ({ input, ctx, tx }) => {
    const orgId = requireOrg(ctx);
    await partyOfTx(tx, input.eventId, input.partyId);
    const email = input.email ? normalizeEmail(input.email) : null;
    if (input.email && !email) throw invalid('email', 'invalid_email');
    const phone = input.phone ? normalizePhone(input.phone) : null;
    if (input.phone && !isE164(phone)) throw invalid('phone', 'invalid_phone');
    const list = await tx
      .select()
      .from(guests)
      .where(eq(guests.partyId, input.partyId))
      .orderBy(asc(guests.createdAt), asc(guests.id));
    const primary = list.find((g) => g.isPrimary) ?? list.find((g) => g.kind === 'guest') ?? null;
    if (!primary) throw new DomainError('invalid_state', 'The party has no guests', { reason: 'no_guests' });
    const before = await unseal(orgId, primary.privateCiphertext);
    const fields = [
      ...((before.email ?? null) !== email ? ['email'] : []),
      ...((before.phone ?? null) !== phone ? ['phone'] : []),
    ];
    if (fields.length) {
      await tx
        .update(guests)
        .set({ privateCiphertext: await seal(orgId, { ...before, email, phone }), updatedAt: ctx.now })
        .where(eq(guests.id, primary.id));
      await recordHistoryTx(tx, ctx, [
        {
          eventId: input.eventId,
          partyId: input.partyId,
          guestId: primary.id,
          action: 'guest_updated',
          source: 'manual',
          fields,
        },
      ]);
    }
    return { guestId: primary.id, email, phone };
  },
  // Field names only: the addresses never reach the audit log.
  audit: (input) => ({
    action: 'guests.party_contact.set',
    targetType: 'party',
    targetId: input.partyId,
    data: { eventId: input.eventId },
  }),
});

/* ------------------------------------------------------------------------------ sending ---- */

const queued = (p: InvitationQueuedPayload) => ({
  type: INVITATION_QUEUED_EVENT,
  version: 1,
  aggregateType: 'event',
  aggregateId: p.eventId,
  payload: p,
});

/**
 * Send invitations: to the chosen parties, or every party not sent yet. Each party gets its RSVP
 * link (made now if it had none) on the chosen channels it has an address for; a party with
 * none of them is counted (`noAddress`) and left as it is. `resend` sends again to parties
 * already sent. Marks each party `sent` (history `rsvp_sent` the first time, `invitation_sent`
 * every time) and emits `guests.invitation_queued@1` (ids only) for the mailer and the reminder
 * journey.
 */
export const sendInvitationsCommand = tenantCommand({
  name: 'guests.sendInvitations',
  input: z.object({
    eventId: z.uuid(),
    partyIds: z.array(z.uuid()).min(1).max(1000).optional(),
    channels: Channels,
    resend: z.boolean().default(false),
  }),
  output: z.object({ sent: z.int(), noAddress: z.int(), alreadySent: z.int() }),
  entitlement: 'guests',
  permission: 'guests:write',
  handler: async ({ input, ctx, tx, emit }) => {
    const orgId = requireOrg(ctx);
    const ev = await eventOfTx(tx, input.eventId);
    await ensureSettingsTx(tx, ctx, input.eventId);
    const list = await tx
      .select({ id: parties.id })
      .from(parties)
      .where(
        and(
          eq(parties.eventId, input.eventId),
          input.partyIds ? inArray(parties.id, input.partyIds) : undefined,
        ),
      )
      .orderBy(parties.name, parties.id);
    if (input.partyIds && list.length !== new Set(input.partyIds).size)
      throw new DomainError('not_found', 'Party not found', { field: 'partyIds' });
    const locales = await partyLocalesTx(
      tx,
      input.eventId,
      list.map((p) => p.id),
    );
    let sent = 0;
    let noAddress = 0;
    let alreadySent = 0;
    for (const p of list) {
      const row = await ensurePartyRsvpTx(tx, ctx, input.eventId, p.id, ev.endsAt);
      if (row.sentAt && !input.resend) {
        alreadySent++;
        continue;
      }
      const addr = await partyAddressesTx(tx, orgId, p.id);
      const channels = input.channels.filter((c: InviteChannel) => (c === 'email' ? addr.email : addr.phone));
      if (channels.length === 0) {
        noAddress++;
        continue;
      }
      if (!row.sentAt) {
        await tx
          .update(partyRsvp)
          .set({ sentAt: ctx.now, updatedAt: ctx.now })
          .where(eq(partyRsvp.id, row.id));
        await recordHistoryTx(tx, ctx, [
          { eventId: input.eventId, partyId: p.id, action: 'rsvp_sent', source: 'manual' },
        ]);
      }
      await recordHistoryTx(tx, ctx, [
        {
          eventId: input.eventId,
          partyId: p.id,
          action: 'invitation_sent',
          source: 'manual',
          detail: { channels: channels.join(',') },
        },
      ]);
      emit(
        queued({
          orgId,
          eventId: input.eventId,
          partyId: p.id,
          sendId: uuidv7(),
          channels,
          kind: 'invitation',
          locale: locales.get(p.id) ?? 'en',
          userId: userOf(ctx),
        }),
      );
      sent++;
    }
    return { sent, noAddress, alreadySent };
  },
  audit: (input, r) => ({
    action: 'guests.invitations.send',
    targetType: 'event',
    targetId: input.eventId,
    data: {
      parties: input.partyIds?.length ?? null,
      channels: input.channels,
      resend: input.resend,
      sent: r.sent,
      noAddress: r.noAddress,
    },
  }),
});

/** A test of the invitation in one language, by email to the signed-in host. */
export const sendTestInvitationCommand = tenantCommand({
  name: 'guests.sendTestInvitation',
  input: z.object({ eventId: z.uuid(), locale: Locale }),
  output: z.object({ ok: z.literal(true) }),
  entitlement: 'guests',
  permission: 'guests:write',
  handler: async ({ input, ctx, tx, emit }) => {
    await eventOfTx(tx, input.eventId);
    const userId = userOf(ctx);
    if (!userId) throw new DomainError('invalid_state', 'Only a signed-in member', { reason: 'no_user' });
    emit(
      queued({
        orgId: requireOrg(ctx),
        eventId: input.eventId,
        partyId: null,
        sendId: uuidv7(),
        channels: ['email'],
        kind: 'test',
        locale: input.locale,
        userId,
      }),
    );
    return { ok: true as const };
  },
  audit: (input) => ({
    action: 'guests.invitations.test',
    targetType: 'event',
    targetId: input.eventId,
    data: { locale: input.locale },
  }),
});

/* ------------------------------------------------------------------------------ reading ---- */

export const InviteMessageDto = z.object({
  id: z.uuid(),
  kind: z.enum(INVITE_MESSAGE_KINDS),
  channel: z.enum(INVITE_CHANNELS),
  locale: z.string(),
  at: z.date(),
  state: z.enum(DELIVERY_STATES),
  reason: z.string().nullable(),
});
export type InviteMessageDto = z.infer<typeof InviteMessageDto>;

export const PartyInviteDto = z.object({
  partyId: z.uuid(),
  locale: z.string(),
  /** Which channels the party can be reached on (never the addresses themselves). */
  hasEmail: z.boolean(),
  hasPhone: z.boolean(),
  /** The latest message per channel and its state. */
  latest: z.array(InviteMessageDto),
  /** Bounced, failed or not sent: shown on the party. */
  problem: z.boolean(),
});
export type PartyInviteDto = z.infer<typeof PartyInviteDto>;

/**
 * Invitation state of parties (all, or the listed ones): language, reachable channels, the latest
 * message per channel and whether one bounced or failed. Messages and states only, no addresses.
 */
export const partyInvitesQuery = tenantQuery({
  name: 'guests.partyInvites',
  input: z.object({ eventId: z.uuid(), partyIds: z.array(z.uuid()).max(1000).optional() }),
  output: z.array(PartyInviteDto),
  entitlement: 'guests',
  permission: 'guests:read',
  handler: async ({ input, ctx, tx }) => {
    const orgId = requireOrg(ctx);
    const ids =
      input.partyIds ??
      (await tx.select({ id: parties.id }).from(parties).where(eq(parties.eventId, input.eventId))).map(
        (p) => p.id,
      );
    const known = new Set(
      (
        await tx
          .select({ id: parties.id })
          .from(parties)
          .where(
            and(eq(parties.eventId, input.eventId), inArray(parties.id, ids.length ? ids : [input.eventId])),
          )
      ).map((p) => p.id),
    );
    const [locales, messages] = await Promise.all([
      partyLocalesTx(tx, input.eventId, [...known]),
      partyMessagesTx(tx, input.eventId, [...known], ctx.now),
    ]);
    const out: PartyInviteDto[] = [];
    for (const partyId of ids) {
      if (!known.has(partyId)) continue;
      const addr = await partyAddressesTx(tx, orgId, partyId);
      const mine = messages.filter((m) => m.partyId === partyId);
      const latest = INVITE_CHANNELS.flatMap((c) => {
        const m = mine.find((x) => x.channel === c);
        return m ? [m] : [];
      });
      out.push({
        partyId,
        locale: locales.get(partyId) ?? 'en',
        hasEmail: !!addr.email,
        hasPhone: !!addr.phone,
        latest: latest.map(({ partyId: _p, ...m }) => m),
        problem: latest.some((m) => PROBLEM_STATES.has(m.state)),
      });
    }
    return out;
  },
});

/** One party's invitation and reminder messages, newest first, with their states. */
export const partyInviteMessagesQuery = tenantQuery({
  name: 'guests.partyInviteMessages',
  input: z.object({ eventId: z.uuid(), partyId: z.uuid() }),
  output: z.array(InviteMessageDto),
  entitlement: 'guests',
  permission: 'guests:read',
  handler: async ({ input, ctx, tx }) => {
    await partyOfTx(tx, input.eventId, input.partyId);
    return (await partyMessagesTx(tx, input.eventId, [input.partyId], ctx.now, 200)).map(
      ({ partyId: _p, ...m }) => m,
    );
  },
});
