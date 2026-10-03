import type { TenantTx } from '@yayatoh/db';
import { findEventTx } from '@yayatoh/events';
import { type Ctx, DomainError, type DomainEvent, isDomainError } from '@yayatoh/kernel';
import { CheckoutResultDto, StartCheckoutInput } from '@yayatoh/orders';
import { tenantCommand } from '@yayatoh/platform';
import { reissueTicketTx } from '@yayatoh/ticketing';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { assertEligible, eligibilityOf } from './checkout.ts';
import { groupProblem, MAX_GROUP, substitutionClosesAt, substitutionOpen } from './domain/approval.ts';
import { eligibilityRefusal } from './domain/eligibility.ts';
import { checkoutRegistrantsTx } from './registrant-checkout.ts';
import {
  groupToken,
  liveGuestCountTx,
  lockRegistrantTx,
  orderIdFromGroupToken,
  type RegistrantRow,
  refuseDirectRegistration,
  registrantIdFromToken,
} from './registrant-records.ts';
import { registrants, registrationTypes } from './schema.ts';

type Emit = (e: DomainEvent) => void;

const Person = z.object({
  name: z.string().trim().min(1).max(120),
  email: z
    .email()
    .max(254)
    .transform((e) => e.toLowerCase()),
  registrationTypeId: z.uuid(),
  admissionItemId: z.uuid(),
  addOnItemIds: z.array(z.uuid()).max(9).default([]),
});

export const StartGroupInput = z.object({
  eventId: z.uuid(),
  buyer: StartCheckoutInput.shape.buyer,
  people: z.array(Person).min(1).max(MAX_GROUP),
  /** A type's access code, for the people of code-only types. */
  accessCode: z.string().max(64).optional(),
  locale: z.string().max(10).default('en'),
  riskReview: z.array(z.string().max(60)).max(10).default([]),
});

/**
 * Group registration (public): one payer, up to 20 named registrants, each with their own type,
 * pass and add-ons, in one order. Each person must be eligible for their type (their own address
 * for a domain rule; the payer's code for a code-only type); approval and +1 types are not sold
 * this way. Capacity is claimed per type with the order's hold.
 */
export const startGroupCommand = tenantCommand({
  name: 'registration.startGroup',
  input: StartGroupInput,
  output: CheckoutResultDto.extend({ groupToken: z.string(), registrantIds: z.array(z.uuid()) }),
  entitlement: 'registration',
  permission: 'public:checkout',
  handler: async ({ input, ctx, tx, emit }) => {
    const event = await findEventTx(tx, input.eventId);
    if (event?.status !== 'published' || event.visibility === 'private')
      throw new DomainError('not_found', 'Event not found');
    const problem = groupProblem(input.people);
    if (problem)
      throw new DomainError('validation_failed', 'Check the names', { reason: problem, field: 'people' });
    const { checkout, registrantIds } = await checkoutRegistrantsTx(
      { tx, ctx, emit },
      {
        eventId: event.id,
        buyer: input.buyer,
        locale: input.locale,
        riskReview: input.riskReview,
        people: input.people,
        typeCheck: (type, person) => {
          // Name the person's row in the refusal (the form marks that row's field).
          const n = input.people.indexOf(person as (typeof input.people)[number]) + 1;
          try {
            refuseDirectRegistration(type);
          } catch (err) {
            if (isDomainError(err))
              throw new DomainError(err.code, err.message, { ...err.details, field: `pass-${n}` });
            throw err;
          }
          try {
            assertEligible(type, { email: person.email, accessCode: input.accessCode });
          } catch (err) {
            if (isDomainError(err))
              throw new DomainError(err.code, err.message, { ...err.details, field: `email-${n}` });
            throw err;
          }
        },
      },
    );
    return { ...checkout, groupToken: groupToken(checkout.order.id), registrantIds };
  },
  audit: (input, r) => ({
    action: 'registration.group_checkout',
    targetType: 'order',
    targetId: r.order.id,
    data: { eventId: input.eventId, people: input.people.length },
  }),
});

/**
 * A +1 (public, by the host's own link): a guest of one of the event's guest types, linked to the
 * host registrant, paid by the host in its own order. Only confirmed hosts of a standard type, and
 * at most the guest type's allowance per host.
 */
export const addGuestCommand = tenantCommand({
  name: 'registration.addGuest',
  input: z.object({
    token: z.string().min(10).max(200),
    registrationTypeId: z.uuid(),
    admissionItemId: z.uuid(),
    name: z.string().trim().min(1).max(120),
    email: z
      .email()
      .max(254)
      .transform((e) => e.toLowerCase()),
    locale: z.string().max(10).default('en'),
  }),
  output: CheckoutResultDto.extend({ registrantId: z.uuid() }),
  entitlement: 'registration',
  permission: 'public:checkout',
  handler: async ({ input, ctx, tx, emit }) => {
    const host = await lockRegistrantTx(tx, registrantIdFromToken(input.token));
    if (host.status !== 'confirmed' || host.hostRegistrantId)
      throw new DomainError('forbidden', 'Only a confirmed registrant may bring a guest', {
        reason: 'host_not_confirmed',
      });
    if (input.email === host.email)
      throw new DomainError('validation_failed', 'Your guest needs their own address', {
        reason: 'guest_is_host',
        field: 'email',
      });
    const { checkout, registrantIds } = await checkoutRegistrantsTx(
      { tx, ctx, emit },
      {
        eventId: host.eventId,
        buyer: { name: host.name, email: host.email },
        locale: input.locale,
        people: [
          {
            registrationTypeId: input.registrationTypeId,
            admissionItemId: input.admissionItemId,
            addOnItemIds: [],
            name: input.name,
            email: input.email,
            hostRegistrantId: host.id,
          },
        ],
        typeCheck: (type) => {
          if (type.kind !== 'guest')
            throw new DomainError('forbidden', 'This is not a guest type', { reason: 'not_guest_type' });
        },
      },
    );
    const [type] = await tx
      .select({ guestsPerHost: registrationTypes.guestsPerHost })
      .from(registrationTypes)
      .where(eq(registrationTypes.id, input.registrationTypeId));
    // Counted after this guest's row exists, under the host's lock: two tabs can't both pass.
    if ((await liveGuestCountTx(tx, host.id)) > (type?.guestsPerHost ?? 1))
      throw new DomainError('invalid_state', 'You have already added your guests', {
        reason: 'guest_limit',
      });
    return { ...checkout, registrantId: registrantIds[0] as string };
  },
  audit: (_input, r) => ({
    action: 'registration.add_guest',
    targetType: 'registrant',
    targetId: r.registrantId,
    data: { orderId: r.order.id },
  }),
});

export const SubstituteResultDto = z.object({
  registrantId: z.uuid(),
  ticketId: z.uuid(),
  rev: z.int(),
});

/**
 * Hand a confirmed registrant's place to someone else until the type's cut-off: the ticket is
 * reissued to the new person (new signed code and short code; every older code stops scanning),
 * so exactly one credential stays valid, and the attendee (badge) moves with it. Audited; the
 * new person must meet the type's domain rule.
 */
async function substituteTx(
  tx: TenantTx,
  ctx: Ctx,
  emit: Emit,
  r: RegistrantRow,
  to: { name: string; email: string },
): Promise<z.infer<typeof SubstituteResultDto>> {
  if (r.status !== 'confirmed' || !r.ticketId)
    throw new DomainError('invalid_state', 'Only a confirmed registrant can be replaced', {
      reason: 'not_confirmed',
    });
  const [type] = await tx
    .select()
    .from(registrationTypes)
    .where(eq(registrationTypes.id, r.registrationTypeId));
  const event = await findEventTx(tx, r.eventId);
  if (!type || !event) throw new DomainError('not_found');
  if (!substitutionOpen(event.startsAt, type.substitutionCutoffHours, ctx.now))
    throw new DomainError('invalid_state', 'Substitutions have closed', {
      reason: 'substitution_closed',
      closedAt: substitutionClosesAt(event.startsAt, type.substitutionCutoffHours).toISOString(),
    });
  if (to.email === r.email && to.name === r.name)
    throw new DomainError('validation_failed', 'Enter someone else', {
      reason: 'same_person',
      field: 'email',
    });
  // A domain rule binds the person attending; an access code was the payer's to use.
  if (type.eligibility === 'email_domain' && eligibilityRefusal(eligibilityOf(type), { email: to.email }))
    throw new DomainError('forbidden', 'This registration type is not open to that address', {
      reason: 'domain_not_allowed',
      field: 'email',
    });
  const [taken] = await tx
    .select({ id: registrants.id })
    .from(registrants)
    .where(
      and(
        eq(registrants.eventId, r.eventId),
        eq(registrants.registrationTypeId, r.registrationTypeId),
        eq(registrants.email, to.email),
        eq(registrants.status, 'confirmed'),
      ),
    );
  if (taken && taken.id !== r.id)
    throw new DomainError('conflict', 'That person is already registered', {
      reason: 'already_registered',
      field: 'email',
    });
  const issued = await reissueTicketTx(tx, ctx, r.ticketId, to);
  await tx
    .update(registrants)
    .set({
      name: to.name,
      email: to.email,
      company: null,
      jobTitle: null,
      message: null,
      substitutions: r.substitutions + 1,
      updatedAt: ctx.now,
    })
    .where(eq(registrants.id, r.id));
  emit({
    type: 'registration.registrant.substituted',
    version: 1,
    aggregateType: 'registrant',
    aggregateId: r.id,
    payload: { orgId: r.orgId, eventId: r.eventId, registrantId: r.id, ticketId: issued.id, rev: issued.rev },
  });
  return { registrantId: r.id, ticketId: issued.id, rev: issued.rev };
}

const SubstituteTo = {
  name: z.string().trim().min(1).max(120),
  email: z
    .email()
    .max(254)
    .transform((e) => e.toLowerCase()),
};

/** The payer replaces one of their group's registrants (public, by the group link). */
export const substituteByPayerCommand = tenantCommand({
  name: 'registration.substituteByPayer',
  input: z.object({ token: z.string().min(10).max(200), registrantId: z.uuid(), ...SubstituteTo }),
  output: SubstituteResultDto,
  entitlement: 'registration',
  permission: 'public:checkout',
  handler: async ({ input, ctx, tx, emit }) => {
    const orderId = orderIdFromGroupToken(input.token);
    const r = await lockRegistrantTx(tx, input.registrantId);
    if (r.orderId !== orderId) throw new DomainError('not_found', 'Registrant not found');
    return substituteTx(tx, ctx, emit, r, { name: input.name, email: input.email });
  },
  audit: (input, r) => ({
    action: 'registration.substitute',
    targetType: 'registrant',
    targetId: r.registrantId,
    data: { by: 'payer', ticketId: r.ticketId, rev: r.rev, orderId: orderIdFromGroupToken(input.token) },
  }),
});

/** The organizer replaces a registrant (console). */
export const substituteRegistrantCommand = tenantCommand({
  name: 'registration.substitute',
  input: z.object({ eventId: z.uuid(), registrantId: z.uuid(), ...SubstituteTo }),
  output: SubstituteResultDto,
  entitlement: 'registration',
  permission: 'events:write',
  handler: async ({ input, ctx, tx, emit }) => {
    const r = await lockRegistrantTx(tx, input.registrantId);
    if (r.eventId !== input.eventId) throw new DomainError('not_found', 'Registrant not found');
    return substituteTx(tx, ctx, emit, r, { name: input.name, email: input.email });
  },
  audit: (input, r) => ({
    action: 'registration.substitute',
    targetType: 'registrant',
    targetId: r.registrantId,
    data: { by: 'organizer', eventId: input.eventId, ticketId: r.ticketId, rev: r.rev },
  }),
});
