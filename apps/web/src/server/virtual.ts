import 'server-only';
import { withTenant } from '@yayatoh/db';
import { findEventTx } from '@yayatoh/events';
import { createCtx, executeQuery, isDomainError } from '@yayatoh/kernel';
import { tooManyRequests } from '@yayatoh/platform/security';
import {
  processZoomWebhook,
  virtualTicketToken,
  watchableTicketsQuery,
  zoomWebhookSecretFromEnv,
} from '@yayatoh/virtual';
import { ports } from './ports.ts';
import { limitRequest } from './rate-limit.ts';

/**
 * Virtual sessions on the web (M6.9a). The org and event always come from the URL's slug (or the
 * order's manage link), never from the request; a ticket's watch link proves the rest.
 */
const systemCtx = (orgId: string) => createCtx({ orgId, actor: { type: 'system', name: 'virtual.web' } });

/** A ticket's watch page (locale-neutral). */
export const watchPath = (eventSlug: string, ticketId: string) =>
  `/events/${eventSlug}/watch/${encodeURIComponent(virtualTicketToken(ticketId))}`;

/** Where the player sends its heartbeats. */
export const HEARTBEAT_URL = '/api/virtual/heartbeat';

/**
 * The order page's "Watch online" links: tickets whose type includes virtual access on an online
 * or hybrid event. None without the virtual module.
 */
export async function watchLinksForOrder(
  target: { orgId: string; eventId: string },
  ticketIds: readonly string[],
): Promise<Map<string, string>> {
  if (ticketIds.length === 0) return new Map();
  const ids = await executeQuery(
    watchableTicketsQuery,
    { eventId: target.eventId, ticketIds: [...ticketIds] },
    createCtx({ orgId: target.orgId }),
    ports,
  ).catch((err) => {
    if (isDomainError(err)) return [] as string[];
    throw err;
  });
  if (ids.length === 0) return new Map();
  const ev = await withTenant(systemCtx(target.orgId), (tx) => findEventTx(tx, target.eventId));
  if (!ev) return new Map();
  return new Map(ids.map((id) => [id, watchPath(ev.slug, id)]));
}

/**
 * Zoom's join/leave webhooks (M6.10a). The raw body is verified (Zoom's `v0` signature with the
 * app's secret token, five-minute window) before anything is parsed; the org comes from the
 * webinar in the verified body. Callers with a refused signature are rate-limited. Off (404) in
 * production until `ZOOM_WEBHOOK_SECRET_TOKEN` is set.
 */
export async function handleZoomWebhook(req: Request): Promise<Response> {
  const raw = await req.text();
  const out = await processZoomWebhook(raw, req.headers, {
    secret: zoomWebhookSecretFromEnv(process.env),
    ports,
  });
  if (!out.verified) {
    const decision = await limitRequest(req, 'webhookAbuse', { scope: 'zoom' });
    if (!decision.allowed) return tooManyRequests(decision);
  }
  return out.body
    ? Response.json(out.body, { status: out.status, headers: { 'cache-control': 'no-store' } })
    : new Response(null, { status: out.status });
}
