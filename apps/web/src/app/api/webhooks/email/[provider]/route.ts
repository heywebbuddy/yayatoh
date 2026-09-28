import { handleDeliveryWebhook } from '@/server/delivery-webhooks.ts';

/** Delivery reports from an email/SMS provider (M1.10d); see `handleDeliveryWebhook`. */
export async function POST(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  return handleDeliveryWebhook(req, provider);
}
