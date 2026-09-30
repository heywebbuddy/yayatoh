import { postgresRateLimitStore } from '@yayatoh/platform';
import { createRateLimiter, readCspReports, tooManyRequests } from '@yayatoh/platform/security';

const limiter = createRateLimiter(postgresRateLimitStore, (err) =>
  console.error(JSON.stringify({ rateLimit: 'store_error', message: String(err) })),
);

/**
 * The staff console's CSP violation reports (M1.3f, same format and limits as the web app's):
 * rate-limited per client, size-capped, logged as allowlisted structured lines.
 */
export async function POST(req: Request) {
  const ip =
    req.headers.get('x-real-ip') ?? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
  const decision = await limiter.check('cspReport', { ip }, { scope: 'admin' });
  if (!decision.allowed) return tooManyRequests(decision);
  const r = readCspReports(req.headers.get('content-type') ?? '', await req.text());
  if (!r.ok) return new Response(null, { status: r.status });
  for (const s of r.reports) console.warn(JSON.stringify({ csp: 'violation', app: 'admin', ...s }));
  return new Response(null, { status: 204 });
}
