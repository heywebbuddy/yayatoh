import 'server-only';
import { createCtx, executeCommand } from '@yayatoh/kernel';
import {
  type DeliveryEvent,
  type DeliveryWebhookAdapter,
  fakeDeliveryAdapter,
  fakeDeliverySecret,
  orgOfMessage,
  recordDeliveryEventsCommand,
} from '@yayatoh/notifications';
import { tooManyRequests } from '@yayatoh/platform/security';
import { ports } from '@/server/ports.ts';
import { limitRequest } from '@/server/rate-limit.ts';

/**
 * The delivery-report adapter for a provider path segment, or null (404). Only the fake provider
 * exists until the owner's SES and Twilio accounts do (their signature formats are adapters
 * behind the same port); it answers everywhere except production unless explicitly chosen.
 */
export function deliveryAdapter(provider: string): DeliveryWebhookAdapter | null {
  if (provider !== 'fake') return null;
  if (process.env.VERCEL_ENV === 'production' && process.env.EMAIL_PROVIDER !== 'fake') return null;
  const secret = fakeDeliverySecret();
  return secret ? fakeDeliveryAdapter(secret) : null;
}

export interface IngestResult {
  recorded: number;
  duplicate: number;
  unknown: number;
  suppressed: number;
}

/**
 * Record verified events: each event's org comes from our own message id (SECURITY DEFINER
 * lookup), never from the payload or a header; then one platform command per org.
 */
export async function ingestDeliveryEvents(provider: string, events: readonly DeliveryEvent[]) {
  const total: IngestResult = { recorded: 0, duplicate: 0, unknown: 0, suppressed: 0 };
  const byOrg = new Map<string, DeliveryEvent[]>();
  for (const e of events) {
    const org = await orgOfMessage(e.messageId);
    if (!org) {
      total.unknown += 1;
      continue;
    }
    byOrg.set(org, [...(byOrg.get(org) ?? []), e]);
  }
  for (const [orgId, list] of byOrg) {
    const ctx = createCtx({ orgId, actor: { type: 'system', name: `webhook:email-${provider}` } });
    const r = await executeCommand(recordDeliveryEventsCommand, { provider, events: list }, ctx, ports);
    total.recorded += r.recorded;
    total.duplicate += r.duplicate;
    total.unknown += r.unknown;
    total.suppressed += r.suppressed;
  }
  return total;
}

/**
 * A provider's delivery webhook (delivered, bounced, complained): verified on the raw body, then
 * recorded, deduplicated by the provider's event id. Failed verifications are rate-limited per
 * source (M1.14a) so forgers get a 429; signed deliveries are never limited.
 */
export async function handleDeliveryWebhook(req: Request, provider: string): Promise<Response> {
  const adapter = deliveryAdapter(provider);
  if (!adapter) return new Response(null, { status: 404 });
  const raw = await req.text();
  let events: DeliveryEvent[];
  try {
    if (raw.length > 256 * 1024) throw new Error('too large');
    events = adapter.verify(raw, req.headers);
  } catch {
    const decision = await limitRequest(req, 'webhookAbuse', { scope: `email-${provider}` });
    if (!decision.allowed) return tooManyRequests(decision);
    return new Response(null, { status: 400 });
  }
  return Response.json(await ingestDeliveryEvents(adapter.name, events));
}
