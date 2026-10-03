import { handleZoomWebhook } from '@/server/virtual.ts';

/** Zoom's join/leave webhooks (M6.10a): verified on the raw body first; see `handleZoomWebhook`. */
export async function POST(req: Request) {
  return handleZoomWebhook(req);
}
