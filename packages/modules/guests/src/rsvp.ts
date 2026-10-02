import { createHmac, timingSafeEqual } from 'node:crypto';
import { type TenantTx, withoutTenant } from '@yayatoh/db';
import { type Ctx, DomainError, requireOrg, uuidv7 } from '@yayatoh/kernel';
import {
  appTokenSecret,
  signLinkToken,
  tenantCommand,
  tenantQuery,
  verifyLinkToken,
} from '@yayatoh/platform';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  checkHouseholdAnswers,
  normalizeLookupCode,
  normalizePin,
  partyRsvpState,
  type RsvpRefusal,
  rsvpOpen,
  strictFullName,
  strictName,
  tally,
} from './domain/rsvp.ts';
import { recordHistoryTx } from './guests.ts';
import { assertInvitedTx } from './invitations.ts';
import {
  afterAnswersTx,
  ensurePartyRsvpTx,
  ensureSettingsTx,
  eventOfTx,
  linkExpiry,
  type PartyRsvpRow,
  partyFacts,
  partyOfTx,
  rsvpFactsTx,
  settingsTx,
} from './rsvp-state.ts';
import {
  GUEST_KINDS,
  guests,
  PARTY_RSVP_STATES,
  type PartyRsvpState,
  parties,
  partyRsvp,
  RESPONSE_STATUSES,
  rsvpSettings,
  SUB_EVENT_KINDS,
  subEventResponses,
} from './schema.ts';
import { recordSubEventHistoryTx } from './sub-events.ts';

/**
 * The RSVP flow (M4.1d, P4-2). A party answers on one mobile-first page, reached by its signed
 * link (also printed as a QR code) or, for paper invitations, by the exact full name of one of
 * its guests plus the party's PIN. One person answers for the whole household, sub-event by
 * sub-event, only for the sub-events the party is invited to (`assertInvitedTx` on every answer),
 * and names a placeholder plus-one. After the event's deadline the page is read-only until the
 * host reopens the party. Every change writes `rsvp_history` (source `rsvp` from the page; the
 * host's own entries keep `manual`/`paper`), and an answer from a party with guests linked to the
 * guest list emits `guests.rsvp_responded@1` for the participation projection (M3.6a). Guests
 * never become marketing audience members (P4-3): nothing here creates contacts or consents.
 */

export const RSVP_LINK_PURPOSE = 'guests.rsvp-link';

/* ---------------------------------------------------------------------------- credentials ---- */

const mac = (label: string, value: string) =>
  createHmac('sha256', appTokenSecret()).update(`${label}:${value}`).digest();

/**
 * The six-digit PIN printed on a party's invitation: derived from the party and its PIN version
 * under the app secret, never stored. Resetting the PIN bumps the version.
 */
export function rsvpPinFor(partyId: string, version: number): string {
  return String(mac('guests-rsvp-pin', `${partyId}:${version}`).readUInt32BE(0) % 1_000_000).padStart(6, '0');
}

/** The party link's token (a signed link id; the web app builds `/rsvp/{token}`). */
export const rsvpLinkToken = (linkId: string) => signLinkToken(RSVP_LINK_PURPOSE, linkId);

/** The org of a party link, or null (bad signature, revoked, unknown, or the org isn't live). */
export async function rsvpLinkRef(token: string): Promise<{ orgId: string; linkId: string } | null> {
  if (token.length > 200) return null;
  const linkId = verifyLinkToken(RSVP_LINK_PURPOSE, token);
  if (!linkId) return null;
  const rows = await withoutTenant((tx) =>
    tx.execute<{ org_id: string }>(sql`select org_id from guests.rsvp_link_org(${linkId}::uuid)`),
  );
  return rows[0] ? { orgId: rows[0].org_id, linkId } : null;
}

/** The org and event of a paper-fallback address, or null (unknown code, or name lookup off). */
export async function rsvpLookupTarget(raw: string): Promise<{ orgId: string; eventId: string } | null> {
  const code = normalizeLookupCode(raw);
  if (!code) return null;
  const rows = await withoutTenant((tx) =>
    tx.execute<{ org_id: string; event_id: string }>(
      sql`select org_id, event_id from guests.rsvp_lookup_target(${code})`,
    ),
  );
  return rows[0] ? { orgId: rows[0].org_id, eventId: rows[0].event_id } : null;
}

const refusalError = (r: RsvpRefusal) =>
  r.reason === 'not_invited'
    ? new DomainError('invalid_state', 'This guest is not invited to this sub-event', {
        reason: 'not_invited',
        field: 'answers',
      })
    : r.reason === 'not_in_party'
      ? new DomainError('not_found', 'Not a guest of this party', {
          reason: 'not_in_party',
          field: 'answers',
        })
      : new DomainError('validation_failed', 'Some answers are missing or invalid', {
          reason: r.reason,
          field:
            r.reason === 'plus_one_name_required' || r.reason === 'not_a_plus_one' ? 'plusOnes' : 'answers',
          guestId: r.guestId,
        });

/* --------------------------------------------------------------------------- host: settings ---- */

export const RsvpSettingsDto = z.object({
  deadline: z.date().nullable(),
  nameLookup: z.boolean(),
  /** Null until the settings were first saved or a link was made. */
  lookupCode: z.string().nullable(),
});
export type RsvpSettingsDto = z.infer<typeof RsvpSettingsDto>;

const toSettingsDto = (r: typeof rsvpSettings.$inferSelect | null): RsvpSettingsDto => ({
  deadline: r?.deadline ?? null,
  nameLookup: r?.nameLookup ?? true,
  lookupCode: r?.lookupCode ?? null,
});

/** The event's RSVP deadline and whether the paper fallback (name + PIN) is on. */
export const setRsvpSettingsCommand = tenantCommand({
  name: 'guests.setRsvpSettings',
  input: z.object({
    eventId: z.uuid(),
    deadline: z.coerce.date().nullable(),
    nameLookup: z.boolean(),
  }),
  output: RsvpSettingsDto,
  entitlement: 'guests',
  permission: 'guests:write',
  handler: async ({ input, ctx, tx, emit }) => {
    await eventOfTx(tx, input.eventId);
    const row = await ensureSettingsTx(tx, ctx, input.eventId);
    // M4.1f: RSVP reminder steps count back from the deadline; their journey re-plans them.
    if ((row.deadline?.getTime() ?? null) !== (input.deadline?.getTime() ?? null))
      emit({
        type: 'guests.rsvp_deadline_set',
        version: 1,
        aggregateType: 'event',
        aggregateId: input.eventId,
        payload: { orgId: requireOrg(ctx), eventId: input.eventId },
      });
    const [updated] = await tx
      .update(rsvpSettings)
      .set({ deadline: input.deadline, nameLookup: input.nameLookup, updatedAt: ctx.now })
      .where(eq(rsvpSettings.id, row.id))
      .returning();
    return toSettingsDto(updated ?? row);
  },
  audit: (input) => ({
    action: 'guests.rsvp_settings.set',
    targetType: 'event',
    targetId: input.eventId,
    data: { deadline: input.deadline?.toISOString() ?? null, nameLookup: input.nameLookup },
  }),
});

export const rsvpSettingsQuery = tenantQuery({
  name: 'guests.rsvpSettings',
  input: z.object({ eventId: z.uuid() }),
  output: RsvpSettingsDto,
  entitlement: 'guests',
  permission: 'guests:read',
  handler: async ({ input, tx }) => toSettingsDto(await settingsTx(tx, input.eventId)),
});

/* ------------------------------------------------------------------------ host: party links ---- */

/**
 * Make RSVP links (and PINs) for some parties, or every party of the event that has none. Also
 * makes the event's settings (and its lookup code) on first use. Repeatable: parties that already
 * have a link keep it.
 */
export const createRsvpLinksCommand = tenantCommand({
  name: 'guests.createRsvpLinks',
  input: z.object({ eventId: z.uuid(), partyIds: z.array(z.uuid()).min(1).max(1000).optional() }),
  output: z.object({ created: z.int() }),
  entitlement: 'guests',
  permission: 'guests:write',
  handler: async ({ input, ctx, tx }) => {
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
      );
    if (input.partyIds && list.length !== new Set(input.partyIds).size)
      throw new DomainError('not_found', 'Party not found', { field: 'partyIds' });
    const have = new Set(
      (
        await tx
          .select({ partyId: partyRsvp.partyId })
          .from(partyRsvp)
          .where(eq(partyRsvp.eventId, input.eventId))
      ).map((r) => r.partyId),
    );
    let created = 0;
    for (const p of list) {
      if (have.has(p.id)) continue;
      await ensurePartyRsvpTx(tx, ctx, input.eventId, p.id, ev.endsAt);
      created++;
    }
    return { created };
  },
  audit: (input, r) => ({
    action: 'guests.rsvp_links.create',
    targetType: 'event',
    targetId: input.eventId,
    data: { parties: input.partyIds?.length ?? null, created: r?.created },
  }),
});

const PartyRef = z.object({ eventId: z.uuid(), partyId: z.uuid() });

async function partyRsvpOfTx(tx: TenantTx, ctx: Ctx, eventId: string, partyId: string) {
  await partyOfTx(tx, eventId, partyId);
  const ev = await eventOfTx(tx, eventId);
  await ensureSettingsTx(tx, ctx, eventId);
  return { row: await ensurePartyRsvpTx(tx, ctx, eventId, partyId, ev.endsAt), ev };
}

/** A new link for the party: every earlier link and QR code stops working at once. */
export const resetRsvpLinkCommand = tenantCommand({
  name: 'guests.resetRsvpLink',
  input: PartyRef,
  output: z.object({ ok: z.literal(true) }),
  entitlement: 'guests',
  permission: 'guests:write',
  handler: async ({ input, ctx, tx }) => {
    const { row, ev } = await partyRsvpOfTx(tx, ctx, input.eventId, input.partyId);
    await tx
      .update(partyRsvp)
      .set({ linkId: uuidv7(), linkExpiresAt: linkExpiry(ctx.now, ev.endsAt), updatedAt: ctx.now })
      .where(eq(partyRsvp.id, row.id));
    await recordHistoryTx(tx, ctx, [
      { eventId: input.eventId, partyId: input.partyId, action: 'rsvp_link_reset', source: 'manual' },
    ]);
    return { ok: true as const };
  },
  audit: (input) => ({
    action: 'guests.rsvp_link.reset',
    targetType: 'party',
    targetId: input.partyId,
    data: { eventId: input.eventId },
  }),
});

/** A new PIN for the party (the printed one stops working). */
export const resetRsvpPinCommand = tenantCommand({
  name: 'guests.resetRsvpPin',
  input: PartyRef,
  output: z.object({ ok: z.literal(true) }),
  entitlement: 'guests',
  permission: 'guests:write',
  handler: async ({ input, ctx, tx }) => {
    const { row } = await partyRsvpOfTx(tx, ctx, input.eventId, input.partyId);
    await tx
      .update(partyRsvp)
      .set({ pinVersion: row.pinVersion + 1, updatedAt: ctx.now })
      .where(eq(partyRsvp.id, row.id));
    await recordHistoryTx(tx, ctx, [
      { eventId: input.eventId, partyId: input.partyId, action: 'rsvp_pin_reset', source: 'manual' },
    ]);
    return { ok: true as const };
  },
  audit: (input) => ({
    action: 'guests.rsvp_pin.reset',
    targetType: 'party',
    targetId: input.partyId,
    data: { eventId: input.eventId },
  }),
});

/**
 * The host sent (or printed and mailed) the invitation: `invited → sent`. Sending by email and
 * text arrives with M4.1f and will call the same rule.
 */
export const markRsvpSentCommand = tenantCommand({
  name: 'guests.markRsvpSent',
  input: PartyRef,
  output: z.object({ ok: z.literal(true) }),
  entitlement: 'guests',
  permission: 'guests:write',
  handler: async ({ input, ctx, tx }) => {
    const { row } = await partyRsvpOfTx(tx, ctx, input.eventId, input.partyId);
    if (row.sentAt) return { ok: true as const };
    await tx.update(partyRsvp).set({ sentAt: ctx.now, updatedAt: ctx.now }).where(eq(partyRsvp.id, row.id));
    await recordHistoryTx(tx, ctx, [
      { eventId: input.eventId, partyId: input.partyId, action: 'rsvp_sent', source: 'manual' },
    ]);
    return { ok: true as const };
  },
  audit: (input) => ({
    action: 'guests.rsvp.sent',
    targetType: 'party',
    targetId: input.partyId,
    data: { eventId: input.eventId },
  }),
});

/** Let a party answer (once more) after the deadline: its page opens until it answers. */
export const reopenRsvpCommand = tenantCommand({
  name: 'guests.reopenRsvp',
  input: PartyRef,
  output: z.object({ ok: z.literal(true) }),
  entitlement: 'guests',
  permission: 'guests:write',
  handler: async ({ input, ctx, tx }) => {
    const { row } = await partyRsvpOfTx(tx, ctx, input.eventId, input.partyId);
    if (row.reopened) return { ok: true as const };
    await tx.update(partyRsvp).set({ reopened: true, updatedAt: ctx.now }).where(eq(partyRsvp.id, row.id));
    await recordHistoryTx(tx, ctx, [
      { eventId: input.eventId, partyId: input.partyId, action: 'rsvp_reopened', source: 'manual' },
    ]);
    return { ok: true as const };
  },
  audit: (input) => ({
    action: 'guests.rsvp.reopen',
    targetType: 'party',
    targetId: input.partyId,
    data: { eventId: input.eventId },
  }),
});

/* --------------------------------------------------------------------------- host: queries ---- */

export const SubEventTallyDto = z.object({
  subEventId: z.uuid(),
  invited: z.int(),
  attending: z.int(),
  declined: z.int(),
  awaiting: z.int(),
});

export const PartyRsvpSummaryDto = z.object({
  partyId: z.uuid(),
  state: z.enum(PARTY_RSVP_STATES),
  reopened: z.boolean(),
  hasLink: z.boolean(),
  /** Per sub-event the party is invited to, in program order. */
  subEvents: z.array(SubEventTallyDto),
});
export type PartyRsvpSummaryDto = z.infer<typeof PartyRsvpSummaryDto>;

export const RsvpOverviewDto = z.object({
  settings: RsvpSettingsDto,
  /** Whether the deadline has passed (now, in the event's terms). */
  locked: z.boolean(),
  subEvents: z.array(z.object({ id: z.uuid(), name: z.string(), kind: z.enum(SUB_EVENT_KINDS) })),
  parties: z.array(PartyRsvpSummaryDto),
  /** Parties per state, for the whole event. */
  states: z.record(z.enum(PARTY_RSVP_STATES), z.int()),
});
export type RsvpOverviewDto = z.infer<typeof RsvpOverviewDto>;

function summarize(
  all: Awaited<ReturnType<typeof rsvpFactsTx>>,
  partyId: string,
  row: PartyRsvpRow | undefined,
): PartyRsvpSummaryDto {
  const f = partyFacts(all, partyId);
  return {
    partyId,
    state: partyRsvpState(row ?? null),
    reopened: row?.reopened ?? false,
    hasLink: !!row,
    subEvents: all.subs
      .filter((s) => f.invited.has(s.id))
      .map((s) => ({
        subEventId: s.id,
        ...tally(f.invited.get(s.id) ?? new Set(), all.responses.get(s.id) ?? new Map()),
      })),
  };
}

/**
 * RSVP states of an event's parties (or of the listed ones): state, reopened, and the attending /
 * declined / awaiting counts per sub-event. Names, links and PINs are not part of it.
 */
export const rsvpOverviewQuery = tenantQuery({
  name: 'guests.rsvpOverview',
  input: z.object({ eventId: z.uuid(), partyIds: z.array(z.uuid()).max(1000).optional() }),
  output: RsvpOverviewDto,
  entitlement: 'guests',
  permission: 'guests:read',
  handler: async ({ input, ctx, tx }) => {
    const [settings, rows, allParties] = await Promise.all([
      settingsTx(tx, input.eventId),
      tx.select().from(partyRsvp).where(eq(partyRsvp.eventId, input.eventId)),
      tx.select({ id: parties.id }).from(parties).where(eq(parties.eventId, input.eventId)),
    ]);
    const byParty = new Map(rows.map((r) => [r.partyId, r]));
    const ids = input.partyIds ?? allParties.map((p) => p.id);
    const facts = await rsvpFactsTx(tx, input.eventId, ids);
    const states = Object.fromEntries(PARTY_RSVP_STATES.map((s) => [s, 0])) as Record<PartyRsvpState, number>;
    for (const p of allParties) states[partyRsvpState(byParty.get(p.id) ?? null)]++;
    const known = new Set(allParties.map((p) => p.id));
    return {
      settings: toSettingsDto(settings),
      locked: !rsvpOpen(settings?.deadline ?? null, ctx.now, false),
      subEvents: facts.subs.map((s) => ({ id: s.id, name: s.name, kind: s.kind })),
      parties: ids.filter((id) => known.has(id)).map((id) => summarize(facts, id, byParty.get(id))),
      states,
    };
  },
});

export const PartyRsvpDetailDto = PartyRsvpSummaryDto.extend({
  /** The party's link token (`/rsvp/{token}`) and PIN: host roles that edit guests only. */
  token: z.string().nullable(),
  pin: z.string().nullable(),
  linkExpiresAt: z.date().nullable(),
  sentAt: z.date().nullable(),
  viewedAt: z.date().nullable(),
  respondedAt: z.date().nullable(),
  lookupCode: z.string().nullable(),
});
export type PartyRsvpDetailDto = z.infer<typeof PartyRsvpDetailDto>;

/**
 * One party's RSVP for the host: its link and PIN (credentials, so `guests:write`), the state's
 * dates and the counts per sub-event. Null link and PIN until a link was made.
 */
export const partyRsvpQuery = tenantQuery({
  name: 'guests.partyRsvp',
  input: PartyRef,
  output: PartyRsvpDetailDto,
  entitlement: 'guests',
  permission: 'guests:write',
  handler: async ({ input, tx }) => {
    await partyOfTx(tx, input.eventId, input.partyId);
    const [[row], settings, facts] = await Promise.all([
      tx.select().from(partyRsvp).where(eq(partyRsvp.partyId, input.partyId)),
      settingsTx(tx, input.eventId),
      rsvpFactsTx(tx, input.eventId, [input.partyId]),
    ]);
    return {
      ...summarize(facts, input.partyId, row),
      token: row ? rsvpLinkToken(row.linkId) : null,
      pin: row ? rsvpPinFor(row.partyId, row.pinVersion) : null,
      linkExpiresAt: row?.linkExpiresAt ?? null,
      sentAt: row?.sentAt ?? null,
      viewedAt: row?.viewedAt ?? null,
      respondedAt: row?.respondedAt ?? null,
      lookupCode: settings?.lookupCode ?? null,
    };
  },
});

/**
 * The link tokens of some parties (those that have one), for the host's "copy link" menu.
 * Credentials, so `guests:write`.
 */
export const rsvpLinksQuery = tenantQuery({
  name: 'guests.rsvpLinks',
  input: z.object({ eventId: z.uuid(), partyIds: z.array(z.uuid()).max(1000) }),
  output: z.array(z.object({ partyId: z.uuid(), token: z.string() })),
  entitlement: 'guests',
  permission: 'guests:write',
  handler: async ({ input, tx }) => {
    if (input.partyIds.length === 0) return [];
    const rows = await tx
      .select({ partyId: partyRsvp.partyId, linkId: partyRsvp.linkId })
      .from(partyRsvp)
      .where(and(eq(partyRsvp.eventId, input.eventId), inArray(partyRsvp.partyId, input.partyIds)));
    return rows.map((r) => ({ partyId: r.partyId, token: rsvpLinkToken(r.linkId) }));
  },
});

/* --------------------------------------------------------------------------------- public ---- */

const NO_PARTY = '00000000-0000-0000-0000-000000000000';

export const PUBLIC_RSVP_STATES = ['open', 'locked', 'expired'] as const;

export const PublicRsvpDto = z.object({
  state: z.enum(PUBLIC_RSVP_STATES),
  eventName: z.string(),
  timezone: z.string(),
  deadline: z.date().nullable(),
  /** The envelope name, else the party's name. Empty for an expired link. */
  partyName: z.string(),
  respondedAt: z.date().nullable(),
  /** Whether the party opened its page before (the page records the first open only). */
  viewed: z.boolean(),
  /** The party's own guests (never anyone else's), plus-ones after their host. */
  guests: z.array(
    z.object({
      id: z.uuid(),
      kind: z.enum(GUEST_KINDS),
      firstName: z.string().nullable(),
      lastName: z.string().nullable(),
      /** For a plus-one: their host's first name. */
      hostFirstName: z.string().nullable(),
    }),
  ),
  /** Only the sub-events the party is invited to, each with who of the party is invited. */
  subEvents: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      kind: z.enum(SUB_EVENT_KINDS),
      startsAt: z.date(),
      endsAt: z.date(),
      place: z.string().nullable(),
      guestIds: z.array(z.uuid()),
    }),
  ),
  responses: z.array(
    z.object({ guestId: z.uuid(), subEventId: z.uuid(), status: z.enum(RESPONSE_STATUSES) }),
  ),
});
export type PublicRsvpDto = z.infer<typeof PublicRsvpDto>;

const Token = z.string().min(10).max(200);

/** The party of a link (in the context's org), or `not_found` for any bad, reset or foreign link. */
async function linkPartyTx(tx: TenantTx, token: string, lock = false) {
  const linkId = verifyLinkToken(RSVP_LINK_PURPOSE, token);
  if (!linkId) throw new DomainError('not_found', 'Unknown link', { reason: 'unknown_link' });
  const q = tx.select().from(partyRsvp).where(eq(partyRsvp.linkId, linkId));
  const [row] = lock ? await q.for('update') : await q;
  if (!row) throw new DomainError('not_found', 'Unknown link', { reason: 'unknown_link' });
  return row;
}

/**
 * What the party's page shows: its own guests, the sub-events it is invited to with who of the
 * party is invited, and its answers. Nothing private (dietary, access, address) and nobody from
 * another party. An expired link shows nothing but the event's name.
 */
export const publicRsvpQuery = tenantQuery({
  name: 'guests.publicRsvp',
  input: z.object({ token: Token }),
  output: PublicRsvpDto,
  entitlement: 'guests',
  permission: 'public:rsvp',
  handler: async ({ input, ctx, tx }) => {
    const row = await linkPartyTx(tx, input.token);
    const ev = await eventOfTx(tx, row.eventId);
    const settings = await settingsTx(tx, row.eventId);
    const base = {
      eventName: ev.name,
      timezone: ev.timezone,
      deadline: settings?.deadline ?? null,
      respondedAt: row.respondedAt,
      viewed: row.viewedAt !== null,
    };
    if (row.linkExpiresAt.getTime() <= ctx.now.getTime())
      return { ...base, state: 'expired' as const, partyName: '', guests: [], subEvents: [], responses: [] };
    const party = await partyOfTx(tx, row.eventId, row.partyId);
    const all = await rsvpFactsTx(tx, row.eventId, [row.partyId]);
    const f = partyFacts(all, row.partyId);
    const byId = new Map(f.guests.map((g) => [g.id, g]));
    const ordered = f.guests
      .filter((g) => g.kind === 'guest')
      .flatMap((g) => [g, ...f.guests.filter((p) => p.hostGuestId === g.id)]);
    const invitedIds = new Set([...f.invited.values()].flatMap((s) => [...s]));
    return {
      ...base,
      state: rsvpOpen(settings?.deadline ?? null, ctx.now, row.reopened)
        ? ('open' as const)
        : ('locked' as const),
      partyName: party.envelopeName ?? party.name,
      guests: ordered
        .filter((g) => invitedIds.has(g.id))
        .map((g) => ({
          id: g.id,
          kind: g.kind as (typeof GUEST_KINDS)[number],
          firstName: g.firstName,
          lastName: g.lastName,
          hostFirstName: g.hostGuestId ? (byId.get(g.hostGuestId)?.firstName ?? null) : null,
        })),
      subEvents: all.subs
        .filter((s) => f.invited.has(s.id))
        .map((s) => ({
          id: s.id,
          name: s.name,
          kind: s.kind,
          startsAt: s.startsAt,
          endsAt: s.endsAt,
          place: s.place,
          guestIds: ordered.filter((g) => f.invited.get(s.id)?.has(g.id)).map((g) => g.id),
        })),
      responses: [...f.invited].flatMap(([subEventId, ids]) =>
        [...ids].flatMap((guestId) => {
          const status = all.responses.get(subEventId)?.get(guestId);
          return status ? [{ guestId, subEventId, status }] : [];
        }),
      ),
    };
  },
});

/** The party opened its page: `viewed` (first time only, with history). */
export const markRsvpViewedCommand = tenantCommand({
  name: 'guests.markRsvpViewed',
  input: z.object({ token: Token }),
  output: z.object({ first: z.boolean() }),
  entitlement: 'guests',
  permission: 'public:rsvp',
  handler: async ({ input, ctx, tx }) => {
    const row = await linkPartyTx(tx, input.token, true);
    if (row.viewedAt || row.linkExpiresAt.getTime() <= ctx.now.getTime()) return { first: false };
    await tx.update(partyRsvp).set({ viewedAt: ctx.now, updatedAt: ctx.now }).where(eq(partyRsvp.id, row.id));
    await recordHistoryTx(tx, ctx, [
      { eventId: row.eventId, partyId: row.partyId, action: 'rsvp_viewed', source: 'rsvp' },
    ]);
    return { first: true };
  },
  audit: (_input, r) => ({
    action: 'guests.rsvp.viewed',
    targetType: 'party_rsvp',
    targetId: null,
    data: { first: r?.first },
  }),
});

const PlusOneInput = z.object({
  guestId: z.uuid(),
  firstName: z.string().trim().max(80),
  lastName: z
    .string()
    .trim()
    .max(80)
    .nullable()
    .default(null)
    .transform((v) => (v ? v : null)),
});

/**
 * The household's answer, from its page: one status per invited guest and sub-event (all of
 * them), and names for placeholder plus-ones. Refused after the deadline unless the host reopened
 * the party (`deadline_passed`), for an expired link (`link_expired`), for any guest outside the
 * party (`not_in_party`) and for a sub-event a guest is not invited to (`not_invited`, checked
 * with `assertInvitedTx` in this transaction). Writes history (source `rsvp`) for every change.
 */
export const submitRsvpCommand = tenantCommand({
  name: 'guests.submitRsvp',
  input: z.object({
    token: Token,
    answers: z
      .array(z.object({ guestId: z.uuid(), subEventId: z.uuid(), status: z.enum(RESPONSE_STATUSES) }))
      .min(1)
      .max(400),
    plusOnes: z.array(PlusOneInput).max(20).default([]),
  }),
  output: z.object({ attending: z.int(), declined: z.int() }),
  entitlement: 'guests',
  permission: 'public:rsvp',
  handler: async ({ input, ctx, tx, emit }) => {
    const row = await linkPartyTx(tx, input.token, true);
    if (row.linkExpiresAt.getTime() <= ctx.now.getTime())
      throw new DomainError('invalid_state', 'This link has expired', { reason: 'link_expired' });
    const settings = await settingsTx(tx, row.eventId);
    if (!rsvpOpen(settings?.deadline ?? null, ctx.now, row.reopened))
      throw new DomainError('invalid_state', 'The RSVP deadline has passed', { reason: 'deadline_passed' });
    const { eventId, partyId } = row;
    const all = await rsvpFactsTx(tx, eventId, [partyId]);
    const f = partyFacts(all, partyId);
    const refusal = checkHouseholdAnswers(
      f.guests.map((g) => ({
        id: g.id,
        kind: g.kind as 'guest' | 'plus_one',
        hostGuestId: g.hostGuestId,
        firstName: g.firstName,
      })),
      f.invited,
      input.answers,
      input.plusOnes,
    );
    if (refusal) throw refusalError(refusal);

    // Name placeholder plus-ones (`unnamed → named`); a name already given may be corrected.
    for (const p of input.plusOnes) {
      const g = f.guests.find((x) => x.id === p.guestId);
      const firstName = p.firstName || null;
      if (!g || !firstName) continue;
      if (g.firstName === firstName && g.lastName === p.lastName) continue;
      await tx
        .update(guests)
        .set({ firstName, lastName: p.lastName, updatedAt: ctx.now })
        .where(eq(guests.id, g.id));
      await recordHistoryTx(tx, ctx, [
        {
          eventId,
          partyId,
          guestId: g.id,
          action: g.firstName ? 'guest_updated' : 'plus_one_named',
          source: 'rsvp',
          fields: [
            ...(g.firstName !== firstName ? ['firstName'] : []),
            ...(g.lastName !== p.lastName ? ['lastName'] : []),
          ],
        },
      ]);
    }

    for (const a of input.answers) {
      // The M4.1c rule, in this transaction: never an answer for a sub-event not invited to.
      await assertInvitedTx(tx, { eventId, guestId: a.guestId, subEventId: a.subEventId });
      const before = all.responses.get(a.subEventId)?.get(a.guestId);
      if (before === a.status) continue;
      await tx
        .insert(subEventResponses)
        .values({
          orgId: requireOrg(ctx),
          eventId,
          subEventId: a.subEventId,
          guestId: a.guestId,
          status: a.status,
          source: 'rsvp',
        })
        .onConflictDoUpdate({
          target: [subEventResponses.orgId, subEventResponses.subEventId, subEventResponses.guestId],
          set: { status: a.status, source: 'rsvp', updatedAt: ctx.now },
        });
      await recordSubEventHistoryTx(tx, ctx, [
        {
          eventId,
          subEventId: a.subEventId,
          partyId,
          guestId: a.guestId,
          action: 'response_recorded',
          source: 'rsvp',
          fields: ['status'],
        },
      ]);
    }
    await tx
      .update(partyRsvp)
      .set({ viewedAt: row.viewedAt ?? ctx.now, updatedAt: ctx.now })
      .where(eq(partyRsvp.id, row.id));
    await recordHistoryTx(tx, ctx, [{ eventId, partyId, action: 'rsvp_submitted', source: 'rsvp' }]);
    return afterAnswersTx(tx, ctx, emit, eventId, partyId, { submitted: true });
  },
  audit: (input, r) => ({
    action: 'guests.rsvp.submit',
    targetType: 'party_rsvp',
    targetId: null,
    data: { answers: input.answers.length, attending: r?.attending, declined: r?.declined },
  }),
});

/**
 * The paper fallback (P4-2): the exact full name of a guest of the party (no partial or fuzzy
 * match) and the PIN printed on its invitation. The answer is the same whether the name is
 * unknown, only part of a name, or the PIN is wrong (`no_match`), and every attempt does the same
 * work (a PIN is computed and compared even when no name matched), so neither the reply nor its
 * timing tells whether someone is on the list. Rate limits and the human check run before this
 * (the web action, `limitAction` + M1.14 challenge). On a match it returns the party's link token.
 */
export const findRsvpByNameCommand = tenantCommand({
  name: 'guests.findRsvpByName',
  input: z.object({
    eventId: z.uuid(),
    name: z.string().trim().min(1).max(170),
    pin: z.string().trim().max(20),
  }),
  output: z.object({ status: z.enum(['found', 'no_match']), token: z.string().nullable() }),
  entitlement: 'guests',
  permission: 'public:rsvp',
  handler: async ({ input, ctx, tx }) => {
    const settings = await settingsTx(tx, input.eventId);
    if (!settings?.nameLookup)
      throw new DomainError('not_found', 'Name lookup is off for this event', { reason: 'lookup_off' });
    const ev = await eventOfTx(tx, input.eventId);
    const wanted = strictName(input.name);
    const pin = normalizePin(input.pin) ?? '------';
    // Every named guest of the event, compared in memory (≤ 3,000): the query is the same for
    // every name, so its time doesn't depend on whether the name exists.
    const named = await tx
      .select({ partyId: guests.partyId, firstName: guests.firstName, lastName: guests.lastName })
      .from(guests)
      .where(eq(guests.eventId, input.eventId));
    const partyIds = [...new Set(named.filter((g) => strictFullName(g) === wanted).map((g) => g.partyId))];
    // Always the same second query (an id that matches nothing when no name did).
    const rows = await tx
      .select()
      .from(partyRsvp)
      .where(inArray(partyRsvp.partyId, partyIds.length ? partyIds : [NO_PARTY]));
    let match: PartyRsvpRow | null = null;
    // Compare against at least one PIN, a dummy when nothing matched, so a miss costs the same.
    const candidates = rows.length ? rows : [null];
    for (const r of candidates) {
      const expected = Buffer.from(rsvpPinFor(r?.partyId ?? input.eventId, r?.pinVersion ?? 0));
      const ok = timingSafeEqual(expected, Buffer.from(pin.padEnd(6, '-').slice(0, 6)));
      if (ok && r && !match) match = r;
    }
    if (!match) return { status: 'no_match' as const, token: null };
    // Like the link itself: a link past its expiry is renewed for a guest who proves the PIN.
    if (match.linkExpiresAt.getTime() <= ctx.now.getTime())
      await tx
        .update(partyRsvp)
        .set({ linkExpiresAt: linkExpiry(ctx.now, ev.endsAt), updatedAt: ctx.now })
        .where(eq(partyRsvp.id, match.id));
    return { status: 'found' as const, token: rsvpLinkToken(match.linkId) };
  },
  audit: (input, r) => ({
    action: 'guests.rsvp.lookup',
    targetType: 'event',
    targetId: input.eventId,
    data: { found: r?.status === 'found' },
  }),
});
