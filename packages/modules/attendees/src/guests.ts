import { normalizeEmail, upsertContactTx } from '@yayatoh/crm';
import type { TenantTx } from '@yayatoh/db';
import { DomainError, requireOrg } from '@yayatoh/kernel';
import {
  bulkCommands,
  bulkOperationParamsTx,
  defineBulkAction,
  defineSubscriber,
  type Mailer,
  tenantCommand,
} from '@yayatoh/platform';
import { assertNotPausedTx } from '@yayatoh/tenancy';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { AttendeeFilter, Label, MAX_LABELS } from './attendees.ts';
import { resolveAttendeeIdsTx } from './bulk.ts';
import { AttendeeDto, attendeeSerializer } from './dto.ts';
import { attendees } from './schema.ts';

/**
 * Add one guest to an event's guest list (source `guest`): no ticket, just a person on the list
 * (weddings, galas, comps). One active entry per email per event.
 */
export const addGuestCommand = tenantCommand({
  name: 'attendees.addGuest',
  input: z.object({
    eventId: z.uuid(),
    name: z.string().trim().min(1).max(200),
    email: z.email().max(254),
    labels: z.array(Label).max(MAX_LABELS).default([]),
  }),
  output: AttendeeDto,
  entitlement: 'attendees',
  permission: 'attendees:write',
  handler: async ({ input, ctx, tx }) => {
    const [dupe] = await tx
      .select({ id: attendees.id })
      .from(attendees)
      .where(
        and(
          eq(attendees.eventId, input.eventId),
          eq(attendees.status, 'active'),
          eq(sql`lower(${attendees.email})`, normalizeEmail(input.email)),
        ),
      )
      .limit(1);
    if (dupe) throw new DomainError('conflict', 'Already on the guest list', { field: 'email' });
    const contact = await upsertContactTx(tx, ctx, {
      email: input.email,
      name: input.name,
      source: 'manual',
    });
    const [row] = await tx
      .insert(attendees)
      .values({
        orgId: requireOrg(ctx),
        eventId: input.eventId,
        contactId: contact.id,
        source: 'guest',
        name: input.name,
        email: input.email.trim(),
        labels: [...new Set(input.labels)],
      })
      .returning();
    if (!row) throw new DomainError('internal');
    return attendeeSerializer.serialize(row);
  },
  audit: (input, r) => ({
    action: 'attendees.add_guest',
    targetType: 'attendee',
    targetId: r?.id ?? null,
    data: { eventId: input.eventId },
  }),
});

/**
 * Take someone off the list (status `cancelled`; the record stays for history). Ticket holders
 * are removed by cancelling or refunding their ticket instead (M1.6), not here.
 */
export const removeGuestCommand = tenantCommand({
  name: 'attendees.removeGuest',
  input: z.object({ eventId: z.uuid(), attendeeId: z.uuid() }),
  output: z.object({ ok: z.boolean() }),
  entitlement: 'attendees',
  permission: 'attendees:write',
  handler: async ({ input, ctx, tx }) => {
    const [a] = await tx
      .select({ ticketId: attendees.ticketId, status: attendees.status })
      .from(attendees)
      .where(and(eq(attendees.id, input.attendeeId), eq(attendees.eventId, input.eventId)));
    if (!a) throw new DomainError('not_found', 'Attendee not found');
    if (a.ticketId)
      throw new DomainError('invalid_state', 'Ticket holders are removed by cancelling the ticket');
    await tx
      .update(attendees)
      .set({ status: 'cancelled', updatedAt: ctx.now })
      .where(eq(attendees.id, input.attendeeId));
    return { ok: true };
  },
  audit: (input) => ({
    action: 'attendees.remove_guest',
    targetType: 'attendee',
    targetId: input.attendeeId,
  }),
});

const MessageParams = z.object({
  subject: z.string().trim().min(1).max(150),
  body: z.string().trim().min(1).max(5_000),
});

/**
 * Email the selected attendees about the event (operational messages, not marketing: no
 * marketing consent needed, but always about this event and from the organizer). Each chunk
 * emits one `attendees.message_batch@1`; the mailer sends one email per active attendee, each
 * with its own idempotency key, so a replayed event never emails twice.
 */
export const attendeeEmailAction = defineBulkAction({
  key: 'attendees.email',
  entitlement: 'attendees',
  permission: 'attendees:write',
  params: MessageParams,
  filter: AttendeeFilter,
  chunkSize: 500,
  resolve: async (tx, sel) => {
    // Staff kill switch (M1.3e): no new messages while messaging is paused.
    await assertNotPausedTx(tx, 'pause_messaging');
    return resolveAttendeeIdsTx(tx, sel);
  },
  run: async (tx, ctx, ids, _params, meta) => {
    if (ids.length === 0) return { results: [] };
    const rows = await tx
      .select({ id: attendees.id, status: attendees.status })
      .from(attendees)
      .where(inArray(attendees.id, [...ids]));
    const status = new Map(rows.map((r) => [r.id, r.status]));
    const send = ids.filter((id) => status.get(id) === 'active');
    if (send.length)
      meta.emit({
        type: 'attendees.message_batch',
        version: 1,
        aggregateType: 'bulk_operation',
        aggregateId: meta.operationId,
        payload: {
          orgId: requireOrg(ctx),
          operationId: meta.operationId,
          eventId: meta.eventId,
          attendeeIds: send,
        },
      });
    return {
      results: ids.map((id) =>
        status.get(id) === 'active'
          ? { id, ok: true }
          : { id, ok: false, code: status.has(id) ? 'not_attending' : 'not_found' },
      ),
    };
  },
});

export const attendeeEmailBulk = bulkCommands(attendeeEmailAction);

const BatchPayload = z.object({
  orgId: z.uuid(),
  operationId: z.uuid(),
  eventId: z.uuid().nullable(),
  attendeeIds: z.array(z.uuid()),
});

/** Sends the emails of one message batch (worker; SES once the owner's AWS account exists). */
export function attendeeMessageMailer(deps: {
  mailer: Mailer;
  eventName: (tx: TenantTx, eventId: string) => Promise<string | null>;
}) {
  return defineSubscriber({
    name: 'attendees.message-mailer',
    events: ['attendees.message_batch@1'],
    handle: async (tx, event) => {
      const p = BatchPayload.parse(event.payload);
      const params = MessageParams.parse(await bulkOperationParamsTx(tx, p.operationId));
      const people = await tx
        .select({ id: attendees.id, name: attendees.name, email: attendees.email })
        .from(attendees)
        .where(and(inArray(attendees.id, p.attendeeIds), eq(attendees.status, 'active')));
      const eventName = p.eventId ? ((await deps.eventName(tx, p.eventId)) ?? '') : '';
      for (const a of people)
        await deps.mailer.send({
          to: a.email,
          template: 'attendees.message',
          params: { subject: params.subject, body: params.body, name: a.name, eventName },
          idempotencyKey: `attendee-message:${p.operationId}:${a.id}`,
        });
    },
  });
}

/**
 * The person behind an attendee record, across all of this org's events (the contact
 * timeline): every attendee row of the same contact.
 */
export async function contactAttendancesTx(tx: TenantTx, attendeeId: string) {
  const [a] = await tx
    .select({ contactId: attendees.contactId })
    .from(attendees)
    .where(eq(attendees.id, attendeeId));
  if (!a) throw new DomainError('not_found', 'Attendee not found');
  const rows = await tx
    .select({
      id: attendees.id,
      eventId: attendees.eventId,
      source: attendees.source,
      status: attendees.status,
      ticketId: attendees.ticketId,
      name: attendees.name,
      email: attendees.email,
      createdAt: attendees.createdAt,
      updatedAt: attendees.updatedAt,
    })
    .from(attendees)
    .where(eq(attendees.contactId, a.contactId))
    .orderBy(attendees.createdAt);
  return { contactId: a.contactId, attendances: rows };
}
