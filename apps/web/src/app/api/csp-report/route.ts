import { readCspReports, tooManyRequests } from '@yayatoh/platform/security';
import { limitRequest } from '@/server/rate-limit.ts';

/**
 * CSP violation reports (M1.14a): both the legacy `report-uri` body and the Reporting API.
 * Rate-limited, size-capped and logged as structured lines for the log pipeline (Axiom once the
 * owner's account exists). Parsing and the allowlisted summary live in @yayatoh/platform/security.
 */
export async function POST(req: Request) {
  const decision = await limitRequest(req, 'cspReport');
  if (!decision.allowed) return tooManyRequests(decision);
  const r = readCspReports(req.headers.get('content-type') ?? '', await req.text());
  if (!r.ok) return new Response(null, { status: r.status });
  for (const s of r.reports) console.warn(JSON.stringify({ csp: 'violation', ...s }));
  return new Response(null, { status: 204 });
}
