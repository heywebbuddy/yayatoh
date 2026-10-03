import { randomBytes } from 'node:crypto';
import { type TenantTx, withoutTenant } from '@yayatoh/db';
import { type Ctx, DomainError, requireOrg, uuidv7 } from '@yayatoh/kernel';
import { keyVault, tenantCommand, tenantQuery } from '@yayatoh/platform';
import { and, asc, count, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  type CollectorPayload,
  MAX_COLLECTOR_MEMBERS,
  MERGE_FIELDS,
  mergeContact,
  newMembers,
  normalizeEmail,
  normalizePhone,
} from './domain/collector.ts';
import { lookupCodeFrom, normalizeLookupCode } from './domain/rsvp.ts';
import {
  MAX_GUESTS_PER_EVENT,
  MAX_GUESTS_PER_PARTY,
  MAX_PARTIES_PER_EVENT,
  recordHistoryTx,
  seal,
  unseal,
} from './guests.ts';
import { setPartyLocaleTx } from './invites-state.ts';
import { eventOfTx, partyOfTx } from './rsvp-state.ts';
import { COLLECTOR_STATUSES, collectorSettings, collectorSubmissions, guests, parties } from './schema.ts';

/**
 * The public contact collector (M4.1f). An event's shareable link (`/collect/{code}`, also a QR
 * code) lets guests leave their household's names, postal address, email and phone. Submissions
 * wait in the host's approval queue, sealed (P4-3): nothing changes a party until the host
 * approves a submission into a new party or merges it into an existing one field by field, or
 * rejects it. The payload is cleared once the host decides. Spam protection (rate limits and the
 * human check) runs in the web action before `submitContact`. Nothing here creates contacts,
 * consents or audience members (P4-3).
 */

/** Pending submissions an event may hold (a flood can't grow the queue without bound). */
export const MAX_PENDING_SUBMISSIONS = 2000;

/* ------------------------------------------------------------------------------ sealing ---- */

const encode = (p: CollectorPayload) => new TextEncoder().encode(JSON.stringify(p));

async function openPayload(orgId: string, ciphertext: string | null): Promise<CollectorPayload | null> {
  if (!ciphertext) return null;
  const raw = JSON.parse(
    new TextDecoder().decode(await keyVault().decrypt(orgId, ciphertext)),
  ) as Partial<CollectorPayload>;
  return {
    household: typeof raw.household === 'string' ? raw.household : '',
    members: Array.isArray(raw.members)
      ? raw.members.flatMap((m) =>
          m && typeof m.firstName === 'string'
            ? [{ firstName: m.firstName, lastName: typeof m.lastName === 'string' ? m.lastName : null }]
            : [],
        )
      : [],
    address: typeof raw.address === 'string' ? raw.address : null,
    email: typeof raw.email === 'string' ? raw.email : null,
    phone: typeof raw.phone === 'string' ? raw.phone : null,
    note: typeof raw.note === 'string' ? raw.note : null,
  };
}

/* ----------------------------------------------------------------------------- settings ---- */

async function collectorOfTx(tx: TenantTx, eventId: string) {
  const [row] = await tx.select().from(collectorSettings).where(eq(collectorSettings.eventId, eventId));
  return row ?? null;
}

/** The event's collector row, made (off, with a fresh code) on first use. */
async function ensureCollectorTx(tx: TenantTx, ctx: Ctx, eventId: string) {
  const found = await collectorOfTx(tx, eventId);
  if (found) return found;
  for (let attempt = 0; attempt < 5; attempt++) {
    const [row] = await tx
      .insert(collectorSettings)
      .values({ orgId: requireOrg(ctx), eventId, code: lookupCodeFrom(randomBytes(8)) })
      .onConflictDoNothing()
      .returning();
    if (row) return row;
    const again = await collectorOfTx(tx, eventId);
    if (again) return again;
  }
  throw new DomainError('conflict', 'Could not allocate a collector code', { reason: 'collector_code' });
}

/** The org and event of a collector address, or null (unknown code, collector off, org not live). */
export async function collectorTarget(raw: string): Promise<{ orgId: string; eventId: string } | null> {
  const code = normalizeLookupCode(raw);
  if (!code) return null;
  const rows = await withoutTenant((tx) =>
    tx.execute<{ org_id: string; event_id: string }>(
      sql`select org_id, event_id from guests.collector_target(${code})`,
    ),
  );
  return rows[0] ? { orgId: rows[0].org_id, eventId: rows[0].event_id } : null;
}

export const CollectorSettingsDto = z.object({
  enabled: z.boolean(),
  /** Null until the collector was first switched on. */
  code: z.string().nullable(),
  pending: z.int(),
});
export type CollectorSettingsDto = z.infer<typeof CollectorSettingsDto>;

async function pendingCountTx(tx: TenantTx, eventId: string) {
  const [row] = await tx
    .select({ n: count() })
    .from(collectorSubmissions)
    .where(and(eq(collectorSubmissions.eventId, eventId), eq(collectorSubmissions.status, 'pending')));
  return row?.n ?? 0;
}

/** Switch the collector on or off (the address stays the same; off, it answers "not found"). */
export const setCollectorCommand = tenantCommand({
  name: 'guests.setCollector',
  input: z.object({ eventId: z.uuid(), enabled: z.boolean() }),
  output: CollectorSettingsDto,
  entitlement: 'guests',
  permission: 'guests:write',
  handler: async ({ input, ctx, tx }) => {
    await eventOfTx(tx, input.eventId);
    const row = await ensureCollectorTx(tx, ctx, input.eventId);
    await tx
      .update(collectorSettings)
      .set({ enabled: input.enabled, updatedAt: ctx.now })
      .where(eq(collectorSettings.id, row.id));
    return { enabled: input.enabled, code: row.code, pending: await pendingCountTx(tx, input.eventId) };
  },
  audit: (input) => ({
    action: 'guests.collector.set',
    targetType: 'event',
    targetId: input.eventId,
    data: { enabled: input.enabled },
  }),
});

export const collectorSettingsQuery = tenantQuery({
  name: 'guests.collectorSettings',
  input: z.object({ eventId: z.uuid() }),
  output: CollectorSettingsDto,
  entitlement: 'guests',
  permission: 'guests:read',
  handler: async ({ input, tx }) => {
    const row = await collectorOfTx(tx, input.eventId);
    return {
      enabled: row?.enabled ?? false,
      code: row?.code ?? null,
      pending: await pendingCountTx(tx, input.eventId),
    };
  },
});

/** What the public page shows: the event's name only (never the host's list). */
export const publicCollectorQuery = tenantQuery({
  name: 'guests.publicCollector',
  input: z.object({ eventId: z.uuid() }),
  output: z.object({ eventName: z.string() }),
  entitlement: 'guests',
  permission: 'public:collector',
  handler: async ({ input, tx }) => {
    const row = await collectorOfTx(tx, input.eventId);
    if (!row?.enabled) throw new DomainError('not_found', 'Collector is off', { reason: 'collector_off' });
    const ev = await eventOfTx(tx, input.eventId);
    return { eventName: ev.name };
  },
});

/* --------------------------------------------------------------------------- submitting ---- */

const Name = (max: number) => z.string().trim().max(max);
const Optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .default(null)
    .transform((v) => (v ? v : null));

export const SubmitContactInput = z.object({
  eventId: z.uuid(),
  household: Name(120).min(1),
  members: z
    .array(z.object({ firstName: Name(80).min(1), lastName: Optional(80) }))
    .min(1)
    .max(MAX_COLLECTOR_MEMBERS),
  address: Optional(500),
  email: Optional(254),
  phone: Optional(40),
  note: Optional(500),
  locale: z
    .string()
    .regex(/^[a-z]{2}(-[A-Z]{2})?$/)
    .default('en'),
});

const invalid = (field: string, reason: string) =>
  new DomainError('validation_failed', `Invalid ${field}`, { field, reason });

/**
 * A guest's submission (public): sealed into the host's queue, nothing else. At least one way to
 * reach the household (address, email or phone). Refused when the collector is off or the
 * queue is full.
 */
export const submitContactCommand = tenantCommand({
  name: 'guests.submitContact',
  input: SubmitContactInput,
  output: z.object({ ok: z.literal(true) }),
  entitlement: 'guests',
  permission: 'public:collector',
  handler: async ({ input, ctx, tx }) => {
    const orgId = requireOrg(ctx);
    const row = await collectorOfTx(tx, input.eventId);
    if (!row?.enabled) throw new DomainError('not_found', 'Collector is off', { reason: 'collector_off' });
    const email = input.email ? normalizeEmail(input.email) : null;
    if (input.email && !email) throw invalid('email', 'invalid_email');
    const phone = input.phone ? normalizePhone(input.phone) : null;
    if (input.phone && !phone) throw invalid('phone', 'invalid_phone');
    if (!input.address && !email && !phone) throw invalid('address', 'contact_required');
    if ((await pendingCountTx(tx, input.eventId)) >= MAX_PENDING_SUBMISSIONS)
      throw new DomainError('invalid_state', 'The queue is full', { reason: 'queue_full' });
    const payload: CollectorPayload = {
      household: input.household,
      members: input.members.map((m) => ({ firstName: m.firstName, lastName: m.lastName })),
      address: input.address,
      email,
      phone,
      note: input.note,
    };
    await tx.insert(collectorSubmissions).values({
      orgId,
      eventId: input.eventId,
      payloadCiphertext: await keyVault().encrypt(orgId, encode(payload)),
      locale: input.locale,
    });
    return { ok: true as const };
  },
  // Counts only: what the guest typed never reaches the audit log.
  audit: (input) => ({
    action: 'guests.collector.submit',
    targetType: 'event',
    targetId: input.eventId,
    data: { members: input.members.length },
  }),
});

/* ------------------------------------------------------------------------------- queue ---- */

export const CollectorSubmissionDto = z.object({
  id: z.uuid(),
  status: z.enum(COLLECTOR_STATUSES),
  submittedAt: z.date(),
  locale: z.string(),
  /** Null once decided (the payload is cleared). */
  household: z.string().nullable(),
  members: z.array(z.object({ firstName: z.string(), lastName: z.string().nullable() })),
  address: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  note: z.string().nullable(),
  partyId: z.uuid().nullable(),
  decidedAt: z.date().nullable(),
});
export type CollectorSubmissionDto = z.infer<typeof CollectorSubmissionDto>;

async function toSubmissionDto(
  orgId: string,
  r: typeof collectorSubmissions.$inferSelect,
): Promise<CollectorSubmissionDto> {
  const p = await openPayload(orgId, r.payloadCiphertext);
  return {
    id: r.id,
    status: r.status as CollectorSubmissionDto['status'],
    submittedAt: r.createdAt,
    locale: r.locale,
    household: p?.household ?? null,
    members: p ? [...p.members] : [],
    address: p?.address ?? null,
    email: p?.email ?? null,
    phone: p?.phone ?? null,
    note: p?.note ?? null,
    partyId: r.partyId,
    decidedAt: r.decidedAt,
  };
}

/**
 * The host's queue: pending submissions (oldest first), then the latest decisions. Personal data
 * (the same roles that read guests' addresses: `guests:read`).
 */
export const collectorQueueQuery = tenantQuery({
  name: 'guests.collectorQueue',
  input: z.object({ eventId: z.uuid() }),
  output: z.object({ pending: z.array(CollectorSubmissionDto), decided: z.array(CollectorSubmissionDto) }),
  entitlement: 'guests',
  permission: 'guests:read',
  handler: async ({ input, ctx, tx }) => {
    const orgId = requireOrg(ctx);
    const [pending, decided] = await Promise.all([
      tx
        .select()
        .from(collectorSubmissions)
        .where(
          and(eq(collectorSubmissions.eventId, input.eventId), eq(collectorSubmissions.status, 'pending')),
        )
        .orderBy(asc(collectorSubmissions.createdAt), asc(collectorSubmissions.id))
        .limit(200),
      tx
        .select()
        .from(collectorSubmissions)
        .where(
          and(
            eq(collectorSubmissions.eventId, input.eventId),
            sql`${collectorSubmissions.status} <> 'pending'`,
          ),
        )
        .orderBy(desc(collectorSubmissions.decidedAt), desc(collectorSubmissions.id))
        .limit(20),
    ]);
    return {
      pending: await Promise.all(pending.map((r) => toSubmissionDto(orgId, r))),
      decided: await Promise.all(decided.map((r) => toSubmissionDto(orgId, r))),
    };
  },
});

/** A pending submission of the event, locked; anything else is `not_found` / `already_decided`. */
async function pendingSubmissionTx(tx: TenantTx, eventId: string, submissionId: string) {
  const [row] = await tx
    .select()
    .from(collectorSubmissions)
    .where(and(eq(collectorSubmissions.id, submissionId), eq(collectorSubmissions.eventId, eventId)))
    .for('update');
  if (!row) throw new DomainError('not_found', 'Submission not found');
  if (row.status !== 'pending')
    throw new DomainError('invalid_state', 'Already decided', { reason: 'already_decided' });
  return row;
}

async function decideTx(
  tx: TenantTx,
  ctx: Ctx,
  id: string,
  status: 'approved' | 'merged' | 'rejected',
  partyId: string | null,
) {
  await tx
    .update(collectorSubmissions)
    .set({
      status,
      partyId,
      payloadCiphertext: null,
      decidedAt: ctx.now,
      decidedBy: ctx.actor.type === 'user' ? ctx.actor.userId : null,
      updatedAt: ctx.now,
    })
    .where(eq(collectorSubmissions.id, id));
}

/**
 * The comparison a merge shows: the submission and the party's primary guest's address, email
 * and phone, side by side, plus which submitted members the party doesn't have yet.
 */
export const collectorMergePreviewQuery = tenantQuery({
  name: 'guests.collectorMergePreview',
  input: z.object({ eventId: z.uuid(), submissionId: z.uuid(), partyId: z.uuid() }),
  output: z.object({
    submission: CollectorSubmissionDto,
    party: z.object({ id: z.uuid(), name: z.string() }),
    current: z.object({
      address: z.string().nullable(),
      email: z.string().nullable(),
      phone: z.string().nullable(),
    }),
    newMembers: z.array(z.int()),
  }),
  entitlement: 'guests',
  permission: 'guests:write',
  handler: async ({ input, ctx, tx }) => {
    const orgId = requireOrg(ctx);
    const [row] = await tx
      .select()
      .from(collectorSubmissions)
      .where(
        and(eq(collectorSubmissions.id, input.submissionId), eq(collectorSubmissions.eventId, input.eventId)),
      );
    if (!row) throw new DomainError('not_found', 'Submission not found');
    const party = await partyOfTx(tx, input.eventId, input.partyId);
    const list = await tx
      .select()
      .from(guests)
      .where(eq(guests.partyId, party.id))
      .orderBy(asc(guests.createdAt), asc(guests.id));
    const primary = list.find((g) => g.isPrimary) ?? list.find((g) => g.kind === 'guest') ?? null;
    const sealed = await unseal(orgId, primary?.privateCiphertext ?? null);
    const submission = await toSubmissionDto(orgId, row);
    return {
      submission,
      party: { id: party.id, name: party.name },
      current: { address: sealed.address, email: sealed.email ?? null, phone: sealed.phone ?? null },
      newMembers: newMembers(list, submission.members),
    };
  },
});

async function countWhere(tx: TenantTx, table: typeof parties | typeof guests, where: ReturnType<typeof eq>) {
  const [row] = await tx.select({ n: count() }).from(table).where(where);
  return row?.n ?? 0;
}

/**
 * Approve a submission into a new party (source `collector`): the household's name, its members
 * as guests (the first is the primary contact and holds the sealed address, email and phone),
 * and the language the guest used for its invitations.
 */
export const approveSubmissionCommand = tenantCommand({
  name: 'guests.approveSubmission',
  input: z.object({ eventId: z.uuid(), submissionId: z.uuid() }),
  output: z.object({ partyId: z.uuid() }),
  entitlement: 'guests',
  permission: 'guests:write',
  handler: async ({ input, ctx, tx }) => {
    const orgId = requireOrg(ctx);
    await eventOfTx(tx, input.eventId);
    const row = await pendingSubmissionTx(tx, input.eventId, input.submissionId);
    const p = await openPayload(orgId, row.payloadCiphertext);
    if (!p || p.members.length === 0)
      throw new DomainError('invalid_state', 'Nothing to approve', { reason: 'empty_submission' });
    if ((await countWhere(tx, parties, eq(parties.eventId, input.eventId))) >= MAX_PARTIES_PER_EVENT)
      throw new DomainError('invalid_state', 'Limit reached', { reason: 'too_many' });
    const members = p.members.slice(0, MAX_GUESTS_PER_PARTY);
    if (
      (await countWhere(tx, guests, eq(guests.eventId, input.eventId))) + members.length >
      MAX_GUESTS_PER_EVENT
    )
      throw new DomainError('invalid_state', 'Limit reached', { reason: 'too_many' });
    const partyId = uuidv7();
    await tx.insert(parties).values({
      id: partyId,
      orgId,
      eventId: input.eventId,
      name: p.household.slice(0, 120),
      notes: p.note?.slice(0, 2000) ?? '',
      source: 'collector',
    });
    const t0 = ctx.now.getTime();
    const ids = members.map((_, i) => uuidv7(t0 + i));
    const contact = await seal(orgId, {
      dietary: null,
      accessibility: null,
      address: p.address,
      email: p.email,
      phone: p.phone,
    });
    await tx.insert(guests).values(
      members.map((m, i) => ({
        id: ids[i] as string,
        orgId,
        eventId: input.eventId,
        partyId,
        kind: 'guest',
        firstName: m.firstName.slice(0, 80),
        lastName: m.lastName?.slice(0, 80) ?? null,
        isPrimary: i === 0,
        privateCiphertext: i === 0 ? contact : null,
      })),
    );
    await setPartyLocaleTx(tx, ctx, input.eventId, partyId, row.locale);
    const at = { eventId: input.eventId, partyId, source: 'collector' as const };
    await recordHistoryTx(tx, ctx, [
      {
        ...at,
        action: 'party_created',
        fields: ['name', ...(p.note ? ['notes'] : [])],
        detail: { submissionId: row.id },
      },
      ...members.map((m, i) => ({
        ...at,
        guestId: ids[i] as string,
        action: 'guest_added' as const,
        fields: [
          'firstName',
          ...(m.lastName ? ['lastName'] : []),
          ...(i === 0 ? ['isPrimary', ...(['address', 'email', 'phone'] as const).filter((k) => p[k])] : []),
        ],
      })),
      { ...at, action: 'collector_approved', detail: { submissionId: row.id } },
    ]);
    await decideTx(tx, ctx, row.id, 'approved', partyId);
    return { partyId };
  },
  audit: (input, r) => ({
    action: 'guests.collector.approve',
    targetType: 'party',
    targetId: r.partyId,
    data: { eventId: input.eventId, submissionId: input.submissionId },
  }),
});

const Choice = z.enum(['keep', 'use']).default('keep');

/**
 * Merge a submission into an existing party, field by field: for the address, email and phone
 * the host keeps the party's value or uses the submitted one (on the party's primary guest, sealed),
 * and picks which of the submitted people to add as guests. Nothing else of the party changes.
 */
export const mergeSubmissionCommand = tenantCommand({
  name: 'guests.mergeSubmission',
  input: z.object({
    eventId: z.uuid(),
    submissionId: z.uuid(),
    partyId: z.uuid(),
    fields: z.object({ address: Choice, email: Choice, phone: Choice }).default({
      address: 'keep',
      email: 'keep',
      phone: 'keep',
    }),
    /** Indexes of submitted members to add (only ones the party doesn't have). */
    addMembers: z
      .array(
        z
          .int()
          .min(0)
          .max(MAX_COLLECTOR_MEMBERS - 1),
      )
      .max(MAX_COLLECTOR_MEMBERS)
      .default([]),
  }),
  output: z.object({ partyId: z.uuid(), changed: z.array(z.enum(MERGE_FIELDS)), added: z.int() }),
  entitlement: 'guests',
  permission: 'guests:write',
  handler: async ({ input, ctx, tx }) => {
    const orgId = requireOrg(ctx);
    const row = await pendingSubmissionTx(tx, input.eventId, input.submissionId);
    const party = await partyOfTx(tx, input.eventId, input.partyId);
    const p = await openPayload(orgId, row.payloadCiphertext);
    if (!p) throw new DomainError('invalid_state', 'Nothing to merge', { reason: 'empty_submission' });
    const list = await tx
      .select()
      .from(guests)
      .where(eq(guests.partyId, party.id))
      .orderBy(asc(guests.createdAt), asc(guests.id));
    const offered = new Set(newMembers(list, p.members));
    const adding = [...new Set(input.addMembers)].sort((a, b) => a - b);
    if (adding.some((i) => !offered.has(i))) throw invalid('addMembers', 'unknown_member');
    if (list.length + adding.length > MAX_GUESTS_PER_PARTY)
      throw new DomainError('invalid_state', 'The party is full', { reason: 'party_full' });
    if (
      adding.length &&
      (await countWhere(tx, guests, eq(guests.eventId, input.eventId))) + adding.length > MAX_GUESTS_PER_EVENT
    )
      throw new DomainError('invalid_state', 'Limit reached', { reason: 'too_many' });
    const at = { eventId: input.eventId, partyId: party.id, source: 'collector' as const };

    // Contact details land on the primary guest (the first named guest when there is none).
    let primary = list.find((g) => g.isPrimary) ?? list.find((g) => g.kind === 'guest') ?? null;
    const t0 = ctx.now.getTime();
    const addedIds: string[] = [];
    for (const [n, i] of adding.entries()) {
      const m = p.members[i];
      if (!m) continue;
      const id = uuidv7(t0 + n);
      const becomesPrimary = !primary && n === 0;
      await tx.insert(guests).values({
        id,
        orgId,
        eventId: input.eventId,
        partyId: party.id,
        kind: 'guest',
        firstName: m.firstName.slice(0, 80),
        lastName: m.lastName?.slice(0, 80) ?? null,
        isPrimary: becomesPrimary,
      });
      addedIds.push(id);
      await recordHistoryTx(tx, ctx, [
        {
          ...at,
          guestId: id,
          action: 'guest_added',
          fields: [
            'firstName',
            ...(m.lastName ? ['lastName'] : []),
            ...(becomesPrimary ? ['isPrimary'] : []),
          ],
        },
      ]);
      if (becomesPrimary) primary = (await tx.select().from(guests).where(eq(guests.id, id)))[0] ?? null;
    }

    let changed: (typeof MERGE_FIELDS)[number][] = [];
    if (primary) {
      const before = await unseal(orgId, primary.privateCiphertext);
      const merged = mergeContact(
        { address: before.address, email: before.email ?? null, phone: before.phone ?? null },
        { address: p.address, email: p.email, phone: p.phone },
        input.fields,
      );
      changed = merged.changed;
      if (changed.length) {
        await tx
          .update(guests)
          .set({ privateCiphertext: await seal(orgId, { ...before, ...merged.values }), updatedAt: ctx.now })
          .where(eq(guests.id, primary.id));
        await recordHistoryTx(tx, ctx, [
          { ...at, guestId: primary.id, action: 'guest_updated', fields: changed },
        ]);
      }
    }
    await recordHistoryTx(tx, ctx, [
      {
        ...at,
        action: 'collector_merged',
        fields: changed,
        detail: { submissionId: row.id, added: addedIds.length },
      },
    ]);
    await decideTx(tx, ctx, row.id, 'merged', party.id);
    return { partyId: party.id, changed, added: addedIds.length };
  },
  audit: (input, r) => ({
    action: 'guests.collector.merge',
    targetType: 'party',
    targetId: input.partyId,
    data: { eventId: input.eventId, submissionId: input.submissionId, changed: r.changed, added: r.added },
  }),
});

/** Reject a submission: its payload is deleted, nothing reaches the list. */
export const rejectSubmissionCommand = tenantCommand({
  name: 'guests.rejectSubmission',
  input: z.object({ eventId: z.uuid(), submissionId: z.uuid() }),
  output: z.object({ ok: z.literal(true) }),
  entitlement: 'guests',
  permission: 'guests:write',
  handler: async ({ input, ctx, tx }) => {
    const row = await pendingSubmissionTx(tx, input.eventId, input.submissionId);
    await decideTx(tx, ctx, row.id, 'rejected', null);
    return { ok: true as const };
  },
  audit: (input) => ({
    action: 'guests.collector.reject',
    targetType: 'event',
    targetId: input.eventId,
    data: { submissionId: input.submissionId },
  }),
});
