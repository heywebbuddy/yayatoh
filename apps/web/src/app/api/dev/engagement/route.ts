import { createPollCommand, enableLiveCommand, openPollCommand } from '@yayatoh/engagement';
import { createEventCommand, transitionEventCommand } from '@yayatoh/events';
import { createCtx, executeCommand, executeQuery } from '@yayatoh/kernel';
import { createSessionCommand } from '@yayatoh/program';
import {
  registrationSetupQuery,
  seedRegistrationDefaultsCommand,
  setCellCommand,
  startRegistrationCommand,
} from '@yayatoh/registration';
import { createSurveyCommand } from '@yayatoh/surveys';
import { resolveOrgSlug } from '@yayatoh/tenancy';
import { type NextRequest, NextResponse } from 'next/server';
import { ports } from '@/server/ports.ts';
import { devAuthEnabled } from '@/server/session.ts';

const H = 3_600_000;

/**
 * Dev/CI only (M5.7b e2e): a published conference running now (it started yesterday) whose session
 * "Closing panel" ended an hour ago, with live polls on and one open poll, a session feedback
 * survey with a rating question, and a free registration for `email` (the e2e's signed-in
 * account; registered as if a week ago). Everything the tests then do goes through the real pages.
 * 404 unless dev auth is on; never in production.
 */
export async function POST(req: NextRequest) {
  if (!devAuthEnabled()) return new NextResponse(null, { status: 404 });
  const form = await req.formData();
  const slug = String(form.get('org') ?? '');
  const org = /^[a-z0-9-]{1,63}$/.test(slug) ? await resolveOrgSlug(slug) : null;
  if (!org) return NextResponse.json({ error: 'unknown_org' }, { status: 404 });
  const name = String(form.get('name') ?? 'Engagement Summit').slice(0, 80);
  const email = String(form.get('email') ?? '').slice(0, 200);
  const ctx = createCtx({ orgId: org.orgId, actor: { type: 'system', name: 'dev.engagement' } });
  const now = Date.now();
  const startsAt = new Date(now - 24 * H);
  const ev = await executeCommand(
    createEventCommand,
    { name, profile: 'conference', timezone: 'America/Chicago', startsAt, endsAt: new Date(now + 24 * H) },
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
  const { session } = await executeCommand(
    createSessionCommand,
    { eventId: ev.id, title: 'Closing panel', startsAt: new Date(now - 3 * H), endsAt: new Date(now - H) },
    ctx,
    ports,
  );
  await executeCommand(enableLiveCommand, { eventId: ev.id, sessionId: session.id }, ctx, ports);
  const poll = await executeCommand(
    createPollCommand,
    {
      eventId: ev.id,
      sessionId: session.id,
      kind: 'single',
      question: 'Was the panel useful?',
      options: ['Yes', 'No'],
    },
    ctx,
    ports,
  );
  await executeCommand(openPollCommand, { eventId: ev.id, pollId: poll.id }, ctx, ports);
  await executeCommand(
    createSurveyCommand,
    {
      eventId: ev.id,
      kind: 'session_feedback',
      sessionId: session.id,
      title: 'How was the closing panel?',
      definition: { fields: [{ key: 'stars', type: 'rating', label: 'Your rating', required: true }] },
    },
    ctx,
    ports,
  );
  if (email)
    await executeCommand(
      startRegistrationCommand,
      {
        eventId: ev.id,
        registrationTypeId: member,
        itemIds: [fullPass],
        buyer: { email, name: 'Engaged Attendee' },
      },
      createCtx({ orgId: org.orgId, now: new Date(startsAt.getTime() - 7 * 24 * H) }),
      ports,
    );
  return NextResponse.json({
    slug: ev.slug,
    path: `/o/${slug}/e/${ev.slug}`,
    participant: `/events/${ev.slug}/live/${session.id}`,
  });
}
