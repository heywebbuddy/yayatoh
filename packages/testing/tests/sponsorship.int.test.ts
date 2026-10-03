import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import {
  createEventCommand,
  createPortalSession,
  type EventDto,
  transitionEventCommand,
  portalCtx,
  portalPrincipalBySession,
} from '@yayatoh/events';
import { type Ctx, createCtx, executeCommand, executeQuery, isDomainError } from '@yayatoh/kernel';
import {
  applyProviderEventCommand,
  attachPaymentCommand,
  startLeadLicenseCheckoutCommand,
  startSponsorPackageCheckoutCommand,
} from '@yayatoh/orders';
import { consumeEvent, recentEventsTx } from '@yayatoh/platform';
import {
  addSponsorDeliverableCommand,
  assignSponsoredSessionCommand,
  cancelSponsorGrantCommand,
  createExhibitorCommand,
  createSessionCommand,
  createSponsorCommand,
  createSponsorTierCommand,
  deleteSponsorCommand,
  deleteSponsorDeliverableCommand,
  dueAtFromDate,
  exhibitorPortalAdminQuery,
  exhibitorPortalQuery,
  grantSponsorPackageCommand,
  inviteExhibitorMemberCommand,
  inviteSponsorContactCommand,
  leadLicensesAdminQuery,
  portalAssignLeadLicenseCommand,
  portalInviteStaffCommand,
  portalLeadLicensesQuery,
  portalReleaseLeadLicenseCommand,
  portalRevokeStaffCommand,
  portalSetDeliverableDoneCommand,
  revokeSponsorContactCommand,
  saveLeadLicenseSettingsCommand,
  saveSponsorPackageCommand,
  setSponsorDeliverableDoneCommand,
  setSponsorExhibitorCommand,
  sponsorDeliverablesQuery,
  sponsorPortalQuery,
  sponsorshipAdminQuery,
} from '@yayatoh/program';
import {
  registrationSetupQuery,
  seedRegistrationDefaultsCommand,
  setCellCommand,
  sponsorCompCodes,
  sponsorCompUsageQuery,
  startRegistrationCommand,
} from '@yayatoh/registration';
import { listPromoCodesQuery } from '@yayatoh/ticketing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, systemCtx, twoOrgs, userCtx } from '../src/index.ts';

let a: OrgFixture;
let b: OrgFixture;
let ev: EventDto;
let gold: { id: string };
let silver: { id: string };

const HOST = 'portal.test';
const TZ = 'America/Chicago';
const HOUR = 3_600_000;
let n = 0;
const uniq = () => `${Date.now().toString(36)}${(n++).toString(36)}`;

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

async function session(orgId: string, accountId: string) {
  const s = await createPortalSession({ orgId, accountId, host: HOST });
  const principal = await portalPrincipalBySession(s.token, HOST);
  if (!principal) throw new Error('no principal');
  return portalCtx(principal);
}

async function newSponsor(name: string, tierId = gold.id) {
  return executeCommand(createSponsorCommand, { eventId: ev.id, tierId, name }, a.ctx(), ports);
}

/** A sponsor with a signed-in contact. */
async function sponsorWithContact(name: string, tierId = gold.id) {
  const s = await newSponsor(name, tierId);
  const inv = await executeCommand(
    inviteSponsorContactCommand,
    { eventId: ev.id, sponsorId: s.id, email: `contact+${uniq()}@sponsor.example` },
    a.ctx(),
    ports,
  );
  return { sponsor: s, accountId: inv.contact.id, ctx: await session(a.org.id, inv.contact.id) };
}

async function exhibitorAdmin(name: string) {
  const x = await executeCommand(createExhibitorCommand, { eventId: ev.id, name }, a.ctx(), ports);
  const inv = await executeCommand(
    inviteExhibitorMemberCommand,
    { eventId: ev.id, exhibitorId: x.id, email: `admin+${uniq()}@exhibitor.example`, role: 'exhibitor_admin' },
    a.ctx(),
    ports,
  );
  return { exhibitor: x, accountId: inv.member.id, ctx: await session(a.org.id, inv.member.id) };
}

/** Pay an add-on order the way the fake provider's webhook does. */
async function pay(orderId: string, amountMinor: number) {
  const pi = `fakepi_${uniq()}`;
  await executeCommand(
    attachPaymentCommand,
    { orderId, provider: 'fake', providerPaymentId: pi },
    systemCtx(a.org.id),
    ports,
  );
  const event = {
    provider: 'fake',
    id: `fakeevt_${uniq()}`,
    type: 'payment.succeeded',
    providerPaymentId: pi,
    amountMinor,
    currency: 'USD',
    orgId: a.org.id,
    orderId,
  };
  return { event, result: await executeCommand(applyProviderEventCommand, event, systemCtx(a.org.id), ports) };
}

const compSubscriber = sponsorCompCodes();
async function drainCompCodes() {
  const events = await withTenant(systemCtx(a.org.id), (tx) =>
    recentEventsTx(
      tx,
      a.org.id,
      ['program.sponsor_package.activated', 'program.sponsor_package.cancelled'],
      HOUR,
    ),
  );
  for (const e of events) await consumeEvent(compSubscriber, e);
}

const goldTerms = {
  description: 'Main stage branding and more.',
  priceMinor: 500_000,
  quantity: 5,
  onSale: true,
  compRegistrations: 10,
  exhibitorBadges: 4,
  leadLicenses: 3,
  logoPlacements: ['website', 'stage', 'badges'] as const,
  sessionSlots: 1,
  deliverables: [
    { title: 'Send logo files', owner: 'sponsor', daysBefore: 21 },
    { title: 'Print the stage banner', owner: 'organizer', daysBefore: 3 },
  ] as const,
};

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
  ev = await executeCommand(
    createEventCommand,
    {
      name: `Summit ${a.org.slug}`,
      profile: 'conference',
      timezone: TZ,
      startsAt: '2030-05-01T14:00:00Z',
      endsAt: '2030-05-02T23:00:00Z',
    },
    a.ctx(),
    ports,
  );
  gold = await executeCommand(createSponsorTierCommand, { eventId: ev.id, name: 'Gold', position: 1 }, a.ctx(), ports);
  silver = await executeCommand(
    createSponsorTierCommand,
    { eventId: ev.id, name: 'Silver', position: 2 },
    a.ctx(),
    ports,
  );
  await executeCommand(
    saveSponsorPackageCommand,
    { eventId: ev.id, tierId: gold.id, ...goldTerms, logoPlacements: [...goldTerms.logoPlacements], deliverables: [...goldTerms.deliverables] },
    a.ctx(),
    ports,
  );
  await executeCommand(
    saveSponsorPackageCommand,
    {
      eventId: ev.id,
      tierId: silver.id,
      priceMinor: 200_000,
      quantity: 1,
      onSale: true,
      compRegistrations: 4,
      exhibitorBadges: 1,
      leadLicenses: 1,
      logoPlacements: ['website'],
      sessionSlots: 0,
    },
    a.ctx(),
    ports,
  );
});

afterAll(async () => {
  await closePools();
});

describe('sponsor packages (M5.4b)', () => {
  it('package terms are validated: on sale needs a price; unknown tiers are not found', async () => {
    await rejects(
      executeCommand(
        saveSponsorPackageCommand,
        { ...goldTerms, eventId: ev.id, tierId: gold.id, priceMinor: null, logoPlacements: [], deliverables: [] },
        a.ctx(),
        ports,
      ),
      'validation_failed',
      'price_required',
    );
    await rejects(
      executeCommand(
        saveSponsorPackageCommand,
        { ...goldTerms, eventId: ev.id, tierId: b.event.id, logoPlacements: [], deliverables: [] },
        a.ctx(),
        ports,
      ),
      'not_found',
    );
    await expect(
      executeCommand(
        saveSponsorPackageCommand,
        { ...goldTerms, eventId: ev.id, tierId: gold.id, compRegistrations: 501, logoPlacements: [], deliverables: [] },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' });
  });

  it('buying "Gold" grants exactly its allowances (paid through an add-on order, fake provider)', async () => {
    const acme = await exhibitorAdmin(`Acme ${uniq()}`);
    const { sponsor, ctx } = await sponsorWithContact(`Acme Sponsor ${uniq()}`, silver.id);
    await executeCommand(
      setSponsorExhibitorCommand,
      { eventId: ev.id, sponsorId: sponsor.id, exhibitorId: acme.exhibitor.id },
      a.ctx(),
      ports,
    );
    const before = (await executeQuery(exhibitorPortalAdminQuery, { eventId: ev.id }, a.ctx(), ports)).exhibitors.find(
      (x) => x.exhibitorId === acme.exhibitor.id,
    );
    expect(before?.staff.allowance).toBe(5);

    // The portal offers both packages while the sponsor holds none.
    const portal = await executeQuery(sponsorPortalQuery, {}, ctx, ports);
    expect(portal.grant).toBeNull();
    expect(portal.forSale.map((p) => p.name)).toEqual(['Gold', 'Silver']);

    const checkout = await executeCommand(
      startSponsorPackageCheckoutCommand,
      { tierId: gold.id, locale: 'en' },
      { ...ctx, idempotencyKey: crypto.randomUUID() } as Ctx,
      ports,
    );
    expect(checkout.order).toMatchObject({ status: 'reserved', totalMinor: 500_000, currency: 'USD', items: [] });
    // Waiting for payment: no allowances yet, and no second purchase.
    const waiting = await executeQuery(sponsorPortalQuery, {}, ctx, ports);
    expect(waiting.grant).toBeNull();
    expect(waiting.pendingUntil).not.toBeNull();
    expect(waiting.forSale).toEqual([]);
    await rejects(
      executeCommand(startSponsorPackageCheckoutCommand, { tierId: gold.id, locale: 'en' }, ctx, ports),
      'invalid_state',
      'purchase_pending',
    );

    const { event, result } = await pay(checkout.order.id, 500_000);
    expect(result).toEqual({ outcome: 'applied', status: 'paid' });
    // A duplicate webhook changes nothing.
    expect(await executeCommand(applyProviderEventCommand, event, systemCtx(a.org.id), ports)).toMatchObject({
      outcome: 'duplicate',
    });

    const after = await executeQuery(sponsorPortalQuery, {}, ctx, ports);
    expect(after.sponsor.tierName).toBe('Gold');
    expect(after.grant).toMatchObject({
      packageName: 'Gold',
      source: 'purchase',
      priceMinor: 500_000,
      allowances: {
        compRegistrations: 10,
        exhibitorBadges: 4,
        leadLicenses: 3,
        logoPlacements: ['badges', 'stage', 'website'],
        sessionSlots: 1,
      },
    });
    expect(after.forSale).toEqual([]);
    // The package's deliverables, due before the event's first day (May 1 in Chicago).
    expect(after.deliverables.map((d) => [d.title, d.owner, d.dueDate])).toEqual([
      ['Send logo files', 'sponsor', '2030-04-10'],
      ['Print the stage banner', 'organizer', '2030-04-28'],
    ]);

    // Exhibitor badges: base 5 + 4. Lead licenses: 1 included + 3.
    const staff = (await executeQuery(exhibitorPortalAdminQuery, { eventId: ev.id }, a.ctx(), ports)).exhibitors.find(
      (x) => x.exhibitorId === acme.exhibitor.id,
    );
    expect(staff?.staff.allowance).toBe(9);
    const lic = (await executeQuery(leadLicensesAdminQuery, { eventId: ev.id }, a.ctx(), ports)).exhibitors.find(
      (x) => x.exhibitorId === acme.exhibitor.id,
    );
    expect(lic?.licenses).toMatchObject({ included: 1, fromPackages: 3, purchased: 0, allowance: 4 });
    expect(lic?.staffBadges).toEqual({ base: 5, fromPackages: 4 });
    expect((await executeQuery(exhibitorPortalQuery, {}, acme.ctx, ports)).staff?.allowance.allowance).toBe(9);

    // One session slot.
    const s1 = await executeCommand(
      createSessionCommand,
      { eventId: ev.id, title: `Keynote ${uniq()}`, startsAt: ev.startsAt, endsAt: new Date(ev.startsAt.getTime() + HOUR) },
      a.ctx(),
      ports,
    );
    const s2 = await executeCommand(
      createSessionCommand,
      { eventId: ev.id, title: `Panel ${uniq()}`, startsAt: ev.startsAt, endsAt: new Date(ev.startsAt.getTime() + HOUR) },
      a.ctx(),
      ports,
    );
    expect(
      await executeCommand(
        assignSponsoredSessionCommand,
        { eventId: ev.id, sponsorId: sponsor.id, sessionId: s1.session.id },
        a.ctx(),
        ports,
      ),
    ).toEqual({ used: 1, slots: 1 });
    await rejects(
      executeCommand(
        assignSponsoredSessionCommand,
        { eventId: ev.id, sponsorId: sponsor.id, sessionId: s2.session.id },
        a.ctx(),
        ports,
      ),
      'invalid_state',
      'slots_used',
    );

    // Comp registrations: one code, 100 % off, usable exactly 10 times.
    await drainCompCodes();
    const withCode = await executeQuery(sponsorPortalQuery, {}, ctx, ports);
    expect(withCode.grant?.compCode).toMatch(/^COMP-[A-Z0-9]{8}$/);
    expect(withCode.grant?.sessions.map((s) => s.title)).toEqual([s1.session.title]);
    const promo = (await executeQuery(listPromoCodesQuery, { eventId: ev.id }, a.ctx(), ports)).find(
      (p) => p.code === withCode.grant?.compCode,
    );
    expect(promo).toMatchObject({ kind: 'percent', percentBps: 10_000, maxRedemptions: 10, active: true });
    expect(await executeQuery(sponsorCompUsageQuery, {}, ctx, ports)).toEqual({
      code: withCode.grant?.compCode,
      allowance: 10,
      used: 0,
    });

    // Changing Gold later never changes what was bought.
    await executeCommand(
      saveSponsorPackageCommand,
      { ...goldTerms, eventId: ev.id, tierId: gold.id, compRegistrations: 99, logoPlacements: [], deliverables: [] },
      a.ctx(),
      ports,
    );
    expect((await executeQuery(sponsorPortalQuery, {}, ctx, ports)).grant?.allowances.compRegistrations).toBe(10);
    await executeCommand(
      saveSponsorPackageCommand,
      { eventId: ev.id, tierId: gold.id, ...goldTerms, logoPlacements: [...goldTerms.logoPlacements], deliverables: [...goldTerms.deliverables] },
      a.ctx(),
      ports,
    );

    // The money: the ledger has the sale, and one `order.addon_paid@1`.
    const paid = await withTenant(systemCtx(a.org.id), (tx) => recentEventsTx(tx, a.org.id, ['order.addon_paid'], HOUR));
    expect(paid.filter((e) => e.aggregateId === checkout.order.id)).toHaveLength(1);
    expect(paid.find((e) => e.aggregateId === checkout.order.id)?.payload).toMatchObject({
      kind: 'sponsor_package',
      totalMinor: 500_000,
    });
    const ledger = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ n: number }>(sql`select count(*)::int as n from payments.journal_entries where ref_id = ${checkout.order.id}`),
    );
    expect(ledger[0]?.n).toBeGreaterThan(0);

    // Cancelling ends the allowances, frees the slot and closes the code.
    const admin = await executeQuery(sponsorshipAdminQuery, { eventId: ev.id }, a.ctx(), ports);
    const grantId = admin.sponsors.find((s) => s.id === sponsor.id)?.grant?.id ?? '';
    await executeCommand(cancelSponsorGrantCommand, { eventId: ev.id, grantId }, a.ctx(), ports);
    await drainCompCodes();
    const gone = await executeQuery(sponsorPortalQuery, {}, ctx, ports);
    expect(gone.grant).toBeNull();
    expect(
      (await executeQuery(leadLicensesAdminQuery, { eventId: ev.id }, a.ctx(), ports)).exhibitors.find(
        (x) => x.exhibitorId === acme.exhibitor.id,
      )?.licenses.allowance,
    ).toBe(1);
    const closed = (await executeQuery(listPromoCodesQuery, { eventId: ev.id }, a.ctx(), ports)).find(
      (p) => p.code === withCode.grant?.compCode,
    );
    expect(closed?.active).toBe(false);
  });

  it('a package sells at most its quantity: a held purchase takes the place until its hold lapses', async () => {
    const first = await sponsorWithContact(`First ${uniq()}`, silver.id);
    const second = await sponsorWithContact(`Second ${uniq()}`, silver.id);
    await executeCommand(startSponsorPackageCheckoutCommand, { tierId: silver.id, locale: 'en' }, first.ctx, ports);
    await rejects(
      executeCommand(startSponsorPackageCheckoutCommand, { tierId: silver.id, locale: 'en' }, second.ctx, ports),
      'invalid_state',
      'sold_out',
    );
    await rejects(
      executeCommand(
        grantSponsorPackageCommand,
        { eventId: ev.id, sponsorId: second.sponsor.id, tierId: silver.id },
        a.ctx(),
        ports,
      ),
      'invalid_state',
      'sold_out',
    );
    // 20 minutes later the first hold has lapsed: the place is free again.
    const later = new Date(Date.now() + 20 * 60_000);
    const r = await executeCommand(
      grantSponsorPackageCommand,
      { eventId: ev.id, sponsorId: second.sponsor.id, tierId: silver.id },
      a.ctx({ now: later }),
      ports,
    );
    expect(r.grantId).toBeTruthy();
  });

  it('the organizer grants a package once; deleting the sponsor ends its package and contacts', async () => {
    const { sponsor, ctx } = await sponsorWithContact(`Granted ${uniq()}`);
    await executeCommand(
      grantSponsorPackageCommand,
      { eventId: ev.id, sponsorId: sponsor.id, tierId: gold.id, note: 'Paid by wire' },
      a.ctx(),
      ports,
    );
    const p = await executeQuery(sponsorPortalQuery, {}, ctx, ports);
    expect(p.grant).toMatchObject({ source: 'organizer', priceMinor: 0, allowances: { compRegistrations: 10 } });
    await rejects(
      executeCommand(grantSponsorPackageCommand, { eventId: ev.id, sponsorId: sponsor.id, tierId: silver.id }, a.ctx(), ports),
      'conflict',
      'already_granted',
    );
    await rejects(
      executeCommand(startSponsorPackageCheckoutCommand, { tierId: gold.id, locale: 'en' }, ctx, ports),
      'conflict',
      'already_granted',
    );
    await executeCommand(deleteSponsorCommand, { eventId: ev.id, sponsorId: sponsor.id }, a.ctx(), ports);
    await rejects(executeQuery(sponsorPortalQuery, {}, ctx, ports), 'forbidden');
    const cancelled = await withTenant(systemCtx(a.org.id), (tx) =>
      recentEventsTx(tx, a.org.id, ['program.sponsor_package.cancelled'], HOUR),
    );
    expect(cancelled.some((e) => (e.payload as { sponsorId?: string }).sponsorId === sponsor.id)).toBe(true);
  });

  it('a sponsor contact sees only their own sponsor; other principals and orgs are refused', async () => {
    const mine = await sponsorWithContact(`Mine ${uniq()}`);
    const other = await sponsorWithContact(`Other ${uniq()}`);
    const d = await executeCommand(
      addSponsorDeliverableCommand,
      { eventId: ev.id, sponsorId: other.sponsor.id, title: 'Ad copy', owner: 'sponsor', dueDate: '2030-04-01' },
      a.ctx(),
      ports,
    );
    const view = await executeQuery(sponsorPortalQuery, {}, mine.ctx, ports);
    expect(view.sponsor.name).toBe(mine.sponsor.name);
    expect(view.deliverables.some((x) => x.id === d.id)).toBe(false);
    // Another sponsor's deliverable looks unknown.
    await rejects(
      executeCommand(portalSetDeliverableDoneCommand, { deliverableId: d.id, done: true }, mine.ctx, ports),
      'not_found',
    );
    // An exhibitor admin is not a sponsor contact; a member can't use portal commands.
    const x = await exhibitorAdmin(`X ${uniq()}`);
    await rejects(executeQuery(sponsorPortalQuery, {}, x.ctx, ports), 'forbidden');
    await rejects(executeQuery(sponsorPortalQuery, {}, a.ctx(), ports), 'forbidden');
    // Org B never sees org A's sponsorship.
    await rejects(executeQuery(sponsorshipAdminQuery, { eventId: ev.id }, b.ctx(), ports), 'not_found');
    await rejects(
      executeCommand(
        grantSponsorPackageCommand,
        { eventId: ev.id, sponsorId: mine.sponsor.id, tierId: gold.id },
        b.ctx(),
        ports,
      ),
      'not_found',
    );
    // A revoked contact is out.
    await executeCommand(revokeSponsorContactCommand, { eventId: ev.id, accountId: mine.accountId }, a.ctx(), ports);
    await rejects(executeQuery(sponsorPortalQuery, {}, mine.ctx, ports), 'forbidden');
  });

  it('the organizer side needs events:write; a viewer is refused', async () => {
    const viewer = userCtx(a.viewerId, a.org.id);
    expect((await executeQuery(sponsorshipAdminQuery, { eventId: ev.id }, viewer, ports)).packages.length).toBe(2);
    await rejects(
      executeCommand(
        saveSponsorPackageCommand,
        { ...goldTerms, eventId: ev.id, tierId: gold.id, logoPlacements: [], deliverables: [] },
        viewer,
        ports,
      ),
      'forbidden',
    );
    const s = await newSponsor(`Viewer target ${uniq()}`);
    await rejects(
      executeCommand(grantSponsorPackageCommand, { eventId: ev.id, sponsorId: s.id, tierId: gold.id }, viewer, ports),
      'forbidden',
    );
    await rejects(
      executeCommand(
        addSponsorDeliverableCommand,
        { eventId: ev.id, sponsorId: s.id, title: 'x', owner: 'sponsor', dueDate: '2030-04-01' },
        viewer,
        ports,
      ),
      'forbidden',
    );
    await rejects(
      executeCommand(
        saveLeadLicenseSettingsCommand,
        { eventId: ev.id, includedLeadLicenses: 2, leadLicensePriceMinor: null },
        viewer,
        ports,
      ),
      'forbidden',
    );
  });
});

describe('sponsor deliverables (M5.4b)', () => {
  it('overdue deliverables list correctly: open and past the end of their due day in the event zone', async () => {
    const tz = await executeCommand(
      createEventCommand,
      {
        name: `Deliverables ${uniq()}`,
        profile: 'conference',
        timezone: TZ,
        startsAt: '2030-06-01T14:00:00Z',
        endsAt: '2030-06-02T23:00:00Z',
      },
      a.ctx(),
      ports,
    );
    const tier = await executeCommand(createSponsorTierCommand, { eventId: tz.id, name: 'Gold', position: 1 }, a.ctx(), ports);
    const acme = await executeCommand(createSponsorCommand, { eventId: tz.id, tierId: tier.id, name: 'Acme' }, a.ctx(), ports);
    const globex = await executeCommand(createSponsorCommand, { eventId: tz.id, tierId: tier.id, name: 'Globex' }, a.ctx(), ports);
    const add = (sponsorId: string, title: string, dueDate: string, owner: 'sponsor' | 'organizer' = 'sponsor') =>
      executeCommand(
        addSponsorDeliverableCommand,
        { eventId: tz.id, sponsorId, title, owner, ownerName: owner === 'organizer' ? 'Production' : null, dueDate },
        a.ctx(),
        ports,
      );
    const logo = await add(acme.id, 'Logo files', '2030-05-10');
    const banner = await add(globex.id, 'Banner proof', '2030-05-08', 'organizer');
    const ad = await add(acme.id, 'Ad copy', '2030-05-10');
    const today = await add(globex.id, 'Booth staff names', '2030-05-12');
    const done = await add(acme.id, 'Invoice', '2030-05-01');
    await add(globex.id, 'Slides', '2030-05-20');
    await executeCommand(setSponsorDeliverableDoneCommand, { eventId: tz.id, deliverableId: done.id, done: true }, a.ctx(), ports);
    // Invalid dates are refused.
    await expect(
      executeCommand(
        addSponsorDeliverableCommand,
        { eventId: tz.id, sponsorId: acme.id, title: 'Bad', owner: 'sponsor', dueDate: '2030-02-30' },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' });

    // 23:59 on May 12 in Chicago: May 12 is still on time, the earlier ones are overdue.
    const lateMay12 = new Date(dueAtFromDate('2030-05-12', TZ).getTime() - 60_000);
    const q1 = await executeQuery(sponsorDeliverablesQuery, { eventId: tz.id }, a.ctx({ now: lateMay12 }), ports);
    expect(q1.overdue.map((d) => d.id)).toEqual([banner.id, ad.id, logo.id]);
    expect(q1.overdue.map((d) => d.sponsorName)).toEqual(['Globex', 'Acme', 'Acme']);
    expect(q1.deliverables.find((d) => d.id === today.id)).toMatchObject({ overdue: false, dueDate: '2030-05-12' });
    // One minute later (midnight in Chicago) May 12 is overdue too.
    const q2 = await executeQuery(
      sponsorDeliverablesQuery,
      { eventId: tz.id },
      a.ctx({ now: new Date(lateMay12.getTime() + 60_000) }),
      ports,
    );
    expect(q2.overdue.map((d) => d.id)).toEqual([banner.id, ad.id, logo.id, today.id]);
    // Ticking one off takes it off the list; deleting removes it.
    await executeCommand(setSponsorDeliverableDoneCommand, { eventId: tz.id, deliverableId: ad.id, done: true }, a.ctx(), ports);
    await executeCommand(deleteSponsorDeliverableCommand, { eventId: tz.id, deliverableId: banner.id }, a.ctx(), ports);
    const q3 = await executeQuery(sponsorDeliverablesQuery, { eventId: tz.id }, a.ctx({ now: lateMay12 }), ports);
    expect(q3.overdue.map((d) => d.id)).toEqual([logo.id]);
    expect(q3.deliverables.find((d) => d.id === ad.id)).toMatchObject({ status: 'done', completedBy: 'organizer' });
    // Reopening puts it back.
    await executeCommand(setSponsorDeliverableDoneCommand, { eventId: tz.id, deliverableId: ad.id, done: false }, a.ctx(), ports);
    const q4 = await executeQuery(sponsorDeliverablesQuery, { eventId: tz.id }, a.ctx({ now: lateMay12 }), ports);
    expect(q4.overdue.map((d) => d.id)).toEqual([ad.id, logo.id]);
    // The sponsoring admin page counts them per sponsor.
    const admin = await executeQuery(sponsorshipAdminQuery, { eventId: tz.id }, a.ctx({ now: lateMay12 }), ports);
    expect(admin.sponsors.find((s) => s.id === acme.id)?.deliverables).toEqual({ open: 2, done: 1, overdue: 2 });
  });

  it('a sponsor contact ticks off only the sponsor’s own deliverables', async () => {
    const { sponsor, ctx } = await sponsorWithContact(`Ticks ${uniq()}`);
    const own = await executeCommand(
      addSponsorDeliverableCommand,
      { eventId: ev.id, sponsorId: sponsor.id, title: 'Logo files', owner: 'sponsor', dueDate: '2030-04-01' },
      a.ctx(),
      ports,
    );
    const theirs = await executeCommand(
      addSponsorDeliverableCommand,
      { eventId: ev.id, sponsorId: sponsor.id, title: 'Stage banner', owner: 'organizer', dueDate: '2030-04-01' },
      a.ctx(),
      ports,
    );
    expect(
      await executeCommand(portalSetDeliverableDoneCommand, { deliverableId: own.id, done: true }, ctx, ports),
    ).toMatchObject({ status: 'done' });
    await rejects(
      executeCommand(portalSetDeliverableDoneCommand, { deliverableId: theirs.id, done: true }, ctx, ports),
      'not_found',
    );
    const view = await executeQuery(sponsorPortalQuery, {}, ctx, ports);
    expect(view.deliverables.find((d) => d.id === own.id)).toMatchObject({ status: 'done', overdue: false });
    expect(view.deliverables.find((d) => d.id === theirs.id)).toMatchObject({ status: 'open', owner: 'organizer' });
  });
});

describe('lead licenses (M5.4b, P5-4)', () => {
  it('1 included; seats up to the allowance; extra licenses bought as an add-on; staff can’t assign', async () => {
    await executeCommand(
      saveLeadLicenseSettingsCommand,
      { eventId: ev.id, includedLeadLicenses: 1, leadLicensePriceMinor: null },
      a.ctx(),
      ports,
    );
    const x = await exhibitorAdmin(`Leads ${uniq()}`);
    const staff = await executeCommand(portalInviteStaffCommand, { email: `s1+${uniq()}@x.example` }, x.ctx, ports);
    const staff2 = await executeCommand(portalInviteStaffCommand, { email: `s2+${uniq()}@x.example` }, x.ctx, ports);
    expect((await executeQuery(portalLeadLicensesQuery, {}, x.ctx, ports)).licenses).toMatchObject({
      included: 1,
      allowance: 1,
      used: 0,
    });
    await executeCommand(portalAssignLeadLicenseCommand, { accountId: x.accountId }, x.ctx, ports);
    await rejects(
      executeCommand(portalAssignLeadLicenseCommand, { accountId: staff.member.id }, x.ctx, ports),
      'invalid_state',
      'licenses_used',
    );
    // Not for sale until the organizer sets a price.
    await rejects(
      executeCommand(startLeadLicenseCheckoutCommand, { quantity: 2, locale: 'en' }, x.ctx, ports),
      'invalid_state',
      'not_for_sale',
    );
    await executeCommand(
      saveLeadLicenseSettingsCommand,
      { eventId: ev.id, includedLeadLicenses: 1, leadLicensePriceMinor: 25_000 },
      a.ctx(),
      ports,
    );
    const order = await executeCommand(startLeadLicenseCheckoutCommand, { quantity: 2, locale: 'en' }, x.ctx, ports);
    expect(order.order).toMatchObject({ totalMinor: 50_000, status: 'reserved' });
    // Waiting for payment adds nothing.
    expect((await executeQuery(portalLeadLicensesQuery, {}, x.ctx, ports)).licenses.allowance).toBe(1);
    expect((await pay(order.order.id, 50_000)).result).toEqual({ outcome: 'applied', status: 'paid' });
    const use = await executeQuery(portalLeadLicensesQuery, {}, x.ctx, ports);
    expect(use.licenses).toMatchObject({ included: 1, purchased: 2, allowance: 3, used: 1, left: 2 });
    expect(use.price).toEqual({ unitMinor: 25_000, currency: 'USD' });
    await executeCommand(portalAssignLeadLicenseCommand, { accountId: staff.member.id }, x.ctx, ports);
    await rejects(
      executeCommand(portalAssignLeadLicenseCommand, { accountId: staff.member.id }, x.ctx, ports),
      'conflict',
      'already_licensed',
    );
    // Staff sign in and see only their own seat; they can't assign.
    const staffCtx = await session(a.org.id, staff.member.id);
    const theirs = await executeQuery(portalLeadLicensesQuery, {}, staffCtx, ports);
    expect(theirs).toMatchObject({ role: 'exhibitor_staff', mine: true, price: null });
    expect(theirs.people.map((p) => p.accountId)).toEqual([staff.member.id]);
    await rejects(
      executeCommand(portalAssignLeadLicenseCommand, { accountId: staff2.member.id }, staffCtx, ports),
      'forbidden',
    );
    // Revoking someone frees their seat; releasing frees one too.
    await executeCommand(portalRevokeStaffCommand, { memberId: staff.member.id }, x.ctx, ports);
    expect((await executeQuery(portalLeadLicensesQuery, {}, x.ctx, ports)).licenses.used).toBe(1);
    await executeCommand(portalReleaseLeadLicenseCommand, { accountId: x.accountId }, x.ctx, ports);
    expect((await executeQuery(portalLeadLicensesQuery, {}, x.ctx, ports)).licenses.used).toBe(0);
    // Another exhibitor's people look unknown.
    const y = await exhibitorAdmin(`Other ${uniq()}`);
    await rejects(
      executeCommand(portalAssignLeadLicenseCommand, { accountId: y.accountId }, x.ctx, ports),
      'not_found',
    );
  });

  it('concurrent assignments stop exactly at the allowance', async () => {
    await executeCommand(
      saveLeadLicenseSettingsCommand,
      { eventId: ev.id, includedLeadLicenses: 3, leadLicensePriceMinor: null },
      a.ctx(),
      ports,
    );
    const x = await exhibitorAdmin(`Race ${uniq()}`);
    await executeCommand(
      setSponsorExhibitorCommand,
      { eventId: ev.id, sponsorId: (await newSponsor(`Race sponsor ${uniq()}`)).id, exhibitorId: x.exhibitor.id },
      a.ctx(),
      ports,
    );
    const people = [];
    for (let i = 0; i < 5; i++)
      people.push((await executeCommand(portalInviteStaffCommand, { email: `r${i}+${uniq()}@x.example` }, x.ctx, ports)).member.id);
    const results = await Promise.allSettled(
      [x.accountId, ...people].map((accountId) =>
        executeCommand(portalAssignLeadLicenseCommand, { accountId }, x.ctx, ports),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(3);
    expect((await executeQuery(portalLeadLicensesQuery, {}, x.ctx, ports)).licenses).toMatchObject({
      allowance: 3,
      used: 3,
      left: 0,
    });
    await executeCommand(
      saveLeadLicenseSettingsCommand,
      { eventId: ev.id, includedLeadLicenses: 1, leadLicensePriceMinor: null },
      a.ctx(),
      ports,
    );
  });

  it('lead retrieval activates the lead_retrieval event add-on (free in beta)', async () => {
    const rows = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ source: string }>(
        sql`select source from billing.event_addons where event_id = ${ev.id} and addon_key = 'lead_retrieval'`,
      ),
    );
    expect(rows.map((r) => r.source)).toEqual(['beta_free']);
  });
});

describe('sponsor contacts and staff badges from packages (M5.4b)', () => {
  it('staff invites stop at the base allowance plus the package’s badges', async () => {
    const x = await exhibitorAdmin(`Badges ${uniq()}`);
    const s = await newSponsor(`Badge sponsor ${uniq()}`);
    await executeCommand(setSponsorExhibitorCommand, { eventId: ev.id, sponsorId: s.id, exhibitorId: x.exhibitor.id }, a.ctx(), ports);
    // Another sponsor can't claim the same exhibitor.
    await rejects(
      executeCommand(
        setSponsorExhibitorCommand,
        { eventId: ev.id, sponsorId: (await newSponsor(`Claim ${uniq()}`)).id, exhibitorId: x.exhibitor.id },
        a.ctx(),
        ports,
      ),
      'conflict',
      'exhibitor_taken',
    );
    for (let i = 0; i < 5; i++)
      await executeCommand(portalInviteStaffCommand, { email: `b${i}+${uniq()}@x.example` }, x.ctx, ports);
    await rejects(
      executeCommand(portalInviteStaffCommand, { email: `b6+${uniq()}@x.example` }, x.ctx, ports),
      'invalid_state',
      'allowance_reached',
    );
    await executeCommand(grantSponsorPackageCommand, { eventId: ev.id, sponsorId: s.id, tierId: gold.id }, a.ctx(), ports);
    for (let i = 0; i < 4; i++)
      await executeCommand(portalInviteStaffCommand, { email: `c${i}+${uniq()}@x.example` }, x.ctx, ports);
    await rejects(
      executeCommand(portalInviteStaffCommand, { email: `c5+${uniq()}@x.example` }, x.ctx, ports),
      'invalid_state',
      'allowance_reached',
    );
  });

  it('contacts: invited once per address, emailed through the outbox', async () => {
    const s = await newSponsor(`Contacts ${uniq()}`);
    const email = `one+${uniq()}@sponsor.example`;
    const inv = await executeCommand(inviteSponsorContactCommand, { eventId: ev.id, sponsorId: s.id, email }, a.ctx(), ports);
    expect(inv.contact).toMatchObject({ status: 'pending', email });
    await rejects(
      executeCommand(inviteSponsorContactCommand, { eventId: ev.id, sponsorId: s.id, email }, a.ctx(), ports),
      'conflict',
      'already_invited',
    );
    const events = await withTenant(systemCtx(a.org.id), (tx) =>
      recentEventsTx(tx, a.org.id, ['portal.account_invited'], HOUR),
    );
    expect(events.find((e) => e.aggregateId === inv.contact.id)?.payload).toMatchObject({ role: 'sponsor_contact' });
  });
});

describe('comp registration codes (M5.4b)', () => {
  it('a package’s comp code takes 100 % off a registration’s pass (add-ons still paid), N times', async () => {
    const conf = await executeCommand(
      createEventCommand,
      {
        name: `Comp ${uniq()}`,
        profile: 'conference',
        timezone: TZ,
        startsAt: '2030-07-01T14:00:00Z',
        endsAt: '2030-07-02T23:00:00Z',
      },
      a.ctx(),
      ports,
    );
    await executeCommand(seedRegistrationDefaultsCommand, { eventId: conf.id, names: {} }, a.ctx(), ports);
    const setup = await executeQuery(registrationSetupQuery, { eventId: conf.id }, a.ctx(), ports);
    const type = setup.types.find((t) => t.key === 'member');
    const item = (key: string) => setup.items.find((i) => i.key === key)?.id as string;
    if (!type) throw new Error('no member type');
    for (const [key, price] of [
      ['full_pass', 30_000],
      ['dinner', 5_000],
    ] as const)
      await executeCommand(
        setCellCommand,
        { eventId: conf.id, registrationTypeId: type.id, admissionItemId: item(key), priceMinor: price },
        a.ctx(),
        ports,
      );
    await executeCommand(transitionEventCommand, { eventId: conf.id, transition: 'publish' }, a.ctx(), ports);
    const tier = await executeCommand(createSponsorTierCommand, { eventId: conf.id, name: 'Gold', position: 1 }, a.ctx(), ports);
    await executeCommand(
      saveSponsorPackageCommand,
      {
        eventId: conf.id,
        tierId: tier.id,
        priceMinor: null,
        quantity: null,
        onSale: false,
        compRegistrations: 2,
        exhibitorBadges: 0,
        leadLicenses: 0,
        sessionSlots: 0,
      },
      a.ctx(),
      ports,
    );
    const s = await executeCommand(createSponsorCommand, { eventId: conf.id, tierId: tier.id, name: 'Acme' }, a.ctx(), ports);
    await executeCommand(grantSponsorPackageCommand, { eventId: conf.id, sponsorId: s.id, tierId: tier.id }, a.ctx(), ports);
    await drainCompCodes();
    // Twice is fine: one code per grant.
    await drainCompCodes();
    const admin = await executeQuery(sponsorshipAdminQuery, { eventId: conf.id }, a.ctx(), ports);
    const code = admin.sponsors[0]?.grant?.compCode ?? '';
    expect(code).toMatch(/^COMP-/);
    const codes = (await executeQuery(listPromoCodesQuery, { eventId: conf.id }, a.ctx(), ports)).filter((p) =>
      p.code.startsWith('COMP-'),
    );
    expect(codes).toHaveLength(1);
    const register = (email: string, itemIds: string[]) =>
      executeCommand(
        startRegistrationCommand,
        {
          eventId: conf.id,
          registrationTypeId: type.id,
          itemIds,
          buyer: { email, name: 'Guest' },
          promoCode: code,
        },
        createCtx({ orgId: a.org.id }),
        ports,
      );
    const free = await register(`g1+${uniq()}@guest.example`, [item('full_pass')]);
    expect(free.order).toMatchObject({ totalMinor: 0, status: 'paid' });
    const withDinner = await register(`g2+${uniq()}@guest.example`, [item('full_pass'), item('dinner')]);
    expect(withDinner.order.totalMinor).toBeGreaterThanOrEqual(5_000);
    expect(withDinner.order.totalMinor).toBeLessThan(30_000);
    // Two uses: a third registration is refused the code.
    await expect(register(`g3+${uniq()}@guest.example`, [item('full_pass')])).rejects.toMatchObject({
      code: expect.stringMatching(/validation_failed|invalid_state|conflict/),
    });
  });
});
