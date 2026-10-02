import { checkoutTarget } from '@yayatoh/events';
import { createCtx, executeCommand, executeQuery, isDomainError } from '@yayatoh/kernel';
import { eventSeatingQuery, setEventLayoutCommand } from '@yayatoh/seating';
import { type NextRequest, NextResponse } from 'next/server';
import { ports } from '@/server/ports.ts';
import { devAuthEnabled, ownSession } from '@/server/session.ts';

const FRONT = '01922c3e-0000-7000-8000-00000000f001';
const BACK = '01922c3e-0000-7000-8000-00000000f002';

/**
 * Dev/preview helper for browser tests (M6.11a): put a published event's rows into two sections,
 * Front and Back (the plan editor has no section tool yet; legacy imports bring sections). Runs
 * as the signed-in user through the normal command, so their permissions apply. 404 unless dev
 * personas are enabled; never available in production.
 */
export async function POST(req: NextRequest) {
  if (!devAuthEnabled()) return new NextResponse(null, { status: 404 });
  const session = await ownSession();
  const target = await checkoutTarget(req.nextUrl.searchParams.get('event') ?? '');
  if (!session || !target) return new NextResponse(null, { status: 404 });
  const ctx = createCtx({ orgId: target.orgId, actor: { type: 'user', userId: session.userId } });
  try {
    const seating = await executeQuery(eventSeatingQuery, { eventId: target.eventId }, ctx, ports);
    if (!seating) return new NextResponse(null, { status: 404 });
    const rows = seating.doc.items.filter((i) => i.kind === 'row');
    const front = new Set(rows.slice(0, Math.ceil(rows.length / 2)).map((r) => r.id));
    await executeCommand(
      setEventLayoutCommand,
      {
        eventId: target.eventId,
        doc: {
          ...seating.doc,
          sections: [
            { id: FRONT, label: 'Front', vip: false },
            { id: BACK, label: 'Back', vip: false },
          ],
          items: seating.doc.items.map((i) =>
            i.kind === 'row' ? { ...i, sectionId: front.has(i.id) ? FRONT : BACK } : i,
          ),
        },
      },
      ctx,
      ports,
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ code: isDomainError(err) ? err.code : 'internal' }, { status: 409 });
  }
}
