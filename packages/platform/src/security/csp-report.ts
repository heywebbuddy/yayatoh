/**
 * CSP violation reports (M1.14a; shared by the web app and the staff console, M1.3f): both the
 * legacy `report-uri` body (`{"csp-report": {…}}`) and the Reporting API
 * (`application/reports+json`, an array). Pure: the routes add rate limiting and logging.
 */
export const CSP_REPORT_MAX_BYTES = 16 * 1024;

type Report = Record<string, unknown>;

/** Only these fields are logged (no query strings: URLs can carry ticket or order tokens). */
export function summarizeCspReport(r: Report): Record<string, string> {
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
 * Parse a report request body: the summaries (at most 20) or the HTTP status to answer with
 * (415 wrong type, 413 too big, 400 malformed or empty).
 */
export function readCspReports(
  contentType: string,
  text: string,
): { ok: true; reports: Record<string, string>[] } | { ok: false; status: 400 | 413 | 415 } {
  if (!/application\/(csp-report|reports\+json|json)/.test(contentType)) return { ok: false, status: 415 };
  if (text.length > CSP_REPORT_MAX_BYTES) return { ok: false, status: 413 };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, status: 400 };
  }
  const reports: Report[] = Array.isArray(parsed)
    ? parsed
        .filter((x): x is { type?: unknown; body?: unknown } => typeof x === 'object' && x !== null)
        .filter((x) => x.type === 'csp-violation' && typeof x.body === 'object' && x.body !== null)
        .map((x) => x.body as Report)
    : typeof (parsed as { 'csp-report'?: unknown })?.['csp-report'] === 'object'
      ? [(parsed as { 'csp-report': Report })['csp-report']]
      : [];
  if (reports.length === 0) return { ok: false, status: 400 };
  return { ok: true, reports: reports.slice(0, 20).map(summarizeCspReport) };
}
