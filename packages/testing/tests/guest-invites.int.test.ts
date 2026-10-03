import {
  journeySubscribers,
  listJourneysQuery,
  partyRemindersQuery,
  type RunnerDeps,
  rsvpRemindersQuery,
  runDueActions,
  setRsvpRemindersCommand,
} from '@yayatoh/automations';
import { withTenant } from '@yayatoh/db';
import { type AdminSql, adminClient, closePools } from '@yayatoh/db/testing';
import { createEventCommand, type EventDto } from '@yayatoh/events';
import {
  addPartyGuestCommand,
  approveSubmissionCommand,
  collectorMergePreviewQuery,
  collectorQueueQuery,
  collectorSettingsQuery,
  collectorTarget,
  createPartyCommand,
  createSubEventCommand,
  guestListQuery,
  invitationMailer,
  invitationPreviewQuery,
  invitationTemplatesQuery,
  markRsvpViewedCommand,
  mergeSubmissionCommand,
  partyContactQuery,
  partyHistoryQuery,
  partyInviteMessagesQuery,
  partyInvitesQuery,
  partyRsvpQuery,
  publicCollectorQuery,
  rejectSubmissionCommand,
  resetInvitationTemplateCommand,
  rsvpOverviewQuery,
  sendInvitationsCommand,
  sendTestInvitationCommand,
  setCollectorCommand,
  setInvitationTemplateCommand,
  setPartyContactCommand,
  setPartyLocaleCommand,
  setRsvpSettingsCommand,
  submitContactCommand,
  submitRsvpCommand,
} from '@yayatoh/guests';
import { type Ctx, createCtx, executeCommand, executeQuery, isDomainError, uuidv7 } from '@yayatoh/kernel';
import {
  createNotifier,
  type DeliveryEvent,
  dispatchDue,
  recordDeliveryEventsCommand,
} from '@yayatoh/notifications';
import { memoryTransports } from '@yayatoh/notifications/testing';
import { consumeEvent, recentEventsTx, subscribes } from '@yayatoh/platform';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, systemCtx, twoOrgs, userCtx } from '../src/index.ts';

/**
 * M4.1f: the contact collector (nothing changes a party without the host's approval; sealed
 * submissions; approve into a new party, merge field by field, reject), invitations by email and
 * text (sent → viewed, bounces on the party, test sends, wording per language), and RSVP deadline
 * reminders on the journey engine (they stop once a party answers, with time travel; quiet hours
 * in the event's timezone). Permissions and tenant isolation.
 */

const ORIGIN = 'https://app.yayatoh.test';
const notifier = createNotifier();
const deps: RunnerDeps = { notifier, appOrigin: ORIGIN };
let admin: AdminSql;
let a: OrgFixture;
let b: OrgFixture;

beforeAll(async () => {
  admin = adminClient();
  ({ a, b } = await twoOrgs());
});
afterAll(async () => {
  await admin.end();
  await closePools();
});

const guestCtx = (orgId: string, extra: Partial<Ctx> = {}) => createCtx({ orgId, ...extra });
const viewerOf = (f: OrgFixture) => userCtx(f.viewerId, f.org.id);

async function refused(p: Promise<unknown>, code: string, reason?: string) {
  try {
    await p;
  } catch (err) {
    expect(isDomainError(err)).toBe(true);
    if (isDomainError(err)) {
      expect(err.code).toBe(code);
      if (reason) expect(err.details?.reason).toBe(reason);
    }
    return;
  }
  throw new Error(`expected ${code}`);
}

/** The guests mailer and the journey hooks, over this org's recent outbox events. */
async function relay(orgId: string) {
  const subs = [invitationMailer({ notifier, appOrigin: ORIGIN }), ...journeySubscribers()];
  const types = [...new Set(subs.flatMap((s) => s.events.map((e) => e.split('@')[0] as string)))];
  const events = await withTenant(systemCtx(orgId), (tx) => recentEventsTx(tx, orgId, types, 3_600_000));
  for (const e of events) for (const s of subs) if (subscribes(s, e)) await consumeEvent(s, e);
}

/** A Chicago wedding in 2030 (deadline May 1, 23:00 local) with a ceremony everyone attends. */
async function wedding(f: OrgFixture, name: string) {
  const ev: EventDto = await executeCommand(
    createEventCommand,
    {
      name: `${name} ${uuidv7().slice(-6)}`,
      profile: 'wedding',
      timezone: 'America/Chicago',
      startsAt: '2030-06-01T20:00:00Z',
      endsAt: '2030-06-02T04:00:00Z',
    },
    f.ctx(),
    ports,
  );
  await executeCommand(
    createSubEventCommand,
    {
      eventId: ev.id,
      name: 'Ceremony',
      kind: 'ceremony',
      startsAt: '2030-06-01T20:00:00Z',
      endsAt: '2030-06-01T21:00:00Z',
      inviteAll: true,
    },
    f.ctx(),
    ports,
  );
  return ev;
}

async function party(f: OrgFixture, eventId: string, name: string, people: string[], contact = {}) {
  const p = await executeCommand(createPartyCommand, { eventId, name }, f.ctx(), ports);
  for (const n of people) {
    const [firstName, lastName] = n.split(' ');
    await executeCommand(
      addPartyGuestCommand,
      { eventId, partyId: p.id, firstName, lastName },
      f.ctx(),
      ports,
    );
  }
  if (Object.keys(contact).length)
    await executeCommand(setPartyContactCommand, { eventId, partyId: p.id, ...contact }, f.ctx(), ports);
  return p;
}

const partyCount = async (f: OrgFixture, eventId: string) =>
  (await executeQuery(guestListQuery, { eventId, limit: 1 }, f.ctx(), ports)).counts.parties;

describe('contact collector', () => {
  it('is off until switched on; its address finds the event only while on', async () => {
    const ev = await wedding(a, 'Collector');
    expect((await executeQuery(collectorSettingsQuery, { eventId: ev.id }, a.ctx(), ports)).enabled).toBe(
      false,
    );
    const on = await executeCommand(setCollectorCommand, { eventId: ev.id, enabled: true }, a.ctx(), ports);
    expect(on.code).toMatch(/^[0-9A-Z]{8}$/);
    expect(await collectorTarget((on.code as string).toLowerCase())).toEqual({
      orgId: a.org.id,
      eventId: ev.id,
    });
    const view = await executeQuery(publicCollectorQuery, { eventId: ev.id }, guestCtx(a.org.id), ports);
    expect(view.eventName).toBe(ev.name);
    await executeCommand(setCollectorCommand, { eventId: ev.id, enabled: false }, a.ctx(), ports);
    expect(await collectorTarget(on.code as string)).toBeNull();
    await refused(
      executeCommand(
        submitContactCommand,
        { eventId: ev.id, household: 'Late', members: [{ firstName: 'Lia' }], email: 'lia@example.test' },
        guestCtx(a.org.id),
        ports,
      ),
      'not_found',
      'collector_off',
    );
    expect(await collectorTarget('ZZZZZZZZ')).toBeNull();
    expect(await collectorTarget('bad')).toBeNull();
  });

  it('a submission never changes a party without approval; it is sealed and validated', async () => {
    const ev = await wedding(a, 'Sealed');
    await executeCommand(setCollectorCommand, { eventId: ev.id, enabled: true }, a.ctx(), ports);
    const before = await partyCount(a, ev.id);
    const submit = (input: object) =>
      executeCommand(submitContactCommand, { eventId: ev.id, ...input }, guestCtx(a.org.id), ports);
    await refused(
      submit({ household: 'Nobody', members: [{ firstName: 'Ned' }] }),
      'validation_failed',
      'contact_required',
    );
    await refused(
      submit({ household: 'Bad', members: [{ firstName: 'Bo' }], email: 'not-an-email' }),
      'validation_failed',
      'invalid_email',
    );
    await refused(
      submit({ household: 'Bad', members: [{ firstName: 'Bo' }], phone: 'call me' }),
      'validation_failed',
      'invalid_phone',
    );
    await refused(
      submit({ household: '', members: [{ firstName: 'Bo' }], email: 'a@example.test' }),
      'validation_failed',
    );
    await refused(submit({ household: 'Empty', members: [], email: 'a@example.test' }), 'validation_failed');
    await submit({
      household: 'The Ortizes',
      members: [
        { firstName: 'Elena', lastName: 'Ortiz' },
        { firstName: 'Tomás', lastName: 'Ortiz' },
      ],
      address: '7 Secret Lane, Springfield',
      email: 'elena.ortiz@example.test',
      phone: '+1 (312) 555-0142',
      locale: 'es',
    });
    // Nothing reached the guest list.
    expect(await partyCount(a, ev.id)).toBe(before);
    // Sealed at rest: no plaintext name, address, email or phone in the row.
    const raw = await admin<{ row: string }[]>`
      select row_to_json(s)::text as row from guests.collector_submissions s where event_id = ${ev.id}`;
    expect(raw).toHaveLength(1);
    for (const secret of ['Ortiz', 'Secret Lane', 'elena.ortiz', '555-0142', '3125550142'])
      expect(raw[0]?.row).not.toContain(secret);
    const q = await executeQuery(collectorQueueQuery, { eventId: ev.id }, a.ctx(), ports);
    expect(q.pending).toHaveLength(1);
    expect(q.pending[0]).toMatchObject({
      household: 'The Ortizes',
      email: 'elena.ortiz@example.test',
      phone: '+13125550142',
      locale: 'es',
      status: 'pending',
    });
    // The audit row has counts only.
    const audit = await admin<{ data: string }[]>`
      select data::text from platform.audit_events where org_id = ${a.org.id} and action = 'guests.collector.submit'
      order by seq desc limit 1`;
    expect(audit[0]?.data).not.toContain('Ortiz');
  });

  it('approve into a new party: guests, sealed contact on the primary, language, history; payload cleared', async () => {
    const ev = await wedding(a, 'Approve');
    await executeCommand(setCollectorCommand, { eventId: ev.id, enabled: true }, a.ctx(), ports);
    await executeCommand(
      submitContactCommand,
      {
        eventId: ev.id,
        household: 'The Nguyens',
        members: [
          { firstName: 'Linh', lastName: 'Nguyen' },
          { firstName: 'Bao', lastName: 'Nguyen' },
        ],
        address: '1 River Rd',
        email: 'linh@example.test',
        locale: 'fr',
      },
      guestCtx(a.org.id),
      ports,
    );
    const [s] = (await executeQuery(collectorQueueQuery, { eventId: ev.id }, a.ctx(), ports)).pending;
    if (!s) throw new Error('no submission');
    // A viewer can read the queue but not decide.
    await executeQuery(collectorQueueQuery, { eventId: ev.id }, viewerOf(a), ports);
    await refused(
      executeCommand(approveSubmissionCommand, { eventId: ev.id, submissionId: s.id }, viewerOf(a), ports),
      'forbidden',
    );
    const { partyId } = await executeCommand(
      approveSubmissionCommand,
      { eventId: ev.id, submissionId: s.id },
      a.ctx(),
      ports,
    );
    const list = await executeQuery(guestListQuery, { eventId: ev.id }, a.ctx(), ports);
    const p = list.parties.find((x) => x.id === partyId);
    expect(p).toMatchObject({ name: 'The Nguyens', source: 'collector' });
    expect(p?.guests.map((g) => [g.firstName, g.isPrimary])).toEqual([
      ['Linh', true],
      ['Bao', false],
    ]);
    expect(p?.guests[0]).toMatchObject({ address: '1 River Rd', email: 'linh@example.test' });
    const invites = await executeQuery(
      partyInvitesQuery,
      { eventId: ev.id, partyIds: [partyId] },
      a.ctx(),
      ports,
    );
    expect(invites[0]).toMatchObject({ locale: 'fr', hasEmail: true, hasPhone: false });
    const history = await executeQuery(partyHistoryQuery, { eventId: ev.id, partyId }, a.ctx(), ports);
    expect(history.map((h) => [h.action, h.source])).toEqual(
      expect.arrayContaining([
        ['party_created', 'collector'],
        ['guest_added', 'collector'],
        ['collector_approved', 'collector'],
      ]),
    );
    const q = await executeQuery(collectorQueueQuery, { eventId: ev.id }, a.ctx(), ports);
    expect(q.pending).toHaveLength(0);
    expect(q.decided[0]).toMatchObject({ status: 'approved', partyId, household: null, email: null });
    // Decided once: a second decision is refused.
    await refused(
      executeCommand(rejectSubmissionCommand, { eventId: ev.id, submissionId: s.id }, a.ctx(), ports),
      'invalid_state',
      'already_decided',
    );
  });

  it('merge field by field: keep or use each value, add only new people; reject deletes the payload', async () => {
    const ev = await wedding(a, 'Merge');
    await executeCommand(setCollectorCommand, { eventId: ev.id, enabled: true }, a.ctx(), ports);
    const garcia = await party(a, ev.id, 'Garcia', ['Luis López', 'Ana García'], {
      email: 'old@example.test',
    });
    const submit = (household: string, extra: object) =>
      executeCommand(
        submitContactCommand,
        { eventId: ev.id, household, ...extra },
        guestCtx(a.org.id),
        ports,
      );
    await submit('Garcia family', {
      members: [
        { firstName: 'luis', lastName: 'lópez' },
        { firstName: 'Sofía', lastName: 'García' },
      ],
      address: '9 Elm St',
      email: 'new@example.test',
      phone: '+13125550199',
    });
    await submit('Spammy', { members: [{ firstName: 'Buy' }], email: 'spam@example.test' });
    const q = await executeQuery(collectorQueueQuery, { eventId: ev.id }, a.ctx(), ports);
    const real = q.pending.find((s) => s.household === 'Garcia family');
    const spam = q.pending.find((s) => s.household === 'Spammy');
    if (!real || !spam) throw new Error('missing');
    const preview = await executeQuery(
      collectorMergePreviewQuery,
      { eventId: ev.id, submissionId: real.id, partyId: garcia.id },
      a.ctx(),
      ports,
    );
    expect(preview.current).toEqual({ address: null, email: 'old@example.test', phone: null });
    // Luis is already in the party (case aside); only Sofía is new.
    expect(preview.newMembers).toEqual([1]);
    await refused(
      executeCommand(
        mergeSubmissionCommand,
        { eventId: ev.id, submissionId: real.id, partyId: garcia.id, addMembers: [0] },
        a.ctx(),
        ports,
      ),
      'validation_failed',
      'unknown_member',
    );
    const r = await executeCommand(
      mergeSubmissionCommand,
      {
        eventId: ev.id,
        submissionId: real.id,
        partyId: garcia.id,
        fields: { address: 'use', email: 'keep', phone: 'use' },
        addMembers: [1],
      },
      a.ctx(),
      ports,
    );
    expect(r).toEqual({ partyId: garcia.id, changed: ['address', 'phone'], added: 1 });
    const contact = await executeQuery(
      partyContactQuery,
      { eventId: ev.id, partyId: garcia.id },
      a.ctx(),
      ports,
    );
    expect(contact).toMatchObject({ email: 'old@example.test', phone: '+13125550199' });
    const list = await executeQuery(guestListQuery, { eventId: ev.id }, a.ctx(), ports);
    const g = list.parties.find((p) => p.id === garcia.id);
    expect(g?.name).toBe('Garcia');
    expect(g?.guests.map((x) => x.firstName)).toEqual(['Luis', 'Ana', 'Sofía']);
    expect(g?.guests[0]?.address).toBe('9 Elm St');
    await executeCommand(rejectSubmissionCommand, { eventId: ev.id, submissionId: spam.id }, a.ctx(), ports);
    const after = await executeQuery(collectorQueueQuery, { eventId: ev.id }, a.ctx(), ports);
    expect(after.pending).toHaveLength(0);
    expect(after.decided.map((d) => [d.status, d.household])).toEqual(
      expect.arrayContaining([
        ['merged', null],
        ['rejected', null],
      ]),
    );
    expect(await partyCount(a, ev.id)).toBe(1);
    const [raw] = await admin<{ n: number }[]>`
      select count(*)::int as n from guests.collector_submissions where event_id = ${ev.id} and payload_ciphertext is not null`;
    expect(raw?.n).toBe(0);
  });

  it('tenant isolation: another org can neither read nor decide the queue', async () => {
    const ev = await wedding(a, 'Isolated');
    await executeCommand(setCollectorCommand, { eventId: ev.id, enabled: true }, a.ctx(), ports);
    await executeCommand(
      submitContactCommand,
      { eventId: ev.id, household: 'Private', members: [{ firstName: 'Pia' }], email: 'pia@example.test' },
      guestCtx(a.org.id),
      ports,
    );
    const [s] = (await executeQuery(collectorQueueQuery, { eventId: ev.id }, a.ctx(), ports)).pending;
    if (!s) throw new Error('no submission');
    expect(
      (await executeQuery(collectorQueueQuery, { eventId: ev.id }, b.ctx(), ports)).pending,
    ).toHaveLength(0);
    await refused(
      executeCommand(approveSubmissionCommand, { eventId: ev.id, submissionId: s.id }, b.ctx(), ports),
      'not_found',
    );
    await refused(
      executeCommand(rejectSubmissionCommand, { eventId: ev.id, submissionId: s.id }, b.ctx(), ports),
      'not_found',
    );
    // A guest of org B can't post into org A's event either (the event isn't theirs).
    await refused(
      executeCommand(
        submitContactCommand,
        { eventId: ev.id, household: 'Cross', members: [{ firstName: 'X' }], email: 'x@example.test' },
        guestCtx(b.org.id),
        ports,
      ),
      'not_found',
    );
    // Anonymous visitors can't read the queue.
    await refused(
      executeQuery(collectorQueueQuery, { eventId: ev.id }, guestCtx(a.org.id), ports),
      'forbidden',
    );
  });
});

describe('invitations', () => {
  it('wording per language: built-in until written, preview fills the party, reset goes back', async () => {
    const ev = await wedding(a, 'Wording');
    const p = await party(a, ev.id, 'Chen', ['Mei Chen']);
    const all = await executeQuery(invitationTemplatesQuery, { eventId: ev.id }, a.ctx(), ports);
    expect(all).toHaveLength(13);
    expect(all.every((t) => !t.custom)).toBe(true);
    expect(all.find((t) => t.locale === 'ar')?.subject).toContain('{event}');
    await refused(
      executeCommand(
        setInvitationTemplateCommand,
        { eventId: ev.id, locale: 'es', subject: '', message: 'x', smsText: 'y' },
        a.ctx(),
        ports,
      ),
      'validation_failed',
    );
    await refused(
      executeCommand(
        setInvitationTemplateCommand,
        { eventId: ev.id, locale: 'es', subject: 'S', message: 'M', smsText: 'T' },
        viewerOf(a),
        ports,
      ),
      'forbidden',
    );
    await executeCommand(
      setInvitationTemplateCommand,
      {
        eventId: ev.id,
        locale: 'es',
        subject: '¡Boda! {event}',
        message: 'Hola {party}',
        smsText: '{party}:',
      },
      a.ctx(),
      ports,
    );
    const preview = await executeQuery(
      invitationPreviewQuery,
      { eventId: ev.id, locale: 'es', partyId: p.id },
      a.ctx(),
      ports,
    );
    expect(preview).toMatchObject({ subject: `¡Boda! ${ev.name}`, message: 'Hola Chen', smsText: 'Chen:' });
    await executeCommand(resetInvitationTemplateCommand, { eventId: ev.id, locale: 'es' }, a.ctx(), ports);
    const es = (await executeQuery(invitationTemplatesQuery, { eventId: ev.id }, a.ctx(), ports)).find(
      (t) => t.locale === 'es',
    );
    expect(es?.custom).toBe(false);
  });

  it('send: sent with the link on each channel the party has; viewed after opening; a bounce shows on the party', async () => {
    const ev = await wedding(a, 'Send');
    const ana = await party(a, ev.id, 'Ana', ['Ana Ruiz'], {
      email: 'ana@example.test',
      phone: '+13125550101',
    });
    const bounce = await party(a, ev.id, 'Bounce', ['Bo Unce'], { email: `bounce-${uuidv7()}@example.test` });
    const none = await party(a, ev.id, 'Nobody', ['No Body']);
    await executeCommand(
      setPartyLocaleCommand,
      { eventId: ev.id, partyId: ana.id, locale: 'es' },
      a.ctx(),
      ports,
    );
    // Viewers can't send.
    await refused(
      executeCommand(sendInvitationsCommand, { eventId: ev.id, channels: ['email'] }, viewerOf(a), ports),
      'forbidden',
    );
    const r = await executeCommand(
      sendInvitationsCommand,
      { eventId: ev.id, channels: ['email', 'sms'] },
      a.ctx(),
      ports,
    );
    expect(r).toEqual({ sent: 2, noAddress: 1, alreadySent: 0 });
    const ov = await executeQuery(rsvpOverviewQuery, { eventId: ev.id }, a.ctx(), ports);
    const state = (id: string) => ov.parties.find((p) => p.partyId === id)?.state;
    expect([state(ana.id), state(bounce.id), state(none.id)]).toEqual(['sent', 'sent', 'invited']);
    // A second bulk send skips parties already sent.
    expect(
      await executeCommand(sendInvitationsCommand, { eventId: ev.id, channels: ['email'] }, a.ctx(), ports),
    ).toEqual({ sent: 0, noAddress: 1, alreadySent: 2 });

    await relay(a.org.id);
    const mem = memoryTransports();
    await dispatchDue(
      a.org.id,
      { transports: mem.transports, appOrigin: ORIGIN, ignoreQuietHours: true },
      200,
    );
    const mail = mem.emails.find((e) => e.to === 'ana@example.test');
    expect(mail?.subject).toBe(`Estás invitado: ${ev.name}`);
    const link = await executeQuery(partyRsvpQuery, { eventId: ev.id, partyId: ana.id }, a.ctx(), ports);
    expect(mail?.html).toContain(`${ORIGIN}/rsvp/${encodeURIComponent(link.token ?? '')}`);
    const text = mem.sms.find((m) => m.to === '+13125550101');
    expect(text?.body).toContain('Ana, están invitados a');
    expect(text?.body).toContain(`/rsvp/${encodeURIComponent(link.token ?? '')}`);

    // The fake provider reports a hard bounce for the bounce address: it shows on that party.
    const [row] = await admin<{ id: string }[]>`
      select m.id from notifications.messages m
      join guests.invite_messages i on i.dedupe_key = m.dedupe_key and i.channel = m.channel
      where i.party_id = ${bounce.id}`;
    if (!row) throw new Error('no message');
    const evt: DeliveryEvent = {
      id: `evt-${uuidv7()}`,
      type: 'bounced',
      bounceType: 'hard',
      messageId: row.id,
      providerMessageId: null,
      recipient: null,
      detail: '550 5.1.1 user unknown',
      occurredAt: new Date(),
    };
    await executeCommand(
      recordDeliveryEventsCommand,
      { provider: 'fake', events: [evt] },
      systemCtx(a.org.id),
      ports,
    );
    const states = await executeQuery(partyInvitesQuery, { eventId: ev.id }, a.ctx(), ports);
    expect(states.find((s) => s.partyId === bounce.id)).toMatchObject({ problem: true });
    expect(states.find((s) => s.partyId === bounce.id)?.latest[0]).toMatchObject({
      channel: 'email',
      state: 'bounced',
    });
    expect(states.find((s) => s.partyId === ana.id)).toMatchObject({
      problem: false,
      hasEmail: true,
      hasPhone: true,
    });
    expect(states.find((s) => s.partyId === none.id)).toMatchObject({ latest: [], hasEmail: false });
    const log = await executeQuery(
      partyInviteMessagesQuery,
      { eventId: ev.id, partyId: ana.id },
      viewerOf(a),
      ports,
    );
    expect(log.map((m) => [m.kind, m.channel, m.state]).sort()).toEqual([
      ['invitation', 'email', 'sent'],
      ['invitation', 'sms', 'sent'],
    ]);

    // Opening the link: viewed.
    await executeCommand(markRsvpViewedCommand, { token: link.token ?? '' }, guestCtx(a.org.id), ports);
    const ov2 = await executeQuery(rsvpOverviewQuery, { eventId: ev.id }, a.ctx(), ports);
    expect(ov2.parties.find((p) => p.partyId === ana.id)?.state).toBe('viewed');
    // History: sent once, then an invitation per send.
    const h = await executeQuery(partyHistoryQuery, { eventId: ev.id, partyId: ana.id }, a.ctx(), ports);
    expect(h.filter((x) => x.action === 'rsvp_sent')).toHaveLength(1);
    expect(h.find((x) => x.action === 'invitation_sent')?.detail).toEqual({ channels: 'email,sms' });
    // Resend to one party: a new message on its channel.
    expect(
      await executeCommand(
        sendInvitationsCommand,
        { eventId: ev.id, partyIds: [ana.id], channels: ['email'], resend: true },
        a.ctx(),
        ports,
      ),
    ).toEqual({ sent: 1, noAddress: 0, alreadySent: 0 });
  });

  it('a test send goes to the signed-in host only, in the chosen language', async () => {
    const ev = await wedding(a, 'Test send');
    await executeCommand(sendTestInvitationCommand, { eventId: ev.id, locale: 'fr' }, a.ctx(), ports);
    await relay(a.org.id);
    const [m] = await admin<{ recipient_user_id: string; kind: string; locale: string }[]>`
      select m.recipient_user_id, m.kind, m.locale from notifications.messages m
      join guests.invite_messages i on i.dedupe_key = m.dedupe_key
      where i.event_id = ${ev.id} and i.kind = 'test'`;
    expect(m).toMatchObject({ recipient_user_id: a.ownerId, kind: 'guests.invitation', locale: 'fr' });
    await refused(
      executeCommand(sendTestInvitationCommand, { eventId: ev.id, locale: 'fr' }, systemCtx(a.org.id), ports),
      'invalid_state',
      'no_user',
    );
  });

  it('isolation: another org can neither send nor read the invitation state; contact needs E.164 for texts', async () => {
    const ev = await wedding(a, 'Iso send');
    const p = await party(a, ev.id, 'Iso', ['Ivy Iso'], { email: 'ivy@example.test' });
    await refused(
      executeCommand(
        sendInvitationsCommand,
        { eventId: ev.id, partyIds: [p.id], channels: ['email'] },
        b.ctx(),
        ports,
      ),
      'not_found',
    );
    expect(
      await executeQuery(partyInvitesQuery, { eventId: ev.id, partyIds: [p.id] }, b.ctx(), ports),
    ).toEqual([]);
    await refused(
      executeCommand(
        setPartyContactCommand,
        { eventId: ev.id, partyId: p.id, phone: '312 555 0100' },
        a.ctx(),
        ports,
      ),
      'validation_failed',
      'invalid_phone',
    );
    await refused(
      executeCommand(
        setPartyContactCommand,
        { eventId: ev.id, partyId: p.id, email: 'x@example.test' },
        b.ctx(),
        ports,
      ),
      'not_found',
    );
  });
});

describe('RSVP deadline reminders (journey engine)', () => {
  const DEADLINE = new Date('2030-05-02T04:00:00Z'); // May 1, 23:00 in Chicago (CDT)

  async function answer(f: OrgFixture, eventId: string, partyId: string, status: 'attending' | 'declined') {
    const link = await executeQuery(partyRsvpQuery, { eventId, partyId }, f.ctx(), ports);
    const ov = await executeQuery(rsvpOverviewQuery, { eventId, partyIds: [partyId] }, f.ctx(), ports);
    const list = await executeQuery(guestListQuery, { eventId }, f.ctx(), ports);
    const guests = list.parties.find((p) => p.id === partyId)?.guests ?? [];
    const sub = ov.subEvents[0]?.id as string;
    await executeCommand(
      submitRsvpCommand,
      { token: link.token ?? '', answers: guests.map((g) => ({ guestId: g.id, subEventId: sub, status })) },
      guestCtx(f.org.id),
      ports,
    );
  }

  const reminderRows = (eventId: string) =>
    admin<{ party_id: string; status: string; outcome: string | null; scheduled_for: Date }[]>`
      select party_id, status, outcome, scheduled_for from automations.scheduled_actions
      where event_id = ${eventId} order by party_id, scheduled_for`;

  it('needs a deadline; 14 and 3 days before; stop once a party answers (time travel); quiet hours', async () => {
    const ev = await wedding(a, 'Reminders');
    const ana = await party(a, ev.id, 'Ana', ['Ana Ruiz'], { email: `ana-${uuidv7()}@example.test` });
    const ben = await party(a, ev.id, 'Ben', ['Ben Ito'], { email: `ben-${uuidv7()}@example.test` });
    const cy = await party(a, ev.id, 'Cy', ['Cy Lee'], { email: `cy-${uuidv7()}@example.test` });
    await refused(
      executeCommand(setRsvpRemindersCommand, { eventId: ev.id, enabled: true }, a.ctx(), ports),
      'invalid_state',
      'no_deadline',
    );
    await executeCommand(
      setRsvpSettingsCommand,
      { eventId: ev.id, deadline: DEADLINE, nameLookup: true },
      a.ctx(),
      ports,
    );
    await refused(
      executeCommand(setRsvpRemindersCommand, { eventId: ev.id, enabled: true }, viewerOf(a), ports),
      'forbidden',
    );
    // Ana is sent before reminders exist; Ben and Cy after: everyone sent gets enrolled.
    await executeCommand(
      sendInvitationsCommand,
      { eventId: ev.id, partyIds: [ana.id], channels: ['email'] },
      a.ctx(),
      ports,
    );
    const on = await executeCommand(
      setRsvpRemindersCommand,
      { eventId: ev.id, enabled: true, days: [3, 14], channels: ['email'] },
      a.ctx(),
      ports,
    );
    expect(on).toMatchObject({ enabled: true, days: [14, 3], channels: ['email'], hasDeadline: true });
    await executeCommand(
      sendInvitationsCommand,
      { eventId: ev.id, partyIds: [ben.id, cy.id], channels: ['email'] },
      a.ctx(),
      ports,
    );
    await relay(a.org.id);
    let rows = await reminderRows(ev.id);
    expect(rows).toHaveLength(6);
    // 14 and 3 days before the deadline, at its wall-clock time (23:00 Chicago).
    expect([...new Set(rows.map((r) => r.scheduled_for.toISOString()))].sort()).toEqual([
      '2030-04-18T04:00:00.000Z',
      '2030-04-29T04:00:00.000Z',
    ]);
    expect(rows.every((r) => r.status === 'pending')).toBe(true);

    // Day −14 (23:00 local): every party gets its first reminder, held for quiet hours.
    const day14 = new Date('2030-04-18T04:00:30Z');
    await runDueActions(a.org.id, deps, ports, { now: day14 });
    expect((await reminderRows(ev.id)).filter((r) => r.status === 'done')).toHaveLength(3);
    const mem = memoryTransports();
    const held = await dispatchDue(
      a.org.id,
      { transports: mem.transports, appOrigin: ORIGIN, now: () => day14 },
      200,
    );
    expect(held.held).toBeGreaterThanOrEqual(3);
    const waiting = await admin<{ reason: string; send_after: Date }[]>`
      select reason, send_after from notifications.messages where kind = 'guests.rsvp-reminder' and event_id = ${ev.id}`;
    expect(waiting).toHaveLength(3);
    for (const w of waiting) {
      expect(w.reason).toBe('quiet_hours');
      expect(w.send_after.toISOString()).toBe('2030-04-18T13:00:00.000Z'); // 08:00 CDT
    }
    const morning = new Date('2030-04-18T13:00:00Z');
    await dispatchDue(a.org.id, { transports: mem.transports, appOrigin: ORIGIN, now: () => morning }, 200);
    expect(mem.emails.filter((e) => e.subject.startsWith('Reminder: please reply'))).toHaveLength(3);
    const parties = await executeQuery(
      partyRemindersQuery,
      { eventId: ev.id, partyId: ana.id },
      a.ctx(),
      ports,
    );
    expect(parties.map((p) => p.status)).toEqual(['done', 'pending']);

    // Ana answers (the hook cancels her run); Ben answers too but the hook hasn't run yet: the
    // runner checks again when the step is due. Cy never answers.
    await answer(a, ev.id, ana.id, 'attending');
    await relay(a.org.id);
    await answer(a, ev.id, ben.id, 'declined');
    const day3 = new Date('2030-04-29T04:00:30Z');
    await runDueActions(a.org.id, deps, ports, { now: day3 });
    rows = await reminderRows(ev.id);
    const last = (id: string) => rows.filter((r) => r.party_id === id).at(-1);
    expect(last(ana.id)).toMatchObject({ status: 'cancelled', outcome: 'responded' });
    expect(last(ben.id)).toMatchObject({ status: 'cancelled', outcome: 'responded' });
    expect(last(cy.id)).toMatchObject({ status: 'done', outcome: 'queued' });
    const runs = await admin<{ party_id: string; status: string; reason: string | null }[]>`
      select party_id, status, reason from automations.journey_runs where event_id = ${ev.id}`;
    expect(runs.find((r) => r.party_id === ana.id)).toMatchObject({
      status: 'cancelled',
      reason: 'responded',
    });
    expect(runs.find((r) => r.party_id === cy.id)).toMatchObject({ status: 'completed' });
    const dispatchAt = new Date('2030-04-29T14:00:00Z');
    await dispatchDue(
      a.org.id,
      { transports: mem.transports, appOrigin: ORIGIN, now: () => dispatchAt },
      200,
    );
    const toAddr = async (id: string) =>
      (await executeQuery(partyContactQuery, { eventId: ev.id, partyId: id }, a.ctx(), ports)).email;
    const reminded = (addr: string | null) =>
      mem.emails.filter((e) => e.to === addr && e.subject.startsWith('Reminder: please reply')).length;
    expect(reminded(await toAddr(ana.id))).toBe(1);
    expect(reminded(await toAddr(ben.id))).toBe(1);
    expect(reminded(await toAddr(cy.id))).toBe(2);
    // The reminders' log on the party.
    const cyLog = await executeQuery(
      partyInviteMessagesQuery,
      { eventId: ev.id, partyId: cy.id },
      a.ctx(),
      ports,
    );
    expect(cyLog.filter((m) => m.kind === 'reminder')).toHaveLength(2);
    const summary = await executeQuery(rsvpRemindersQuery, { eventId: ev.id }, viewerOf(a), ports);
    expect(summary.counts).toMatchObject({ done: 4, cancelled: 2, pending: 0 });
  });

  it('a new deadline re-plans pending reminders; switching off cancels them; a wedding org needs no marketing', async () => {
    const ev = await wedding(a, 'Replan');
    const p = await party(a, ev.id, 'Dee', ['Dee Dee'], { email: `dee-${uuidv7()}@example.test` });
    await executeCommand(
      setRsvpSettingsCommand,
      { eventId: ev.id, deadline: DEADLINE, nameLookup: true },
      a.ctx(),
      ports,
    );
    await executeCommand(
      setRsvpRemindersCommand,
      { eventId: ev.id, enabled: true, days: [7] },
      a.ctx(),
      ports,
    );
    await executeCommand(sendInvitationsCommand, { eventId: ev.id, channels: ['email'] }, a.ctx(), ports);
    await relay(a.org.id);
    expect((await reminderRows(ev.id))[0]?.scheduled_for.toISOString()).toBe('2030-04-25T04:00:00.000Z');
    await executeCommand(
      setRsvpSettingsCommand,
      { eventId: ev.id, deadline: new Date('2030-05-10T17:00:00Z'), nameLookup: true },
      a.ctx(),
      ports,
    );
    await relay(a.org.id);
    expect((await reminderRows(ev.id))[0]?.scheduled_for.toISOString()).toBe('2030-05-03T17:00:00.000Z');
    const off = await executeCommand(
      setRsvpRemindersCommand,
      { eventId: ev.id, enabled: false },
      a.ctx(),
      ports,
    );
    expect(off.enabled).toBe(false);
    const rows = await reminderRows(ev.id);
    expect(rows.map((r) => [r.status, r.outcome])).toEqual([['cancelled', 'journey_disabled']]);
    // The marketing journey list never shows the system journey.
    const [{ n } = { n: -1 }] = await admin<{ n: number }[]>`
      select count(*)::int as n from automations.journeys where event_id = ${ev.id} and trigger = 'rsvp_sent'`;
    expect(n).toBe(1);
    const listed = await executeQuery(listJourneysQuery, { eventId: ev.id }, a.ctx(), ports);
    expect(listed).toEqual([]);
    // P4-3: nothing here made a crm contact for the guest's address.
    const contact = await executeQuery(partyContactQuery, { eventId: ev.id, partyId: p.id }, a.ctx(), ports);
    const [{ c } = { c: -1 }] = await admin<{ c: number }[]>`
      select count(*)::int as c from crm.contacts where org_id = ${a.org.id} and email_norm = ${contact.email}`;
    expect(c).toBe(0);
  });

  it('isolation: org B sees none of org A’s reminders', async () => {
    const ev = await wedding(a, 'Iso rem');
    await executeCommand(
      setRsvpSettingsCommand,
      { eventId: ev.id, deadline: DEADLINE, nameLookup: true },
      a.ctx(),
      ports,
    );
    await executeCommand(setRsvpRemindersCommand, { eventId: ev.id, enabled: true }, a.ctx(), ports);
    await refused(
      executeCommand(setRsvpRemindersCommand, { eventId: ev.id, enabled: false }, b.ctx(), ports),
      'not_found',
    );
    const view = await executeQuery(rsvpRemindersQuery, { eventId: ev.id }, b.ctx(), ports);
    expect(view.enabled).toBe(false);
  });
});
