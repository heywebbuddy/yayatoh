import 'server-only';
import { type BillingProvider, billingProviderFromEnv, processBillingWebhook } from '@yayatoh/billing';
import { tooManyRequests } from '@yayatoh/platform/security';
import { ports } from '@/server/ports.ts';
import { limitRequest } from '@/server/rate-limit.ts';

let provider: BillingProvider | undefined;

/**
 * The subscription billing provider (M6.6a): `BILLING_PROVIDER=stripe` with the Stripe billing
 * keys once the owner has the account, otherwise the fake (dev, preview, CI; refused in
 * production). Only used while billing is switched on (`BILLING_ENABLED`).
 */
export function getBillingProvider(): BillingProvider {
  provider ??= billingProviderFromEnv(process.env);
  return provider;
}

/**
 * The billing provider's webhook (see `processBillingWebhook`): 404 while billing is off or for
 * another provider's endpoint. Only deliveries that fail verification count against the source
 * IP (M1.14a), so a forger gets a 429 while the provider's signed deliveries are never limited.
 */
export async function handleBillingWebhook(req: Request, expected: string): Promise<Response> {
  if (expected !== 'fake' && expected !== 'stripe') return new Response(null, { status: 404 });
  const raw = await req.text();
  const out = await processBillingWebhook(raw, req.headers, expected, {
    provider: getBillingProvider,
    ports,
  });
  if (!out.verified) {
    const decision = await limitRequest(req, 'webhookAbuse', { scope: `billing:${expected}` });
    if (!decision.allowed) return tooManyRequests(decision);
  }
  return out.body
    ? Response.json(out.body, { status: out.status })
    : new Response(null, { status: out.status });
}
