import type { TenantTx } from '@yayatoh/db';
import { findEventTx } from '@yayatoh/events';
import { type Ctx, DomainError, type DomainEvent, isDomainError, requireOrg } from '@yayatoh/kernel';
import { orderPaymentStateTx } from '@yayatoh/orders';
import { bulkCommands, defineBulkAction, tenantCommand, tenantQuery } from '@yayatoh/platform';
import { quoteTx } from '@yayatoh/ticketing';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { lockTypeTx, offerFreedPlacesTx, typeDemandTx } from './capacity.ts';
import { assertEligible, liveTypeForBuyerTx, offeredItemsTx } from './checkout.ts';
import {
  autoApproval,
  type Decision,
  type DecisionSource,
  decisionRefusal,
  MAX_MEMBERS,
  normalizeDomains,
  type RegistrantStatus,
} from './domain/approval.ts';
import { approvalRoom } from './domain/capacity.ts';
import { selectionProblem } from './domain/matrix.ts';
import { checkoutRegistrantsTx } from './registrant-checkout.ts';
import { lockRegistrantTx, registrantIdFromToken, registrantToken } from './registrant-records.ts';
import {
  APPROVAL_MODES,
  REGISTRANT_STATUSES,
  reasonTemplates,
  registrants,
  registrationTypes,
  TYPE_KINDS,
  typeMembers,
} from './schema.ts';

type Emit = (e: DomainEvent) => void;

async function eventForWriteTx(tx: TenantTx, eventId: string) {
  const event = await findEventTx(tx, eventId);
  if (!event) throw new DomainError('not_found', 'Event not found');
  if (['cancelled', 'completed', 'archived'].includes(event.status))
    throw new DomainError('invalid_state', 'Registration cannot change on a finished event', {
      reason: 'event_finished',
    });
  return event;
}

async function typeOfEventTx(tx: TenantTx, eventId: string, typeId: string) {
  const [row] = await tx.select().from(registrationTypes).where(eq(registrationTypes.id, typeId));
  if (!row || row.eventId !== eventId || row.archivedAt)
    throw new DomainError('not_found', 'Registration type not found');
  return row;
}

// ---------------------------------------------------------------------------------------------
// Type rules: approval, auto-approve domains, +1 guest types, substitution cut-off.

export const TypeRulesInput = z.object({
  eventId: z.uuid(),
  registrationTypeId: z.uuid(),
  approval: z.enum(APPROVAL_MODES),
  autoApproveDomains: z.array(z.string().max(253)).max(20).default([]),
  kind: z.enum(TYPE_KINDS),
  guestsPerHost: z.int().min(1).max(10).default(1),
  substitutionCutoffHours: z.int().min(0).max(720).default(24),
});

export const TypeRulesDto = z.object({
  registrationTypeId: z.uuid(),
  approval: z.enum(APPROVAL_MODES),
  autoApproveDomains: z.array(z.string()),
  kind: z.enum(TYPE_KINDS),
  guestsPerHost: z.int(),
  substitutionCutoffHours: z.int(),
  /** Addresses on the type's member list (auto-approved on applying). */
  members: z.int(),
});
export type TypeRulesDto = z.infer<typeof TypeRulesDto>;

/** Set how a type admits people (M5.1c). A +1 type has no approval of its own (its host has). */
export const setTypeRulesCommand = tenantCommand({
  name: 'registration.setTypeRules',
  input: TypeRulesInput,
  output: z.object({ ok: z.boolean() }),
  entitlement: 'registration',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    await eventForWriteTx(tx, input.eventId);
    const type = await typeOfEventTx(tx, input.eventId, input.registrationTypeId);
    const domains = input.approval === 'manual' ? normalizeDomains(input.autoApproveDomains) : [];
    if (!domains)
      throw new DomainError('validation_failed', 'Enter valid domains', { field: 'autoApproveDomains' });
    if (input.kind === 'guest' && input.approval === 'manual')
      throw new DomainError('validation_failed', 'A guest type has no approval of its own', {
        field: 'approval',
        reason: 'guest_no_approval',
      });
    await tx
      .update(registrationTypes)
      .set({
        approval: input.approval,
        autoApproveDomains: domains,
        kind: input.kind,
        guestsPerHost: input.guestsPerHost,
        substitutionCutoffHours: input.substitutionCutoffHours,
        updatedAt: ctx.now,
      })
      .where(eq(registrationTypes.id, type.id));
    return { ok: true };
  },
  audit: (input) => ({
    action: 'registration.type_rules',
    targetType: 'registration_type',
    targetId: input.registrationTypeId,
    data: {
      eventId: input.eventId,
      approval: input.approval,
      kind: input.kind,
      domains: input.autoApproveDomains.length,
    },
  }),
});

/**
 * Replace a type's member list (CSV upload or an audience snapshot taken by the app): addresses,
 * lower case, each once, at most 5,000. An empty list clears it.
 */
export const replaceMembersCommand = tenantCommand({
  name: 'registration.replaceMembers',
  input: z.object({
    eventId: z.uuid(),
    registrationTypeId: z.uuid(),
    emails: z.array(z.email().max(254)).max(MAX_MEMBERS),
    source: z.enum(['csv', 'audience']).default('csv'),
  }),
  output: z.object({ members: z.int() }),
  entitlement: 'registration',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    await eventForWriteTx(tx, input.eventId);
    const type = await typeOfEventTx(tx, input.eventId, input.registrationTypeId);
    const emails = [...new Set(input.emails.map((e) => e.trim().toLowerCase()))];
    await tx.delete(typeMembers).where(eq(typeMembers.registrationTypeId, type.id));
    const orgId = requireOrg(ctx);
    for (let i = 0; i < emails.length; i += 500)
      await tx.insert(typeMembers).values(
        emails.slice(i, i + 500).map((email) => ({
          orgId,
          eventId: input.eventId,
          registrationTypeId: type.id,
          email,
          source: input.source,
        })),
      );
    return { members: emails.length };
  },
  audit: (input, r) => ({
    action: 'registration.members_replace',
    targetType: 'registration_type',
    targetId: input.registrationTypeId,
    data: { eventId: input.eventId, members: r.members, source: input.source },
  }),
});

export const ReasonTemplateDto = z.object({
  id: z.uuid(),
  decision: z.enum(['approve', 'deny']),
  label: z.string(),
  body: z.string(),
});
export type ReasonTemplateDto = z.infer<typeof ReasonTemplateDto>;

export const saveReasonTemplateCommand = tenantCommand({
  name: 'registration.saveReasonTemplate',
  input: z.object({
    eventId: z.uuid(),
    decision: z.enum(['approve', 'deny']),
    label: z.string().trim().min(1).max(80),
    body: z.string().trim().min(1).max(1000),
  }),
  output: z.object({ id: z.uuid() }),
  entitlement: 'registration',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    await eventForWriteTx(tx, input.eventId);
    const [n] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(reasonTemplates)
      .where(eq(reasonTemplates.eventId, input.eventId));
    if ((n?.n ?? 0) >= 50)
      throw new DomainError('invalid_state', 'At most 50 templates per event', { reason: 'too_many' });
    const [row] = await tx
      .insert(reasonTemplates)
      .values({ orgId: requireOrg(ctx), ...input })
      .returning({ id: reasonTemplates.id });
    if (!row) throw new DomainError('internal');
    return row;
  },
  audit: (input, r) => ({
    action: 'registration.reason_template_save',
    targetType: 'reason_template',
    targetId: r.id,
    data: { eventId: input.eventId, decision: input.decision },
  }),
});

export const removeReasonTemplateCommand = tenantCommand({
  name: 'registration.removeReasonTemplate',
  input: z.object({ eventId: z.uuid(), templateId: z.uuid() }),
  output: z.object({ ok: z.boolean() }),
  entitlement: 'registration',
  permission: 'events:write',
  category: 'delete',
  handler: async ({ input, tx }) => {
    const rows = await tx
      .delete(reasonTemplates)
      .where(and(eq(reasonTemplates.id, input.templateId), eq(reasonTemplates.eventId, input.eventId)))
      .returning({ id: reasonTemplates.id });
    if (rows.length === 0) throw new DomainError('not_found', 'Template not found');
    return { ok: true };
  },
  audit: (input) => ({
    action: 'registration.reason_template_remove',
    targetType: 'reason_template',
    targetId: input.templateId,
    data: { eventId: input.eventId },
  }),
});

/** The approval setup of an event's types (console): rules, member counts and reason templates. */
export const approvalSetupQuery = tenantQuery({
  name: 'registration.approvalSetup',
  input: z.object({ eventId: z.uuid() }),
  output: z.object({ types: z.array(TypeRulesDto), templates: z.array(ReasonTemplateDto) }),
  entitlement: 'registration',
  permission: 'events:read',
  handler: async ({ input, tx }) => {
    const types = await tx
      .select()
      .from(registrationTypes)
      .where(and(eq(registrationTypes.eventId, input.eventId), isNull(registrationTypes.archivedAt)))
      .orderBy(asc(registrationTypes.sortOrder), asc(registrationTypes.createdAt));
    const counts = await tx
      .select({ typeId: typeMembers.registrationTypeId, n: sql<number>`count(*)::int` })
      .from(typeMembers)
      .where(eq(typeMembers.eventId, input.eventId))
      .groupBy(typeMembers.registrationTypeId);
    const templates = await tx
      .select()
      .from(reasonTemplates)
      .where(eq(reasonTemplates.eventId, input.eventId))
      .orderBy(asc(reasonTemplates.createdAt));
    return {
      types: types.map((t) => ({
        registrationTypeId: t.id,
        approval: t.approval as 'none',
        autoApproveDomains: t.autoApproveDomains,
        kind: t.kind as 'standard',
        guestsPerHost: t.guestsPerHost,
        substitutionCutoffHours: t.substitutionCutoffHours,
        members: counts.find((c) => c.typeId === t.id)?.n ?? 0,
      })),
      templates: templates.map((r) => ({
        id: r.id,
        decision: r.decision as 'approve',
        label: r.label,
        body: r.body,
      })),
    };
  },
});

// ---------------------------------------------------------------------------------------------
// Deciding.

/** Is the registrant's selection free (then approval confirms at once, with no pay step)? */
async function selectionIsFreeTx(
  tx: TenantTx,
  ctx: Ctx,
  r: { eventId: string; registrationTypeId: string; admissionItemId: string; addOnItemIds: string[] },
): Promise<boolean> {
  const offered = await offeredItemsTx(tx, r.registrationTypeId);
  const lines = [r.admissionItemId, ...r.addOnItemIds].map((id) => ({
    ticketTypeId: offered.get(id)?.ticketTypeId as string,
    quantity: 1,
  }));
  if (lines.some((l) => !l.ticketTypeId))
    throw new DomainError('invalid_state', 'This pass is no longer offered', { reason: 'item_gone' });
  const quote = await quoteTx(tx, r.eventId, lines, {
    now: ctx.now,
    includeHidden: false,
    manager: 'registration',
  });
  return quote.totalMinor === 0;
}

export interface DecideOutcome {
  readonly status: RegistrantStatus;
  readonly changed: boolean;
}

/**
 * Approve or deny one registrant (single, bulk and auto-approval share it). Approval locks the
 * type (after the registrant: every path locks registrant, then type) and needs room beyond what
 * the type's waitlist, open offers and earlier approvals keep, so concurrent approvals never
 * pass the capacity. A free selection is confirmed at once; a paid one waits for the applicant's
 * payment from their link. Deciding again what is already decided changes nothing (safe retries).
 */
export async function decideTx(
  tx: TenantTx,
  ctx: Ctx,
  emit: Emit,
  input: { registrantId: string; decision: Decision; reason: string | null; source: DecisionSource },
): Promise<DecideOutcome> {
  const r = await lockRegistrantTx(tx, input.registrantId);
  const refusal = decisionRefusal(r.status as RegistrantStatus, input.decision, r.orderId !== null);
  if (refusal === 'already') return { status: r.status as RegistrantStatus, changed: false };
  if (refusal)
    throw new DomainError('invalid_state', 'This registrant cannot be decided now', { reason: refusal });
  if (r.hostRegistrantId)
    throw new DomainError('invalid_state', 'Guests are not decided', { reason: 'guest' });
  const by = ctx.actor.type === 'user' ? ctx.actor.userId : null;
  const decided = {
    decisionSource: input.source,
    decisionReason: input.reason,
    decidedAt: ctx.now,
    decidedBy: by,
    updatedAt: ctx.now,
  };
  const type = await lockTypeTx(tx, r.registrationTypeId);
  if (!type) throw new DomainError('not_found', 'Registration type not found');
  if (input.decision === 'deny') {
    const wasApproved = r.status === 'approved';
    await tx
      .update(registrants)
      .set({ status: 'denied', ...decided })
      .where(eq(registrants.id, r.id));
    emit({
      type: 'registration.registrant.denied',
      version: 1,
      aggregateType: 'registrant',
      aggregateId: r.id,
      payload: {
        orgId: r.orgId,
        eventId: r.eventId,
        registrantId: r.id,
        registrationTypeId: r.registrationTypeId,
        decidedAt: ctx.now.toISOString(),
      },
    });
    // A withdrawn approval gives its place back to the type's lines.
    if (wasApproved) await offerFreedPlacesTx(tx, ctx, emit, type.id);
    return { status: 'denied', changed: true };
  }
  if (type.archivedAt)
    throw new DomainError('invalid_state', 'This type is archived', { reason: 'type_archived' });
  const room = approvalRoom(
    { capacity: type.capacity, held: type.quantityHeld, sold: type.quantitySold },
    await typeDemandTx(tx, type.id),
  );
  if (room !== null && room < 1)
    throw new DomainError('conflict', 'This registration type is full', {
      reason: 'type_full',
      registrationTypeId: type.id,
    });
  await tx
    .update(registrants)
    .set({ status: 'approved', ...decided })
    .where(eq(registrants.id, r.id));
  emit({
    type: 'registration.registrant.approved',
    version: 1,
    aggregateType: 'registrant',
    aggregateId: r.id,
    payload: {
      orgId: r.orgId,
      eventId: r.eventId,
      registrantId: r.id,
      registrationTypeId: r.registrationTypeId,
      source: input.source,
      decidedAt: ctx.now.toISOString(),
    },
  });
  if (await selectionIsFreeTx(tx, ctx, r)) {
    await checkoutRegistrantsTx(
      { tx, ctx, emit },
      {
        eventId: r.eventId,
        buyer: { name: r.name, email: r.email },
        locale: r.locale,
        people: [
          {
            registrationTypeId: r.registrationTypeId,
            admissionItemId: r.admissionItemId,
            addOnItemIds: r.addOnItemIds,
            name: r.name,
            email: r.email,
            approvedRegistrantId: r.id,
          },
        ],
      },
    );
    return { status: 'confirmed', changed: true };
  }
  return { status: 'approved', changed: true };
}

const DecideInput = z.object({
  eventId: z.uuid(),
  registrantId: z.uuid(),
  decision: z.enum(['approve', 'deny']),
  reason: z.string().trim().max(1000).nullable().default(null),
  templateId: z.uuid().nullable().default(null),
});

/** The reason sent: the typed text, else the chosen template's body. */
async function reasonTx(
  tx: TenantTx,
  eventId: string,
  decision: Decision,
  reason: string | null,
  templateId: string | null,
): Promise<string | null> {
  if (reason?.trim()) return reason.trim();
  if (!templateId) return null;
  const [t] = await tx.select().from(reasonTemplates).where(eq(reasonTemplates.id, templateId));
  if (!t || t.eventId !== eventId || t.decision !== decision)
    throw new DomainError('validation_failed', 'Choose a template for this decision', {
      field: 'templateId',
    });
  return t.body;
}

async function registrantOfEventTx(tx: TenantTx, eventId: string, registrantId: string) {
  const [r] = await tx
    .select({ id: registrants.id, eventId: registrants.eventId })
    .from(registrants)
    .where(eq(registrants.id, registrantId));
  if (!r || r.eventId !== eventId) throw new DomainError('not_found', 'Registrant not found');
}

/** Approve or deny one registrant from the queue, with an optional reason (emailed to them). */
export const decideRegistrantCommand = tenantCommand({
  name: 'registration.decide',
  input: DecideInput,
  output: z.object({ status: z.enum(REGISTRANT_STATUSES), changed: z.boolean() }),
  entitlement: 'registration',
  permission: 'events:write',
  handler: async ({ input, ctx, tx, emit }) => {
    await eventForWriteTx(tx, input.eventId);
    await registrantOfEventTx(tx, input.eventId, input.registrantId);
    const reason = await reasonTx(tx, input.eventId, input.decision, input.reason, input.templateId);
    return decideTx(tx, ctx, emit, {
      registrantId: input.registrantId,
      decision: input.decision,
      reason,
      source: 'manual',
    });
  },
  audit: (input, r) => ({
    action: `registration.${input.decision}`,
    targetType: 'registrant',
    targetId: input.registrantId,
    data: { eventId: input.eventId, status: r.status, changed: r.changed, reason: Boolean(input.reason) },
  }),
});

const BulkDecideParams = z.object({
  decision: z.enum(['approve', 'deny']),
  reason: z.string().trim().max(1000).nullable().default(null),
  templateId: z.uuid().nullable().default(null),
});
const BulkDecideFilter = z.object({
  status: z.enum(['pending', 'approved']).default('pending'),
  registrationTypeId: z.uuid().nullable().default(null),
});

/**
 * Bulk approve or deny with one reason (M5.1c): one resumable operation over a snapshot of
 * registrant ids, 50 per chunk. Each registrant is decided in its own savepoint, so one that
 * no longer fits (type full) or changed meanwhile fails alone with a code; a chunk is committed
 * with the operation's progress, so a crash replays at most the uncommitted chunk, and deciding
 * what is already decided changes nothing (no second email).
 */
export const registrationDecideAction = defineBulkAction({
  key: 'registration.decide',
  entitlement: 'registration',
  permission: 'events:write',
  params: BulkDecideParams,
  filter: BulkDecideFilter,
  chunkSize: 50,
  auditParams: (p) => ({ decision: p.decision, reason: Boolean(p.reason || p.templateId) }),
  resolve: async (tx, sel) => {
    if (!sel.eventId) throw new DomainError('validation_failed', 'Choose an event', { field: 'eventId' });
    await eventForWriteTx(tx, sel.eventId);
    if (sel.ids) {
      const rows = await tx
        .select({ id: registrants.id })
        .from(registrants)
        .where(and(eq(registrants.eventId, sel.eventId), inArray(registrants.id, [...sel.ids])));
      return rows.map((r) => r.id);
    }
    const f = BulkDecideFilter.parse(sel.filter ?? {});
    const rows = await tx
      .select({ id: registrants.id })
      .from(registrants)
      .where(
        and(
          eq(registrants.eventId, sel.eventId),
          eq(registrants.status, f.status),
          isNull(registrants.hostRegistrantId),
          f.registrationTypeId ? eq(registrants.registrationTypeId, f.registrationTypeId) : undefined,
        ),
      )
      .orderBy(asc(registrants.createdAt), asc(registrants.id));
    return rows.map((r) => r.id);
  },
  run: async (tx, ctx, ids, params, meta) => {
    const eventId = meta.eventId as string;
    const reason = await reasonTx(tx, eventId, params.decision, params.reason, params.templateId);
    const results = [];
    for (const id of ids) {
      try {
        await tx.transaction((sp) =>
          decideTx(sp as unknown as TenantTx, ctx, meta.emit, {
            registrantId: id,
            decision: params.decision,
            reason,
            source: 'manual',
          }),
        );
        results.push({ id, ok: true });
      } catch (err) {
        if (!isDomainError(err)) throw err;
        results.push({ id, ok: false, code: String(err.details?.reason ?? err.code) });
      }
    }
    return { results };
  },
});

export const registrationDecideBulk = bulkCommands(registrationDecideAction);

// ---------------------------------------------------------------------------------------------
// Applying (public) and paying for an approved application.

export const ApplyInput = z.object({
  eventId: z.uuid(),
  registrationTypeId: z.uuid(),
  admissionItemId: z.uuid(),
  addOnItemIds: z.array(z.uuid()).max(9).default([]),
  name: z.string().trim().min(1).max(120),
  email: z
    .email()
    .max(254)
    .transform((e) => e.toLowerCase()),
  company: z.string().trim().max(120).nullable().default(null),
  jobTitle: z.string().trim().max(120).nullable().default(null),
  message: z.string().trim().max(2000).nullable().default(null),
  accessCode: z.string().max(64).optional(),
  locale: z.string().max(10).default('en'),
});

export const ApplyResultDto = z.object({
  registrantId: z.uuid(),
  status: z.enum(REGISTRANT_STATUSES),
  alreadyApplied: z.boolean(),
  /** The applicant's own link (their status, and the pay step once approved). */
  token: z.string(),
});

/**
 * Apply to attend (public; the address proved first by the page, M1.5f). Nobody is charged: no
 * order exists until approval. An address at an auto-approve domain, or on the type's member
 * list, is approved at once (a free selection is then confirmed); a full type leaves even those
 * pending. Applying twice for one type returns the live application.
 */
export const applyCommand = tenantCommand({
  name: 'registration.apply',
  input: ApplyInput,
  output: ApplyResultDto,
  entitlement: 'registration',
  permission: 'public:checkout',
  handler: async ({ input, ctx, tx, emit }) => {
    const event = await findEventTx(tx, input.eventId);
    if (event?.status !== 'published' || event.visibility === 'private')
      throw new DomainError('not_found', 'Event not found');
    const type = await liveTypeForBuyerTx(tx, event.id, input.registrationTypeId);
    if (type.approval !== 'manual')
      throw new DomainError('invalid_state', 'This type needs no application', { reason: 'no_approval' });
    assertEligible(type, { email: input.email, accessCode: input.accessCode });
    const offered = await offeredItemsTx(tx, type.id);
    const kinds = new Map([...offered].map(([id, c]) => [id, c.kind]));
    const problem = selectionProblem([input.admissionItemId, ...input.addOnItemIds], kinds);
    if (problem || kinds.get(input.admissionItemId) !== 'admission')
      throw new DomainError('validation_failed', 'Choose one pass and any add-ons', {
        reason: problem ?? 'admission_required',
        field: 'items',
      });
    const [live] = await tx
      .select()
      .from(registrants)
      .where(
        and(
          eq(registrants.registrationTypeId, type.id),
          eq(registrants.email, input.email),
          inArray(registrants.status, ['pending', 'approved', 'confirmed']),
        ),
      )
      .limit(1);
    if (live)
      return {
        registrantId: live.id,
        status: live.status as RegistrantStatus,
        alreadyApplied: true,
        token: registrantToken(live.id),
      };
    const [row] = await tx
      .insert(registrants)
      .values({
        orgId: requireOrg(ctx),
        eventId: event.id,
        registrationTypeId: type.id,
        admissionItemId: input.admissionItemId,
        addOnItemIds: input.addOnItemIds,
        status: 'pending',
        name: input.name,
        email: input.email,
        company: input.company || null,
        jobTitle: input.jobTitle || null,
        message: input.message || null,
        locale: input.locale,
      })
      .returning();
    if (!row) throw new DomainError('internal');
    emit({
      type: 'registration.registrant.applied',
      version: 1,
      aggregateType: 'registrant',
      aggregateId: row.id,
      payload: { orgId: row.orgId, eventId: event.id, registrantId: row.id, registrationTypeId: type.id },
    });
    const [member] = await tx
      .select({ id: typeMembers.id })
      .from(typeMembers)
      .where(and(eq(typeMembers.registrationTypeId, type.id), eq(typeMembers.email, input.email)));
    const auto = autoApproval(
      { approval: 'manual', autoApproveDomains: type.autoApproveDomains },
      input.email,
      Boolean(member),
    );
    let status: RegistrantStatus = 'pending';
    if (auto) {
      try {
        status = (
          await tx.transaction((sp) =>
            decideTx(sp as unknown as TenantTx, ctx, emit, {
              registrantId: row.id,
              decision: 'approve',
              reason: null,
              source: auto,
            }),
          )
        ).status;
      } catch (err) {
        // Full (or the pass went off sale): the application waits for a person to decide.
        if (!isDomainError(err)) throw err;
      }
    }
    return { registrantId: row.id, status, alreadyApplied: false, token: registrantToken(row.id) };
  },
  audit: (input, r) => ({
    action: 'registration.apply',
    targetType: 'registrant',
    targetId: r.registrantId,
    data: { eventId: input.eventId, registrationTypeId: input.registrationTypeId, status: r.status },
  }),
});

export const PayResultDto = z.object({
  orderId: z.uuid(),
  status: z.string(),
  totalMinor: z.int(),
  currency: z.string(),
  buyerEmail: z.string(),
  fundsFlow: z.string(),
  connectedAccountId: z.string().nullable(),
  applicationFeeMinor: z.int(),
  /** True when the open order of an earlier attempt is returned (no second order). */
  reused: z.boolean(),
});
export type PayResultDto = z.infer<typeof PayResultDto>;

/**
 * Pay for an approved application (public, by the applicant's link). Idempotent: while an order
 * of an earlier attempt is still open it is returned (the provider call uses the order's
 * idempotency key); once paid, the registrant is confirmed. Pending, denied or cancelled
 * applicants are refused: nobody is charged without an approval.
 */
export const payApprovedCommand = tenantCommand({
  name: 'registration.payApproved',
  input: z.object({ token: z.string().min(10).max(200), locale: z.string().max(10).default('en') }),
  output: PayResultDto,
  entitlement: 'registration',
  permission: 'public:checkout',
  handler: async ({ input, ctx, tx, emit }) => {
    const r = await lockRegistrantTx(tx, registrantIdFromToken(input.token));
    if (r.status === 'confirmed')
      throw new DomainError('invalid_state', 'Already confirmed', { reason: 'already_confirmed' });
    if (r.status !== 'approved')
      throw new DomainError('forbidden', 'This application is not approved', { reason: 'not_approved' });
    const open = r.orderId ? await orderPaymentStateTx(tx, r.orderId) : null;
    if (open?.open)
      return {
        orderId: open.id,
        status: open.status,
        totalMinor: open.totalMinor,
        currency: open.currency,
        buyerEmail: open.buyerEmail,
        fundsFlow: open.fundsFlow,
        connectedAccountId: open.connectedAccountId,
        applicationFeeMinor: open.applicationFeeMinor,
        reused: true,
      };
    const { checkout } = await checkoutRegistrantsTx(
      { tx, ctx, emit },
      {
        eventId: r.eventId,
        buyer: { name: r.name, email: r.email },
        locale: input.locale,
        people: [
          {
            registrationTypeId: r.registrationTypeId,
            admissionItemId: r.admissionItemId,
            addOnItemIds: r.addOnItemIds,
            name: r.name,
            email: r.email,
            approvedRegistrantId: r.id,
          },
        ],
      },
    );
    return {
      orderId: checkout.order.id,
      status: checkout.order.status,
      totalMinor: checkout.order.totalMinor,
      currency: checkout.order.currency,
      buyerEmail: checkout.order.buyerEmail,
      fundsFlow: checkout.payment.fundsFlow,
      connectedAccountId: checkout.payment.connectedAccountId,
      applicationFeeMinor: checkout.payment.applicationFeeMinor,
      reused: false,
    };
  },
  audit: (_input, r) => ({
    action: 'registration.pay_approved',
    targetType: 'order',
    targetId: r.orderId,
    data: { reused: r.reused },
  }),
});
