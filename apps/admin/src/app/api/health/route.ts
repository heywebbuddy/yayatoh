export const dynamic = 'force-dynamic';

/** Liveness for the container healthcheck (ADR 0024): this process answers. */
export function GET() {
  return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
}
