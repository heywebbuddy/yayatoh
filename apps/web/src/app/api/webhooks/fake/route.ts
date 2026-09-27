import { createCtx, executeCommand, isDomainError } from '@yayatoh/kernel';
import { applyDisputeEventCommand, applyProviderEventCommand } from '@yayatoh/orders';
import {
  applyAccountEventCommand,
  isAccountEvent,
  isDisputeEvent,
  type WebhookEvent,
} from '@yayatoh/payments';
import { getPaymentProvider } from '@/server/payments.ts';
import { ports } from '@/server/ports.ts';

/**
 * Fake-provider webhook (dev/preview/CI). Verified on the raw body, then applied as a platform
 * command: deduplicated by event id. Payment events are checked against the order (amount,
 * currency, payment id); account events only touch the account the org recorded.
 */
export async function POST(req: Request) {
  const raw = await req.text();
  let event: WebhookEvent;
  try {
    event = await getPaymentProvider().verifyWebhook(raw, req.headers);
  } catch {
    return new Response(null, { status: 400 });
  }
  const ctx = createCtx({ orgId: event.orgId, actor: { type: 'system', name: 'webhook:fake' } });
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
