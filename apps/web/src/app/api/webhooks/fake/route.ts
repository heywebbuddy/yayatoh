import { createCtx, executeCommand, isDomainError } from '@yayatoh/kernel';
import { applyProviderEventCommand } from '@yayatoh/orders';
import { getPaymentProvider } from '@/server/payments.ts';
import { ports } from '@/server/ports.ts';

/**
 * Fake-provider webhook (dev/preview/CI). Verified on the raw body, then applied as a platform
 * command: deduplicated by event id, amount/currency/payment id checked against the order.
 */
export async function POST(req: Request) {
  const raw = await req.text();
  let event: Awaited<ReturnType<ReturnType<typeof getPaymentProvider>['verifyWebhook']>>;
  try {
    event = await getPaymentProvider().verifyWebhook(raw, req.headers);
  } catch {
    return new Response(null, { status: 400 });
  }
  try {
    const out = await executeCommand(
      applyProviderEventCommand,
      event,
      createCtx({ orgId: event.orgId, actor: { type: 'system', name: 'webhook:fake' } }),
      ports,
    );
    return Response.json(out);
  } catch (err) {
    if (isDomainError(err)) return Response.json({ error: err.code }, { status: err.status });
    throw err;
  }
}
