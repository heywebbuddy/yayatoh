import { executeCommand, executeQuery, isDomainError } from '@yayatoh/kernel';
import { leadSetupQuery, myLeadsQuery, syncLeadScansCommand } from '@yayatoh/leads';
import { problem, problemFor, problemResponse } from '@yayatoh/platform/http';
import { ports } from '@/server/ports.ts';
import { leadCaller, noStore } from '@/server/scan-leads.ts';

/**
 * Lead mode (M5.6b): GET the person's setup (license, terms, capture window, qualifiers) and the
 * leads they may see; POST a batch of scans (one online scan, or the offline queue). Each scan id
 * is applied once, so the PWA can resend its queue until it gets an answer.
 */
export async function GET(req: Request) {
  const ctx = await leadCaller(req);
  if (ctx instanceof Response) return ctx;
  try {
    const setup = await executeQuery(leadSetupQuery, {}, ctx, ports);
    const list = setup.capture.accessOpen
      ? await executeQuery(myLeadsQuery, {}, ctx, ports).catch((err) => {
          if (isDomainError(err) && err.code === 'invalid_state') return null;
          throw err;
        })
      : null;
    return Response.json(
      { setup, leads: list?.leads ?? [], scope: list?.scope ?? 'own' },
      { headers: noStore },
    );
  } catch (err) {
    return problemResponse(problemFor(err));
  }
}

export async function POST(req: Request) {
  const ctx = await leadCaller(req, true);
  if (ctx instanceof Response) return ctx;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return problemResponse(problem('validation_failed', 'JSON required'));
  }
  try {
    const out = await executeCommand(syncLeadScansCommand, body as { scans: never[] }, ctx, ports);
    return Response.json(out, { headers: noStore });
  } catch (err) {
    return problemResponse(problemFor(err));
  }
}
