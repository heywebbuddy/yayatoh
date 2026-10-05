import { handleWebhook } from '@/server/delivery-webhooks.ts';

/** Delivery reports from an email provider (M1.10d; SES through SNS, M3.5b); see `handleWebhook`. */
export async function POST(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  return handleWebhook(req, 'email', provider);
}
