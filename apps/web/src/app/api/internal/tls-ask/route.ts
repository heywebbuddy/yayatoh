import { resolveHost } from '@yayatoh/tenancy';
import { tlsAllowed } from '@/lib/tls-ask.ts';

export const dynamic = 'force-dynamic';

/**
 * Asked by Caddy before it requests a certificate for a new host (`?domain=`): 200 issues, 404
 * refuses. Caddy calls it on the private network; the public sites answer 404 for /api/internal/tls-ask.
 */
export async function GET(req: Request) {
  const domain = new URL(req.url).searchParams.get('domain');
  const ok = await tlsAllowed(domain, resolveHost);
  return new Response(null, { status: ok ? 200 : 404 });
}
