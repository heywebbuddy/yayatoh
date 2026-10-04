import { recordTermConsentTx } from '@yayatoh/crm';
import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import {
  createEventCommand,
  createPortalSession,
  type EventDto,
  portalCtx,
  portalPrincipalBySession,
  transitionEventCommand,
} from '@yayatoh/events';
import { type Ctx, createCtx, executeCommand, executeQuery, isDomainError } from '@yayatoh/kernel';
import {
  acceptLeadTermsCommand,
  EXPORT_COLUMNS,
  exportLeadsCommand,
  LEAD_TERMS_VERSION,
  leadSetupQuery,
  myLeadsQuery,
  saveLeadSettingsCommand,
  setExhibitorEmailSharingCommand,
  syncLeadScansCommand,
  updateLeadCommand,
  whoScannedMeQuery,
  withdrawLeadEmailCommand,
} from '@yayatoh/leads';
import { recentEventsTx } from '@yayatoh/platform';
import {
  createExhibitorCommand,
  inviteExhibitorMemberCommand,
  portalAssignLeadLicenseCommand,
  portalInviteStaffCommand,
  saveLeadLicenseSettingsCommand,
} from '@yayatoh/program';
import {
  registrantsOfLinkTx,
  registrationSetupQuery,
  seedRegistrationDefaultsCommand,
  setCellCommand,
  startRegistrationCommand,
} from '@yayatoh/registration';
import { issueHolderLinkTx } from '@yayatoh/ticketing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, systemCtx, twoOrgs } from '../src/index.ts';

/**
 * M5.6b — lead retrieval: exhibitor people with a license capture leads by scanning badges;
 * the P5-8 allowlist (email only with consent); an offline queue applied exactly once; licenses
 * beyond the allowance refused; the P5-4 window (capture stops 48 h after the event, access 90
 * days); own vs team visibility; the CSV export with step-up; the attendee's "who scanned me".
 */
let a: OrgFixture;
let b: OrgFixture;
let ev: EventDto;
let n = 0;
const H = 3_600_000;
const START = new Date('2030-10-20T14:00:00Z');
const END = new Date('2030-10-21T22:00:00Z');
const DURING = new Date(START.getTime() + 2 * H);
const HOST = 'leads.test';
const uniq = () => `${Date.now().toString(36)}${(n++).toString(36)}`;
const scanId = () => `scan-${uniq()}-${Math.random().toString(36).slice(2, 8)}`;

async function rejects(p: Promise<unknown>, code: string, reason?: string) {
  try {
    await p;
  } catch (err) {
    if (!isDomainError(err)) throw err;
    expect(err.code).toBe(code);
    if (reason) expect((err.details as { reason?: string } | undefined)?.reason).toBe(reason);
    return;
  }
  throw new Error(`expected ${code}`);
}

/** A portal context signed in at `signedIn` (step-up moment), acting at `now`. */
async function as(orgId: string, accountId: string, now = DURING, signedIn = now): Promise<Ctx> {
  const s = await createPortalSession({ orgId, accountId, host: HOST }, signedIn);
  const p = await portalPrincipalBySession(s.token, HOST, signedIn);
  if (!p) throw new Error('no principal');
  return portalCtx(p, 'en', now);
}

interface Team {
  exhibitorId: string;
  admin: string;
  staff: string[];
}

/** An exhibitor with an admin (holding the included license), staff invited, terms accepted. */
async function team(name: string, staff = 2, org = a, event = ev, accept = true): Promise<Team> {
  const x = await executeCommand(createExhibitorCommand, { eventId: event.id, name }, org.ctx(), ports);
  const inv = await executeCommand(
    inviteExhibitorMemberCommand,
    { eventId: event.id, exhibitorId: x.id, email: `admin+${uniq()}@x.example`, role: 'exhibitor_admin' },
    org.ctx(),
    ports,
  );
  const admin = inv.member.id;
  const ctx = await as(org.org.id, admin);
  const ids: string[] = [];
  for (let i = 0; i < staff; i++) {
    const r = await executeCommand(
      portalInviteStaffCommand,
      { email: `staff+${uniq()}@x.example` },
      ctx,
      ports,
    );
    ids.push((r as { member: { id: string } }).member.id);
  }
  await executeCommand(portalAssignLeadLicenseCommand, { accountId: admin }, ctx, ports);
  if (accept) await executeCommand(acceptLeadTermsCommand, { version: LEAD_TERMS_VERSION }, ctx, ports);
  return { exhibitorId: x.id, admin, staff: ids };
}

interface Attendee {
  email: string;
  code: string;
  ticketId: string;
}

async function attendee(consent: boolean, org = a, event = ev): Promise<Attendee> {
  const setup = await executeQuery(registrationSetupQuery, { eventId: event.id }, org.ctx(), ports);
  const member = setup.types.find((t) => t.key === 'member')?.id as string;
  const full = setup.items.find((i) => i.key === 'full_pass')?.id as string;
  const email = `guest+${uniq()}@example.test`;
  const r = await executeCommand(
    startRegistrationCommand,
    {
      eventId: event.id,
      registrationTypeId: member,
      itemIds: [full],
      buyer: { email, name: `Guest ${uniq()}` },
    },
    createCtx({ orgId: org.org.id, now: new Date(START.getTime() - 72 * H) }),
    ports,
  );
  const sys = systemCtx(org.org.id);
  const [reg] = await withTenant(sys, (tx) => registrantsOfLinkTx(tx, r.manageToken));
  if (!reg) throw new Error('no registrant');
  const [t] = await withTenant(sys, (tx) =>
    tx.execute<{ id: string; short_code: string }>(
      sql`select id, short_code from ticketing.tickets where id = ${reg.id}`,
    ),
  );
  if (consent)
    await withTenant(sys, (tx) =>
      recordTermConsentTx(tx, sys, {
        email,
        name: null,
        term: 'exhibitor_email_sharing',
        version: 1,
        evidence: 'test:registration_form',
      }),
    );
  return { email, code: t?.short_code ?? '', ticketId: t?.id ?? '' };
}

const scan = (code: string, capturedAt = DURING, extra: Record<string, unknown> = {}) => ({
  scanId: scanId(),
  code,
  capturedAt,
  offline: false,
  ...extra,
});

const sync = (ctx: Ctx, scans: ReturnType<typeof scan>[]) =>
  executeCommand(syncLeadScansCommand, { scans }, ctx, ports);

async function conference(org: OrgFixture, name: string) {
  const event = await executeCommand(
    createEventCommand,
    { name, profile: 'conference', timezone: 'America/Chicago', startsAt: START, endsAt: END },
    org.ctx(),
    ports,
  );
  await executeCommand(seedRegistrationDefaultsCommand, { eventId: event.id, names: {} }, org.ctx(), ports);
  const setup = await executeQuery(registrationSetupQuery, { eventId: event.id }, org.ctx(), ports);
  await executeCommand(
    setCellCommand,
    {
      eventId: event.id,
      registrationTypeId: setup.types.find((t) => t.key === 'member')?.id as string,
      admissionItemId: setup.items.find((i) => i.key === 'full_pass')?.id as string,
      priceMinor: 0,
    },
    org.ctx(),
    ports,
  );
  await executeCommand(
    transitionEventCommand,
    { eventId: event.id, transition: 'publish' },
    org.ctx(),
    ports,
  );
  await executeCommand(
    saveLeadLicenseSettingsCommand,
    { eventId: event.id, includedLeadLicenses: 2, leadLicensePriceMinor: null },
    org.ctx(),
    ports,
  );
  return event;
}

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
  ev = await conference(a, `Leads ${a.org.slug}`);
});

afterAll(async () => {
  await closePools();
});

describe('capture and the P5-8 allowlist', () => {
  it('email appears only with consent; phone and address are never part of a lead', async () => {
    const t = await team('Acme');
    const ctx = await as(a.org.id, t.admin);
    const yes = await attendee(true);
    const no = await attendee(false);
    const r = await sync(ctx, [scan(yes.code), scan(no.code)]);
    expect(r.results.map((x) => x.status)).toEqual(['captured', 'captured']);
    const [withEmail, without] = r.results.map((x) => x.lead);
    expect(withEmail?.email).toBe(yes.email);
    expect(withEmail?.sharedFields).toEqual(['name', 'job_title', 'company', 'email']);
    expect(withEmail?.emailConsentVersion).toBe(1);
    expect(without?.email).toBeNull();
    expect(without?.sharedFields).toEqual(['name', 'job_title', 'company']);
    expect(Object.keys(withEmail ?? {})).not.toEqual(expect.arrayContaining(['phone']));
    expect(JSON.stringify(r)).not.toMatch(/ticketId|orgId|address|phone/);
  });

  it('a withdrawn consent stops the email for scans from then on', async () => {
    const t = await team('Withdrawn Co');
    const ctx = await as(a.org.id, t.admin);
    const p = await attendee(true);
    await withTenant(systemCtx(a.org.id), async (tx) => {
      const sys = systemCtx(a.org.id);
      const { contactIdByEmailTx, recordConsentTx } = await import('@yayatoh/crm');
      const id = await contactIdByEmailTx(tx, p.email);
      await recordConsentTx(tx, sys, {
        contactId: id as string,
        channel: 'email',
        purpose: 'exhibitor_sharing',
        status: 'withdrawn',
        evidence: 'test',
        version: 1,
      });
    });
    const r = await sync(ctx, [scan(p.code)]);
    expect(r.results[0]?.lead?.email).toBeNull();
  });

  it('refuses unknown codes and another event’s badges, without making a lead', async () => {
    const t = await team('Strict');
    const ctx = await as(a.org.id, t.admin);
    const other = await conference(a, `Other ${uniq()}`);
    const elsewhere = await attendee(false, a, other);
    const r = await sync(ctx, [scan('NOTACODE1'), scan(elsewhere.code)]);
    expect(r.results.map((x) => [x.status, x.reason])).toEqual([
      ['refused', 'invalid'],
      ['refused', 'wrong_event'],
    ]);
    const list = await executeQuery(myLeadsQuery, {}, ctx, ports);
    expect(list.leads).toHaveLength(0);
  });

  it('keeps only the qualifiers the exhibitor defined; a rescan adds to the same lead', async () => {
    const t = await team('Qualify');
    const ctx = await as(a.org.id, t.admin);
    await executeCommand(
      saveLeadSettingsCommand,
      { qualifiers: [' Budget ', 'budget', 'Demo'], teamVisibility: false },
      ctx,
      ports,
    );
    const p = await attendee(false);
    const first = await sync(ctx, [
      scan(p.code, DURING, { rating: 'warm', qualifiers: ['demo', 'Made up'], notes: 'Booth chat' }),
    ]);
    expect(first.results[0]?.lead).toMatchObject({
      qualifiers: ['Demo'],
      rating: 'warm',
      notes: 'Booth chat',
    });
    const again = await sync(ctx, [scan(p.code, new Date(DURING.getTime() + H), { notes: 'Came back' })]);
    expect(again.results[0]?.status).toBe('rescanned');
    expect(again.results[0]?.lead).toMatchObject({
      id: first.results[0]?.lead?.id,
      scans: 2,
      notes: 'Booth chat\nCame back',
      rating: 'warm',
    });
    await rejects(
      executeCommand(
        saveLeadSettingsCommand,
        { qualifiers: Array.from({ length: 11 }, (_, i) => `Q${i}`), teamVisibility: false },
        ctx,
        ports,
      ),
      'validation_failed',
      'too_many_qualifiers',
    );
  });
});

describe('the offline queue', () => {
  it('a lead scanned offline syncs once (retries and racing batches included)', async () => {
    const t = await team('Offline');
    const ctx = await as(a.org.id, t.admin);
    const people = await Promise.all([attendee(true), attendee(false), attendee(false)]);
    const queue = people.map((p, i) =>
      scan(p.code, new Date(DURING.getTime() + i * 60_000), { offline: true, notes: `queued ${i}` }),
    );
    const first = await sync(ctx, queue);
    expect(first.results.map((r) => r.status)).toEqual(['captured', 'captured', 'captured']);
    // The reply was lost: the device sends the same queue again, twice at once, and once more.
    const racing = await Promise.all([sync(ctx, queue), sync(ctx, queue)]);
    const retry = await sync(ctx, queue);
    for (const r of [...racing, retry])
      expect(r.results.map((x) => x.status)).toEqual(['captured', 'captured', 'captured']);
    const rows = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ leads: number; scans: number; total: number }>(
        sql`select (select count(*)::int from leads.leads where exhibitor_id = ${t.exhibitorId}) as leads,
                   (select count(*)::int from leads.lead_scans where exhibitor_id = ${t.exhibitorId}) as scans,
                   (select coalesce(sum(scans), 0)::int from leads.leads where exhibitor_id = ${t.exhibitorId}) as total`,
      ),
    );
    expect(rows[0]).toEqual({ leads: 3, scans: 3, total: 3 });
    const list = await executeQuery(myLeadsQuery, {}, ctx, ports);
    expect(list.leads.map((l) => l.notes).sort()).toEqual(['queued 0', 'queued 1', 'queued 2']);
    const events = await withTenant(systemCtx(a.org.id), (tx) =>
      recentEventsTx(tx, a.org.id, ['leads.captured'], 24 * H),
    );
    const mine = events.filter((e) => (e.payload as { exhibitorId: string }).exhibitorId === t.exhibitorId);
    expect(mine).toHaveLength(3);
    expect(Object.keys(mine[0]?.payload as object).sort()).toEqual([
      'emailShared',
      'eventId',
      'exhibitorId',
      'leadId',
      'orgId',
    ]);
  });
});

describe('licenses (P5-4)', () => {
  it('a license beyond the allowance is refused, and people without one capture nothing', async () => {
    const t = await team('Licensed', 3);
    const admin = await as(a.org.id, t.admin);
    const [s1, s2, s3] = t.staff as [string, string, string];
    const p = await attendee(false);
    await rejects(sync(await as(a.org.id, s1), [scan(p.code)]), 'forbidden', 'no_license');
    // 2 included: the admin holds one, s1 the other; a third is refused at assignment.
    await executeCommand(portalAssignLeadLicenseCommand, { accountId: s1 }, admin, ports);
    await rejects(
      executeCommand(portalAssignLeadLicenseCommand, { accountId: s2 }, admin, ports),
      'invalid_state',
      'licenses_used',
    );
    expect((await sync(await as(a.org.id, s1), [scan(p.code)])).results[0]?.status).toBe('captured');
    // The organizer lowers the allowance to 1: the newest seat (s1's) is now beyond it.
    await executeCommand(
      saveLeadLicenseSettingsCommand,
      { eventId: ev.id, includedLeadLicenses: 1, leadLicensePriceMinor: null },
      a.ctx(),
      ports,
    );
    try {
      await rejects(sync(await as(a.org.id, s1), [scan(p.code)]), 'forbidden', 'over_allowance');
      const setup = await executeQuery(leadSetupQuery, {}, await as(a.org.id, s1), ports);
      expect(setup.license).toBe('over_allowance');
      expect((await sync(admin, [scan(p.code)])).results[0]?.status).toBe('rescanned');
      await rejects(sync(await as(a.org.id, s3), [scan(p.code)]), 'forbidden', 'no_license');
    } finally {
      await executeCommand(
        saveLeadLicenseSettingsCommand,
        { eventId: ev.id, includedLeadLicenses: 2, leadLicensePriceMinor: null },
        a.ctx(),
        ports,
      );
    }
  });

  it('capture waits for the admin to accept the lead terms', async () => {
    const t = await team('No terms', 0, a, ev, false);
    const ctx = await as(a.org.id, t.admin);
    const p = await attendee(false);
    await rejects(sync(ctx, [scan(p.code)]), 'invalid_state', 'terms_not_accepted');
    await rejects(
      executeCommand(acceptLeadTermsCommand, { version: 99 }, ctx, ports),
      'validation_failed',
      'terms_version',
    );
    await executeCommand(acceptLeadTermsCommand, { version: LEAD_TERMS_VERSION }, ctx, ports);
    expect((await sync(ctx, [scan(p.code)])).results[0]?.status).toBe('captured');
  });
});

describe('the capture window (P5-4)', () => {
  it('capture stops 48 h after the event; offline scans made before then still count', async () => {
    const t = await team('Window');
    const close = new Date(END.getTime() + 48 * H);
    const p = await Promise.all([attendee(false), attendee(false), attendee(false), attendee(false)]);
    const before = await as(a.org.id, t.admin, new Date(START.getTime() - 24 * H - 60_000));
    expect((await sync(before, [scan(p[0]?.code ?? '', before.now)])).results[0]).toMatchObject({
      status: 'refused',
      reason: 'not_open',
    });
    const opening = await as(a.org.id, t.admin, new Date(START.getTime() - 24 * H));
    expect((await sync(opening, [scan(p[0]?.code ?? '', opening.now)])).results[0]?.status).toBe('captured');
    const last = await as(a.org.id, t.admin, new Date(close.getTime() - 60_000));
    expect((await sync(last, [scan(p[1]?.code ?? '', last.now)])).results[0]?.status).toBe('captured');
    const after = await as(a.org.id, t.admin, close);
    expect((await sync(after, [scan(p[2]?.code ?? '', close)])).results[0]).toMatchObject({
      status: 'refused',
      reason: 'closed',
    });
    // Scanned offline an hour before closing, synced a day later: it counts.
    const later = await as(a.org.id, t.admin, new Date(close.getTime() + 24 * H));
    const queued = scan(p[3]?.code ?? '', new Date(close.getTime() - H), { offline: true });
    expect((await sync(later, [queued])).results[0]?.status).toBe('captured');
    // A device clock running ahead can't stretch the window: its future time is replaced.
    const cheat = scan(p[2]?.code ?? '', new Date(close.getTime() - H), {});
    const ahead = await as(a.org.id, t.admin, new Date(close.getTime() + 2 * H));
    expect(
      (await sync(ahead, [{ ...cheat, capturedAt: new Date(close.getTime() + 3 * H) }])).results[0],
    ).toMatchObject({ status: 'refused', reason: 'closed' });
    const setup = await executeQuery(leadSetupQuery, {}, later, ports);
    expect(setup.capture).toMatchObject({ state: 'closed', accessOpen: true });
    // Notes stay open for 90 days; then lead access ends (the portal account ends with it, P5-7).
    const lastDay = await as(a.org.id, t.admin, new Date(END.getTime() + 90 * 24 * H - 60_000));
    expect((await executeQuery(myLeadsQuery, {}, lastDay, ports)).leads).toHaveLength(3);
    const endedAt = new Date(END.getTime() + 90 * 24 * H);
    await rejects(as(a.org.id, t.admin, endedAt), 'forbidden');
    const lingering = { ...lastDay, now: endedAt };
    await rejects(executeQuery(myLeadsQuery, {}, lingering, ports), 'forbidden');
    await rejects(sync(lingering, [scan(p[2]?.code ?? '', close)]), 'forbidden');
  });
});

describe('own vs team visibility', () => {
  it('staff see their own leads unless the admin shares the team’s; hidden leads look unknown', async () => {
    const t = await team('Visibility', 1);
    const admin = await as(a.org.id, t.admin);
    const staffId = t.staff[0] as string;
    await executeCommand(portalAssignLeadLicenseCommand, { accountId: staffId }, admin, ports);
    const staff = await as(a.org.id, staffId);
    const [p1, p2] = await Promise.all([attendee(false), attendee(false)]);
    const byAdmin = (await sync(admin, [scan(p1.code)])).results[0]?.lead;
    const byStaff = (await sync(staff, [scan(p2.code)])).results[0]?.lead;
    expect((await executeQuery(myLeadsQuery, {}, admin, ports)).leads.map((l) => l.id).sort()).toEqual(
      [byAdmin?.id, byStaff?.id].sort(),
    );
    const own = await executeQuery(myLeadsQuery, {}, staff, ports);
    expect(own).toMatchObject({ scope: 'own' });
    expect(own.leads.map((l) => l.id)).toEqual([byStaff?.id]);
    expect(own.leads[0]?.scannedBy).toBeNull();
    const edit = { leadId: byAdmin?.id as string, rating: 'hot' as const, qualifiers: [], notes: 'x' };
    await rejects(executeCommand(updateLeadCommand, edit, staff, ports), 'not_found');
    await executeCommand(saveLeadSettingsCommand, { qualifiers: [], teamVisibility: true }, admin, ports);
    const shared = await executeQuery(myLeadsQuery, {}, staff, ports);
    expect(shared.scope).toBe('team');
    expect(shared.leads).toHaveLength(2);
    await executeCommand(updateLeadCommand, edit, staff, ports);
    expect(
      (await executeQuery(myLeadsQuery, {}, admin, ports)).leads.find((l) => l.id === byAdmin?.id),
    ).toMatchObject({ rating: 'hot', notes: 'x' });
  });

  it('another exhibitor and another org see none of it; the organizer has no lead access', async () => {
    const x = await team('Mine');
    const y = await team('Theirs');
    const p = await attendee(true);
    const lead = (await sync(await as(a.org.id, x.admin), [scan(p.code)])).results[0]?.lead;
    const other = await as(a.org.id, y.admin);
    expect((await executeQuery(myLeadsQuery, {}, other, ports)).leads).toHaveLength(0);
    await rejects(
      executeCommand(
        updateLeadCommand,
        { leadId: lead?.id as string, rating: null, qualifiers: [], notes: '' },
        other,
        ports,
      ),
      'not_found',
    );
    // Org B: a forged context finds nothing under RLS.
    const forged = { ...(await as(a.org.id, x.admin)), orgId: b.org.id };
    await rejects(executeQuery(myLeadsQuery, {}, forged, ports), 'forbidden');
    const bRows = await withTenant(systemCtx(b.org.id), (tx) =>
      tx.execute<{ n: number }>(
        sql`select count(*)::int as n from leads.leads where id = ${lead?.id as string}`,
      ),
    );
    expect(bRows[0]?.n).toBe(0);
    // An organizer (or a viewer) is not a portal principal.
    await rejects(executeQuery(myLeadsQuery, {}, a.ctx(), ports), 'forbidden');
  });
});

describe('CSV export with step-up', () => {
  it('needs a fresh sign-in, is admin only, and carries the allowlist (email only with consent)', async () => {
    const t = await team('Export', 1);
    const admin = await as(a.org.id, t.admin);
    await executeCommand(portalAssignLeadLicenseCommand, { accountId: t.staff[0] as string }, admin, ports);
    const yes = await attendee(true);
    const no = await attendee(false);
    await sync(admin, [scan(yes.code, DURING, { notes: '=HYPERLINK("x")', rating: 'hot' }), scan(no.code)]);
    const headers = EXPORT_COLUMNS.map((c) => c.toUpperCase());
    const stale = await as(a.org.id, t.admin, DURING, new Date(DURING.getTime() - 11 * 60_000));
    await rejects(executeCommand(exportLeadsCommand, { headers }, stale, ports), 'step_up_required');
    const staff = await as(a.org.id, t.staff[0] as string);
    await rejects(executeCommand(exportLeadsCommand, { headers }, staff, ports), 'forbidden');
    const out = await executeCommand(exportLeadsCommand, { headers }, admin, ports);
    expect(out.count).toBe(2);
    const lines = out.csv.replace(/^﻿/, '').trim().split('\r\n');
    expect(lines[0]).toBe(headers.join(','));
    expect(out.csv).toContain(yes.email);
    expect(out.csv).not.toContain(no.email);
    expect(out.csv).toContain(`"'=HYPERLINK(""x"")"`);
    expect(out.csv).toContain('America/Chicago');
    expect(out.csv).toContain('v1');
    const audit = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ data: { rows: number } }>(
        sql`select data from platform.audit_events where action = 'leads.export' and target_id = ${t.exhibitorId}`,
      ),
    );
    expect(audit.map((r) => r.data.rows)).toEqual([2]);
  });
});

describe('who scanned me (the attendee)', () => {
  it('lists the exhibitors, withdraws the email from one, and turns sharing off for future scans', async () => {
    const x = await team('Booth X');
    const y = await team('Booth Y');
    const p = await attendee(true);
    const xLead = (await sync(await as(a.org.id, x.admin), [scan(p.code)])).results[0]?.lead;
    await sync(await as(a.org.id, y.admin), [scan(p.code, new Date(DURING.getTime() + 60_000))]);
    const sys = { ...systemCtx(a.org.id), now: DURING };
    const link = await withTenant(sys, (tx) => issueHolderLinkTx(tx, sys, ev.id, p.email));
    const guest = createCtx({ orgId: a.org.id, now: DURING });
    const seen = await executeQuery(whoScannedMeQuery, { linkId: link.id }, guest, ports);
    expect(seen.emailSharing).toBe(true);
    expect(seen.scans.map((s) => [s.exhibitorName, s.emailShared])).toEqual([
      ['Booth Y', true],
      ['Booth X', true],
    ]);
    expect(JSON.stringify(seen)).not.toMatch(/notes|rating|qualifiers|@x\.example/);

    const r = await executeCommand(
      withdrawLeadEmailCommand,
      { linkId: link.id, leadId: xLead?.id as string },
      guest,
      ports,
    );
    expect(r.withdrawn).toBe(true);
    const xView = (await executeQuery(myLeadsQuery, {}, await as(a.org.id, x.admin), ports)).leads[0];
    expect(xView).toMatchObject({ email: null, sharedFields: ['name', 'job_title', 'company', 'email'] });
    expect(xView?.emailWithdrawnAt).toBeInstanceOf(Date);
    const xCsv = await executeCommand(
      exportLeadsCommand,
      { headers: [...EXPORT_COLUMNS] },
      await as(a.org.id, x.admin),
      ports,
    );
    expect(xCsv.csv).not.toContain(p.email);
    // Someone else's lead id through this link looks unknown.
    const stranger = await attendee(false);
    const strangerLead = (await sync(await as(a.org.id, x.admin), [scan(stranger.code)])).results[0]?.lead;
    await rejects(
      executeCommand(
        withdrawLeadEmailCommand,
        { linkId: link.id, leadId: strangerLead?.id as string },
        guest,
        ports,
      ),
      'not_found',
    );

    await executeCommand(setExhibitorEmailSharingCommand, { linkId: link.id, share: false }, guest, ports);
    expect((await executeQuery(whoScannedMeQuery, { linkId: link.id }, guest, ports)).emailSharing).toBe(
      false,
    );
    const z = await team('Booth Z');
    const zLead = (await sync(await as(a.org.id, z.admin), [scan(p.code)])).results[0]?.lead;
    expect(zLead?.email).toBeNull();
    // Turning it back on records a new grant at the current version.
    await executeCommand(setExhibitorEmailSharingCommand, { linkId: link.id, share: true }, guest, ports);
    const w = await team('Booth W');
    expect((await sync(await as(a.org.id, w.admin), [scan(p.code)])).results[0]?.lead?.email).toBe(p.email);
    // An expired link shows nothing.
    await rejects(
      executeQuery(
        whoScannedMeQuery,
        { linkId: link.id },
        createCtx({ orgId: a.org.id, now: new Date('2040-01-01') }),
        ports,
      ),
      'not_found',
    );
  });
});
