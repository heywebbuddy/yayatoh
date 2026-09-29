import { checkpointNamesTx, deviceIdOf, deviceLabelsTx, queueStaffPushTx } from '@yayatoh/checkin';
import { defineSerializer } from '@yayatoh/contracts';
import type { TenantTx } from '@yayatoh/db';
import { eventRoleGrantsTx, eventStaffTx, findEventTx } from '@yayatoh/events';
import { type Ctx, DomainError, requireOrg } from '@yayatoh/kernel';
import { signLinkToken, tenantCommand, tenantQuery, verifyLinkToken } from '@yayatoh/platform';
import { eventRoleCan, memberRoleTx, memberUserIdsTx, ORG_ROLES, roleCan } from '@yayatoh/tenancy';
import { ticketsByIdsTx } from '@yayatoh/ticketing';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  ACTIVITY_KINDS,
  type ActivityKind,
  CLOSED_STATES,
  dueAt,
  GUEST_REASONS,
  LOCATION_MAX,
  MAX_OPEN_PER_TICKET,
  NOTE_MAX,
  OPEN_STATES,
  PRIORITIES,
  PRIORITY_RANK,
  type Priority,
  priorityFor,
  pushes,
  REASONS,
  REQUEST_SOURCES,
  REQUEST_STATES,
  type RequestEvent,
  type RequestState,
  requestLifecycle,
  STAFF_REASONS,
  slaStatus,
} from './domain/rules.ts';
import { publishRequestTx } from './realtime.ts';
import { activity, requests } from './schema.ts';

type RequestRow = typeof requests.$inferSelect;

// --- Links -----------------------------------------------------------------------------------------

/** A ticket's help link (`<ticketId>~<hmac>`): proves the guest holds that ticket's link. */
export const TICKET_PURPOSE = 'assistance.ticket';
/** A request's status link, handed back to the guest who asked. */
export const REQUEST_PURPOSE = 'assistance.request';

export const assistanceTicketToken = (ticketId: string) => signLinkToken(TICKET_PURPOSE, ticketId);
export const assistanceRequestToken = (requestId: string) => signLinkToken(REQUEST_PURPOSE, requestId);

const verify = (purpose: string, token: string) =>
  token.length > 200 ? null : verifyLinkToken(purpose, token);

/**
 * The ticket behind a help link when it is authentic, for this event, and still valid (not void);
 * null otherwise. Another event's ticket, a forged or truncated link: all null.
 */
export async function assistanceTicketTx(tx: TenantTx, eventId: string, token: string) {
  const ticketId = verify(TICKET_PURPOSE, token);
  if (!ticketId) return null;
  const [t] = await ticketsByIdsTx(tx, [ticketId]);
  if (!t || t.eventId !== eventId || t.status !== 'active') return null;
  return t;
}

// --- Who is acting -------------------------------------------------------------------------------

interface Actor {
  readonly userId: string | null;
  readonly deviceId: string | null;
}

function actorOf(ctx: Ctx): Actor {
  if (ctx.actor.type === 'user') return { userId: ctx.actor.userId, deviceId: null };
  if (ctx.actor.type === 'system') {
    try {
      return { userId: null, deviceId: deviceIdOf(ctx) };
    } catch {
      return { userId: null, deviceId: null };
    }
  }
  return { userId: null, deviceId: null };
}

/** A member (or signed-in staff) who may work the queue at this event: org role or event role. */
export async function canWorkTx(tx: TenantTx, userId: string, eventId: string, now: Date): Promise<boolean> {
  const role = await memberRoleTx(tx, userId);
  if (role === null) return false;
  if (roleCan(role, 'assistance:manage')) return true;
  const grants = await eventRoleGrantsTx(tx, eventId, userId, now);
  return eventRoleCan(
    grants.map((g) => g.role),
    'assistance:manage',
  );
}

async function eventOrThrowTx(tx: TenantTx, eventId: string) {
  const ev = await findEventTx(tx, eventId);
  if (!ev) throw new DomainError('not_found', 'Event not found');
  return ev;
}

async function nextNumberTx(tx: TenantTx, eventId: string): Promise<number> {
  // One writer per event at a time, so numbers never collide.
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`assistance:${eventId}`}))`);
  const [r] = await tx
    .select({ n: sql<number>`coalesce(max(${requests.number}), 0)::int` })
    .from(requests)
    .where(eq(requests.eventId, eventId));
  return (r?.n ?? 0) + 1;
}

async function logTx(
  tx: TenantTx,
  ctx: Ctx,
  requestId: string,
  kind: ActivityKind,
  extra: { body?: string; assigneeUserId?: string | null; assigneeDeviceId?: string | null } = {},
) {
  const a = actorOf(ctx);
  await tx.insert(activity).values({
    orgId: requireOrg(ctx),
    requestId,
    kind,
    body: extra.body ?? '',
    actorUserId: a.userId,
    actorDeviceId: a.deviceId,
    assigneeUserId: extra.assigneeUserId ?? null,
    assigneeDeviceId: extra.assigneeDeviceId ?? null,
    createdAt: ctx.now,
  });
}

/** Outbox events carry ids and states only (the alert engine re-evaluates the event). */
const requestEvent = (type: string, orgId: string, row: RequestRow) => ({
  type,
  version: 1,
  aggregateType: 'assistance_request',
  aggregateId: row.id,
  payload: { orgId, eventId: row.eventId, requestId: row.id, state: row.state, priority: row.priority },
});

// --- DTOs (allowlists) ---------------------------------------------------------------------------

/** Plain text a person typed: line breaks become spaces, control characters are refused. */
const Plain = (max: number) =>
  z
    .string()
    .max(max * 2)
    .transform((v) => v.replace(/[\r\n\t]+/g, ' ').trim())
    .pipe(
      z
        .string()
        .max(max)
        .regex(/^[^\p{Cc}]*$/u, 'Plain text only'),
    );

/**
 * One request as staff see it (members with `assistance:read` and the event's devices). The
 * guest's name and ticket code and what they wrote are for the event's staff only: never public,
 * never exported for marketing.
 */
export const RequestDto = z.object({
  id: z.uuid(),
  number: z.int(),
  source: z.enum(REQUEST_SOURCES),
  reason: z.enum(REASONS as [string, ...string[]]),
  priority: z.enum(PRIORITIES),
  state: z.enum(REQUEST_STATES),
  note: z.string(),
  location: z.string(),
  guest: z.object({ name: z.string(), ticket: z.string() }).nullable(),
  /** The Scan PWA device that raised a staff request. */
  device: z.string().nullable(),
  checkpoint: z.string().nullable(),
  assignee: z
    .object({ kind: z.enum(['user', 'device']), id: z.uuid(), label: z.string().nullable() })
    .nullable(),
  /** Assigned to the caller (member or device). */
  mine: z.boolean(),
  createdAt: z.date(),
  dueAt: z.date(),
  assignedAt: z.date().nullable(),
  startedAt: z.date().nullable(),
  closedAt: z.date().nullable(),
  overdue: z.boolean(),
  activity: z.array(
    z.object({
      kind: z.enum(ACTIVITY_KINDS),
      body: z.string(),
      actor: z.enum(['guest', 'member', 'device', 'system']),
      actorUserId: z.uuid().nullable(),
      actorDevice: z.string().nullable(),
      assigneeUserId: z.uuid().nullable(),
      assigneeDevice: z.string().nullable(),
      at: z.date(),
    }),
  ),
});
export type RequestDto = z.infer<typeof RequestDto>;
export const requestSerializer = defineSerializer('assistance.request', RequestDto);

/** What the guest who asked sees on their status link: no staff names, no notes. */
export const GuestStatusDto = z.object({
  number: z.int(),
  reason: z.enum(GUEST_REASONS),
  state: z.enum(REQUEST_STATES),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type GuestStatusDto = z.infer<typeof GuestStatusDto>;
export const guestStatusSerializer = defineSerializer('assistance.guestStatus', GuestStatusDto);

async function toDtosTx(tx: TenantTx, ctx: Ctx, rows: RequestRow[]): Promise<RequestDto[]> {
  if (rows.length === 0) return [];
  const eventId = rows[0]?.eventId as string;
  const me = actorOf(ctx);
  const ids = rows.map((r) => r.id);
  const log = await tx
    .select()
    .from(activity)
    .where(inArray(activity.requestId, ids))
    .orderBy(asc(activity.createdAt), asc(activity.id));
  const tickets = new Map(
    (
      await ticketsByIdsTx(
        tx,
        rows.flatMap((r) => (r.ticketId ? [r.ticketId] : [])),
      )
    ).map((t) => [t.id, t]),
  );
  const deviceIds = [
    ...rows.flatMap((r) => [r.deviceId, r.assigneeDeviceId]),
    ...log.flatMap((l) => [l.actorDeviceId, l.assigneeDeviceId]),
  ].filter((x): x is string => !!x);
  const labels = await deviceLabelsTx(tx, deviceIds);
  const checkpoints = await checkpointNamesTx(tx, eventId);
  const label = (id: string | null) => (id ? (labels.get(id) ?? null) : null);
  return rows.map((r) => {
    const t = r.ticketId ? tickets.get(r.ticketId) : undefined;
    return requestSerializer.serialize({
      id: r.id,
      number: r.number,
      source: r.source as RequestDto['source'],
      reason: r.reason,
      priority: r.priority as Priority,
      state: r.state as RequestState,
      note: r.note,
      location: r.location,
      guest: t ? { name: t.holderName, ticket: t.shortCode } : null,
      device: label(r.deviceId),
      checkpoint: r.checkpointId ? (checkpoints.get(r.checkpointId) ?? null) : null,
      assignee: r.assigneeUserId
        ? { kind: 'user', id: r.assigneeUserId, label: null }
        : r.assigneeDeviceId
          ? { kind: 'device', id: r.assigneeDeviceId, label: label(r.assigneeDeviceId) }
          : null,
      mine:
        (!!me.userId && r.assigneeUserId === me.userId) ||
        (!!me.deviceId && r.assigneeDeviceId === me.deviceId),
      createdAt: r.createdAt,
      dueAt: r.dueAt,
      assignedAt: r.assignedAt,
      startedAt: r.startedAt,
      closedAt: r.closedAt,
      overdue: slaStatus({ state: r.state as RequestState, dueAt: r.dueAt }, ctx.now).overdue,
      activity: log
        .filter((l) => l.requestId === r.id)
        .map((l) => ({
          kind: l.kind as ActivityKind,
          body: l.body,
          actor: l.actorUserId
            ? ('member' as const)
            : l.actorDeviceId
              ? ('device' as const)
              : l.kind === 'created' && r.source === 'guest'
                ? ('guest' as const)
                : ('system' as const),
          actorUserId: l.actorUserId,
          actorDevice: label(l.actorDeviceId),
          assigneeUserId: l.assigneeUserId,
          assigneeDevice: label(l.assigneeDeviceId),
          at: l.createdAt,
        })),
    });
  });
}

// --- Guests --------------------------------------------------------------------------------------

export const GuestRequestInput = z.object({
  eventId: z.uuid(),
  ticketToken: z.string().min(1).max(200),
  reason: z.enum(GUEST_REASONS),
  note: Plain(NOTE_MAX).default(''),
  location: Plain(LOCATION_MAX).default(''),
});

/**
 * A guest asks for help (the seat finder's "Need help", M3.3b). No account: the ticket's help
 * link proves who they are, for this event only. The web action rate-limits it first
 * (`assistanceRequest`); a ticket may also have only a few open requests at once. Urgent and
 * high-priority requests are pushed to the staff devices at the event.
 */
export const guestRequestCommand = tenantCommand({
  name: 'assistance.guestRequest',
  input: GuestRequestInput,
  output: z.object({ requestId: z.uuid(), number: z.int(), statusToken: z.string() }),
  entitlement: 'checkin',
  permission: 'public:assistance.request',
  handler: async ({ input, ctx, tx, emit }) => {
    const ev = await eventOrThrowTx(tx, input.eventId);
    if (['cancelled', 'archived', 'draft'].includes(ev.status))
      throw new DomainError('invalid_state', 'This event does not take help requests');
    const ticket = await assistanceTicketTx(tx, input.eventId, input.ticketToken);
    if (!ticket) throw new DomainError('not_found', 'This ticket link is not valid for this event');
    const [open] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(requests)
      .where(and(eq(requests.ticketId, ticket.id), inArray(requests.state, [...OPEN_STATES])));
    if ((open?.n ?? 0) >= MAX_OPEN_PER_TICKET)
      throw new DomainError('conflict', 'This ticket already has help requests waiting');
    const row = await createTx(tx, ctx, {
      eventId: input.eventId,
      source: 'guest',
      reason: input.reason,
      note: input.note,
      location: input.location,
      ticketId: ticket.id,
    });
    emit(requestEvent('assistance.requested', requireOrg(ctx), row));
    return { requestId: row.id, number: row.number, statusToken: assistanceRequestToken(row.id) };
  },
  audit: (input, r) => ({
    action: 'assistance.guest_request',
    targetType: 'assistance_request',
    targetId: r.requestId,
    data: { reason: input.reason },
  }),
});

async function createTx(
  tx: TenantTx,
  ctx: Ctx,
  v: {
    eventId: string;
    source: 'guest' | 'staff';
    reason: (typeof REASONS)[number];
    note: string;
    location: string;
    ticketId?: string | null;
    deviceId?: string | null;
    checkpointId?: string | null;
  },
): Promise<RequestRow> {
  const orgId = requireOrg(ctx);
  const priority = priorityFor(v.source, v.reason);
  const [row] = await tx
    .insert(requests)
    .values({
      orgId,
      eventId: v.eventId,
      number: await nextNumberTx(tx, v.eventId),
      source: v.source,
      reason: v.reason,
      priority,
      state: 'new',
      note: v.note,
      location: v.location,
      ticketId: v.ticketId ?? null,
      deviceId: v.deviceId ?? null,
      checkpointId: v.checkpointId ?? null,
      dueAt: dueAt(ctx.now, priority),
      createdAt: ctx.now,
      updatedAt: ctx.now,
    })
    .returning();
  if (!row) throw new Error('assistance request not stored');
  await logTx(tx, ctx, row.id, 'created');
  await publishRequestTx(tx, orgId, row, ctx.now);
  if (pushes(priority)) {
    const where =
      v.location ||
      (v.checkpointId ? ((await checkpointNamesTx(tx, v.eventId)).get(v.checkpointId) ?? '') : '') ||
      `#${row.number}`;
    await queueStaffPushTx(tx, {
      orgId,
      eventId: v.eventId,
      alertKey: `assistance:${row.id}`,
      label: `#${row.number} · ${where}`,
      exceptDeviceId: v.deviceId ?? null,
    });
  }
  return row;
}

/** The guest's own request, from its status link (and only for this event). */
export const guestStatusQuery = tenantQuery({
  name: 'assistance.guestStatus',
  input: z.object({ eventId: z.uuid(), token: z.string().min(1).max(200) }),
  output: GuestStatusDto,
  entitlement: 'checkin',
  permission: 'public:assistance.status',
  handler: async ({ input, tx }) => {
    const id = verify(REQUEST_PURPOSE, input.token);
    const [row] = id ? await tx.select().from(requests).where(eq(requests.id, id)) : [];
    if (!row || row.eventId !== input.eventId || row.source !== 'guest')
      throw new DomainError('not_found', 'Unknown help request');
    return guestStatusSerializer.serialize({
      number: row.number,
      reason: row.reason as GuestStatusDto['reason'],
      state: row.state as RequestState,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  },
});

// --- Staff on the scanner ------------------------------------------------------------------------

/**
 * Door staff ask for help from the Scan PWA (backup, a supervisor, medical, security, a device
 * problem), tied to the device and the entrance it scans at. Device credentials only.
 */
export const staffRequestCommand = tenantCommand({
  name: 'assistance.staffRequest',
  input: z.object({
    eventId: z.uuid(),
    reason: z.enum(STAFF_REASONS),
    note: Plain(NOTE_MAX).default(''),
    checkpointId: z.uuid().nullable().default(null),
  }),
  output: z.object({ requestId: z.uuid(), number: z.int() }),
  entitlement: 'checkin',
  permission: 'checkin:device',
  handler: async ({ input, ctx, tx, emit }) => {
    const deviceId = deviceIdOf(ctx);
    await eventOrThrowTx(tx, input.eventId);
    const checkpoints = await checkpointNamesTx(tx, input.eventId);
    // An entrance of another event (or none we know) is dropped, never trusted.
    const checkpointId =
      input.checkpointId && checkpoints.has(input.checkpointId) ? input.checkpointId : null;
    const row = await createTx(tx, ctx, {
      eventId: input.eventId,
      source: 'staff',
      reason: input.reason,
      note: input.note,
      location: '',
      deviceId,
      checkpointId,
    });
    emit(requestEvent('assistance.requested', requireOrg(ctx), row));
    return { requestId: row.id, number: row.number };
  },
  audit: (input, r) => ({
    action: 'assistance.staff_request',
    targetType: 'assistance_request',
    targetId: r.requestId,
    data: { reason: input.reason },
  }),
});

// --- The queue -----------------------------------------------------------------------------------

/**
 * The event's help queue (console, Command Center, Scan PWA staff mode): open requests most
 * urgent first then oldest first, or the latest closed ones.
 */
export const queueQuery = tenantQuery({
  name: 'assistance.queue',
  input: z.object({
    eventId: z.uuid(),
    status: z.enum(['open', 'closed']).default('open'),
    limit: z.int().min(1).max(200).default(100),
  }),
  output: z.array(RequestDto),
  entitlement: 'checkin',
  permission: 'assistance:read',
  handler: async ({ input, ctx, tx }) => {
    await eventOrThrowTx(tx, input.eventId);
    const open = input.status === 'open';
    const rows = await tx
      .select()
      .from(requests)
      .where(
        and(
          eq(requests.eventId, input.eventId),
          inArray(requests.state, open ? [...OPEN_STATES] : [...CLOSED_STATES]),
        ),
      )
      .orderBy(open ? asc(requests.createdAt) : desc(requests.closedAt), asc(requests.number))
      .limit(input.limit);
    if (open)
      rows.sort(
        (a, b) =>
          PRIORITY_RANK[a.priority as Priority] - PRIORITY_RANK[b.priority as Priority] ||
          a.createdAt.getTime() - b.createdAt.getTime(),
      );
    return toDtosTx(tx, ctx, rows);
  },
});

/** People who can be given a request at this event (user ids; the web resolves their names). */
export const assigneesQuery = tenantQuery({
  name: 'assistance.assignees',
  input: z.object({ eventId: z.uuid() }),
  output: z.array(z.object({ userId: z.uuid() })),
  entitlement: 'checkin',
  permission: 'assistance:read',
  handler: async ({ input, ctx, tx }) => {
    await eventOrThrowTx(tx, input.eventId);
    const roles = ORG_ROLES.filter((r) => roleCan(r, 'assistance:manage'));
    const members = await memberUserIdsTx(tx, roles);
    const staff = (await eventStaffTx(tx, input.eventId, ctx.now)).filter((g) =>
      eventRoleCan([g.role], 'assistance:manage'),
    );
    const ids = [...new Set([...members.map((m) => m.userId), ...staff.map((s) => s.userId)])];
    return ids.map((userId) => ({ userId }));
  },
});

async function loadTx(tx: TenantTx, requestId: string, eventId: string): Promise<RequestRow> {
  const [row] = await tx.select().from(requests).where(eq(requests.id, requestId)).for('update');
  if (!row || row.eventId !== eventId) throw new DomainError('not_found', 'Help request not found');
  return row;
}

async function oneDtoTx(tx: TenantTx, ctx: Ctx, row: RequestRow) {
  return (await toDtosTx(tx, ctx, [row]))[0] as RequestDto;
}

const RequestRef = z.object({ eventId: z.uuid(), requestId: z.uuid() });

/**
 * Give a request to someone: `me` (the member or device asking) or a member who may work the
 * queue at this event. Viewers can't (`assistance:manage`).
 */
export const assignCommand = tenantCommand({
  name: 'assistance.assign',
  input: RequestRef.extend({ assignee: z.union([z.literal('me'), z.uuid()]) }),
  output: RequestDto,
  entitlement: 'checkin',
  permission: 'assistance:manage',
  handler: async ({ input, ctx, tx, emit }) => {
    const row = await loadTx(tx, input.requestId, input.eventId);
    requestLifecycle.next(row.state as RequestState, 'assign');
    const me = actorOf(ctx);
    let assigneeUserId: string | null = null;
    let assigneeDeviceId: string | null = null;
    if (input.assignee === 'me') {
      if (!me.userId && !me.deviceId)
        throw new DomainError('forbidden', 'Only a person or a device can take it');
      assigneeUserId = me.userId;
      assigneeDeviceId = me.deviceId;
    } else {
      if (!(await canWorkTx(tx, input.assignee, input.eventId, ctx.now)))
        throw new DomainError('validation_failed', 'That person does not work this event', {
          field: 'assignee',
        });
      assigneeUserId = input.assignee;
    }
    const [updated] = await tx
      .update(requests)
      .set({
        state: 'assigned',
        assigneeUserId,
        assigneeDeviceId,
        assignedAt: ctx.now,
        startedAt: null,
        updatedAt: ctx.now,
      })
      .where(and(eq(requests.id, row.id), inArray(requests.state, [...requestLifecycle.from('assign')])))
      .returning();
    if (!updated) throw new DomainError('conflict', 'The request changed meanwhile; reload and try again');
    await logTx(tx, ctx, row.id, 'assigned', { assigneeUserId, assigneeDeviceId });
    await publishRequestTx(tx, requireOrg(ctx), updated, ctx.now);
    emit(requestEvent('assistance.updated', requireOrg(ctx), updated));
    return oneDtoTx(tx, ctx, updated);
  },
  audit: (input) => ({
    action: 'assistance.assign',
    targetType: 'assistance_request',
    targetId: input.requestId,
    data: { assignee: input.assignee },
  }),
});

const ACTION_LOG: Readonly<Record<Exclude<RequestEvent, 'assign'>, ActivityKind>> = {
  start: 'started',
  resolve: 'resolved',
  cancel: 'cancelled',
};

/**
 * Move a request on: start (someone is with the guest; an unassigned request becomes the
 * starter's), resolve, or cancel (duplicate, the guest left). Resolving and cancelling close it.
 */
export const updateCommand = tenantCommand({
  name: 'assistance.update',
  input: RequestRef.extend({ action: z.enum(['start', 'resolve', 'cancel']) }),
  output: RequestDto,
  entitlement: 'checkin',
  permission: 'assistance:manage',
  handler: async ({ input, ctx, tx, emit }) => {
    const row = await loadTx(tx, input.requestId, input.eventId);
    const next = requestLifecycle.next(row.state as RequestState, input.action);
    const me = actorOf(ctx);
    const takes = input.action === 'start' && !row.assigneeUserId && !row.assigneeDeviceId;
    const [updated] = await tx
      .update(requests)
      .set({
        state: next,
        ...(takes ? { assigneeUserId: me.userId, assigneeDeviceId: me.deviceId, assignedAt: ctx.now } : {}),
        ...(input.action === 'start' ? { startedAt: ctx.now } : { closedAt: ctx.now }),
        updatedAt: ctx.now,
      })
      .where(and(eq(requests.id, row.id), inArray(requests.state, [...requestLifecycle.from(input.action)])))
      .returning();
    if (!updated) throw new DomainError('conflict', 'The request changed meanwhile; reload and try again');
    if (takes)
      await logTx(tx, ctx, row.id, 'assigned', {
        assigneeUserId: me.userId,
        assigneeDeviceId: me.deviceId,
      });
    await logTx(tx, ctx, row.id, ACTION_LOG[input.action]);
    await publishRequestTx(tx, requireOrg(ctx), updated, ctx.now);
    emit(requestEvent('assistance.updated', requireOrg(ctx), updated));
    return oneDtoTx(tx, ctx, updated);
  },
  audit: (input) => ({
    action: `assistance.${input.action}`,
    targetType: 'assistance_request',
    targetId: input.requestId,
  }),
});

/** A staff note on a request (kept in its activity; staff-only). */
export const addNoteCommand = tenantCommand({
  name: 'assistance.addNote',
  input: RequestRef.extend({
    body: Plain(NOTE_MAX).pipe(z.string().min(1)),
  }),
  output: RequestDto,
  entitlement: 'checkin',
  permission: 'assistance:manage',
  handler: async ({ input, ctx, tx }) => {
    const row = await loadTx(tx, input.requestId, input.eventId);
    await logTx(tx, ctx, row.id, 'note', { body: input.body });
    const [updated] = await tx
      .update(requests)
      .set({ updatedAt: ctx.now })
      .where(eq(requests.id, row.id))
      .returning();
    await publishRequestTx(tx, requireOrg(ctx), updated ?? row, ctx.now);
    return oneDtoTx(tx, ctx, updated ?? row);
  },
  // Never the note's text in the audit log: the activity keeps it, staff-only.
  audit: (input) => ({
    action: 'assistance.note',
    targetType: 'assistance_request',
    targetId: input.requestId,
  }),
});

// --- Reads for other modules (alert engine, Command Center) --------------------------------------

/** Unassigned requests past their SLA at an event (the alert engine's `assistanceOverdue`). */
export async function assistanceOverdueTx(
  tx: TenantTx,
  eventId: string,
  now: Date,
): Promise<{ overdue: number; urgent: number }> {
  const [r] = await tx
    .select({
      overdue: sql<number>`count(*)::int`,
      urgent: sql<number>`count(*) filter (where ${requests.priority} = 'urgent')::int`,
    })
    .from(requests)
    .where(and(eq(requests.eventId, eventId), eq(requests.state, 'new'), sql`${requests.dueAt} < ${now}`));
  return { overdue: r?.overdue ?? 0, urgent: r?.urgent ?? 0 };
}

/** The queue in numbers, plus its most urgent open requests (the Command Center widget). */
export async function assistanceSummaryTx(tx: TenantTx, eventId: string, now: Date) {
  const rows = await tx
    .select({
      id: requests.id,
      number: requests.number,
      source: requests.source,
      reason: requests.reason,
      priority: requests.priority,
      state: requests.state,
      dueAt: requests.dueAt,
      createdAt: requests.createdAt,
    })
    .from(requests)
    .where(and(eq(requests.eventId, eventId), inArray(requests.state, [...OPEN_STATES])));
  rows.sort(
    (a, b) =>
      PRIORITY_RANK[a.priority as Priority] - PRIORITY_RANK[b.priority as Priority] ||
      a.createdAt.getTime() - b.createdAt.getTime(),
  );
  const count = (s: RequestState) => rows.filter((r) => r.state === s).length;
  return {
    waiting: count('new'),
    assigned: count('assigned'),
    inProgress: count('in_progress'),
    overdue: rows.filter((r) => slaStatus({ state: r.state as RequestState, dueAt: r.dueAt }, now).overdue)
      .length,
    top: rows.slice(0, 5).map((r) => ({
      id: r.id,
      number: r.number,
      source: r.source as 'guest' | 'staff',
      reason: r.reason,
      priority: r.priority as Priority,
      state: r.state as RequestState,
      dueAt: r.dueAt,
      overdue: slaStatus({ state: r.state as RequestState, dueAt: r.dueAt }, now).overdue,
    })),
  };
}
