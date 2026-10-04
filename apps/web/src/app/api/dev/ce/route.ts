import { createCheckpointCommand, scanTicketCommand } from '@yayatoh/checkin';
import { createEventCommand, setEventDetailsCommand, transitionEventCommand } from '@yayatoh/events';
import { createCtx, executeCommand, executeQuery } from '@yayatoh/kernel';
import { orderByManageToken } from '@yayatoh/orders';
import { createSessionCommand, setSessionAgendaCommand } from '@yayatoh/program';
import {
  registrationSetupQuery,
  seedRegistrationDefaultsCommand,
  setCellCommand,
  startRegistrationCommand,
} from '@yayatoh/registration';
import { resolveOrgSlug } from '@yayatoh/tenancy';
import {
  createStreamCommand,
  heartbeatCommand,
  setTicketAccessCommand,
  startPlaybackCommand,
  virtualTicketToken,
} from '@yayatoh/virtual';
import { type NextRequest, NextResponse } from 'next/server';
import { ports } from '@/server/ports.ts';
import { devAuthEnabled } from '@/server/session.ts';

const MIN = 60_000;
const H = 60 * MIN;

/**
 * Dev/CI only (M6.9b e2e): a published hybrid conference that started five hours ago, with two
 * sessions already over ("Morning keynote" −4 h → −3 h, "Clinical update" −2 h → −1 h) and two
 * registrants on a pass with in-person and online access. Attendance is recorded through the
 * real commands at those past times: Ana was scanned into the keynote's door for 50 minutes and
 * watched the clinical update online for 15 minutes; Ben was in the keynote for 20 minutes. The
 * test sets the CE rules and calculates through the console. Returns the console path and each
 * person's order manage token and email. 404 unless dev auth is on; never in production.
 */
export async function POST(req: NextRequest) {
  if (!devAuthEnabled()) return new NextResponse(null, { status: 404 });
  const form = await req.formData();
  const slug = String(form.get('org') ?? '');
  const org = /^[a-z0-9-]{1,63}$/.test(slug) ? await resolveOrgSlug(slug) : null;
  if (!org) return NextResponse.json({ error: 'unknown_org' }, { status: 404 });
  const name = String(form.get('name') ?? 'CE Summit').slice(0, 80);
  // Whole minutes, so the minutes a test sees are exact (a visit counts every minute it touches).
  const now = Math.floor(Date.now() / MIN) * MIN;
  const at = (ms: number) => new Date(now + ms);
  const ctx = (when?: Date) =>
    createCtx({
      orgId: org.orgId,
      actor: { type: 'system', name: 'dev.ce' },
      ...(when ? { now: when } : {}),
    });
  const ev = await executeCommand(
    createEventCommand,
    { name, profile: 'conference', timezone: 'America/Chicago', startsAt: at(-5 * H), endsAt: at(3 * H) },
    ctx(),
    ports,
  );
  await executeCommand(seedRegistrationDefaultsCommand, { eventId: ev.id, names: {} }, ctx(), ports);
  const setup = await executeQuery(registrationSetupQuery, { eventId: ev.id }, ctx(), ports);
  const member = setup.types.find((t) => t.key === 'member')?.id as string;
  const fullPass = setup.items.find((i) => i.key === 'full_pass')?.id as string;
  await executeCommand(
    setCellCommand,
    { eventId: ev.id, registrationTypeId: member, admissionItemId: fullPass, priceMinor: 0 },
    ctx(),
    ports,
  );
  await executeCommand(transitionEventCommand, { eventId: ev.id, transition: 'publish' }, ctx(), ports);
  await executeCommand(setEventDetailsCommand, { eventId: ev.id, attendanceMode: 'hybrid' }, ctx(), ports);
  const sessions: { id: string; title: string }[] = [];
  for (const [title, from] of [
    ['Morning keynote', -4 * H],
    ['Clinical update', -2 * H],
  ] as const) {
    const r = await executeCommand(
      createSessionCommand,
      { eventId: ev.id, title, startsAt: at(from), endsAt: at(from + H), capacity: null },
      ctx(),
      ports,
    );
    await executeCommand(
      setSessionAgendaCommand,
      { eventId: ev.id, sessionId: r.session.id, admission: 'included', groupId: null },
      ctx(),
      ports,
    );
    sessions.push({ id: r.session.id, title });
  }
  const keynote = sessions[0] as { id: string };
  const clinical = sessions[1] as { id: string };
  const people: { name: string; email: string; token: string; ticketId: string; code: string }[] = [];
  for (const who of ['Ana', 'Ben']) {
    const email = `${who.toLowerCase()}.${now.toString(36)}${Math.random().toString(36).slice(2, 8)}@example.test`;
    const r = await executeCommand(
      startRegistrationCommand,
      {
        eventId: ev.id,
        registrationTypeId: member,
        itemIds: [fullPass],
        buyer: { email, name: `${who} Lovelace` },
      },
      createCtx({ orgId: org.orgId, now: at(-6 * H) }),
      ports,
    );
    const order = await orderByManageToken(r.manageToken);
    const tk = order?.tickets[0];
    if (!tk) return NextResponse.json({ error: 'no_ticket' }, { status: 500 });
    people.push({ name: `${who} Lovelace`, email, token: r.manageToken, ticketId: tk.id, code: tk.code });
    if (who === 'Ana')
      await executeCommand(
        setTicketAccessCommand,
        { eventId: ev.id, ticketTypeId: tk.ticketTypeId, access: 'both' },
        ctx(),
        ports,
      );
  }
  const ana = people[0] as (typeof people)[number];
  const ben = people[1] as (typeof people)[number];
  const door = await executeCommand(
    createCheckpointCommand,
    {
      eventId: ev.id,
      name: 'Keynote door',
      kind: 'session',
      sessionId: keynote.id,
      capacity: null,
      selfCheckin: false,
    },
    ctx(),
    ports,
  );
  const scan = (code: string, when: number, direction: 'in' | 'out') =>
    executeCommand(
      scanTicketCommand,
      { eventId: ev.id, code, checkpointId: door.id, direction },
      ctx(at(when)),
      ports,
    );
  await scan(ana.code, -4 * H + 30_000, 'in');
  await scan(ana.code, -4 * H + 50 * MIN, 'out');
  await scan(ben.code, -4 * H + 10 * MIN, 'in');
  await scan(ben.code, -4 * H + 30 * MIN, 'out');
  // Ana watches the clinical update online from 20 to 35 minutes in (a heartbeat each minute).
  await executeCommand(createStreamCommand, { eventId: ev.id, sessionId: clinical.id }, ctx(), ports);
  let token = '';
  for (let i = 0; i < 15; i++) {
    const when = at(-2 * H + (20 + i) * MIN + 10_000);
    if (i % 8 === 0)
      token = (
        await executeCommand(
          startPlaybackCommand,
          { eventId: ev.id, sessionId: clinical.id, ticketToken: virtualTicketToken(ana.ticketId) },
          createCtx({ orgId: org.orgId, now: new Date(when.getTime() - 1000) }),
          ports,
        )
      ).token;
    await executeCommand(
      heartbeatCommand,
      { token, seq: (i % 8) + 1 },
      createCtx({ orgId: org.orgId, now: when }),
      ports,
    );
  }
  return NextResponse.json({
    slug: ev.slug,
    eventId: ev.id,
    orgId: org.orgId,
    path: `/o/${slug}/e/${ev.slug}`,
    sessions,
    people: people.map((p) => ({ name: p.name, email: p.email, token: p.token })),
  });
}
