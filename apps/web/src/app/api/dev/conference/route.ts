import { evaluateEventAlertsTx } from '@yayatoh/alerts';
import { withTenant } from '@yayatoh/db';
import { createCtx } from '@yayatoh/kernel';
import { resolveOrgSlug } from '@yayatoh/tenancy';
import { type NextRequest, NextResponse } from 'next/server';
import { conferenceSources, devConferenceFakes } from '@/server/conference-sources.ts';
import { notifier } from '@/server/notifications.ts';
import { devAuthEnabled } from '@/server/session.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const count = (v: FormDataEntryValue | null) => {
  const n = Number(v);
  return v !== null && v !== '' && Number.isInteger(n) && n >= 0 && n <= 100_000 ? n : null;
};

/**
 * Dev/CI only (M5.9a e2e): set this server's fake conference sources for one event — leads per
 * exhibitor (`leads`, JSON `{ exhibitorId: count }`), overdue sponsor deliverables and offline
 * badge printers (counts; empty = not served) — then re-evaluate the event's alerts as the worker
 * would. 404 unless dev auth is on; never in production.
 */
export async function POST(req: NextRequest) {
  if (!devAuthEnabled()) return new NextResponse(null, { status: 404 });
  const form = await req.formData();
  const slug = String(form.get('org') ?? '');
  const org = /^[a-z0-9-]{1,63}$/.test(slug) ? await resolveOrgSlug(slug) : null;
  if (!org) return NextResponse.json({ error: 'unknown_org' }, { status: 404 });
  const eventId = String(form.get('event') ?? '');
  if (!UUID.test(eventId)) return NextResponse.json({ error: 'bad_event' }, { status: 400 });
  const fakes = devConferenceFakes();
  const leads = form.get('leads');
  if (typeof leads === 'string' && leads) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(leads);
    } catch {
      return NextResponse.json({ error: 'bad_leads' }, { status: 400 });
    }
    if (!parsed || typeof parsed !== 'object')
      return NextResponse.json({ error: 'bad_leads' }, { status: 400 });
    const map = new Map<string, number>();
    for (const [id, n] of Object.entries(parsed as Record<string, unknown>))
      if (UUID.test(id) && Number.isInteger(n) && (n as number) >= 0) map.set(id, n as number);
    fakes.leads.set(eventId, map);
  }
  for (const [key, store] of [
    ['deliverables', fakes.deliverables],
    ['printers', fakes.printers],
  ] as const) {
    const n = count(form.get(key));
    if (n !== null) store.set(eventId, n);
  }
  const ctx = createCtx({ orgId: org.orgId, actor: { type: 'system', name: 'dev.conference' } });
  const changes = await withTenant(ctx, (tx) =>
    evaluateEventAlertsTx(tx, ctx, eventId, { notifier, conference: conferenceSources() }),
  );
  return NextResponse.json({ ok: true, changes: changes.length });
}
