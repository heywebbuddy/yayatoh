import { pingDatabase } from '@yayatoh/db';

export const dynamic = 'force-dynamic';

const TIMEOUT_MS = 3000;

/**
 * Liveness for the container healthcheck and the uptime monitor (ADR 0024): 200 when this process
 * answers and the database replies within 3 s, else 503. No details leave the server.
 */
export async function GET() {
  const timeout = new Promise<boolean>((resolve) => setTimeout(() => resolve(false), TIMEOUT_MS).unref());
  const ok = await Promise.race([pingDatabase(), timeout]).catch(() => false);
  return Response.json({ ok }, { status: ok ? 200 : 503, headers: { 'Cache-Control': 'no-store' } });
}
