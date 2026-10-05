import { handleWebhook } from '@/server/delivery-webhooks.ts';

/** Inbound texts (STOP / START / HELP feed consent, M3.5b); answers with TwiML. */
export async function POST(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  return handleWebhook(req, 'sms', provider);
}
