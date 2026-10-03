import { attendeesByIdsTx } from '@yayatoh/attendees';
import { isUniqueViolation, type TenantTx } from '@yayatoh/db';
import { findEventTx } from '@yayatoh/events';
import { actorId, type Ctx, DomainError, requireOrg } from '@yayatoh/kernel';
import { keyVault, tenantCommand, tenantQuery } from '@yayatoh/platform';
import { and, asc, desc, eq, ilike, inArray, isNotNull, ne, or, type SQL, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  changedFields,
  countGuests,
  type GuestLike,
  movingIds,
  nextPrimary,
  normalizeTags,
  orderWithPlusOnes,
  plusOneRefusal,
} from './domain/guests.ts';
import {
  GuestDto,
  GuestListDto,
  guestSerializer,
  HistoryEntryDto,
  PartyDto,
  partySerializer,
} from './dto.ts';
import { rsvpStateCondition } from './rsvp-filter.ts';
import {
  AGE_CLASSES,
  ENTRY_SOURCES,
  type GuestSource,
  guests,
  type HistoryAction,
  PARTY_RSVP_STATES,
  parties,
  rsvpHistory,
} from './schema.ts';

export const MAX_PARTIES_PER_EVENT = 1000;
export const MAX_GUESTS_PER_PARTY = 20;
export const MAX_GUESTS_PER_EVENT = 3000;
export const MAX_TAGS = 20;

/* ---------------------------------------------------------------------------- validation ---- */

const Text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .default(null)
    .transform((v) => (v ? v : null));

const Source = z.enum(ENTRY_SOURCES).default('manual');

const PartyFields = z.object({
  name: z.string().trim().min(1).max(120),
  envelopeName: Text(200),
  side: Text(40),
  vip: z.boolean().default(false),
  tags: z
    .array(z.string().trim().max(40))
    .max(MAX_TAGS)
    .default([])
    .transform((t) => normalizeTags(t)),
  notes: z.string().trim().max(2000).default(''),
  source: Source,
});

const GuestFields = z.object({
  firstName: Text(80),
  lastName: Text(80),
  ageClass: z.enum(AGE_CLASSES).default('adult'),
  meal: Text(80),
  dietary: Text(500),
  accessibility: Text(500),
  address: Text(500),
  attendeeId: z.uuid().nullable().default(null),
  isPrimary: z.boolean().default(false),
  source: Source,
});

const invalid = (field: string, reason: string) =>
  new DomainError('validation_failed', `Invalid ${field}`, { field, reason });

/* ------------------------------------------------------------------------------- sealing ---- */

/**
 * The sealed part of a guest (P4-3): never stored or logged in plaintext. Email and phone arrive
 * with an import (M4.1b) and are kept when the host edits the other answers.
 */
interface Sealed {
  dietary: string | null;
  accessibility: string | null;
  address: string | null;
  email?: string | null;
  phone?: string | null;
}
const SEALED_KEYS = ['dietary', 'accessibility', 'address', 'email', 'phone'] as const;

export async function seal(orgId: string, s: Sealed): Promise<string | null> {
  const present = Object.fromEntries(SEALED_KEYS.filter((k) => s[k]).map((k) => [k, s[k]]));
  if (Object.keys(present).length === 0) return null;
  return keyVault().encrypt(orgId, new TextEncoder().encode(JSON.stringify(present)));
}

async function unseal(orgId: string, ciphertext: string | null): Promise<Sealed> {
  const out: Sealed = { dietary: null, accessibility: null, address: null, email: null, phone: null };
  if (!ciphertext) return out;
  const raw = JSON.parse(new TextDecoder().decode(await keyVault().decrypt(orgId, ciphertext))) as Record<
    string,
    unknown
  >;
  for (const k of SEALED_KEYS) if (typeof raw[k] === 'string' && raw[k]) out[k] = raw[k] as string;
  return out;
}

/* ------------------------------------------------------------------------------- helpers ---- */

type PartyRow = typeof parties.$inferSelect;
type GuestRow = typeof guests.$inferSelect;

const like = (g: GuestRow): GuestLike => ({
  id: g.id,
  kind: g.kind as GuestLike['kind'],
  hostGuestId: g.hostGuestId,
  firstName: g.firstName,
  lastName: g.lastName,
  ageClass: g.ageClass as GuestLike['ageClass'],
});

async function toGuestDto(orgId: string, g: GuestRow): Promise<GuestDto> {
  return guestSerializer.serialize({ ...g, ...(await unseal(orgId, g.privateCiphertext)) });
}

/** The event under the org's RLS, or `not_found` (foreign and unknown ids look the same). */
async function eventOf(tx: TenantTx, eventId: string) {
  const ev = await findEventTx(tx, eventId);
  if (!ev) throw new DomainError('not_found');
  return ev;
}

async function partyOf(tx: TenantTx, eventId: string, partyId: string, field?: string): Promise<PartyRow> {
  const [p] = await tx
    .select()
    .from(parties)
    .where(and(eq(parties.id, partyId), eq(parties.eventId, eventId)));
  if (!p) throw field ? invalid(field, 'unknown_party') : new DomainError('not_found');
  return p;
}

async function guestOf(tx: TenantTx, eventId: string, guestId: string): Promise<GuestRow> {
  const [g] = await tx
    .select()
    .from(guests)
    .where(and(eq(guests.id, guestId), eq(guests.eventId, eventId)));
  if (!g) throw new DomainError('not_found');
  return g;
}

async function partyGuests(tx: TenantTx, partyId: string): Promise<GuestRow[]> {
  return tx
    .select()
    .from(guests)
    .where(eq(guests.partyId, partyId))
    .orderBy(asc(guests.createdAt), asc(guests.id));
}

async function countOf(tx: TenantTx, where: SQL | undefined, table: typeof parties | typeof guests) {
  const [row] = await tx.select({ n: sql<number>`count(*)::int` }).from(table).where(where);
  return row?.n ?? 0;
}

async function assertRoomFor(tx: TenantTx, eventId: string, partyId: string, adding: number) {
  if ((await countOf(tx, eq(guests.partyId, partyId), guests)) + adding > MAX_GUESTS_PER_PARTY)
    throw new DomainError('invalid_state', 'The party is full', { reason: 'party_full' });
  if ((await countOf(tx, eq(guests.eventId, eventId), guests)) + adding > MAX_GUESTS_PER_EVENT)
    throw new DomainError('invalid_state', 'Limit reached', { reason: 'too_many' });
}

interface HistoryInput {
  readonly eventId: string;
  readonly partyId: string;
  readonly guestId?: string | null;
  readonly action: HistoryAction;
  readonly source: GuestSource;
  readonly fields?: readonly string[];
  readonly detail?: Record<string, string | number>;
}

/**
 * The history writer (roadmap §5.1: every change to a guest or party, with its source and actor).
 * Runs in the command's transaction, so a change and its history commit together. Field names
 * only, never values (some are sealed).
 */
export async function recordHistoryTx(tx: TenantTx, ctx: Ctx, entries: readonly HistoryInput[]) {
  if (entries.length === 0) return;
  const orgId = requireOrg(ctx);
  await tx.insert(rsvpHistory).values(
    entries.map((e) => ({
      orgId,
      eventId: e.eventId,
      partyId: e.partyId,
      guestId: e.guestId ?? null,
      action: e.action,
      source: e.source,
      actor: actorId(ctx.actor),
      fields: [...(e.fields ?? [])],
      detail: e.detail ?? {},
    })),
  );
}

/**
 * Keeps one primary contact per party: when none is left, the first named adult guest becomes it
 * (recorded as a change of `isPrimary`).
 */
async function ensurePrimaryTx(
  tx: TenantTx,
  ctx: Ctx,
  eventId: string,
  partyId: string,
  source: GuestSource,
) {
  const list = await partyGuests(tx, partyId);
  if (list.some((g) => g.isPrimary)) return;
  const id = nextPrimary(list.map(like));
  if (!id) return;
  await tx.update(guests).set({ isPrimary: true, updatedAt: ctx.now }).where(eq(guests.id, id));
  await recordHistoryTx(tx, ctx, [
    { eventId, partyId, guestId: id, action: 'guest_updated', source, fields: ['isPrimary'] },
  ]);
}

/**
 * Clears the party's primary contact (other than `keepId`) before another guest takes the role;
 * each demoted guest's change is recorded.
 */
async function clearPrimaryTx(
  tx: TenantTx,
  ctx: Ctx,
  at: { eventId: string; partyId: string; source: GuestSource },
  keepId: string | null,
) {
  const demoted = await tx
    .update(guests)
    .set({ isPrimary: false, updatedAt: ctx.now })
    .where(
      and(
        eq(guests.partyId, at.partyId),
        eq(guests.isPrimary, true),
        ...(keepId ? [ne(guests.id, keepId)] : []),
      ),
    )
    .returning({ id: guests.id });
  await recordHistoryTx(
    tx,
    ctx,
    demoted.map((d) => ({ ...at, guestId: d.id, action: 'guest_updated' as const, fields: ['isPrimary'] })),
  );
}

/** The attendee link: an active guest-list entry of the same event; returns its contact. */
async function linkOf(tx: TenantTx, eventId: string, attendeeId: string | null) {
  if (!attendeeId) return { attendeeId: null, contactId: null };
  const [a] = await attendeesByIdsTx(tx, [attendeeId]);
  if (!a || a.eventId !== eventId) throw invalid('attendeeId', 'unknown_attendee');
  return { attendeeId: a.id, contactId: a.contactId };
}

const linkTaken = (err: unknown) =>
  isUniqueViolation(err) ? new DomainError('conflict', 'Already linked', { field: 'attendeeId' }) : err;

/* ------------------------------------------------------------------------------- parties ---- */

export const createPartyCommand = tenantCommand({
  name: 'guests.createParty',
  input: PartyFields.extend({ eventId: z.uuid() }),
  output: PartyDto,
  entitlement: 'guests',
  permission: 'guests:write',
  handler: async ({ input, ctx, tx }) => {
    await eventOf(tx, input.eventId);
    if ((await countOf(tx, eq(parties.eventId, input.eventId), parties)) >= MAX_PARTIES_PER_EVENT)
      throw new DomainError('invalid_state', 'Limit reached', { reason: 'too_many' });
    const [row] = await tx
      .insert(parties)
      .values({ orgId: requireOrg(ctx), ...input })
      .returning();
    if (!row) throw new DomainError('internal');
    const { eventId: _e, source: _s, ...fields } = input;
    await recordHistoryTx(tx, ctx, [
      {
        eventId: input.eventId,
        partyId: row.id,
        action: 'party_created',
        source: input.source,
        fields: changedFields(
          { name: '', envelopeName: null, side: null, vip: false, tags: [], notes: '' },
          fields,
        ),
      },
    ]);
    return partySerializer.serialize(row);
  },
  audit: (input, row) => ({
    action: 'guests.party.create',
    targetType: 'party',
    targetId: row.id,
    data: { eventId: input.eventId },
  }),
});

export const updatePartyCommand = tenantCommand({
  name: 'guests.updateParty',
  input: PartyFields.extend({ eventId: z.uuid(), partyId: z.uuid() }),
  output: PartyDto,
  entitlement: 'guests',
  permission: 'guests:write',
  handler: async ({ input, ctx, tx }) => {
    const { eventId, partyId, source, ...fields } = input;
    const before = await partyOf(tx, eventId, partyId);
    const changed = changedFields(before, fields);
    if (changed.length === 0) return partySerializer.serialize(before);
    const [row] = await tx
      .update(parties)
      .set({ ...fields, updatedAt: ctx.now })
      .where(eq(parties.id, partyId))
      .returning();
    if (!row) throw new DomainError('not_found');
    await recordHistoryTx(tx, ctx, [{ eventId, partyId, action: 'party_updated', source, fields: changed }]);
    return partySerializer.serialize(row);
  },
  audit: (input) => ({
    action: 'guests.party.update',
    targetType: 'party',
    targetId: input.partyId,
    data: { eventId: input.eventId },
  }),
});

/** Removes the party and its guests; the history stays (it has no foreign key to them). */
export const removePartyCommand = tenantCommand({
  name: 'guests.removeParty',
  category: 'delete',
  input: z.object({ eventId: z.uuid(), partyId: z.uuid(), source: Source }),
  output: z.object({ removed: z.boolean() }),
  entitlement: 'guests',
  permission: 'guests:write',
  handler: async ({ input, ctx, tx }) => {
    await partyOf(tx, input.eventId, input.partyId);
    const gone = await tx
      .delete(guests)
      .where(eq(guests.partyId, input.partyId))
      .returning({ id: guests.id });
    await tx.delete(parties).where(eq(parties.id, input.partyId));
    await recordHistoryTx(tx, ctx, [
      ...gone.map((g) => ({
        eventId: input.eventId,
        partyId: input.partyId,
        guestId: g.id,
        action: 'guest_removed' as const,
        source: input.source,
      })),
      {
        eventId: input.eventId,
        partyId: input.partyId,
        action: 'party_removed',
        source: input.source,
        detail: { guests: gone.length },
      },
    ]);
    return { removed: true };
  },
  audit: (input) => ({
    action: 'guests.party.remove',
    targetType: 'party',
    targetId: input.partyId,
    data: { eventId: input.eventId },
  }),
});

/* -------------------------------------------------------------------------------- guests ---- */

export const addPartyGuestCommand = tenantCommand({
  name: 'guests.addGuest',
  input: GuestFields.extend({ eventId: z.uuid(), partyId: z.uuid() }),
  output: GuestDto,
  entitlement: 'guests',
  permission: 'guests:write',
  handler: async ({ input, ctx, tx }) => {
    const orgId = requireOrg(ctx);
    const { eventId, partyId, source, dietary, accessibility, address, attendeeId, isPrimary, ...fields } =
      input;
    if (!fields.firstName) throw invalid('firstName', 'required');
    await partyOf(tx, eventId, partyId);
    await assertRoomFor(tx, eventId, partyId, 1);
    const link = await linkOf(tx, eventId, attendeeId);
    const privateCiphertext = await seal(orgId, { dietary, accessibility, address });
    // The first guest of a party becomes its primary contact unless another is chosen later.
    const primary = isPrimary || !(await partyGuests(tx, partyId)).some((g) => g.isPrimary);
    if (isPrimary) await clearPrimaryTx(tx, ctx, { eventId, partyId, source }, null);
    const [row] = await tx
      .insert(guests)
      .values({
        orgId,
        eventId,
        partyId,
        kind: 'guest',
        ...fields,
        ...link,
        isPrimary: primary,
        privateCiphertext,
      })
      .returning()
      .catch((err) => {
        throw linkTaken(err);
      });
    if (!row) throw new DomainError('internal');
    await recordHistoryTx(tx, ctx, [
      {
        eventId,
        partyId,
        guestId: row.id,
        action: 'guest_added',
        source,
        fields: changedFields(EMPTY_GUEST, {
          ...fields,
          dietary,
          accessibility,
          address,
          ...link,
          isPrimary: primary,
        }),
      },
    ]);
    return toGuestDto(orgId, row);
  },
  audit: (input, g) => ({
    action: 'guests.guest.add',
    targetType: 'guest',
    targetId: g.id,
    data: { eventId: input.eventId, partyId: input.partyId },
  }),
});

const EMPTY_GUEST = {
  firstName: null as string | null,
  lastName: null as string | null,
  ageClass: 'adult',
  meal: null as string | null,
  dietary: null as string | null,
  accessibility: null as string | null,
  address: null as string | null,
  attendeeId: null as string | null,
  contactId: null as string | null,
  isPrimary: false,
};

/**
 * Edit a guest (or name a plus-one: `plus_one_named` in the history). A named guest keeps a first
 * name; a plus-one may stay unnamed. Plus-ones can't be the primary contact.
 */
export const updatePartyGuestCommand = tenantCommand({
  name: 'guests.updateGuest',
  input: GuestFields.extend({ eventId: z.uuid(), guestId: z.uuid() }),
  output: GuestDto,
  entitlement: 'guests',
  permission: 'guests:write',
  handler: async ({ input, ctx, tx }) => {
    const orgId = requireOrg(ctx);
    const { eventId, guestId, source, dietary, accessibility, address, attendeeId, isPrimary, ...fields } =
      input;
    const before = await guestOf(tx, eventId, guestId);
    if (before.kind === 'guest' && !fields.firstName) throw invalid('firstName', 'required');
    if (before.kind === 'plus_one' && !fields.firstName && fields.lastName)
      throw invalid('firstName', 'required');
    if (before.kind === 'plus_one' && isPrimary) throw invalid('isPrimary', 'plus_one_primary');
    const link = await linkOf(tx, eventId, attendeeId);
    const sealedBefore = await unseal(orgId, before.privateCiphertext);
    const next = { ...fields, dietary, accessibility, address, ...link, isPrimary };
    const changed = changedFields({ ...before, ...sealedBefore }, next);
    if (changed.length === 0) return toGuestDto(orgId, before);
    const sealedChanged = changed.some((k) => (SEALED_KEYS as readonly string[]).includes(k));
    if (isPrimary && !before.isPrimary)
      await clearPrimaryTx(tx, ctx, { eventId, partyId: before.partyId, source }, guestId);
    await tx
      .update(guests)
      .set({
        ...fields,
        ...link,
        isPrimary,
        ...(sealedChanged
          ? { privateCiphertext: await seal(orgId, { ...sealedBefore, dietary, accessibility, address }) }
          : {}),
        updatedAt: ctx.now,
      })
      .where(eq(guests.id, guestId))
      .catch((err) => {
        throw linkTaken(err);
      });
    const named = before.kind === 'plus_one' && !before.firstName && !!fields.firstName;
    await recordHistoryTx(tx, ctx, [
      {
        eventId,
        partyId: before.partyId,
        guestId,
        action: named ? 'plus_one_named' : 'guest_updated',
        source,
        fields: changed,
      },
    ]);
    if (!isPrimary) await ensurePrimaryTx(tx, ctx, eventId, before.partyId, source);
    return toGuestDto(orgId, await guestOf(tx, eventId, guestId));
  },
  audit: (input) => ({
    action: 'guests.guest.update',
    targetType: 'guest',
    targetId: input.guestId,
    data: { eventId: input.eventId },
  }),
});

/** A "Guest of <host>" slot in the host's party, named now or later. */
export const addPlusOneCommand = tenantCommand({
  name: 'guests.addPlusOne',
  input: z.object({
    eventId: z.uuid(),
    hostGuestId: z.uuid(),
    firstName: Text(80),
    lastName: Text(80),
    ageClass: z.enum(AGE_CLASSES).default('adult'),
    source: Source,
  }),
  output: GuestDto,
  entitlement: 'guests',
  permission: 'guests:write',
  handler: async ({ input, ctx, tx }) => {
    const orgId = requireOrg(ctx);
    const host = await guestOf(tx, input.eventId, input.hostGuestId);
    const party = await partyGuests(tx, host.partyId);
    const refusal = plusOneRefusal(like(host), party.map(like), MAX_GUESTS_PER_PARTY);
    if (refusal) throw new DomainError('invalid_state', 'No plus-one', { reason: refusal });
    if (!input.firstName && input.lastName) throw invalid('firstName', 'required');
    await assertRoomFor(tx, input.eventId, host.partyId, 1);
    const [row] = await tx
      .insert(guests)
      .values({
        orgId,
        eventId: input.eventId,
        partyId: host.partyId,
        kind: 'plus_one',
        hostGuestId: host.id,
        firstName: input.firstName,
        lastName: input.lastName,
        ageClass: input.ageClass,
      })
      .returning()
      .catch((err) => {
        if (isUniqueViolation(err))
          throw new DomainError('invalid_state', 'No plus-one', { reason: 'host_has_plus_one' });
        throw err;
      });
    if (!row) throw new DomainError('internal');
    await recordHistoryTx(tx, ctx, [
      {
        eventId: input.eventId,
        partyId: host.partyId,
        guestId: row.id,
        action: 'plus_one_added',
        source: input.source,
        fields: changedFields(EMPTY_GUEST, {
          firstName: input.firstName,
          lastName: input.lastName,
          ageClass: input.ageClass,
        }),
        detail: { hostGuestId: host.id },
      },
    ]);
    return toGuestDto(orgId, row);
  },
  audit: (input, g) => ({
    action: 'guests.plus_one.add',
    targetType: 'guest',
    targetId: g.id,
    data: { eventId: input.eventId, hostGuestId: input.hostGuestId },
  }),
});

/** Removes a guest (and their plus-one, who came as their guest). */
export const removePartyGuestCommand = tenantCommand({
  name: 'guests.removeGuest',
  category: 'delete',
  input: z.object({ eventId: z.uuid(), guestId: z.uuid(), source: Source }),
  output: z.object({ removed: z.number().int() }),
  entitlement: 'guests',
  permission: 'guests:write',
  handler: async ({ input, ctx, tx }) => {
    const g = await guestOf(tx, input.eventId, input.guestId);
    const gone = await tx
      .delete(guests)
      .where(or(eq(guests.id, g.id), eq(guests.hostGuestId, g.id)))
      .returning({ id: guests.id });
    await recordHistoryTx(
      tx,
      ctx,
      gone.map((r) => ({
        eventId: input.eventId,
        partyId: g.partyId,
        guestId: r.id,
        action: 'guest_removed' as const,
        source: input.source,
      })),
    );
    await ensurePrimaryTx(tx, ctx, input.eventId, g.partyId, input.source);
    return { removed: gone.length };
  },
  audit: (input) => ({
    action: 'guests.guest.remove',
    targetType: 'guest',
    targetId: input.guestId,
    data: { eventId: input.eventId },
  }),
});

/**
 * Moves a guest to another party of the same event, with their plus-one. They stop being the
 * primary contact; each party keeps one.
 */
export const moveGuestCommand = tenantCommand({
  name: 'guests.moveGuest',
  input: z.object({ eventId: z.uuid(), guestId: z.uuid(), toPartyId: z.uuid(), source: Source }),
  output: z.object({ moved: z.number().int() }),
  entitlement: 'guests',
  permission: 'guests:write',
  handler: async ({ input, ctx, tx }) => {
    const g = await guestOf(tx, input.eventId, input.guestId);
    if (g.partyId === input.toPartyId) throw invalid('toPartyId', 'same_party');
    await partyOf(tx, input.eventId, input.toPartyId, 'toPartyId');
    const ids = movingIds(like(g), (await partyGuests(tx, g.partyId)).map(like));
    if (!ids)
      throw new DomainError('invalid_state', 'A plus-one moves with their host', {
        reason: 'plus_one_moves_with_host',
      });
    await assertRoomFor(tx, input.eventId, input.toPartyId, ids.length);
    await tx
      .update(guests)
      .set({ partyId: input.toPartyId, isPrimary: false, updatedAt: ctx.now })
      .where(inArray(guests.id, ids));
    await recordHistoryTx(
      tx,
      ctx,
      ids.map((id) => ({
        eventId: input.eventId,
        partyId: input.toPartyId,
        guestId: id,
        action: 'guest_moved' as const,
        source: input.source,
        fields: ['partyId'],
        detail: { fromPartyId: g.partyId },
      })),
    );
    await ensurePrimaryTx(tx, ctx, input.eventId, g.partyId, input.source);
    await ensurePrimaryTx(tx, ctx, input.eventId, input.toPartyId, input.source);
    return { moved: ids.length };
  },
  audit: (input) => ({
    action: 'guests.guest.move',
    targetType: 'guest',
    targetId: input.guestId,
    data: { eventId: input.eventId, toPartyId: input.toPartyId },
  }),
});

/* ------------------------------------------------------------------------------- queries ---- */

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export const GuestListInput = z.object({
  eventId: z.uuid(),
  search: z.string().trim().max(100).optional(),
  side: z.string().trim().max(40).optional(),
  tag: z.string().trim().max(40).optional(),
  vip: z.boolean().optional(),
  /** M4.1d: parties in this RSVP state. */
  rsvp: z.enum(PARTY_RSVP_STATES).optional(),
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).max(100_000).default(0),
});
export type GuestListInput = z.input<typeof GuestListInput>;

/**
 * The host's guest list: parties (with every guest, plus-ones after their host) matching the
 * search (party, envelope or guest name) and filters (side, tag, VIP), and counts for the whole
 * event. Sealed answers are opened for the listed guests only.
 */
export const guestListQuery = tenantQuery({
  name: 'guests.guestList',
  input: GuestListInput,
  output: GuestListDto,
  entitlement: 'guests',
  permission: 'guests:read',
  handler: async ({ input, ctx, tx }) => {
    const orgId = requireOrg(ctx);
    const conds: SQL[] = [eq(parties.eventId, input.eventId)];
    if (input.side) conds.push(sql`lower(${parties.side}) = lower(${input.side})`);
    if (input.tag)
      conds.push(
        sql`exists (select 1 from unnest(${parties.tags}) as t(v) where lower(t.v) = lower(${input.tag}))`,
      );
    if (input.vip !== undefined) conds.push(eq(parties.vip, input.vip));
    if (input.rsvp) conds.push(rsvpStateCondition(parties.id, input.rsvp));
    if (input.search) {
      const pat = `%${escapeLike(input.search)}%`;
      const match = or(
        ilike(parties.name, pat),
        ilike(parties.envelopeName, pat),
        sql`exists (select 1 from ${guests} g where g.party_id = ${parties.id}
              and concat_ws(' ', g.first_name, g.last_name) ilike ${pat})`,
      );
      if (match) conds.push(match);
    }
    const where = and(...conds);
    const [total, page, allParties, allGuests, sides, tags] = await Promise.all([
      countOf(tx, where, parties),
      tx
        .select()
        .from(parties)
        .where(where)
        .orderBy(sql`lower(${parties.name})`, asc(parties.createdAt))
        .limit(input.limit)
        .offset(input.offset),
      tx
        .select({ id: parties.id, name: parties.name, vip: parties.vip })
        .from(parties)
        .where(eq(parties.eventId, input.eventId)),
      tx
        .select({
          id: guests.id,
          partyId: guests.partyId,
          kind: guests.kind,
          hostGuestId: guests.hostGuestId,
          firstName: guests.firstName,
          lastName: guests.lastName,
          ageClass: guests.ageClass,
        })
        .from(guests)
        .where(eq(guests.eventId, input.eventId)),
      tx
        .selectDistinct({ v: parties.side })
        .from(parties)
        .where(and(eq(parties.eventId, input.eventId), isNotNull(parties.side))),
      tx
        .selectDistinct({ v: sql<string>`unnest(${parties.tags})` })
        .from(parties)
        .where(eq(parties.eventId, input.eventId)),
    ]);
    const byParty = new Map<string, GuestLike[]>();
    for (const g of allGuests) {
      const l = byParty.get(g.partyId) ?? [];
      l.push(g as GuestLike);
      byParty.set(g.partyId, l);
    }
    const counts = countGuests(allParties.map((p) => ({ vip: p.vip, guests: byParty.get(p.id) ?? [] })));
    const ids = page.map((p) => p.id);
    const rows = ids.length
      ? await tx
          .select()
          .from(guests)
          .where(inArray(guests.partyId, ids))
          .orderBy(asc(guests.createdAt), asc(guests.id))
      : [];
    const dtos = await Promise.all(rows.map((g) => toGuestDto(orgId, g)));
    const sort = (a: string, b: string) => a.localeCompare(b, ctx.locale, { sensitivity: 'base' });
    return {
      counts,
      total,
      parties: page.map((p) => ({
        ...partySerializer.serialize(p),
        guests: orderWithPlusOnes(dtos.filter((g) => g.partyId === p.id)),
      })),
      partyOptions: allParties.map((p) => ({ id: p.id, name: p.name })).sort((x, y) => sort(x.name, y.name)),
      sides: sides.flatMap((s) => (s.v ? [s.v] : [])).sort(sort),
      tags: normalizeTags(tags.map((t) => t.v)).sort(sort),
    };
  },
});

/**
 * How many parties and guests (placeholder plus-ones included) an event has: the setup checklist's
 * "add your guests" item (batch 3c merge), without loading the list or opening sealed answers.
 */
export const guestCountQuery = tenantQuery({
  name: 'guests.guestCount',
  input: z.object({ eventId: z.uuid() }),
  output: z.object({ parties: z.int(), guests: z.int() }),
  entitlement: 'guests',
  permission: 'guests:read',
  handler: async ({ input, tx }) => {
    const [p, g] = await Promise.all([
      countOf(tx, eq(parties.eventId, input.eventId), parties),
      countOf(tx, eq(guests.eventId, input.eventId), guests),
    ]);
    return { parties: p, guests: g };
  },
});

/** A party's change history, newest first (moves out of the party included). */
export const partyHistoryQuery = tenantQuery({
  name: 'guests.partyHistory',
  input: z.object({
    eventId: z.uuid(),
    partyId: z.uuid(),
    limit: z.number().int().min(1).max(200).default(50),
  }),
  output: z.array(HistoryEntryDto),
  entitlement: 'guests',
  permission: 'guests:read',
  handler: async ({ input, tx }) => {
    const rows = await tx
      .select()
      .from(rsvpHistory)
      .where(
        and(
          eq(rsvpHistory.eventId, input.eventId),
          or(
            eq(rsvpHistory.partyId, input.partyId),
            sql`${rsvpHistory.detail}->>'fromPartyId' = ${input.partyId}`,
          ),
        ),
      )
      .orderBy(desc(rsvpHistory.createdAt), desc(rsvpHistory.id))
      .limit(input.limit);
    return rows.map((r) => ({ ...r, at: r.createdAt }));
  },
});
