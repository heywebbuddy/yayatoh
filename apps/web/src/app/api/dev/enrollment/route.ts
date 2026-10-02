import { createEventCommand, transitionEventCommand } from '@yayatoh/events';
import { createCtx, executeCommand, executeQuery } from '@yayatoh/kernel';
import {
  createSessionCommand,
  createSessionGroupCommand,
  setSessionAgendaCommand,
  updateSessionCommand,
} from '@yayatoh/program';
import {
  enrollSessionCommand,
  myScheduleQuery,
  registrationSetupQuery,
  seedRegistrationDefaultsCommand,
  setCellCommand,
  startRegistrationCommand,
} from '@yayatoh/registration';
import { resolveOrgSlug } from '@yayatoh/tenancy';
import { type NextRequest, NextResponse } from 'next/server';
import { ports } from '@/server/ports.ts';
import { devAuthEnabled } from '@/server/session.ts';

const H = 3_600_000;
const DAY = 24 * H;

/**
 * Dev/CI only (M5.2b e2e): a published conference with free registration, an included keynote,
 * two overlapping optional workshops (one with a single place), a "pick one" group of two tracks
 * and a session whose capacity was raised while people waited (for "Promote now"), plus `people`
 * free registrants. Returns the console path and each registrant's manage token. Everything the
 * tests then do goes through the real pages. 404 unless dev auth is on; never in production.
 */
export async function POST(req: NextRequest) {
  if (!devAuthEnabled()) return new NextResponse(null, { status: 404 });
  const form = await req.formData();
  const slug = String(form.get('org') ?? '');
  const org = /^[a-z0-9-]{1,63}$/.test(slug) ? await resolveOrgSlug(slug) : null;
  if (!org) return NextResponse.json({ error: 'unknown_org' }, { status: 404 });
  const name = String(form.get('name') ?? 'Enrollment Summit').slice(0, 80);
  const people = Math.min(6, Math.max(1, Number(form.get('people') ?? 3) || 3));
  const ctx = createCtx({ orgId: org.orgId, actor: { type: 'system', name: 'dev.enrollment' } });
  // Day one of the conference, 40 days out, 09:00 in Chicago (14:00 UTC).
  const day1 = new Date(Math.floor((Date.now() + 40 * DAY) / DAY) * DAY + 14 * H);
  const ev = await executeCommand(
    createEventCommand,
    {
      name,
      profile: 'conference',
      timezone: 'America/Chicago',
      startsAt: day1,
      endsAt: new Date(day1.getTime() + 9 * H),
    },
    ctx,
    ports,
  );
  await executeCommand(seedRegistrationDefaultsCommand, { eventId: ev.id, names: {} }, ctx, ports);
  const setup = await executeQuery(registrationSetupQuery, { eventId: ev.id }, ctx, ports);
  const member = setup.types.find((t) => t.key === 'member')?.id as string;
  const fullPass = setup.items.find((i) => i.key === 'full_pass')?.id as string;
  await executeCommand(
    setCellCommand,
    { eventId: ev.id, registrationTypeId: member, admissionItemId: fullPass, priceMinor: 0 },
    ctx,
    ports,
  );
  await executeCommand(transitionEventCommand, { eventId: ev.id, transition: 'publish' }, ctx, ports);
  const group = await executeCommand(
    createSessionGroupCommand,
    { eventId: ev.id, name: 'Afternoon track' },
    ctx,
    ports,
  );
  const session = async (
    title: string,
    h: number,
    capacity: number | null,
    admission: 'included' | 'optional' = 'optional',
    groupId: string | null = null,
  ) => {
    const res = await executeCommand(
      createSessionCommand,
      {
        eventId: ev.id,
        title,
        startsAt: new Date(day1.getTime() + h * H),
        endsAt: new Date(day1.getTime() + (h + 1) * H),
        capacity,
      },
      ctx,
      ports,
    );
    await executeCommand(
      setSessionAgendaCommand,
      { eventId: ev.id, sessionId: res.session.id, admission, groupId },
      ctx,
      ports,
    );
    return res.session;
  };
  await session('Opening keynote', 0, null, 'included');
  await session('Data workshop', 1, 1);
  await session('Design workshop', 1.5, 10);
  await session('Track A', 5, 10, 'optional', group.id);
  await session('Track B', 5, 10, 'optional', group.id);
  const raised = await session('Bonus lab', 7, 1);
  const out: { token: string; name: string; email: string }[] = [];
  for (let i = 0; i < people; i++) {
    const email = `enrol.${i}.${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}@example.test`;
    const r = await executeCommand(
      startRegistrationCommand,
      {
        eventId: ev.id,
        registrationTypeId: member,
        itemIds: [fullPass],
        buyer: { email, name: `Attendee ${i + 1}` },
      },
      createCtx({ orgId: org.orgId }),
      ports,
    );
    out.push({ token: r.manageToken, name: `Attendee ${i + 1}`, email });
  }
  // "Bonus lab": the first two registrants hold its place and wait; then its capacity is raised,
  // so one place is free with someone waiting (what "Promote now" is for).
  for (const p of out.slice(0, 2)) {
    const anon = createCtx({ orgId: org.orgId });
    const mine = await executeQuery(myScheduleQuery, { token: p.token, registrantId: null }, anon, ports);
    if (mine.registrantId)
      await executeCommand(
        enrollSessionCommand,
        { token: p.token, registrantId: mine.registrantId, sessionId: raised.id, choice: 'refuse' },
        anon,
        ports,
      );
  }
  await executeCommand(
    updateSessionCommand,
    {
      eventId: ev.id,
      sessionId: raised.id,
      title: 'Bonus lab',
      startsAt: new Date(day1.getTime() + 7 * H),
      endsAt: new Date(day1.getTime() + 8 * H),
      capacity: 2,
    },
    ctx,
    ports,
  );
  return NextResponse.json({ slug: ev.slug, path: `/o/${slug}/e/${ev.slug}`, people: out });
}
