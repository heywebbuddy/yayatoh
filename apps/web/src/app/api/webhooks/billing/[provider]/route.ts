import { handleBillingWebhook } from '@/server/billing.ts';

/** Subscription billing webhooks (M6.6a; dormant until BILLING_ENABLED): see `handleBillingWebhook`. */
export async function POST(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  return handleBillingWebhook(req, provider);
}
