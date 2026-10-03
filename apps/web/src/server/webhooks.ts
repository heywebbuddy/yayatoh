import 'server-only';
import { createCtx, executeCommand, isDomainError } from '@yayatoh/kernel';
import { applyDisputeEventCommand, applyProviderEventCommand } from '@yayatoh/orders';
import {
  applyAccountEventCommand,
  isAccountEvent,
  isDisputeEvent,
  isIgnoredEvent,
  type WebhookEvent,
} from '@yayatoh/payments';
import { tooManyRequests } from '@yayatoh/platform/security';
import { getPaymentProvider } from '@/server/payments.ts';
import { ports } from '@/server/ports.ts';
import { limitRequest } from '@/server/rate-limit.ts';

/**
 * A payment provider's webhook: only the configured provider's endpoint answers (the other is a
 * 404). Verified on the raw body, then applied as a platform command, deduplicated by the
 * provider's event id. Payment events are checked against the order (amount, currency, payment
 * id); account events only touch the account the org recorded. Events the platform doesn't act
 * on are acknowledged so the provider stops retrying.
 */
export async function handlePaymentWebhook(req: Request, expected: 'fake' | 'stripe'): Promise<Response> {
  const provider = getPaymentProvider();
  // M6.3a: on a Stripe deployment the fake endpoint stays open for sandbox orgs' fake payments
  // only (the sandbox-safe provider refuses a fake-signed event for any other org).
  const sandboxFake = expected === 'fake' && 'sandboxSafe' in provider;
  if (provider.name !== expected && !sandboxFake) return new Response(null, { status: 404 });
  const raw = await req.text();
  let event: WebhookEvent;
  try {
    event = await provider.verifyWebhook(raw, req.headers);
  } catch {
    // Abuse path (M1.14a): only deliveries that fail verification count, per source IP, so a
    // forger gets a 429 while the provider's genuine (signed) deliveries are never limited.
    const decision = await limitRequest(req, 'webhookAbuse', { scope: expected });
    if (!decision.allowed) return tooManyRequests(decision);
    return new Response(null, { status: 400 });
  }
  if (isIgnoredEvent(event)) return Response.json({ outcome: 'ignored' });
  const ctx = createCtx({ orgId: event.orgId, actor: { type: 'system', name: `webhook:${expected}` } });
  try {
    const out = isAccountEvent(event)
      ? await executeCommand(applyAccountEventCommand, event, ctx, ports)
      : isDisputeEvent(event)
        ? await executeCommand(applyDisputeEventCommand, event, ctx, ports)
        : await executeCommand(applyProviderEventCommand, event, ctx, ports);
    return Response.json(out);
  } catch (err) {
    if (isDomainError(err)) return Response.json({ error: err.code }, { status: err.status });
    throw err;
  }
}
