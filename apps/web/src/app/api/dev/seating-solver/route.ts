import { getEventBySlugQuery } from '@yayatoh/events';
import { quickLayout } from '@yayatoh/floorplan';
import { addPartyGuestCommand, createPartyCommand } from '@yayatoh/guests';
import { createCtx, executeCommand, executeQuery } from '@yayatoh/kernel';
import { setEventLayoutCommand } from '@yayatoh/seating';
import { resolveOrgSlug } from '@yayatoh/tenancy';
import { type NextRequest, NextResponse } from 'next/server';
import { ports } from '@/server/ports.ts';
import { devAuthEnabled } from '@/server/session.ts';

const SIZES = [2, 4, 3, 1, 5, 2, 3, 4, 6, 2, 3, 2];
const TAGS = ['Acme', 'Globex', 'Initech'];

/**
 * Dev/CI only (M6.12a): a ballroom for the seating solver's browser test: 44 round tables of 10
 * with a stage and an exit, and `guests` guests (default 400, at most 400) in parties of 1–6 with
 * sides, tags (some "Accessibility") and a few VIP parties. Form fields: `org` and `event` (slugs).
 * Building 400 guests through the UI would take most of the test's time. 404 unless dev auth is on.
 */
export async function POST(req: NextRequest) {
  if (!devAuthEnabled()) return new NextResponse(null, { status: 404 });
  const form = await req.formData();
  const slug = String(form.get('org') ?? '');
  const org = /^[a-z0-9-]{1,63}$/.test(slug) ? await resolveOrgSlug(slug) : null;
  if (!org) return NextResponse.json({ error: 'unknown_org' }, { status: 404 });
  const total = Math.min(400, Math.max(1, Number(form.get('guests') ?? 400) || 400));
  const ctx = createCtx({ orgId: org.orgId, actor: { type: 'system', name: 'staff:dev' } });
  const ev = await executeQuery(
    getEventBySlugQuery,
    { slug: String(form.get('event') ?? '') },
    ctx,
    ports,
  ).catch(() => null);
  if (!ev) return NextResponse.json({ error: 'unknown_event' }, { status: 404 });
  const doc = quickLayout({ rows: 0, seatsPerRow: 1, tables: 44, seatsPerTable: 10, stage: true });
  doc.items.push({
    kind: 'object',
    id: crypto.randomUUID(),
    objectType: 'exit',
    label: 'Exit',
    x: 0,
    y: Math.max(0, doc.height - 150),
    width: 150,
    height: 150,
    rotation: 0,
  });
  await executeCommand(setEventLayoutCommand, { eventId: ev.id, doc }, ctx, ports);
  let made = 0;
  for (let n = 0; made < total; n++) {
    const size = Math.min(total - made, SIZES[n % SIZES.length] ?? 2);
    const tags = n % 3 === 0 ? [TAGS[n % TAGS.length] ?? 'Acme'] : [];
    if (n % 17 === 5) tags.push('Accessibility');
    const party = await executeCommand(
      createPartyCommand,
      {
        eventId: ev.id,
        name: `Party ${String(n + 1).padStart(3, '0')}`,
        side: n % 2 ? 'Groom' : 'Bride',
        vip: n % 13 === 0,
        tags,
      },
      ctx,
      ports,
    );
    for (let k = 0; k < size; k++)
      await executeCommand(
        addPartyGuestCommand,
        { eventId: ev.id, partyId: party.id, firstName: `Guest ${made + k + 1}`, lastName: `P${n + 1}` },
        ctx,
        ports,
      );
    made += size;
  }
  return NextResponse.json({ guests: made });
}
