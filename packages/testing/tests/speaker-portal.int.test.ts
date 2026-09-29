import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import {
  consumePortalLink,
  createEventCommand,
  createPortalSession,
  endPortalSession,
  PORTAL_GRACE_MS,
  type PortalPrincipal,
  portalCtx,
  portalInviteByToken,
  portalInviteToken,
  portalPrincipalBySession,
  requestPortalChallenge,
  transitionEventCommand,
  verifyPortalChallenge,
} from '@yayatoh/events';
import { type Ctx, createCtx, executeCommand, executeQuery, uuidv7 } from '@yayatoh/kernel';
import {
  listOwnersMediaQuery,
  portalFileQuery,
  speakerPhotoApprover,
  uploadSpeakerPortalFile,
} from '@yayatoh/media';
import { catchUpSubscriber, memoryNotifier, postgresRateLimitStore } from '@yayatoh/platform';
import { createRateLimiter } from '@yayatoh/platform/security';
import {
  completePortalTaskCommand,
  createPortalTaskCommand,
  createSessionCommand,
  createSpeakerCommand,
  decideSpeakerChangeCommand,
  deleteSpeakerCommand,
  emitOverdueTasks,
  inviteSpeakerCommand,
  portalTaskBoardQuery,
  programQuery,
  proposeProfileChangeCommand,
  proposeSessionChangeCommand,
  publicProgram,
  remindMissingCommand,
  revokeSpeakerAccessCommand,
  speakerAccessQuery,
  speakerChangesQuery,
  speakerPortalQuery,
  taskReminderMailer,
  updateSpeakerCommand,
} from '@yayatoh/program';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, systemCtx, twoOrgs, userCtx } from '../src/index.ts';

/**
 * M5.3a speaker portal: portal accounts (P5-7), a speaker's view of only their own event and
 * sessions, proposed changes with approval, tasks, "missing X" reminders and outbox events.
 */
let a: OrgFixture;
let b: OrgFixture;
let eventId: string;
const run = uuidv7().slice(-10);
const HOST = 'portal.test';
const limiter = createRateLimiter(postgresRateLimitStore);
const limits = () => ({ limiter, subject: { device: `dev${uuidv7().replace(/-/g, '')}`, ip: null } });
const browser = () => `b${uuidv7().replace(/-/g, '')}`.padEnd(43, 'x').slice(0, 43);
const email = (tag: string) => `speaker.${tag}.${run}@example.test`;
const PDF = new TextEncoder().encode('%PDF-1.4\n% slides\n%%EOF\n');
const PNG = Uint8Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  ),
);

let clock = Date.now();
const later = () => {
  clock += 31_000;
  return new Date(clock);
};

const speakers: Record<string, { id: string; accountId?: string; principal?: PortalPrincipal }> = {};

/** Invite, sign in by code and return the signed-in principal. */
async function signIn(org: OrgFixture, speakerId: string, address: string): Promise<PortalPrincipal> {
  const inv = await executeCommand(
    inviteSpeakerCommand,
    { eventId: evOf(org), speakerId, email: address },
    org.ctx(),
    ports,
  );
  const token = await inviteTokenOf(org, inv.accountId);
  const r = await requestPortalChallenge({ inviteToken: token, browserState: browser() }, limits(), later());
  if (r.status !== 'sent') throw new Error(`no code: ${r.status}`);
  const v = await verifyPortalChallenge(
    { inviteToken: token, challengeId: r.challengeId, code: r.code },
    limits(),
    later(),
  );
  if (v.status !== 'ok') throw new Error(`not verified: ${v.status}`);
  const s = await createPortalSession({ orgId: v.orgId, accountId: v.accountId, host: HOST });
  const p = await portalPrincipalBySession(s.token, HOST);
  if (!p) throw new Error('no principal');
  return p;
}

const events = new Map<string, string>();
const evOf = (org: OrgFixture) => events.get(org.org.id) ?? '';

async function inviteTokenOf(org: OrgFixture, accountId: string) {
  const [row] = await withTenant(systemCtx(org.org.id), (tx) =>
    tx.execute<{ v: number }>(
      sql`select invite_version as v from events.portal_accounts where id = ${accountId}`,
    ),
  );
  return portalInviteToken(org.org.id, accountId, Number(row?.v ?? 1));
}

async function outbox(org: OrgFixture, type: string, aggregateId?: string) {
  return withTenant(systemCtx(org.org.id), (tx) =>
    tx.execute<{ id: string; payload: Record<string, unknown> }>(
      aggregateId
        ? sql`select id, payload from platform.domain_events where type = ${type} and aggregate_id = ${aggregateId}`
        : sql`select id, payload from platform.domain_events where type = ${type}`,
    ),
  );
}

async function newEvent(org: OrgFixture, name: string) {
  const e = await executeCommand(
    createEventCommand,
    {
      name,
      profile: 'conference',
      timezone: 'America/Chicago',
      startsAt: '2029-06-01T14:00:00Z',
      endsAt: '2029-06-02T23:00:00Z',
    },
    org.ctx(),
    ports,
  );
  await executeCommand(transitionEventCommand, { eventId: e.id, transition: 'publish' }, org.ctx(), ports);
  events.set(org.org.id, e.id);
  return e.id;
}

async function speaker(org: OrgFixture, name: string) {
  return executeCommand(
    createSpeakerCommand,
    { eventId: evOf(org), name, bio: `${name} bio` },
    org.ctx(),
    ports,
  );
}

async function session(org: OrgFixture, title: string, speakerIds: string[], hour: number) {
  const r = await executeCommand(
    createSessionCommand,
    {
      eventId: evOf(org),
      title,
      startsAt: new Date(Date.UTC(2029, 5, 1, hour)),
      endsAt: new Date(Date.UTC(2029, 5, 1, hour + 1)),
      speakerIds,
    },
    org.ctx(),
    ports,
  );
  return r.session.id;
}

const sessionIds: Record<string, string> = {};

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
  eventId = await newEvent(a, `Summit ${run}`);
  await newEvent(b, `Other ${run}`);
  for (const n of ['Ana', 'Ben', 'Cy']) speakers[n] = { id: (await speaker(a, `${n} ${run}`)).id };
  speakers.Zed = { id: (await speaker(b, `Zed ${run}`)).id };
  sessionIds.ana = await session(a, 'Ana talk', [speakers.Ana?.id ?? ''], 15);
  sessionIds.ben = await session(a, 'Ben talk', [speakers.Ben?.id ?? ''], 16);
  sessionIds.panel = await session(a, 'Panel', [speakers.Ana?.id ?? '', speakers.Ben?.id ?? ''], 17);
  sessionIds.zed = await session(b, 'Zed talk', [speakers.Zed?.id ?? ''], 15);
  for (const n of ['Ana', 'Ben'] as const) {
    const p = await signIn(a, speakers[n]?.id ?? '', email(n.toLowerCase()));
    Object.assign(speakers[n] ?? {}, { principal: p, accountId: p.accountId });
  }
  const z = await signIn(b, speakers.Zed?.id ?? '', email('zed'));
  Object.assign(speakers.Zed ?? {}, { principal: z, accountId: z.accountId });
}, 240_000);

afterAll(async () => {
  await closePools();
});

const pctx = (n: string, now?: Date): Ctx => {
  const p = speakers[n]?.principal;
  if (!p) throw new Error(`no principal for ${n}`);
  return portalCtx(p, 'en', now);
};

describe('portal accounts (P5-7)', () => {
  it('a principal names the org, event, assignment, role and subject; the assignment is a live speaker role', async () => {
    const p = speakers.Ana?.principal as PortalPrincipal;
    expect(p).toMatchObject({ orgId: a.org.id, eventId, role: 'speaker', subjectId: speakers.Ana?.id });
    const [row] = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ role: string; user_id: string; expires_at: Date }>(
        sql`select role, user_id, expires_at from events.event_role_assignments where id = ${p.eventRoleAssignmentId}`,
      ),
    );
    expect(row?.role).toBe('speaker');
    expect(row?.user_id).toBe(p.accountId);
    // Expires with the event + 90 days.
    expect(new Date(row?.expires_at ?? 0).getTime()).toBe(
      new Date('2029-06-02T23:00:00Z').getTime() + PORTAL_GRACE_MS,
    );
    // No org membership and no Better Auth user.
    const members = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute(sql`select 1 from tenancy.memberships where user_id = ${p.accountId}`),
    );
    expect(members).toHaveLength(0);
  });

  it('a session works only on its host, and a cookie naming another org finds nothing', async () => {
    const ana = speakers.Ana?.principal as PortalPrincipal;
    const s = await createPortalSession({ orgId: a.org.id, accountId: ana.accountId, host: HOST });
    expect(await portalPrincipalBySession(s.token, HOST)).not.toBeNull();
    expect(await portalPrincipalBySession(s.token, 'other.test')).toBeNull();
    const secret = s.token.split('~')[1];
    expect(await portalPrincipalBySession(`${b.org.id}~${secret}`, HOST)).toBeNull();
    // Stored hashed: the secret appears nowhere.
    const rows = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ token_hash: string }>(sql`select token_hash from events.portal_sessions`),
    );
    expect(rows.some((r) => r.token_hash.includes(secret ?? '-'))).toBe(false);
    await endPortalSession(s.token);
    expect(await portalPrincipalBySession(s.token, HOST)).toBeNull();
  });

  it('forged, reissued, revoked and expired invitations are refused', async () => {
    const spk = await speaker(a, `Revoked ${run}`);
    const inv = await executeCommand(
      inviteSpeakerCommand,
      { eventId, speakerId: spk.id, email: email('revoked') },
      a.ctx(),
      ports,
    );
    const v1 = await inviteTokenOf(a, inv.accountId);
    expect((await portalInviteByToken(v1))?.status).toBe('ok');
    expect(await portalInviteByToken(`${v1.slice(0, -2)}xx`)).toBeNull();
    // Reissue (invite the same address again): the old link stops working, the new one works.
    await executeCommand(
      inviteSpeakerCommand,
      { eventId, speakerId: spk.id, email: email('revoked') },
      a.ctx(),
      ports,
    );
    const v2 = await inviteTokenOf(a, inv.accountId);
    expect((await portalInviteByToken(v1))?.status).toBe('reissued');
    expect(
      (await requestPortalChallenge({ inviteToken: v1, browserState: browser() }, limits(), later())).status,
    ).toBe('refused');
    // Sign in, then revoke: the session, the link and new codes all stop.
    const r = await requestPortalChallenge({ inviteToken: v2, browserState: browser() }, limits(), later());
    if (r.status !== 'sent') throw new Error(r.status);
    const ok = await verifyPortalChallenge(
      { inviteToken: v2, challengeId: r.challengeId, code: r.code },
      limits(),
      later(),
    );
    expect(ok.status).toBe('ok');
    const s = await createPortalSession({ orgId: a.org.id, accountId: inv.accountId, host: HOST });
    expect(await portalPrincipalBySession(s.token, HOST)).not.toBeNull();
    // A viewer can't revoke.
    await expect(
      executeCommand(
        revokeSpeakerAccessCommand,
        { eventId, accountId: inv.accountId },
        userCtx(a.viewerId, a.org.id),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await executeCommand(revokeSpeakerAccessCommand, { eventId, accountId: inv.accountId }, a.ctx(), ports);
    expect(await portalPrincipalBySession(s.token, HOST)).toBeNull();
    expect((await portalInviteByToken(v2))?.status).toBe('revoked');
    expect(
      (await requestPortalChallenge({ inviteToken: v2, browserState: browser() }, limits(), later())).status,
    ).toBe('refused');
    // A command with a stale portal context is refused in its transaction.
    const stale = portalCtx({ ...(speakers.Ana?.principal as PortalPrincipal), accountId: inv.accountId });
    await expect(executeQuery(speakerPortalQuery, {}, stale, ports)).rejects.toMatchObject({
      code: 'forbidden',
    });
    const access = await executeQuery(speakerAccessQuery, { eventId }, a.ctx(), ports);
    expect(access.find((x) => x.speakerId === spk.id)?.accounts[0]?.status).toBe('revoked');
    // After the event + 90 days, the link opens nothing.
    const ana = speakers.Ana?.principal as PortalPrincipal;
    const anaToken = await inviteTokenOf(a, ana.accountId);
    const after = new Date(new Date('2029-06-02T23:00:00Z').getTime() + PORTAL_GRACE_MS);
    expect((await portalInviteByToken(anaToken, after))?.status).toBe('expired');
    expect(
      (await requestPortalChallenge({ inviteToken: anaToken, browserState: browser() }, limits(), after))
        .status,
    ).toBe('refused');
    await expect(executeQuery(speakerPortalQuery, {}, pctx('Ana', after), ports)).rejects.toMatchObject({
      code: 'forbidden',
    });
  });

  it('codes lock after five wrong tries; magic links work once and only in the browser that asked', async () => {
    const spk = await speaker(a, `Linky ${run}`);
    const inv = await executeCommand(
      inviteSpeakerCommand,
      { eventId, speakerId: spk.id, email: email('linky') },
      a.ctx(),
      ports,
    );
    const token = await inviteTokenOf(a, inv.accountId);
    const mine = browser();
    const r = await requestPortalChallenge({ inviteToken: token, browserState: mine }, limits(), later());
    if (r.status !== 'sent') throw new Error(r.status);
    // Within 30 s: no new code.
    expect(
      (
        await requestPortalChallenge(
          { inviteToken: token, browserState: mine },
          limits(),
          new Date(clock + 1000),
        )
      ).status,
    ).toBe('cooldown');
    expect(
      await consumePortalLink({ token: r.linkToken, browserState: browser(), spend: false }),
    ).toMatchObject({
      status: 'other_browser',
    });
    expect(await consumePortalLink({ token: r.linkToken, browserState: mine })).toMatchObject({
      status: 'ok',
      accountId: inv.accountId,
    });
    expect(await consumePortalLink({ token: r.linkToken, browserState: mine })).toEqual({
      status: 'invalid',
    });
    // A fresh code: five wrong tries lock it, even against the right code.
    const r2 = await requestPortalChallenge({ inviteToken: token, browserState: mine }, limits(), later());
    if (r2.status !== 'sent') throw new Error(r2.status);
    const wrong = r2.code === '000000' ? '111111' : '000000';
    for (let i = 4; i >= 1; i--)
      expect(
        await verifyPortalChallenge(
          { inviteToken: token, challengeId: r2.challengeId, code: wrong },
          limits(),
          later(),
        ),
      ).toEqual({ status: 'wrong', attemptsLeft: i });
    expect(
      (
        await verifyPortalChallenge(
          { inviteToken: token, challengeId: r2.challengeId, code: wrong },
          limits(),
          later(),
        )
      ).status,
    ).toBe('locked');
    expect(
      (
        await verifyPortalChallenge(
          { inviteToken: token, challengeId: r2.challengeId, code: r2.code },
          limits(),
          later(),
        )
      ).status,
    ).toBe('locked');
    // The code of this account's challenge never verifies with another invitation.
    const other = await inviteTokenOf(a, speakers.Ana?.accountId ?? '');
    expect(
      (
        await verifyPortalChallenge(
          { inviteToken: other, challengeId: r2.challengeId, code: r2.code },
          limits(),
          later(),
        )
      ).status,
    ).toBe('expired');
  });
});

describe('a speaker sees only their own event and sessions', () => {
  it('lists their sessions (with co-speakers) and tasks, nothing of other speakers or orgs', async () => {
    const view = await executeQuery(speakerPortalQuery, {}, pctx('Ana'), ports);
    expect(view.event.timezone).toBe('America/Chicago');
    expect(view.speaker.id).toBe(speakers.Ana?.id);
    expect(view.sessions.map((s) => s.title).sort()).toEqual(['Ana talk', 'Panel']);
    expect(view.sessions.find((s) => s.title === 'Panel')?.coSpeakers).toEqual([`Ben ${run}`]);
    const zed = await executeQuery(speakerPortalQuery, {}, pctx('Zed'), ports);
    expect(zed.sessions.map((s) => s.title)).toEqual(['Zed talk']);
  });

  it('refuses another speaker’s session, guessed ids and other orgs’ sessions', async () => {
    for (const id of [sessionIds.ben, uuidv7(), sessionIds.zed])
      await expect(
        executeCommand(
          proposeSessionChangeCommand,
          { sessionId: id ?? '', title: 'Hijack', description: '' },
          pctx('Ana'),
          ports,
        ),
      ).rejects.toMatchObject({ code: 'not_found' });
    // A portal principal can't reach another org at all (its account is not there).
    await expect(
      executeQuery(speakerPortalQuery, {}, { ...pctx('Ana'), orgId: b.org.id }, ports),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('has no console: every organizer read and write is forbidden', async () => {
    await expect(executeQuery(programQuery, { eventId }, pctx('Ana'), ports)).rejects.toMatchObject({
      code: 'forbidden',
    });
    await expect(
      executeCommand(
        updateSpeakerCommand,
        { eventId, speakerId: speakers.Ana?.id ?? '', name: 'Self-approved' },
        pctx('Ana'),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(executeQuery(speakerChangesQuery, { eventId }, pctx('Ana'), ports)).rejects.toMatchObject({
      code: 'forbidden',
    });
    // And an org member can't run portal commands.
    await expect(executeQuery(speakerPortalQuery, {}, a.ctx(), ports)).rejects.toMatchObject({
      code: 'forbidden',
    });
  });
});

describe('proposed changes: the public agenda shows only approved values', () => {
  it('approve applies the diff; reject leaves it; audited; viewers refused', async () => {
    const r = await executeCommand(
      proposeProfileChangeCommand,
      { name: `Ana ${run}`, bio: 'A **new** bio', links: [{ label: 'Site', url: 'https://ana.test' }] },
      pctx('Ana'),
      ports,
    );
    expect(r.changed).toEqual(['bio', 'links']);
    const pub = async () =>
      (await publicProgram({ orgId: a.org.id, eventId })).speakers.find((s) => s.id === speakers.Ana?.id);
    expect((await pub())?.bio).toBe(`Ana ${run} bio`);
    const changes = await executeQuery(
      speakerChangesQuery,
      { eventId },
      userCtx(a.viewerId, a.org.id),
      ports,
    );
    const c = changes.pending.find((x) => x.id === r.changeId);
    expect(c?.changes.map((x) => x.field)).toEqual(['bio', 'links']);
    expect(c?.changes[0]).toMatchObject({ before: `Ana ${run} bio`, after: 'A **new** bio' });
    await expect(
      executeCommand(
        decideSpeakerChangeCommand,
        { eventId, changeId: r.changeId, decision: 'approve' },
        userCtx(a.viewerId, a.org.id),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    // Another org can't see or decide it.
    await expect(
      executeCommand(
        decideSpeakerChangeCommand,
        { eventId, changeId: r.changeId, decision: 'approve' },
        b.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'not_found' });
    await executeCommand(
      decideSpeakerChangeCommand,
      { eventId, changeId: r.changeId, decision: 'approve' },
      a.ctx(),
      ports,
    );
    expect((await pub())?.bio).toBe('A **new** bio');
    expect((await pub())?.links).toEqual([{ label: 'Site', url: 'https://ana.test' }]);
    await expect(
      executeCommand(
        decideSpeakerChangeCommand,
        { eventId, changeId: r.changeId, decision: 'reject' },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'invalid_state' });
    const [audit] = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ data: { fields: string[] } }>(
        sql`select data from platform.audit_events where action = 'program.speaker_change.approve' and target_id = ${r.changeId}`,
      ),
    );
    expect(audit?.data.fields).toEqual(['bio', 'links']);

    const s = await executeCommand(
      proposeSessionChangeCommand,
      { sessionId: sessionIds.panel ?? '', title: 'Panel: the future', description: 'We talk.' },
      pctx('Ben'),
      ports,
    );
    await executeCommand(
      decideSpeakerChangeCommand,
      { eventId, changeId: s.changeId, decision: 'reject', note: 'Keep the title' },
      a.ctx(),
      ports,
    );
    expect(
      (await publicProgram({ orgId: a.org.id, eventId })).sessions.find((x) => x.id === sessionIds.panel)
        ?.title,
    ).toBe('Panel');
    const ben = await executeQuery(speakerPortalQuery, {}, pctx('Ben'), ports);
    expect(ben.sessions.find((x) => x.id === sessionIds.panel)?.change).toMatchObject({
      status: 'rejected',
      note: 'Keep the title',
    });
  });

  it('a new proposal supersedes the pending one; approval is refused after an organizer edit', async () => {
    const first = await executeCommand(
      proposeProfileChangeCommand,
      { name: `Ben ${run}`, company: 'First Co' },
      pctx('Ben'),
      ports,
    );
    const second = await executeCommand(
      proposeProfileChangeCommand,
      { name: `Ben ${run}`, company: 'Second Co' },
      pctx('Ben'),
      ports,
    );
    const { pending } = await executeQuery(speakerChangesQuery, { eventId }, a.ctx(), ports);
    expect(pending.some((x) => x.id === first.changeId)).toBe(false);
    expect(pending.some((x) => x.id === second.changeId)).toBe(true);
    await expect(
      executeCommand(
        proposeProfileChangeCommand,
        { name: `Ben ${run}`, bio: `Ben ${run} bio` },
        pctx('Ben'),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'validation_failed', details: { reason: 'no_change' } });
    await executeCommand(
      updateSpeakerCommand,
      {
        eventId,
        speakerId: speakers.Ben?.id ?? '',
        name: `Ben ${run}`,
        company: 'Organizer Co',
        bio: `Ben ${run} bio`,
      },
      a.ctx(),
      ports,
    );
    await expect(
      executeCommand(
        decideSpeakerChangeCommand,
        { eventId, changeId: second.changeId, decision: 'approve' },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'conflict', details: { reason: 'stale' } });
  });

  it('a proposed photo becomes the speaker photo only when approved', async () => {
    const up = await uploadSpeakerPortalFile(
      pctx('Ana'),
      { purpose: 'speaker_photo', assigneeId: null, file: PNG, fileName: 'me.png' },
      ports,
    );
    const photos = async () =>
      (
        await executeQuery(
          listOwnersMediaQuery,
          { ownerType: 'speaker', ownerIds: [speakers.Ana?.id ?? ''] },
          a.ctx(),
          ports,
        )
      ).filter((m) => m.ownerId === speakers.Ana?.id);
    const before = (await photos()).length;
    const file = await executeQuery(portalFileQuery, { fileId: up.fileId }, a.ctx(), ports);
    expect(file.contentType).toBe('image/png');
    // A document is not a photo.
    await expect(
      uploadSpeakerPortalFile(
        pctx('Ana'),
        { purpose: 'speaker_photo', assigneeId: null, file: PDF, fileName: 'x.pdf' },
        ports,
      ),
    ).rejects.toMatchObject({ code: 'validation_failed', details: { reason: 'unsupported_type' } });
    const { pending } = await executeQuery(speakerChangesQuery, { eventId }, a.ctx(), ports);
    const change = pending.find((x) => x.photoFileId === up.fileId);
    if (!change) throw new Error('no photo change');
    await executeCommand(
      decideSpeakerChangeCommand,
      { eventId, changeId: change.id, decision: 'approve' },
      a.ctx(),
      ports,
    );
    await catchUpSubscriber(speakerPhotoApprover(), a.org.id);
    const after = await photos();
    expect(after.length).toBe(Math.max(1, before));
    expect(after[0]?.alt).toBe(`Ana ${run}`);
  });
});

describe('tasks and "remind whoever is missing X"', () => {
  let taskId: string;
  const assignee = async (n: string) =>
    (await executeQuery(speakerPortalQuery, {}, pctx(n), ports)).tasks.find(
      (t) => t.title === `Slides ${run}`,
    );

  beforeAll(async () => {
    const t = await executeCommand(
      createPortalTaskCommand,
      { eventId, kind: 'upload', title: `Slides ${run}`, dueAt: new Date('2029-05-25T17:00:00Z') },
      a.ctx(),
      ports,
    );
    taskId = t.taskId;
  });

  it('assigns every speaker; viewers and other orgs are refused', async () => {
    const board = await executeQuery(portalTaskBoardQuery, { eventId }, userCtx(a.viewerId, a.org.id), ports);
    const t = board.find((x) => x.id === taskId);
    expect(t?.assignees.length).toBeGreaterThanOrEqual(3);
    await expect(
      executeCommand(remindMissingCommand, { eventId, taskId }, userCtx(a.viewerId, a.org.id), ports),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      executeCommand(remindMissingCommand, { eventId, taskId }, b.ctx(), ports),
    ).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(
      executeCommand(
        createPortalTaskCommand,
        { eventId, kind: 'agreement', title: 'Release', dueAt: new Date('2029-05-25T17:00:00Z') },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' });
  });

  it('file answers are type- and owner-checked; completing emits the event once', async () => {
    const ana = await assignee('Ana');
    const ben = await assignee('Ben');
    if (!ana || !ben) throw new Error('no assignee');
    await expect(
      uploadSpeakerPortalFile(
        pctx('Ana'),
        {
          purpose: 'task_answer',
          assigneeId: ana.assigneeId,
          file: new TextEncoder().encode('just text'),
          fileName: 'a.pdf',
        },
        ports,
      ),
    ).rejects.toMatchObject({ code: 'validation_failed', details: { reason: 'unsupported_type' } });
    const big = new Uint8Array(25 * 1024 * 1024 + 1);
    big.set(new TextEncoder().encode('%PDF-'));
    await expect(
      uploadSpeakerPortalFile(
        pctx('Ana'),
        { purpose: 'task_answer', assigneeId: ana.assigneeId, file: big, fileName: 'big.pdf' },
        ports,
      ),
    ).rejects.toMatchObject({ code: 'validation_failed', details: { reason: 'too_large' } });
    // Ben's task is not Ana's.
    await expect(
      uploadSpeakerPortalFile(
        pctx('Ana'),
        { purpose: 'task_answer', assigneeId: ben.assigneeId, file: PDF, fileName: 's.pdf' },
        ports,
      ),
    ).rejects.toMatchObject({ code: 'not_found' });
    const done = await uploadSpeakerPortalFile(
      pctx('Ana'),
      { purpose: 'task_answer', assigneeId: ana.assigneeId, file: PDF, fileName: '../My slides.PDF' },
      ports,
    );
    expect(done.fileName).toBe('My slides.pdf');
    expect((await assignee('Ana'))?.status).toBe('done');
    await expect(
      executeCommand(
        completePortalTaskCommand,
        { assigneeId: ana.assigneeId, accept: true },
        pctx('Ana'),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'invalid_state' });
    expect(await outbox(a, 'program.speaker_task.completed', ana.assigneeId)).toHaveLength(1);
    const file = await executeQuery(
      portalFileQuery,
      { fileId: done.fileId },
      userCtx(a.viewerId, a.org.id),
      ports,
    );
    expect(new TextDecoder().decode(file.bytes)).toContain('%PDF');
    await expect(
      executeQuery(portalFileQuery, { fileId: done.fileId }, b.ctx(), ports),
    ).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(
      executeQuery(portalFileQuery, { fileId: done.fileId }, pctx('Ana'), ports),
    ).rejects.toMatchObject({
      code: 'forbidden',
    });
  });

  it('a reminder reaches only speakers missing the task', async () => {
    const r = await executeCommand(remindMissingCommand, { eventId, taskId }, a.ctx(), ports);
    // Ben and Linky (invited, not yet signed in) are missing it and have access; Cy and the revoked
    // and deleted test speakers have none. Ana is done.
    expect(r.recipients).toBe(2);
    expect(r.unreachable).toBeGreaterThanOrEqual(1);
    const { notifier, sent } = memoryNotifier();
    await catchUpSubscriber(taskReminderMailer({ notifier, appOrigin: 'https://app.test' }), a.org.id);
    const reminders = sent.filter(
      (m) => m.kind === 'program.task-reminder' && m.params.title === `Slides ${run}` && !m.sendAfter,
    );
    expect(reminders.map((m) => m.to.email).sort()).toEqual([email('ben'), email('linky')]);
    expect(reminders[0]?.params.url).toMatch(/^https:\/\/app\.test\/event-portal\/invite\//);
    // Scheduled pre-due reminders were planned for open assignees with access (Ben), not Ana (done).
    const planned = sent.filter((m) => m.kind === 'program.task-reminder' && m.sendAfter);
    expect(planned.some((m) => m.to.email === email('ben'))).toBe(true);
    const board = await executeQuery(portalTaskBoardQuery, { eventId }, a.ctx(), ports);
    const ben = board.find((t) => t.id === taskId)?.assignees.find((x) => x.subjectId === speakers.Ben?.id);
    expect(ben).toMatchObject({ reminderCount: 1, reachable: true });
  });

  it('agreements are accepted in the portal; the overdue event is emitted once per assignee', async () => {
    const t = await executeCommand(
      createPortalTaskCommand,
      {
        eventId,
        kind: 'agreement',
        title: `Release ${run}`,
        agreementText: 'Placeholder release text.',
        dueAt: new Date(Date.now() + 60_000),
      },
      a.ctx(),
      ports,
    );
    const view = await executeQuery(speakerPortalQuery, {}, pctx('Ana'), ports);
    const mine = view.tasks.find((x) => x.title === `Release ${run}`);
    if (!mine) throw new Error('no release task');
    expect(mine.agreementText).toBe('Placeholder release text.');
    await executeCommand(
      completePortalTaskCommand,
      { assigneeId: mine.assigneeId, accept: true },
      pctx('Ana'),
      ports,
    );
    const soon = new Date(Date.now() + 120_000);
    const n = await emitOverdueTasks(a.org.id, soon);
    expect(n).toBeGreaterThanOrEqual(2);
    expect(await emitOverdueTasks(a.org.id, soon)).toBe(0);
    const overdue = (await outbox(a, 'program.speaker_task.overdue')).filter(
      (e) => e.payload.taskId === t.taskId,
    );
    // Everyone but Ana (done), once each.
    expect(overdue.length).toBe(n);
    expect(new Set(overdue.map((e) => e.payload.assigneeId)).size).toBe(overdue.length);
    expect(overdue.some((e) => e.payload.subjectId === speakers.Ana?.id)).toBe(false);
    // Another org's sweep sees none of it.
    expect(await emitOverdueTasks(b.org.id, soon)).toBe(0);
  });

  it('a deleted speaker’s account opens nothing', async () => {
    const spk = await speaker(a, `Gone ${run}`);
    const p = await signIn(a, spk.id, email('gone'));
    await executeCommand(deleteSpeakerCommand, { eventId, speakerId: spk.id }, a.ctx(), ports);
    await expect(executeQuery(speakerPortalQuery, {}, portalCtx(p), ports)).rejects.toMatchObject({
      code: 'forbidden',
    });
  });
});

describe('isolation', () => {
  it('portal rows of each org are invisible to the other', async () => {
    for (const [org, other] of [
      [a, b],
      [b, a],
    ] as const) {
      const counts = await withTenant(createCtx({ orgId: org.org.id }), (tx) =>
        tx.execute<{ n: number }>(sql`
          select (select count(*) from events.portal_accounts where org_id = ${other.org.id})
               + (select count(*) from events.portal_sessions where org_id = ${other.org.id})
               + (select count(*) from program.speaker_changes where org_id = ${other.org.id})
               + (select count(*) from program.portal_tasks where org_id = ${other.org.id})
               + (select count(*) from program.portal_task_assignees where org_id = ${other.org.id})
               + (select count(*) from media.portal_files where org_id = ${other.org.id}) as n`),
      );
      expect(Number(counts[0]?.n)).toBe(0);
    }
  });
});
