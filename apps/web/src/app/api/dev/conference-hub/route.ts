import { enableLiveCommand, updateNetworkSettingsCommand } from '@yayatoh/engagement';
import { createEventCommand, transitionEventCommand } from '@yayatoh/events';
import { createCtx, executeCommand, executeQuery } from '@yayatoh/kernel';
import { createSessionCommand, setSessionAgendaCommand, updateSessionCommand } from '@yayatoh/program';
import {
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
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Dev/CI only (M5.10a e2e): a published conference happening now (it started an hour ago), with
 * free registration and these sessions (times from now, whole minutes): "Opening keynote" on now
 * (included, polls and Q&A on), "Morning panel" and "Parallel talk" overlapping next (included),
 * "Data workshop" later (optional, 10 places) and "Closing remarks" tomorrow; networking on.
 * `empty=1` makes the same conference with no sessions. Returns each registrant's manage token,
 * the event slug and the session ids. `action=move` moves a session by `minutes` (the organizer's
 * edit, for the calendar feed test). Everything the tests then do goes through the real pages.
 * 404 unless dev auth is on; never in production.
 */
export async function POST(req: NextRequest) {
  if (!devAuthEnabled()) return new NextResponse(null, { status: 404 });
  const form = await req.formData();
  const slug = String(form.get('org') ?? '');
  const org = /^[a-z0-9-]{1,63}$/.test(slug) ? await resolveOrgSlug(slug) : null;
  if (!org) return NextResponse.json({ error: 'unknown_org' }, { status: 404 });
  const ctx = createCtx({ orgId: org.orgId, actor: { type: 'system', name: 'dev.conference-hub' } });

  if (form.get('action') === 'move') {
    const eventId = String(form.get('eventId') ?? '');
    const sessionId = String(form.get('sessionId') ?? '');
    if (!UUID.test(eventId) || !UUID.test(sessionId))
      return NextResponse.json({ error: 'bad' }, { status: 400 });
    const by = Number(form.get('minutes') ?? 60) * 60_000;
    const startsAt = new Date(String(form.get('startsAt')));
    const endsAt = new Date(String(form.get('endsAt')));
    await executeCommand(
      updateSessionCommand,
      {
        eventId,
        sessionId,
        title: String(form.get('title') ?? 'Session'),
        startsAt: new Date(startsAt.getTime() + by),
        endsAt: new Date(endsAt.getTime() + by),
        capacity: null,
      },
      ctx,
      ports,
    );
    return NextResponse.json({ ok: true });
  }

  const name = String(form.get('name') ?? 'Hub Summit').slice(0, 80);
  const people = Math.min(3, Math.max(1, Number(form.get('people') ?? 1) || 1));
  const now = Math.floor(Date.now() / 60_000) * 60_000;
  const ev = await executeCommand(
    createEventCommand,
    {
      name,
      profile: 'conference',
      timezone: 'Europe/Berlin',
      startsAt: new Date(now - H),
      endsAt: new Date(now + 40 * H),
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
  const sessions: Record<string, { id: string; startsAt: string; endsAt: string }> = {};
  if (form.get('empty') !== '1') {
    const session = async (
      title: string,
      fromH: number,
      lenH: number,
      admission: 'included' | 'optional' = 'included',
      capacity: number | null = null,
    ) => {
      const startsAt = new Date(now + fromH * H);
      const endsAt = new Date(now + (fromH + lenH) * H);
      const res = await executeCommand(
        createSessionCommand,
        { eventId: ev.id, title, startsAt, endsAt, capacity },
        ctx,
        ports,
      );
      await executeCommand(
        setSessionAgendaCommand,
        { eventId: ev.id, sessionId: res.session.id, admission, groupId: null },
        ctx,
        ports,
      );
      sessions[title] = {
        id: res.session.id,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
      };
      return res.session;
    };
    const keynote = await session('Opening keynote', -0.5, 1.5);
    await session('Morning panel', 2, 1);
    await session('Parallel talk', 2.5, 1);
    await session('Data workshop', 5, 1, 'optional', 10);
    await session('Closing remarks', 26, 1);
    await executeCommand(enableLiveCommand, { eventId: ev.id, sessionId: keynote.id }, ctx, ports);
  }
  await executeCommand(
    updateNetworkSettingsCommand,
    { eventId: ev.id, enabled: true, meetingsEnabled: false },
    ctx,
    ports,
  );
  const out: { token: string; name: string }[] = [];
  for (let i = 0; i < people; i++) {
    const email = `hub.${i}.${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}@example.test`;
    const r = await executeCommand(
      startRegistrationCommand,
      {
        eventId: ev.id,
        registrationTypeId: member,
        itemIds: [fullPass],
        buyer: { email, name: `Hub Attendee ${i + 1}` },
      },
      createCtx({ orgId: org.orgId }),
      ports,
    );
    out.push({ token: r.manageToken, name: `Hub Attendee ${i + 1}` });
  }
  return NextResponse.json({ eventId: ev.id, slug: ev.slug, sessions, people: out });
}
