import { createHmac, timingSafeEqual } from 'node:crypto';
import { type TenantTx, withoutTenant } from '@yayatoh/db';
import { type CommandPorts, createCtx, executeCommand, isDomainError, requireOrg } from '@yayatoh/kernel';
import { tenantCommand } from '@yayatoh/platform';
import { and, asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { zoomAttendance, zoomParticipantEvents, zoomRegistrants, zoomWebinars } from './schema.ts';
import { virtualAttended } from './viewer.ts';
import { zoomEventKey, zoomParticipantKey, zoomSegmentKey } from './zoom-keys.ts';

/**
 * M6.10a: Zoom's join/leave webhooks (`webinar.participant_joined`, `webinar.participant_left`).
 *
 * **Verified before anything else**: Zoom signs `v0:{x-zm-request-timestamp}:{raw body}` with the
 * app's secret token (HMAC-SHA256, `x-zm-signature: v0=<hex>`). A request with a wrong or missing
 * signature, or a timestamp more than five minutes away, is refused before the body is parsed.
 * The URL check (`endpoint.url_validation`) is answered only after the same verification.
 *
 * **Deduplicated by the provider's event**: Zoom sends no event id, so the id is built from what
 * Zoom repeats on every retry of one delivery (the event name, its `event_ts`, the meeting
 * instance, the participant and their join or leave time) and stored hashed with a unique key. A
 * webhook replayed twice records once and counts once.
 *
 * The org comes from the webinar id in the verified body (`virtual.org_for_zoom_webinar`: the org
 * that created it through its Zoom connection, else the one that linked it), never a header. A
 * join and its leave make a `zoom_attendance` segment with the same key the report pull uses, so
 * the stay counts once for CE credits; a matched ticket's first join checks it in at the session's
 * virtual checkpoint (`virtual.attended@1`).
 */

/** Zoom's own tolerance for a webhook's timestamp. */
export const ZOOM_WEBHOOK_TOLERANCE_MS = 5 * 60_000;
/** Bodies above this are refused unread (Zoom's participant events are about 1 KB). */
export const ZOOM_WEBHOOK_MAX_BYTES = 64 * 1024;

const hmac = (secret: string, text: string) => createHmac('sha256', secret).update(text).digest('hex');

/**
 * The webhook secret: `ZOOM_WEBHOOK_SECRET_TOKEN` (the Marketplace app's secret token), else in
 * development, CI and previews a fake one derived from `APP_TOKEN_SECRET` (the dev route and the
 * tests sign with it). Null in production without the token: the endpoint answers 404.
 */
export function zoomWebhookSecretFromEnv(env: Readonly<Record<string, string | undefined>>): string | null {
  if (env.ZOOM_WEBHOOK_SECRET_TOKEN && env.ZOOM_WEBHOOK_SECRET_TOKEN.length >= 16)
    return env.ZOOM_WEBHOOK_SECRET_TOKEN;
  const production =
    env.VERCEL_ENV === 'production' || (env.NODE_ENV === 'production' && !env.YAYATOH_DEV_AUTH);
  if (production || !env.APP_TOKEN_SECRET || env.APP_TOKEN_SECRET.length < 32) return null;
  return hmac(env.APP_TOKEN_SECRET, 'zoom.webhook.fake');
}

/** The headers Zoom would send with `rawBody` (the fake Zoom, the dev route and tests). */
export function signZoomWebhook(secret: string, rawBody: string, at: Date): Record<string, string> {
  const ts = String(Math.floor(at.getTime() / 1000));
  return { 'x-zm-request-timestamp': ts, 'x-zm-signature': `v0=${hmac(secret, `v0:${ts}:${rawBody}`)}` };
}

/** Whether `rawBody` carries Zoom's signature under `secret`, sent within the tolerance of `now`. */
export function verifyZoomSignature(secret: string, rawBody: string, headers: Headers, now: Date): boolean {
  const ts = headers.get('x-zm-request-timestamp') ?? '';
  const sig = headers.get('x-zm-signature') ?? '';
  if (!/^[0-9]{9,12}$/.test(ts) || !/^v0=[0-9a-f]{64}$/.test(sig)) return false;
  if (Math.abs(now.getTime() - Number(ts) * 1000) > ZOOM_WEBHOOK_TOLERANCE_MS) return false;
  const want = Buffer.from(`v0=${hmac(secret, `v0:${ts}:${rawBody}`)}`);
  const got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got);
}

/* -------------------------------------------------------------------------- the command ---- */

export const ZoomParticipantInput = z.object({
  /** Zoom's event identity (hashed before it is stored). */
  providerEventId: z.string().min(1).max(600),
  kind: z.enum(['joined', 'left']),
  webinarId: z.string().regex(/^[0-9]{9,12}$/),
  /** Zoom's participant id (else their address): pairs a join with its leave. */
  participant: z.string().min(1).max(320),
  email: z.string().max(320).nullable(),
  at: z.date(),
});

export const ZOOM_OUTCOMES = ['recorded', 'duplicate', 'unknown_webinar'] as const;

type EventRow = typeof zoomParticipantEvents.$inferSelect;

/** Pair a participant's joins and leaves (in time order) into stays: join → the next leave. */
export function pairStays(rows: readonly Pick<EventRow, 'kind' | 'at' | 'email'>[]) {
  const sorted = [...rows].sort(
    (a, b) => a.at.getTime() - b.at.getTime() || (a.kind === b.kind ? 0 : a.kind === 'joined' ? -1 : 1),
  );
  const stays: { joinedAt: Date; leftAt: Date; email: string | null }[] = [];
  let open: (typeof sorted)[number] | null = null;
  for (const r of sorted) {
    if (r.kind === 'joined') open ??= r;
    else if (open) {
      stays.push({ joinedAt: open.at, leftAt: r.at, email: open.email ?? r.email });
      open = null;
    }
  }
  return stays;
}

/**
 * Record one verified join or leave. A replay (same provider event) records nothing; a webinar
 * not linked in the org is ignored. Pairs the participant's events into attendance segments
 * (idempotent: one row per stay) and, on a registered ticket's first join of the session, emits
 * `virtual.attended@1`. Runs as the webhook's system actor only.
 */
export const recordZoomParticipantCommand = tenantCommand({
  name: 'virtual.recordZoomParticipant',
  input: ZoomParticipantInput,
  output: z.object({ outcome: z.enum(ZOOM_OUTCOMES) }),
  entitlement: 'virtual',
  permission: 'platform:virtual.zoom_webhook',
  handler: async ({ input, ctx, tx, emit }) => {
    const orgId = requireOrg(ctx);
    const [link] = await tx.select().from(zoomWebinars).where(eq(zoomWebinars.webinarId, input.webinarId));
    if (!link) return { outcome: 'unknown_webinar' as const };
    const email = input.email ? input.email.trim().toLowerCase() : null;
    const ticketId = email ? await registeredTicketTx(tx, link.id, email) : null;
    const participantKey = zoomParticipantKey(input.webinarId, input.participant);
    const added = await tx
      .insert(zoomParticipantEvents)
      .values({
        orgId,
        eventId: link.eventId,
        sessionId: link.sessionId,
        webinarLinkId: link.id,
        providerEventId: zoomEventKey(input.providerEventId),
        kind: input.kind,
        participantKey,
        ticketId,
        email,
        at: input.at,
      })
      .onConflictDoNothing()
      .returning({ id: zoomParticipantEvents.id });
    if (added.length === 0) return { outcome: 'duplicate' as const };
    const rows = await tx
      .select()
      .from(zoomParticipantEvents)
      .where(
        and(
          eq(zoomParticipantEvents.webinarLinkId, link.id),
          eq(zoomParticipantEvents.participantKey, participantKey),
        ),
      )
      .orderBy(asc(zoomParticipantEvents.at));
    for (const stay of pairStays(rows)) {
      if (!stay.email) continue; // nobody to credit: Zoom attendance is matched by address
      await tx
        .insert(zoomAttendance)
        .values({
          orgId,
          eventId: link.eventId,
          sessionId: link.sessionId,
          webinarLinkId: link.id,
          ticketId: await registeredTicketTx(tx, link.id, stay.email),
          email: stay.email,
          joinedAt: stay.joinedAt,
          leftAt: stay.leftAt,
          segmentKey: zoomSegmentKey(stay.email, stay.joinedAt),
        })
        .onConflictDoNothing();
    }
    if (input.kind === 'joined' && ticketId) {
      const [first] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(zoomParticipantEvents)
        .where(
          and(
            eq(zoomParticipantEvents.sessionId, link.sessionId),
            eq(zoomParticipantEvents.ticketId, ticketId),
            eq(zoomParticipantEvents.kind, 'joined'),
          ),
        );
      if ((first?.n ?? 0) === 1)
        emit(
          virtualAttended({
            orgId,
            eventId: link.eventId,
            sessionId: link.sessionId,
            ticketId,
            at: input.at.toISOString(),
          }),
        );
    }
    return { outcome: 'recorded' as const };
  },
});

async function registeredTicketTx(tx: TenantTx, linkId: string, email: string): Promise<string | null> {
  const [reg] = await tx
    .select({ ticketId: zoomRegistrants.ticketId })
    .from(zoomRegistrants)
    .where(and(eq(zoomRegistrants.webinarLinkId, linkId), eq(zoomRegistrants.email, email)))
    .orderBy(asc(zoomRegistrants.createdAt))
    .limit(1);
  return reg?.ticketId ?? null;
}

/* -------------------------------------------------------------------------- transport ---- */

export interface ZoomWebhookResult {
  readonly status: number;
  readonly body: Record<string, string> | null;
  /** False when the signature was refused (the route rate-limits those callers). */
  readonly verified: boolean;
}

const Participant = z.object({
  id: z.string().max(200).optional(),
  user_id: z.union([z.string(), z.number()]).optional(),
  participant_uuid: z.string().max(200).optional(),
  email: z.string().max(320).optional(),
  join_time: z.string().max(40).optional(),
  leave_time: z.string().max(40).optional(),
});
const ParticipantEvent = z.object({
  event: z.enum(['webinar.participant_joined', 'webinar.participant_left']),
  event_ts: z.number().int().nonnegative(),
  payload: z.object({
    object: z.object({
      id: z.union([z.string(), z.number()]),
      uuid: z.string().max(200).optional(),
      participant: Participant,
    }),
  }),
});

/** The org a webinar id belongs to (SECURITY DEFINER lookup; null when none or ambiguous). */
async function orgForWebinar(webinarId: string): Promise<string | null> {
  const [row] = await withoutTenant((tx) =>
    tx.execute<{ org_id: string | null }>(sql`select virtual.org_for_zoom_webinar(${webinarId}) as org_id`),
  );
  return row?.org_id ?? null;
}

/**
 * Zoom's webhook, transport-free so the route and the tests share it. 404 when no secret is
 * configured; 401 for a refused signature (nothing parsed); 400 for a verified body we cannot
 * read; 200 otherwise (Zoom retries anything else).
 */
export async function processZoomWebhook(
  rawBody: string,
  headers: Headers,
  deps: { secret: string | null; ports: CommandPorts<TenantTx>; now?: Date },
): Promise<ZoomWebhookResult> {
  if (!deps.secret) return { status: 404, body: null, verified: true };
  const now = deps.now ?? new Date();
  if (rawBody.length > ZOOM_WEBHOOK_MAX_BYTES || !verifyZoomSignature(deps.secret, rawBody, headers, now))
    return { status: 401, body: null, verified: false };
  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return { status: 400, body: null, verified: true };
  }
  const head = json as { event?: unknown; payload?: { plainToken?: unknown } } | null;
  if (head?.event === 'endpoint.url_validation') {
    const plain = head.payload?.plainToken;
    if (typeof plain !== 'string' || plain.length === 0 || plain.length > 200)
      return { status: 400, body: null, verified: true };
    return {
      status: 200,
      body: { plainToken: plain, encryptedToken: hmac(deps.secret, plain) },
      verified: true,
    };
  }
  const parsed = ParticipantEvent.safeParse(json);
  if (!parsed.success) return { status: 200, body: { outcome: 'ignored' }, verified: true };
  const e = parsed.data;
  const p = e.payload.object.participant;
  const webinarId = String(e.payload.object.id);
  const joined = e.event === 'webinar.participant_joined';
  const when = joined ? p.join_time : p.leave_time;
  const at = when ? new Date(when) : new Date(e.event_ts);
  const participant =
    p.participant_uuid || p.id || (p.user_id !== undefined ? String(p.user_id) : '') || p.email;
  if (!/^[0-9]{9,12}$/.test(webinarId) || !participant || Number.isNaN(at.getTime()))
    return { status: 200, body: { outcome: 'ignored' }, verified: true };
  const orgId = await orgForWebinar(webinarId);
  if (!orgId) return { status: 200, body: { outcome: 'unknown_webinar' }, verified: true };
  const ctx = createCtx({ orgId, actor: { type: 'system', name: 'webhook:zoom' } });
  try {
    const out = await executeCommand(
      recordZoomParticipantCommand,
      {
        providerEventId: [e.event, e.event_ts, e.payload.object.uuid ?? '', participant, when ?? ''].join(
          '|',
        ),
        kind: joined ? 'joined' : 'left',
        webinarId,
        participant,
        email: p.email && p.email.length >= 3 ? p.email : null,
        at,
      },
      ctx,
      deps.ports,
    );
    return { status: 200, body: { outcome: out.outcome }, verified: true };
  } catch (err) {
    if (isDomainError(err) && err.code === 'module_not_enabled')
      return { status: 200, body: { outcome: 'ignored' }, verified: true };
    if (isDomainError(err)) return { status: err.status, body: { error: err.code }, verified: true };
    throw err;
  }
}
