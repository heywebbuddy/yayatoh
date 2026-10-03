import { createCheckpointCommand, sessionAttendanceQuery } from '@yayatoh/checkin';
import { createEventCommand, transitionEventCommand } from '@yayatoh/events';
import { createCtx, executeCommand, executeQuery } from '@yayatoh/kernel';
import { orderByManageToken } from '@yayatoh/orders';
import { createRoomCommand, createSessionCommand, setSessionAgendaCommand } from '@yayatoh/program';
import {
  enrollSessionCommand,
  myScheduleQuery,
  registrationSetupQuery,
  seedRegistrationDefaultsCommand,
  setCellCommand,
  setItemSessionsCommand,
  startRegistrationCommand,
} from '@yayatoh/registration';
import { resolveOrgSlug } from '@yayatoh/tenancy';
import { type NextRequest, NextResponse } from 'next/server';
import { ports } from '@/server/ports.ts';
import { devAuthEnabled } from '@/server/session.ts';

const MIN = 60_000;

/**
 * Dev/CI only (M5.6a e2e): a published conference happening now with free registration (full
 * pass and day pass), three sessions under way — "Small room talk" (included, a room for one),
 * "Hands-on workshop" (optional with places: enrollment needed) and "Members briefing" (included,
 * but the day pass gives only the talk) — and four registrants: Ana (full pass, enrolled in the
 * workshop), Ben and Cleo (full pass) and Dev (day pass). With `doors=1` it also adds a door per
 * session and a flyer door for the talk. Returns the console path, each registrant's ticket code
 * and the flyer token. 404 unless dev auth is on; never in production.
 */
export async function POST(req: NextRequest) {
  if (!devAuthEnabled()) return new NextResponse(null, { status: 404 });
  const form = await req.formData();
  const slug = String(form.get('org') ?? '');
  const org = /^[a-z0-9-]{1,63}$/.test(slug) ? await resolveOrgSlug(slug) : null;
  if (!org) return NextResponse.json({ error: 'unknown_org' }, { status: 404 });
  const name = String(form.get('name') ?? 'Session Summit').slice(0, 80);
  const doors = form.get('doors') === '1';
  const ctx = createCtx({ orgId: org.orgId, actor: { type: 'system', name: 'dev.session-checkin' } });
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
  const session = async (
    title: string,
    room: { name: string; capacity: number },
    admission: 'included' | 'optional',
    capacity: number | null,
  ) => {
    const r = await executeCommand(createRoomCommand, { eventId: ev.id, ...room }, ctx, ports);
    const res = await executeCommand(
      createSessionCommand,
      {
        eventId: ev.id,
        title,
        startsAt: new Date(now - 20 * MIN),
        endsAt: new Date(now + 100 * MIN),
        capacity,
        roomId: r.id,
      },
      ctx,
      ports,
    );
    await executeCommand(
      setSessionAgendaCommand,
      { eventId: ev.id, sessionId: res.session.id, admission, groupId: null },
      ctx,
      ports,
    );
    return res.session;
  };
  const talk = await session('Small room talk', { name: 'Room S', capacity: 1 }, 'included', null);
  const workshop = await session('Hands-on workshop', { name: 'Lab', capacity: 20 }, 'optional', 5);
  const briefing = await session('Members briefing', { name: 'Hall B', capacity: 50 }, 'included', null);
  // The day pass gives the talk only.
  await executeCommand(
    setItemSessionsCommand,
    { eventId: ev.id, admissionItemId: item('day_pass'), sessionIds: [talk.id] },
    ctx,
    ports,
  );
  const people: { name: string; code: string }[] = [];
  for (const [who, pass] of [
    ['Ana', 'full_pass'],
    ['Ben', 'full_pass'],
    ['Cleo', 'full_pass'],
    ['Dev', 'day_pass'],
  ] as const) {
    const email = `${who.toLowerCase()}.${now.toString(36)}${Math.random().toString(36).slice(2, 8)}@example.test`;
    const anon = createCtx({ orgId: org.orgId });
    const r = await executeCommand(
      startRegistrationCommand,
      { eventId: ev.id, registrationTypeId: member, itemIds: [item(pass)], buyer: { email, name: who } },
      anon,
      ports,
    );
    const order = await orderByManageToken(r.manageToken);
    people.push({ name: who, code: order?.tickets[0]?.shortCode ?? '' });
    if (who === 'Ana') {
      const mine = await executeQuery(
        myScheduleQuery,
        { token: r.manageToken, registrantId: null },
        anon,
        ports,
      );
      if (mine.registrantId)
        await executeCommand(
          enrollSessionCommand,
          { token: r.manageToken, registrantId: mine.registrantId, sessionId: workshop.id, choice: 'refuse' },
          anon,
          ports,
        );
    }
  }
  let flyerToken: string | null = null;
  if (doors) {
    for (const [doorName, sessionId, selfCheckin] of [
      ['Talk door', talk.id, false],
      ['Workshop door', workshop.id, false],
      ['Briefing door', briefing.id, false],
      ['Talk flyer', talk.id, true],
    ] as const)
      await executeCommand(
        createCheckpointCommand,
        { eventId: ev.id, name: doorName, kind: 'session', sessionId, selfCheckin },
        ctx,
        ports,
      );
    const listed = await executeQuery(sessionAttendanceQuery, { eventId: ev.id }, ctx, ports);
    flyerToken = listed.find((d) => d.name === 'Talk flyer')?.selfCheckinToken ?? null;
  }
  return NextResponse.json({ slug: ev.slug, path: `/o/${slug}/e/${ev.slug}`, people, flyerToken });
}
