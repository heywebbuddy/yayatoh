import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { attendeeEmailBulk, attendeeLabelBulk } from '@yayatoh/attendees';
import { type Command, type Ctx, executeCommand, executeQuery, requireOrg } from '@yayatoh/kernel';
import { ticketCancelBulk } from '@yayatoh/orders';
import { type AnyBulkAction, bulkStepCommand, runBulkOperation } from '@yayatoh/platform';
import { seatAssignBulk } from '@yayatoh/seating';
import { ticketResendBulk } from '@yayatoh/ticketing';
import type { V1Deps, V1Env } from '../context.ts';
import {
  BULK_KINDS,
  BulkCancelRequest,
  BulkEmailRequest,
  type BulkKind,
  BulkLabelRequest,
  BulkOperation,
  BulkResendRequest,
  BulkSeatRequest,
  toWire,
} from '../resources.ts';
import {
  body,
  EventParams,
  IdempotencyHeader,
  idempotent,
  json,
  OrgParam,
  orgSecurity,
  problems,
  writeProblems,
} from './common.ts';

/**
 * The M1.8 bulk actions on `/v1` (M1.13d). Each kind is one registered bulk action and runs the
 * console's own start, undo and status commands, so permissions (API key scopes), entitlements,
 * step-up, the org gate and the `bulk.start` / `bulk.undo` audit rows are the console's. Exports
 * are not offered: they need a step-up, which no `/v1` credential carries.
 */
const KINDS = {
  labels: attendeeLabelBulk,
  emails: attendeeEmailBulk,
  'seat-assignments': seatAssignBulk,
  'ticket-resends': ticketResendBulk,
  'ticket-cancellations': ticketCancelBulk,
} as const satisfies Record<BulkKind, unknown>;

// biome-ignore lint/suspicious/noExplicitAny: a start command of any kind; each validates its own input.
type AnyCommand = Command<any, { operationId: string; total: number }, any, any>;

/** Kinds whose operations can be undone for a while after they finish. */
const UNDOABLE = ['labels', 'seat-assignments'] as const satisfies readonly BulkKind[];

/** Every action the inline runner may meet on an operation started here. */
export const V1_BULK_ACTIONS: readonly AnyBulkAction[] = Object.values(KINDS).map((k) => k.action);
const step = bulkStepCommand(V1_BULK_ACTIONS);
const KIND_OF = new Map<string, BulkKind>(
  (Object.keys(KINDS) as BulkKind[]).map((k) => [KINDS[k].action.key, k]),
);

/** Like the console, new operations run inline for up to 3 s; the worker's leader does the rest. */
const INLINE_MS = 3_000;

const SELECTION_NOTE =
  'Select attendees by `ids` (all must belong to the event, else 404) or by a list `filter`, resolved once when the operation starts (at most 50,000). Retrying with the same Idempotency-Key returns the same operation; another body with that key is 422.';

const start = <R extends z.ZodType>(path: string, request: R, summary: string, description: string) =>
  createRoute({
    method: 'post',
    path: `/orgs/{org}/events/{eventId}/bulk/${path}`,
    tags: ['bulk actions'],
    summary,
    description,
    security: orgSecurity,
    request: { params: EventParams, headers: IdempotencyHeader, ...body(request) },
    responses: {
      202: json(BulkOperation, 'The operation after up to 3 s of work; poll it until it settles'),
      ...writeProblems,
    },
  });

const OperationParams = OrgParam.extend({
  kind: z.enum(BULK_KINDS).openapi({ param: { name: 'kind', in: 'path' } }),
  operationId: z.uuid(),
});
const UndoParams = OrgParam.extend({
  kind: z.enum(UNDOABLE).openapi({ param: { name: 'kind', in: 'path' } }),
  operationId: z.uuid(),
});

const routes = {
  labels: start(
    'labels',
    BulkLabelRequest,
    'Add or remove labels on many attendees (scope `attendees:write`)',
    `${SELECTION_NOTE} Removal wins over addition; an attendee carries at most 20 labels (\`too_many_labels\`). Undo within 10 minutes restores each attendee's previous labels.`,
  ),
  emails: start(
    'emails',
    BulkEmailRequest,
    'Email many attendees about the event (scope `attendees:write`)',
    `${SELECTION_NOTE} One email per attending person; the others fail \`not_attending\`. Refused while messaging is paused for the organization.`,
  ),
  seats: start(
    'seat-assignments',
    BulkSeatRequest,
    'Seat many attendees at once (scope `events:write`)',
    `${SELECTION_NOTE} Seats them at a table or row, in a section, in the best available seats or in their group's block, in plan order. Per-person failures: \`not_enough_seats\`, \`seated_by_ticket\`, \`attendee_cancelled\`, \`not_found\`; a kept-back accessible seat is a warning (\`ada_kept_back\`). Undo within 10 minutes puts everyone back.`,
  ),
  resend: start(
    'ticket-resends',
    BulkResendRequest,
    'Email attendees their tickets again (scope `attendees:write`)',
    `${SELECTION_NOTE} Each ticket holder gets one email with a fresh link to their tickets. Guests without a ticket fail \`no_ticket\`; void tickets fail \`ticket_void\`.`,
  ),
  cancel: start(
    'ticket-cancellations',
    BulkCancelRequest,
    'Cancel tickets without a refund (scope `orders:refund`)',
    'Voids the named attendees’ tickets (scanners reject them), cancels the attendees and returns their places and seats to sale. No money moves: refunds stay per order. It cannot be undone, so only explicit `ids` are accepted, never a filter.',
  ),
  status: createRoute({
    method: 'get',
    path: '/orgs/{org}/bulk/{kind}/{operationId}',
    tags: ['bulk actions'],
    summary: 'A bulk operation’s progress and results (the scope of its kind)',
    description:
      'Poll until `status` is `done`, `failed` or `undone`. `failures` and `warnings` list the first 50 attendees, each with a stable code.',
    security: orgSecurity,
    request: { params: OperationParams },
    responses: { 200: json(BulkOperation, 'The operation'), ...problems },
  }),
  undo: createRoute({
    method: 'post',
    path: '/orgs/{org}/bulk/{kind}/{operationId}/undo',
    tags: ['bulk actions'],
    summary: 'Undo a finished operation while `undoUntil` is set (the scope of its kind)',
    description:
      'Once only, within 10 minutes of finishing; otherwise 409 `invalid_state`. People changed since are left alone.',
    security: orgSecurity,
    request: { params: UndoParams, headers: IdempotencyHeader },
    responses: { 202: json(BulkOperation, 'The operation, undoing or undone'), ...writeProblems },
  }),
};

export function bulkRoutes(deps: V1Deps) {
  const { ports } = deps;
  const inlineMs = deps.bulkInlineMs ?? INLINE_MS;

  /** Read an operation under its kind's own permission (another kind's operation is a 404). */
  async function read(kind: BulkKind, operationId: string, ctx: Ctx) {
    const op = await executeQuery(KINDS[kind].status, { operationId }, ctx, ports);
    return toWire(BulkOperation, {
      ...op,
      kind: KIND_OF.get(op.action) ?? kind,
      failures: op.failures.map((f) => ({ attendeeId: f.itemId, code: f.code })),
      warnings: op.warnings.map((w) => ({ attendeeId: w.itemId, code: w.code })),
    });
  }

  /** Work the operation for a moment as the org's bulk runner, then read it back. */
  async function settle(kind: BulkKind, operationId: string, ctx: Ctx) {
    if (inlineMs > 0) await runBulkOperation(step, ports, requireOrg(ctx), operationId, inlineMs);
    return read(kind, operationId, ctx);
  }

  async function begin(kind: BulkKind, eventId: string, input: object, ctx: Ctx) {
    // Each kind's start command validates its own input (the union of their types is too wide).
    const command = KINDS[kind].start as AnyCommand;
    const r = await executeCommand(idempotent(command), { eventId, ...input }, ctx, ports);
    return settle(kind, r.operationId, ctx);
  }

  return new OpenAPIHono<V1Env>()
    .openapi(routes.labels, async (c) => {
      const { selection, add, remove } = c.req.valid('json');
      const { eventId } = c.req.valid('param');
      const op = await begin(
        'labels',
        eventId,
        { selection, params: { add: add ?? [], remove: remove ?? [] } },
        c.get('ctx'),
      );
      return c.json(op, 202);
    })
    .openapi(routes.emails, async (c) => {
      const { selection, subject, body: message } = c.req.valid('json');
      const { eventId } = c.req.valid('param');
      const op = await begin(
        'emails',
        eventId,
        { selection, params: { subject, body: message } },
        c.get('ctx'),
      );
      return c.json(op, 202);
    })
    .openapi(routes.seats, async (c) => {
      const { selection, target, overrideRules } = c.req.valid('json');
      const { eventId } = c.req.valid('param');
      const op = await begin(
        'seat-assignments',
        eventId,
        { selection, params: { target, overrideRules: overrideRules ?? false } },
        c.get('ctx'),
      );
      return c.json(op, 202);
    })
    .openapi(routes.resend, async (c) => {
      const { selection } = c.req.valid('json');
      const { eventId } = c.req.valid('param');
      const op = await begin('ticket-resends', eventId, { selection, params: {} }, c.get('ctx'));
      return c.json(op, 202);
    })
    .openapi(routes.cancel, async (c) => {
      const { selection } = c.req.valid('json');
      const { eventId } = c.req.valid('param');
      const op = await begin('ticket-cancellations', eventId, { selection, params: {} }, c.get('ctx'));
      return c.json(op, 202);
    })
    .openapi(routes.status, async (c) => {
      const { kind, operationId } = c.req.valid('param');
      return c.json(await read(kind, operationId, c.get('ctx')), 200);
    })
    .openapi(routes.undo, async (c) => {
      const { kind, operationId } = c.req.valid('param');
      const ctx = c.get('ctx');
      await executeCommand(idempotent(KINDS[kind].undo), { operationId }, ctx, ports);
      return c.json(await settle(kind, operationId, ctx), 202);
    });
}
