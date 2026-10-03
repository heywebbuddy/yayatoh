import { executeCommand } from '@yayatoh/kernel';
import { updateLeadCommand } from '@yayatoh/leads';
import { problem, problemFor, problemResponse } from '@yayatoh/platform/http';
import { ports } from '@/server/ports.ts';
import { leadCaller, noStore } from '@/server/scan-leads.ts';

/** Rate, qualify and annotate one lead the caller may see (M5.6b). */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await leadCaller(req, true);
  if (ctx instanceof Response) return ctx;
  const { id } = await params;
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return problemResponse(problem('validation_failed', 'JSON required'));
  }
  try {
    const out = await executeCommand(
      updateLeadCommand,
      { leadId: id, rating: body.rating, qualifiers: body.qualifiers, notes: body.notes } as never,
      ctx,
      ports,
    );
    return Response.json(out, { headers: noStore });
  } catch (err) {
    return problemResponse(problemFor(err));
  }
}
