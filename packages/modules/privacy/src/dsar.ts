import { attendeesDsarTx, eraseAttendeesDsarTx } from '@yayatoh/attendees';
import { admissionsDsarTx } from '@yayatoh/checkin';
import { contactDsarTx, eraseContactDsarTx, normalizeEmail } from '@yayatoh/crm';
import type { TenantTx } from '@yayatoh/db';
import { findEventTx } from '@yayatoh/events';
import { eraseResponsesDsarTx, responsesDsarTx } from '@yayatoh/forms';
import { type Ctx, DomainError, requireOrg, uuidv7 } from '@yayatoh/kernel';
import { eraseOrdersDsarTx, ordersDsarTx } from '@yayatoh/orders';
import {
  bulkCommands,
  bulkOperationRequesterTx,
  defineBulkAction,
  purgeFilesMentioningTx,
  tenantCommand,
  tenantQuery,
} from '@yayatoh/platform';
import { eraseTicketsDsarTx, ticketsDsarTx } from '@yayatoh/ticketing';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { DSAR_KINDS, dsarRequests } from './schema.ts';

/**
 * Data-subject requests (M1.14c; roadmap §10 Privacy). The org is the controller for its
 * attendees and buyers; Yayatoh is the processor and gives the org's owners and admins the tools:
 * find a person across the org, export everything held about them (JSON through the bulk
 * framework) and erase them. Erasure redacts in place: paid orders and the ledger are kept for
 * tax and accounting (legal hold), tickets stay valid, check-in counts stay right.
 */

export const DsarEmail = z.string().trim().toLowerCase().max(320).pipe(z.email());

async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** `jane@example.com` → `j•••@example.com` (enough to recognise, not to contact). */
export function maskEmail(emailNorm: string): string {
  const [local = '', domain = ''] = emailNorm.split('@');
  return `${local.slice(0, 1)}•••@${domain}`;
}

/** Everything the org holds about one email, allowlisted per module. */
export async function collectSubjectTx(tx: TenantTx, orgId: string, emailNorm: string) {
  const crm = await contactDsarTx(tx, emailNorm);
  const orders = await ordersDsarTx(tx, emailNorm);
  const orderIds = orders.map((o) => o.id);
  const ticketing = await ticketsDsarTx(tx, emailNorm, orderIds);
  const attendees = await attendeesDsarTx(
    tx,
    emailNorm,
    crm.contacts.map((c) => c.id),
  );
  const answers = await responsesDsarTx(tx, orgId, orderIds);
  const admissions = await admissionsDsarTx(
    tx,
    ticketing.tickets.map((t) => t.id),
  );
  return { crm, orders, ticketing, attendees, answers, admissions };
}

type Subject = Awaited<ReturnType<typeof collectSubjectTx>>;

export const DsarSummary = z.object({
  contacts: z.int(),
  consents: z.int(),
  orders: z.int(),
  paidOrders: z.int(),
  tickets: z.int(),
  activeTickets: z.int(),
  claims: z.int(),
  holderLinks: z.int(),
  attendees: z.int(),
  answers: z.int(),
  admissions: z.int(),
});
export type DsarSummary = z.infer<typeof DsarSummary>;

const PAID = ['paid', 'partially_refunded', 'refunded'];

export function summarize(s: Subject): DsarSummary {
  return {
    contacts: s.crm.contacts.length,
    consents: s.crm.consents.length,
    orders: s.orders.length,
    paidOrders: s.orders.filter((o) => PAID.includes(o.status)).length,
    tickets: s.ticketing.tickets.length,
    activeTickets: s.ticketing.tickets.filter((t) => t.status === 'active').length,
    claims: s.ticketing.claims.length,
    holderLinks: s.ticketing.holderLinks.length,
    attendees: s.attendees.length,
    answers: s.answers.length,
    admissions: s.admissions.length,
  };
}

export const DsarRequestDto = z.object({
  id: z.uuid(),
  kind: z.enum(DSAR_KINDS),
  subjectHint: z.string(),
  requestedBy: z.uuid().nullable(),
  summary: z.record(z.string(), z.int()),
  createdAt: z.date(),
});
export type DsarRequestDto = z.infer<typeof DsarRequestDto>;

const toRequestDto = (r: typeof dsarRequests.$inferSelect): DsarRequestDto => ({
  id: r.id,
  kind: r.kind as DsarRequestDto['kind'],
  subjectHint: r.subjectHint,
  requestedBy: r.requestedBy,
  summary: r.summary as Record<string, number>,
  createdAt: r.createdAt,
});

/** Find a person: what the org holds about this email (counts only) and earlier requests. */
export const findSubjectQuery = tenantQuery({
  name: 'privacy.findSubject',
  input: z.object({ email: DsarEmail }),
  output: z.object({
    email: z.string(),
    found: z.boolean(),
    summary: DsarSummary,
    history: z.array(DsarRequestDto),
  }),
  entitlement: 'core',
  permission: 'privacy:manage',
  handler: async ({ input, ctx, tx }) => {
    const email = normalizeEmail(input.email);
    const summary = summarize(await collectSubjectTx(tx, requireOrg(ctx), email));
    const ref = await sha256Hex(email);
    const history = await tx
      .select()
      .from(dsarRequests)
      .where(eq(dsarRequests.subjectRef, ref))
      .orderBy(desc(dsarRequests.createdAt))
      .limit(20);
    return {
      email,
      found: Object.values(summary).some((n) => n > 0),
      summary,
      history: history.map(toRequestDto),
    };
  },
});

/** Recent requests handled by the org (the accountability record; no addresses). */
export const dsarHistoryQuery = tenantQuery({
  name: 'privacy.history',
  input: z.object({ limit: z.int().min(1).max(100).default(20) }),
  output: z.array(DsarRequestDto),
  entitlement: 'core',
  permission: 'privacy:manage',
  handler: async ({ input, tx }) =>
    (await tx.select().from(dsarRequests).orderBy(desc(dsarRequests.createdAt)).limit(input.limit)).map(
      toRequestDto,
    ),
});

async function eventNames(tx: TenantTx, ids: Iterable<string>): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const id of new Set(ids)) {
    const e = await findEventTx(tx, id);
    if (e) out[id] = e.name;
  }
  return out;
}

/** The access-request document (JSON): versioned, allowlisted, events named. */
export async function subjectDocumentTx(tx: TenantTx, ctx: Ctx, emailNorm: string, orgName: string) {
  const s = await collectSubjectTx(tx, requireOrg(ctx), emailNorm);
  const events = await eventNames(tx, [
    ...s.orders.map((o) => o.eventId),
    ...s.ticketing.tickets.map((t) => t.eventId),
    ...s.attendees.map((a) => a.eventId),
  ]);
  return {
    format: 'yayatoh.dsar/1',
    generatedAt: ctx.now.toISOString(),
    controller: orgName,
    subject: { email: emailNorm },
    summary: summarize(s),
    events,
    contacts: s.crm.contacts.map(({ id: _id, ...c }) => c),
    consents: s.crm.consents,
    orders: s.orders,
    tickets: s.ticketing.tickets,
    ticketClaims: s.ticketing.claims,
    holderLinks: s.ticketing.holderLinks,
    attendeeRecords: s.attendees.map(({ id: _id, ...a }) => a),
    formAnswers: s.answers,
    checkIns: s.admissions,
    notes: [
      'Card numbers are never stored by the organizer or Yayatoh; payments are processed by Stripe.',
      'Money amounts are in minor units of the order currency (e.g. cents).',
    ],
  };
}

/**
 * Access request (right of access / portability): the person's data as one JSON file through
 * the bulk framework (progress, 7-day expiry, download route). The selection is a single
 * placeholder item; the email travels in the operation's params, which the retention job clears
 * a day after the export finishes.
 */
export const dsarExportAction = defineBulkAction({
  key: 'privacy.dsarExport',
  entitlement: 'core',
  permission: 'privacy:manage',
  params: z.object({ email: DsarEmail, orgName: z.string().max(200) }),
  filter: z.object({ email: DsarEmail }),
  chunkSize: 1,
  file: {
    contentType: 'application/json; charset=utf-8',
    name: (_p, now) => `personal-data-${now.toISOString().slice(0, 10)}.json`,
  },
  resolve: async (_tx, sel) => {
    if (sel.ids || !sel.filter) throw new DomainError('validation_failed', 'Export a person by email');
    return [uuidv7()];
  },
  run: async (tx, ctx, ids, params, meta) => {
    const email = normalizeEmail(params.email);
    const doc = await subjectDocumentTx(tx, ctx, email, params.orgName);
    await tx.insert(dsarRequests).values({
      orgId: requireOrg(ctx),
      kind: 'access',
      subjectRef: await sha256Hex(email),
      subjectHint: maskEmail(email),
      requestedBy: await bulkOperationRequesterTx(tx, meta.operationId),
      summary: doc.summary,
      operationId: meta.operationId,
      completedAt: ctx.now,
    });
    return { results: ids.map((id) => ({ id, ok: true })), append: `${JSON.stringify(doc, null, 2)}\n` };
  },
});

export const dsarExportBulk = bulkCommands(dsarExportAction);

export const EraseResult = z.object({
  requestId: z.uuid(),
  summary: z.object({
    contacts: z.int(),
    consentsKept: z.int(),
    orders: z.int(),
    paidOrdersKept: z.int(),
    tickets: z.int(),
    activeTicketsKept: z.int(),
    claims: z.int(),
    holderLinks: z.int(),
    attendees: z.int(),
    importRows: z.int(),
    answers: z.int(),
    files: z.int(),
  }),
});

/**
 * Erasure (right to be forgotten). The caller must type the email again (`confirm`). Redacts
 * the person across modules in one tenant transaction, deletes export files that mention them,
 * records the request (masked) and audits it without the address.
 */
export const eraseSubjectCommand = tenantCommand({
  name: 'privacy.eraseSubject',
  input: z.object({ email: DsarEmail, confirm: z.string().max(320) }),
  output: EraseResult,
  entitlement: 'core',
  permission: 'privacy:manage',
  // Erasure cannot be undone: a recent sign-in is required (step-up, roadmap §9; M1.2c).
  stepUp: true,
  handler: async ({ input, ctx, tx }) => {
    const email = normalizeEmail(input.email);
    if (normalizeEmail(input.confirm) !== email)
      throw new DomainError('validation_failed', 'Type the email again to confirm', { field: 'confirm' });
    const orgId = requireOrg(ctx);
    const before = summarize(await collectSubjectTx(tx, orgId, email));
    if (!Object.values(before).some((n) => n > 0))
      throw new DomainError('not_found', 'Nothing is held about this email');
    const contact = await eraseContactDsarTx(tx, email, ctx.now);
    const orders = await eraseOrdersDsarTx(tx, email, ctx.now);
    const answers = await eraseResponsesDsarTx(tx, orders.orderIds, ctx.now);
    const tickets = await eraseTicketsDsarTx(tx, email, ctx.now);
    const attendees = await eraseAttendeesDsarTx(tx, email, contact.contactIds, ctx.now);
    const files = await purgeFilesMentioningTx(tx, email);
    const summary = {
      contacts: contact.erased,
      consentsKept: contact.consentsKept,
      orders: orders.erased,
      paidOrdersKept: orders.legalHold,
      tickets: tickets.erased,
      activeTicketsKept: tickets.activeKept,
      claims: tickets.claims,
      holderLinks: tickets.holderLinksDeleted,
      attendees: attendees.erased,
      importRows: attendees.importRowsDeleted,
      answers: answers.erased,
      files,
    };
    const [row] = await tx
      .insert(dsarRequests)
      .values({
        orgId,
        kind: 'erasure',
        subjectRef: await sha256Hex(email),
        subjectHint: maskEmail(email),
        requestedBy: ctx.actor.type === 'user' ? ctx.actor.userId : null,
        summary,
        completedAt: ctx.now,
      })
      .returning({ id: dsarRequests.id });
    if (!row) throw new DomainError('internal');
    return { requestId: row.id, summary };
  },
  audit: (_input, r) => ({
    action: 'privacy.erase',
    targetType: 'dsar_request',
    targetId: r?.requestId ?? null,
    data: { kind: 'erasure', count: r ? Object.values(r.summary).reduce((a, b) => a + b, 0) : 0 },
  }),
});
