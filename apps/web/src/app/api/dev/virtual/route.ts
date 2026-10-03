import { createEventCommand, transitionEventCommand } from '@yayatoh/events';
import { createCtx, executeCommand, executeQuery } from '@yayatoh/kernel';
import { orderByManageToken } from '@yayatoh/orders';
import { createSessionCommand } from '@yayatoh/program';
import {
  registrationSetupQuery,
  seedRegistrationDefaultsCommand,
  setCellCommand,
  startRegistrationCommand,
} from '@yayatoh/registration';
import { resolveOrgSlug } from '@yayatoh/tenancy';
import { virtualSetupQuery } from '@yayatoh/virtual';
import { type NextRequest, NextResponse } from 'next/server';
import { ports } from '@/server/ports.ts';
import { devAuthEnabled } from '@/server/session.ts';
import { watchPath } from '@/server/virtual.ts';

const MIN = 60_000;

/**
 * Dev/CI only (M6.9a e2e): a published conference under way (still in person: the test sets up
 * delivery, access and streams through the console), free registration with a full pass and a
 * day pass, two sessions ("Opening keynote" and "Closing panel", both now) and two registrants:
 * Ana (full pass) and Ben (day pass). Returns the console path, the sessions, and each person's
 * order manage token, watch path and ticket type name. 404 unless dev auth is on; never in
 * production.
 */
export async function POST(req: NextRequest) {
  if (!devAuthEnabled()) return new NextResponse(null, { status: 404 });
  const form = await req.formData();
  const slug = String(form.get('org') ?? '');
  const org = /^[a-z0-9-]{1,63}$/.test(slug) ? await resolveOrgSlug(slug) : null;
  if (!org) return NextResponse.json({ error: 'unknown_org' }, { status: 404 });
  const name = String(form.get('name') ?? 'Virtual Summit').slice(0, 80);
  const ctx = createCtx({ orgId: org.orgId, actor: { type: 'system', name: 'dev.virtual' } });
  const now = Date.now();
  const ev = await executeCommand(
    createEventCommand,
    {
      name,
      profile: 'conference',
      timezone: 'America/Chicago',
      startsAt: new Date(now - 60 * MIN),
      endsAt: new Date(now + 8 * 60 * MIN),
    },
    ctx,
    ports,
  );
  await executeCommand(seedRegistrationDefaultsCommand, { eventId: ev.id, names: {} }, ctx, ports);
  const setup = await executeQuery(registrationSetupQuery, { eventId: ev.id }, ctx, ports);
  const member = setup.types.find((t) => t.key === 'member')?.id as string;
  const item = (key: string) => setup.items.find((i) => i.key === key)?.id as string;
  for (const key of ['full_pass', 'day_pass'])
    await executeCommand(
      setCellCommand,
      { eventId: ev.id, registrationTypeId: member, admissionItemId: item(key), priceMinor: 0 },
      ctx,
      ports,
    );
  await executeCommand(transitionEventCommand, { eventId: ev.id, transition: 'publish' }, ctx, ports);
  const sessions: { id: string; title: string }[] = [];
  for (const title of ['Opening keynote', 'Closing panel']) {
    const r = await executeCommand(
      createSessionCommand,
      { eventId: ev.id, title, startsAt: new Date(now - 10 * MIN), endsAt: new Date(now + 110 * MIN) },
      ctx,
      ports,
    );
    sessions.push({ id: r.session.id, title });
  }
  const anon = createCtx({ orgId: org.orgId });
  const registered: { name: string; token: string; ticketId: string; ticketTypeId: string }[] = [];
  for (const [who, pass] of [
    ['Ana', 'full_pass'],
    ['Ben', 'day_pass'],
  ] as const) {
    const email = `${who.toLowerCase()}.${now.toString(36)}${Math.random().toString(36).slice(2, 8)}@example.test`;
    const r = await executeCommand(
      startRegistrationCommand,
      { eventId: ev.id, registrationTypeId: member, itemIds: [item(pass)], buyer: { email, name: who } },
      anon,
      ports,
    );
    const order = await orderByManageToken(r.manageToken);
    const tk = order?.tickets[0];
    if (!tk) return NextResponse.json({ error: 'no_ticket' }, { status: 500 });
    registered.push({ name: who, token: r.manageToken, ticketId: tk.id, ticketTypeId: tk.ticketTypeId });
  }
  const types = (await executeQuery(virtualSetupQuery, { eventId: ev.id }, ctx, ports)).ticketTypes;
  return NextResponse.json({
    slug: ev.slug,
    path: `/o/${slug}/e/${ev.slug}`,
    sessions,
    people: registered.map((p) => ({
      name: p.name,
      token: p.token,
      watch: watchPath(ev.slug, p.ticketId),
      ticketType: types.find((t) => t.ticketTypeId === p.ticketTypeId)?.name ?? null,
    })),
  });
}
