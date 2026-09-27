import { tooManyRequests } from '@yayatoh/platform/security';
import { limitRequest } from '@/server/rate-limit.ts';

const MAX_BYTES = 16 * 1024;

type Report = Record<string, unknown>;

/** Only these fields are logged (no query strings: URLs can carry ticket or order tokens). */
function summarize(r: Report): Record<string, string> {
  const strip = (v: unknown) => {
    if (typeof v !== 'string') return '';
    try {
      const u = new URL(v);
      return `${u.origin}${u.pathname}`.slice(0, 300);
    } catch {
      return v.slice(0, 100);
    }
  };
  const pick = (...keys: string[]) => {
    for (const k of keys) if (typeof r[k] === 'string') return r[k] as string;
    return '';
  };
  return {
    directive: pick(
      'effectiveDirective',
      'effective-directive',
      'violatedDirective',
      'violated-directive',
    ).slice(0, 60),
    blocked: strip(r.blockedURL ?? r['blocked-uri']),
    document: strip(r.documentURL ?? r['document-uri']),
    source: strip(r.sourceFile ?? r['source-file']),
    disposition: pick('disposition').slice(0, 10),
  };
}

/**
 * CSP violation reports (M1.14a): both the legacy `report-uri` body (`{"csp-report": {…}}`)
 * and the Reporting API (`application/reports+json`, an array). Rate-limited, size-capped and
 * logged as structured lines for the log pipeline (Axiom once the owner's account exists).
 */
export async function POST(req: Request) {
  const decision = await limitRequest(req, 'cspReport');
  if (!decision.allowed) return tooManyRequests(decision);
  const type = req.headers.get('content-type') ?? '';
  if (!/application\/(csp-report|reports\+json|json)/.test(type)) return new Response(null, { status: 415 });
  const text = await req.text();
  if (text.length > MAX_BYTES) return new Response(null, { status: 413 });
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return new Response(null, { status: 400 });
  }
  const reports: Report[] = Array.isArray(parsed)
    ? parsed
        .filter((x): x is { type?: unknown; body?: unknown } => typeof x === 'object' && x !== null)
        .filter((x) => x.type === 'csp-violation' && typeof x.body === 'object' && x.body !== null)
        .map((x) => x.body as Report)
    : typeof (parsed as { 'csp-report'?: unknown })?.['csp-report'] === 'object'
      ? [(parsed as { 'csp-report': Report })['csp-report']]
      : [];
  if (reports.length === 0) return new Response(null, { status: 400 });
  for (const r of reports.slice(0, 20)) console.warn(JSON.stringify({ csp: 'violation', ...summarize(r) }));
  return new Response(null, { status: 204 });
}
