import {
  agencyDetachSubscriber,
  agencyFanoutsQuery,
  agencyLibraryQuery,
  agencyStaffQuery,
  applyBrandKitCommand,
  assignStaffCommand,
  clientAgencyOpsQuery,
  detachAgencyCommand,
  fanOutCampaign,
  handOverClient,
  publishBrandKit,
  publishTemplate,
  revokeStaffCommand,
  saveBrandKitCommand,
  setTemplatePrivacyCommand,
} from '@yayatoh/agency-ops';
import { setEntitlementOverrideCommand } from '@yayatoh/billing';
import { createCampaignCommand, saveCampaignCommand } from '@yayatoh/campaigns';
import { recordConsentTx, upsertContactTx } from '@yayatoh/crm';
import { withTenant } from '@yayatoh/db';
import { adminClient, closePools } from '@yayatoh/db/testing';
import { createEventCommand, listEventsQuery } from '@yayatoh/events';
import {
  type Ctx,
  createCtx,
  type DomainError,
  executeCommand,
  executeQuery,
  isDomainError,
  uuidv7,
} from '@yayatoh/kernel';
import { auditLogQuery, catchUpSubscriber } from '@yayatoh/platform';
import { listTemplatesQuery } from '@yayatoh/templates';
import {
  addMemberCommand,
  agencyAccess,
  createOrganization,
  getOrganizationQuery,
  grantAgencyAccessCommand,
  listAgencyStaffGrantsQuery,
  myAgencyClients,
  revokeAgencyStaffGrantCommand,
} from '@yayatoh/tenancy';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, staleCtx, systemCtx, twoOrgs, userCtx } from '../src/index.ts';

/**
 * Agency v2 operations (M6.8b): templates and brand kits published downward, per-client campaign
 * fan-out, team and day-of grants, handover and detach.
 */

let a: OrgFixture;
let b: OrgFixture;
/** A third client with a viewer grant only (and no campaigns yet: no postal address). */
let c: { id: string; owner: string };
let agencyId: string;
let agencySlug: string;
const owner = uuidv7();
const staff = uuidv7();
const marketer = uuidv7();
const freelancer = uuidv7();
let grantA: string;
let grantB: string;
let grantC: string;
let templateId: string;
let kitId: string;
const NOTE = `CANARY-PRIVATE-${uuidv7().slice(-10)}`;
const KIT_NOTE = `CANARY-KIT-${uuidv7().slice(-10)}`;

const errorOf = async (p: Promise<unknown>): Promise<DomainError> => {
  try {
    await p;
  } catch (err) {
    if (isDomainError(err)) return err;
    throw err;
  }
  throw new Error('expected a DomainError');
};

const agencyCtx = (user = staff) => userCtx(user, agencyId);
const via = (user: string, orgId: string, grantId: string): Ctx =>
  userCtx(user, orgId, { viaAgency: { grantId, agencyOrgId: agencyId } });

async function setFlag(on: boolean) {
  const db = adminClient();
  await db`select platform.set_flag('agency_v2', ${on}, 'test:agency-ops', 'agency v2 integration tests')`;
  await db.end();
}

async function grant(orgId: string, ctx: Ctx, role: 'manager' | 'marketing' | 'viewer') {
  const g = await executeCommand(grantAgencyAccessCommand, { agency: agencySlug, role }, ctx, ports);
  return g.id;
}

async function person(orgId: string, email: string, consent: 'granted' | 'withdrawn' | null) {
  const ctx = systemCtx(orgId);
  return withTenant(ctx, async (tx) => {
    const { id } = await upsertContactTx(tx, ctx, { email, name: 'Rae Contact', source: 'manual' });
    if (consent)
      await recordConsentTx(tx, ctx, {
        contactId: id,
        channel: 'email',
        purpose: 'marketing',
        status: consent,
        evidence: 'test',
      });
    return id;
  });
}

/** A campaign with a postal address, so new footers of the org start from it. */
async function addressCampaign(ctx: Ctx, address: string) {
  const camp = await executeCommand(
    createCampaignCommand,
    { name: `Address ${uuidv7().slice(-8)}` },
    ctx,
    ports,
  );
  await executeCommand(
    saveCampaignCommand,
    {
      campaignId: camp.id,
      name: camp.name,
      locale: 'en',
      content: {
        subject: 'Hello',
        preheader: '',
        font: 'sans',
        smsBody: '',
        blocks: [
          { id: 'b1', type: 'text', text: 'Hello' },
          { id: 'b2', type: 'footer', postalAddress: address, note: '' },
        ],
      },
    },
    ctx,
    ports,
  );
}

const recipients = (orgId: string, campaignId: string) =>
  withTenant(systemCtx(orgId), (tx) =>
    tx.execute<{ contact_id: string; status: string; reason: string | null }>(
      sql`select contact_id, status, reason from campaigns.campaign_recipients where campaign_id = ${campaignId}`,
    ),
  );

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
  const tag = uuidv7().slice(-8);
  agencySlug = `fern-${tag}`;
  const agency = await createOrganization(
    userCtx(owner),
    { slug: agencySlug, name: 'Fern Agency', kind: 'agency' },
    ports,
  );
  agencyId = agency.id;
  for (const [userId, role] of [
    [staff, 'manager'],
    [marketer, 'marketing'],
    [freelancer, 'collaborator'],
  ] as const)
    await executeCommand(addMemberCommand, { userId, role }, userCtx(owner, agencyId), ports);
  await executeCommand(
    setEntitlementOverrideCommand,
    { moduleKey: 'agency', effect: 'grant', reason: 'agency fixture' },
    systemCtx(agencyId),
    ports,
  );
  const cOwner = uuidv7();
  const cOrg = await createOrganization(
    userCtx(cOwner),
    { slug: `clover-${tag}`, name: 'Clover Club' },
    ports,
  );
  c = { id: cOrg.id, owner: cOwner };
  await setFlag(true);
  grantA = await grant(a.org.id, a.ctx(), 'manager');
  grantB = await grant(b.org.id, b.ctx(), 'marketing');
  grantC = await grant(c.id, userCtx(cOwner, c.id), 'viewer');
  // The agency's own template, from the fixture event's snapshot (two checkout questions, a
  // seating plan, ticket types), saved in the agency org.
  const [src] = await withTenant(systemCtx(a.org.id), (tx) =>
    tx.execute<{ snapshot: unknown; profile: string }>(
      sql`select snapshot, profile from templates.event_templates where name = ${`${a.org.name} template`}`,
    ),
  );
  const [row] = await withTenant(systemCtx(agencyId), (tx) =>
    tx.execute<{ id: string }>(
      sql`insert into templates.event_templates (org_id, name, description, profile, snapshot)
          values (${agencyId}, ${`Gala kit ${tag}`}, 'A ready gala', ${src?.profile ?? 'gala'}, ${JSON.stringify(src?.snapshot)}::jsonb)
          returning id`,
    ),
  );
  templateId = row?.id as string;
}, 300_000);
afterAll(async () => {
  await closePools();
});

describe('agency v2 behind its switch', () => {
  it('is refused while staff have not switched agency v2 on', async () => {
    await setFlag(false);
    try {
      const e = await errorOf(
        executeCommand(saveBrandKitCommand, { name: 'Off', brandColor: '#112233' }, agencyCtx(), ports),
      );
      expect(e.code).toBe('module_not_enabled');
      const p = await errorOf(publishTemplate(agencyCtx(), { templateId, clientOrgIds: [a.org.id] }, ports));
      expect(p.code).toBe('module_not_enabled');
    } finally {
      await setFlag(true);
    }
  });
});

describe('templates and brand kits published downward', () => {
  it('copies a template into the client without its private parts; a re-publish updates the same copy', async () => {
    await executeCommand(
      setTemplatePrivacyCommand,
      { templateId, privateNotes: NOTE, privateParts: ['questions', 'seating'] },
      agencyCtx(),
      ports,
    );
    // An organizer member can't: the agency's own permission.
    expect(
      (
        await errorOf(
          executeCommand(setTemplatePrivacyCommand, { templateId, privateParts: [] }, a.ctx(), ports),
        )
      ).code,
    ).toBe('forbidden');
    const missing = uuidv7();
    const results = await publishTemplate(
      agencyCtx(),
      { templateId, clientOrgIds: [a.org.id, b.org.id, c.id, missing] },
      ports,
    );
    const of = (id: string) => results.find((r) => r.clientOrgId === id);
    expect(of(a.org.id)).toMatchObject({ status: 'published', errorCode: null });
    // A marketing grant can't create event templates; a viewer grant can't either.
    expect(of(b.org.id)).toMatchObject({ status: 'failed', errorCode: 'forbidden' });
    expect(of(c.id)).toMatchObject({ status: 'failed', errorCode: 'forbidden' });
    expect(of(missing)).toMatchObject({ status: 'failed', errorCode: 'not_found' });

    const copies = (await executeQuery(listTemplatesQuery, {}, a.ctx(), ports)).filter((t) =>
      t.name.startsWith('Gala kit'),
    );
    expect(copies).toHaveLength(1);
    expect(copies[0]).toMatchObject({ questions: 0, seats: 0, description: 'A ready gala' });
    expect(copies[0]?.ticketTypes).toBeGreaterThan(0);
    const [raw] = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ snapshot: string }>(
        sql`select snapshot::text as snapshot from templates.event_templates where id = ${copies[0]?.id}`,
      ),
    );
    expect(raw?.snapshot).not.toContain(NOTE);
    // The client's audit log names the agency and the grant.
    const log = await executeQuery(auditLogQuery, { limit: 100 }, a.ctx(), ports);
    expect(log.entries.find((e) => e.action === 'agencyTemplate.receive')?.details).toMatchObject({
      viaAgency: `org:${agencyId}`,
      agencyGrantId: grantA,
    });
    // Re-publish with nothing private: the same copy now carries the questions.
    await executeCommand(
      setTemplatePrivacyCommand,
      { templateId, privateNotes: NOTE, privateParts: [] },
      agencyCtx(),
      ports,
    );
    await publishTemplate(agencyCtx(), { templateId, clientOrgIds: [a.org.id] }, ports);
    const again = (await executeQuery(listTemplatesQuery, {}, a.ctx(), ports)).filter((t) =>
      t.name.startsWith('Gala kit'),
    );
    expect(again.map((t) => t.id)).toEqual([copies[0]?.id]);
    expect(again[0]?.questions).toBeGreaterThan(0);
    await executeCommand(
      setTemplatePrivacyCommand,
      { templateId, privateNotes: NOTE, privateParts: ['questions', 'seating'] },
      agencyCtx(),
      ports,
    );
    await publishTemplate(agencyCtx(), { templateId, clientOrgIds: [a.org.id] }, ports);
    const lib = await executeQuery(agencyLibraryQuery, {}, agencyCtx(), ports);
    expect(
      lib.publications.filter((p) => p.sourceId === templateId).map((p) => [p.clientOrgId, p.status]),
    ).toEqual(
      expect.arrayContaining([
        [a.org.id, 'published'],
        [b.org.id, 'failed'],
      ]),
    );
  });

  it('copies a brand kit into each client library without its notes; only the client applies it', async () => {
    const kit = await executeCommand(
      saveBrandKitCommand,
      { name: 'Fern spring', brandColor: '#2F6B4F', privateNotes: KIT_NOTE },
      agencyCtx(),
      ports,
    );
    kitId = kit.id;
    expect(kit.brandColor).toBe('#2f6b4f');
    const dup = await errorOf(
      executeCommand(saveBrandKitCommand, { name: 'Fern spring', brandColor: '#000000' }, agencyCtx(), ports),
    );
    expect(dup.code).toBe('conflict');
    const results = await publishBrandKit(
      agencyCtx(),
      { kitId, clientOrgIds: [a.org.id, b.org.id, c.id] },
      ports,
    );
    expect(results.map((r) => [r.clientOrgId, r.status])).toEqual(
      expect.arrayContaining([
        [a.org.id, 'published'],
        [b.org.id, 'published'],
        [c.id, 'failed'],
      ]),
    );
    for (const org of [a, b]) {
      const view = await executeQuery(clientAgencyOpsQuery, {}, org.ctx(), ports);
      const got = view.brandKits.find((k) => k.name === 'Fern spring');
      expect(got).toMatchObject({ brandColor: '#2f6b4f', receivedFromAgencyOrgId: agencyId });
      const [notes] = await withTenant(systemCtx(org.org.id), (tx) =>
        tx.execute<{ n: number }>(
          sql`select count(*)::int as n from agency_ops.brand_kits where private_notes is not null and received_from_agency_org_id is not null`,
        ),
      );
      expect(notes?.n).toBe(0);
    }
    const view = await executeQuery(clientAgencyOpsQuery, {}, a.ctx(), ports);
    const received = view.brandKits.find((k) => k.name === 'Fern spring');
    // The agency can't change the client's public brand: org settings are the client's.
    const refused = await errorOf(
      executeCommand(applyBrandKitCommand, { kitId: received?.id }, via(staff, a.org.id, grantA), ports),
    );
    expect(refused.code).toBe('forbidden');
    await executeCommand(applyBrandKitCommand, { kitId: received?.id }, a.ctx(), ports);
    const org = await executeQuery(getOrganizationQuery, {}, a.ctx(), ports);
    expect(org.brandColor).toBe('#2f6b4f');
  });
});

describe('per-client campaign fan-out', () => {
  it('sends one campaign per client in its own org: recipients never mix and each client’s consent decides', async () => {
    const t = uuidv7().slice(-8);
    const aYes = await person(a.org.id, `yes+${t}@a.test`, 'granted');
    const aNone = await person(a.org.id, `none+${t}@a.test`, null);
    const aGone = await person(a.org.id, `gone+${t}@a.test`, 'withdrawn');
    const bYes = await person(b.org.id, `yes+${t}@b.test`, 'granted');
    // The same address in both clients is two people, one per org.
    const bShared = await person(b.org.id, `none+${t}@a.test`, 'granted');
    await addressCampaign(a.ctx(), '1 Lake Road, Chicago IL');
    await addressCampaign(b.ctx(), '9 Harbor St, Boston MA');
    const out = await fanOutCampaign(
      agencyCtx(marketer),
      {
        name: `Spring news ${t}`,
        subject: 'Spring is here, {{first_name|friend}}',
        heading: 'Spring at last',
        body: 'Our spring season opens soon.',
        audience: 'everyone',
        mode: 'send',
        clientOrgIds: [a.org.id, b.org.id, c.id],
      },
      ports,
    );
    const of = (id: string) => out.targets.find((x) => x.clientOrgId === id);
    expect(of(a.org.id)).toMatchObject({ status: 'sent', errorCode: null });
    expect(of(b.org.id)).toMatchObject({ status: 'sent', errorCode: null });
    // A viewer grant can't create campaigns in the client.
    expect(of(c.id)).toMatchObject({ status: 'failed', errorCode: 'forbidden' });

    const ra = await recipients(a.org.id, of(a.org.id)?.clientCampaignId as string);
    const rb = await recipients(b.org.id, of(b.org.id)?.clientCampaignId as string);
    const aIds = new Set(ra.map((r) => r.contact_id));
    const bIds = new Set(rb.map((r) => r.contact_id));
    expect([...aIds].some((id) => bIds.has(id))).toBe(false);
    expect(aIds.has(bYes)).toBe(false);
    expect(bIds.has(aYes)).toBe(false);
    const ofA = (id: string) => ra.find((r) => r.contact_id === id);
    expect(ofA(aYes)).toMatchObject({ status: 'pending', reason: null });
    expect(ofA(aNone)).toMatchObject({ status: 'excluded', reason: 'consent_missing' });
    expect(ofA(aGone)).toMatchObject({ status: 'excluded', reason: 'consent_withdrawn' });
    // b's own consent: the address a never consented with is consented in b.
    expect(rb.find((r) => r.contact_id === bShared)).toMatchObject({ status: 'pending' });
    // Every recipient row belongs to its own org's crm.
    const foreign = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ n: number }>(
        sql`select count(*)::int as n from campaigns.campaign_recipients r
            where r.campaign_id = ${of(a.org.id)?.clientCampaignId as string}
              and not exists (select 1 from crm.contacts c where c.id = r.contact_id)`,
      ),
    );
    expect(foreign[0]?.n).toBe(0);
    // The client's footer is its own postal address.
    const [content] = await withTenant(systemCtx(b.org.id), (tx) =>
      tx.execute<{ content: string }>(
        sql`select content::text as content from campaigns.campaigns where id = ${of(b.org.id)?.clientCampaignId as string}`,
      ),
    );
    expect(content?.content).toContain('9 Harbor St, Boston MA');
    expect(content?.content).not.toContain('1 Lake Road');

    const list = await executeQuery(agencyFanoutsQuery, {}, agencyCtx(), ports);
    expect(list.find((f) => f.id === out.fanoutId)?.targets).toHaveLength(3);
    const view = await executeQuery(clientAgencyOpsQuery, {}, a.ctx(), ports);
    expect(
      view.items.some((i) => i.kind === 'campaign' && i.localId === of(a.org.id)?.clientCampaignId),
    ).toBe(true);
  });

  it('a client without a postal address gets a draft to finish; draft mode never sends', async () => {
    // c's grant becomes marketing; c has no campaign yet, so no postal address.
    await withTenant(systemCtx(c.id), (tx) =>
      tx.execute(sql`update tenancy.org_access_grants set role = 'marketing' where id = ${grantC}`),
    );
    const out = await fanOutCampaign(
      agencyCtx(),
      {
        name: `Draft news ${uuidv7().slice(-6)}`,
        subject: 'News',
        heading: 'News',
        body: 'Body',
        audience: 'attendees',
        mode: 'draft',
        clientOrgIds: [c.id, a.org.id],
      },
      ports,
    );
    expect(out.targets.find((x) => x.clientOrgId === c.id)).toMatchObject({ status: 'needs_address' });
    const ta = out.targets.find((x) => x.clientOrgId === a.org.id);
    expect(ta).toMatchObject({ status: 'draft' });
    expect(await recipients(a.org.id, ta?.clientCampaignId as string)).toHaveLength(0);
    // A member of the agency without `agency:campaigns` (a collaborator) is refused.
    const e = await errorOf(
      fanOutCampaign(
        agencyCtx(freelancer),
        {
          name: 'Nope',
          subject: 'x',
          heading: 'x',
          body: 'x',
          audience: 'everyone',
          mode: 'draft',
          clientOrgIds: [a.org.id],
        },
        ports,
      ),
    );
    expect(e.code).toBe('forbidden');
  });
});

describe('team and day-of grants', () => {
  it('a named team narrows who acts through the grant; roles stay under the grant', async () => {
    expect(await agencyAccess(userCtx(marketer, a.org.id))).not.toBeNull();
    const team = await executeCommand(
      assignStaffCommand,
      { kind: 'team', clientOrgId: a.org.id, userId: staff, role: 'manager' },
      agencyCtx(),
      ports,
    );
    expect(team).toMatchObject({ kind: 'team', role: 'manager', clientOrgId: a.org.id });
    expect((await agencyAccess(userCtx(staff, a.org.id)))?.role).toBe('manager');
    // Not on the team: no access any more, on the next request (and not in the switcher).
    expect(await agencyAccess(userCtx(marketer, a.org.id))).toBeNull();
    expect((await myAgencyClients(marketer)).map((x) => x.orgId)).not.toContain(a.org.id);
    expect(
      (await errorOf(executeQuery(listEventsQuery, {}, via(marketer, a.org.id, grantA), ports))).code,
    ).toBe('forbidden');
    // Under b's marketing grant, a manager team role is capped at marketing.
    const capped = await executeCommand(
      assignStaffCommand,
      { kind: 'team', clientOrgId: b.org.id, userId: marketer, role: 'manager' },
      agencyCtx(),
      ports,
    );
    expect(capped.role).toBe('marketing');
    // Collaborators can't be on a team; strangers can't be named at all.
    const collab = await errorOf(
      executeCommand(
        assignStaffCommand,
        { kind: 'team', clientOrgId: a.org.id, userId: freelancer, role: 'viewer' },
        agencyCtx(),
        ports,
      ),
    );
    expect(collab.code).toBe('validation_failed');
    const stranger = await errorOf(
      executeCommand(
        assignStaffCommand,
        { kind: 'team', clientOrgId: a.org.id, userId: uuidv7(), role: 'viewer' },
        agencyCtx(),
        ports,
      ),
    );
    expect(stranger.code).toBe('validation_failed');
    // The marketer (no agency:manage) can't change the team.
    const notAllowed = await errorOf(
      executeCommand(
        assignStaffCommand,
        { kind: 'team', clientOrgId: a.org.id, userId: marketer, role: 'viewer' },
        agencyCtx(marketer),
        ports,
      ),
    );
    expect(notAllowed.code).toBe('forbidden');
    // The client sees the team; another org sees none of it.
    const clientList = await executeQuery(listAgencyStaffGrantsQuery, {}, a.ctx(), ports);
    expect(clientList.some((s) => s.id === team.id)).toBe(true);
    const other = await executeQuery(listAgencyStaffGrantsQuery, {}, b.ctx(), ports);
    expect(other.some((s) => s.id === team.id)).toBe(false);
  });

  it('a day-of pass works only inside its window and stops on revoke at the next request', async () => {
    const event = await executeCommand(
      createEventCommand,
      {
        name: 'Spring gala',
        slug: `spring-gala-${uuidv7().slice(-6)}`,
        startsAt: new Date(Date.now() + 3_600_000).toISOString(),
        endsAt: new Date(Date.now() + 4 * 3_600_000).toISOString(),
        timezone: 'America/Chicago',
      },
      a.ctx(),
      ports,
    );
    const now = Date.now();
    // Too long, or already over: refused.
    const tooLong = await errorOf(
      executeCommand(
        assignStaffCommand,
        {
          kind: 'day_of',
          clientOrgId: a.org.id,
          userId: freelancer,
          role: 'viewer',
          eventId: event.id,
          startsAt: new Date(now),
          endsAt: new Date(now + 80 * 3_600_000),
        },
        agencyCtx(),
        ports,
      ),
    );
    expect(tooLong.code).toBe('validation_failed');
    // A pass for later: no access before it starts.
    await executeCommand(
      assignStaffCommand,
      {
        kind: 'day_of',
        clientOrgId: a.org.id,
        userId: freelancer,
        role: 'viewer',
        eventId: event.id,
        startsAt: new Date(now + 2 * 3_600_000),
        endsAt: new Date(now + 5 * 3_600_000),
      },
      agencyCtx(),
      ports,
    );
    expect(await agencyAccess(userCtx(freelancer, a.org.id))).toBeNull();
    // The default window: three hours either side of the event, so it is in force now.
    const pass = await executeCommand(
      assignStaffCommand,
      { kind: 'day_of', clientOrgId: a.org.id, userId: freelancer, role: 'manager', eventId: event.id },
      agencyCtx(),
      ports,
    );
    expect(pass.endsAt?.getTime()).toBe(new Date(event.endsAt).getTime() + 3 * 3_600_000);
    const fctx = via(freelancer, a.org.id, grantA);
    expect((await agencyAccess(userCtx(freelancer, a.org.id)))?.role).toBe('manager');
    expect(await executeQuery(listEventsQuery, {}, fctx, ports)).toBeTruthy();
    const staffList = await executeQuery(agencyStaffQuery, {}, agencyCtx(), ports);
    expect(staffList.some((s) => s.id === pass.id && s.clientOrgId === a.org.id)).toBe(true);
    // On time: once its end passes, the same context is refused.
    await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute(
        sql`update tenancy.agency_staff_grants set starts_at = now() - interval '2 hours', ends_at = now() - interval '1 second' where id = ${pass.id}`,
      ),
    );
    expect((await errorOf(executeQuery(listEventsQuery, {}, fctx, ports))).code).toBe('forbidden');
    // A new pass, then the agency revokes it: refused on the next request.
    const second = await executeCommand(
      assignStaffCommand,
      { kind: 'day_of', clientOrgId: a.org.id, userId: freelancer, role: 'viewer', eventId: event.id },
      agencyCtx(),
      ports,
    );
    expect(await executeQuery(listEventsQuery, {}, fctx, ports)).toBeTruthy();
    await executeCommand(
      revokeStaffCommand,
      { clientOrgId: a.org.id, staffGrantId: second.id },
      agencyCtx(),
      ports,
    );
    expect((await errorOf(executeQuery(listEventsQuery, {}, fctx, ports))).code).toBe('forbidden');
    // And the client revokes one itself.
    const third = await executeCommand(
      assignStaffCommand,
      { kind: 'day_of', clientOrgId: a.org.id, userId: freelancer, role: 'viewer', eventId: event.id },
      agencyCtx(),
      ports,
    );
    expect(await executeQuery(listEventsQuery, {}, fctx, ports)).toBeTruthy();
    await executeCommand(revokeAgencyStaffGrantCommand, { staffGrantId: third.id }, a.ctx(), ports);
    expect((await errorOf(executeQuery(listEventsQuery, {}, fctx, ports))).code).toBe('forbidden');
    // Another org can't revoke a's rows (row security: not found).
    const cross = await errorOf(
      executeCommand(revokeAgencyStaffGrantCommand, { staffGrantId: third.id }, b.ctx(), ports),
    );
    expect(cross.code).toBe('not_found');
  });
});

describe('handover and detach', () => {
  const counts = async (orgId: string) =>
    withTenant(systemCtx(orgId), async (tx) => {
      const [r] = await tx.execute<{
        events: number;
        templates: number;
        kits: number;
        campaigns: number;
        contacts: number;
      }>(
        sql`select (select count(*)::int from events.events) as events,
                   (select count(*)::int from templates.event_templates) as templates,
                   (select count(*)::int from agency_ops.brand_kits) as kits,
                   (select count(*)::int from campaigns.campaigns) as campaigns,
                   (select count(*)::int from crm.contacts) as contacts`,
      );
      return r;
    });

  it('detaching leaves the client all its data and none of the agency templates’ private parts', async () => {
    const before = await counts(a.org.id);
    // Neither a viewer member nor the agency (through its grant) can detach.
    const viewer = uuidv7();
    await executeCommand(addMemberCommand, { userId: viewer, role: 'viewer' }, a.ctx(), ports);
    expect(
      (
        await errorOf(
          executeCommand(detachAgencyCommand, { grantId: grantA }, userCtx(viewer, a.org.id), ports),
        )
      ).code,
    ).toBe('forbidden');
    expect(
      (
        await errorOf(
          executeCommand(detachAgencyCommand, { grantId: grantA }, via(staff, a.org.id, grantA), ports),
        )
      ).code,
    ).toBe('forbidden');
    const staffCtx = via(staff, a.org.id, grantA);
    expect(await executeQuery(listEventsQuery, {}, staffCtx, ports)).toBeTruthy();

    const r = await executeCommand(detachAgencyCommand, { grantId: grantA }, a.ctx(), ports);
    expect(r).toMatchObject({ agencyOrgId: agencyId, initiatedBy: 'client' });
    expect(r.templatesKept).toBeGreaterThanOrEqual(1);
    expect(r.brandKitsKept).toBeGreaterThanOrEqual(1);
    expect(r.campaignsKept).toBeGreaterThanOrEqual(2);
    expect(r.staffRevoked).toBeGreaterThanOrEqual(1);
    // All of the client's data is still there.
    expect(await counts(a.org.id)).toEqual(before);
    // The agency is out on the next request.
    expect((await errorOf(executeQuery(listEventsQuery, {}, staffCtx, ports))).code).toBe('forbidden');
    expect(await agencyAccess(userCtx(staff, a.org.id))).toBeNull();
    // No link back to the agency's originals, and nothing private of the agency anywhere in a.
    const [links] = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ live: number }>(
        sql`select count(*)::int as live from agency_ops.received_items where agency_org_id = ${agencyId} and (source_id is not null or detached_at is null)`,
      ),
    );
    expect(links?.live).toBe(0);
    const [leak] = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ n: number }>(
        sql`select (select count(*)::int from templates.event_templates
                    where snapshot::text like ${`%${NOTE}%`} or coalesce(description, '') like ${`%${NOTE}%`})
             + (select count(*)::int from agency_ops.brand_kits
                    where coalesce(private_notes, '') like ${`%${KIT_NOTE}%`} or received_from_agency_org_id is not null and private_notes is not null)
             + (select count(*)::int from agency_ops.template_settings where coalesce(private_notes, '') like ${`%${NOTE}%`}) as n`,
      ),
    );
    expect(leak?.n).toBe(0);
    // The client's copy keeps none of the parts the agency kept private.
    const copy = (await executeQuery(listTemplatesQuery, {}, a.ctx(), ports)).find((t) =>
      t.name.startsWith('Gala kit'),
    );
    expect(copy).toMatchObject({ questions: 0, seats: 0 });
    // The agency's side is marked by the subscriber; a new publish no longer reaches a.
    await catchUpSubscriber(agencyDetachSubscriber, a.org.id);
    const lib = await executeQuery(agencyLibraryQuery, {}, agencyCtx(), ports);
    expect(
      lib.publications.filter((p) => p.clientOrgId === a.org.id).every((p) => p.status === 'detached'),
    ).toBe(true);
    const again = await publishTemplate(agencyCtx(), { templateId, clientOrgIds: [a.org.id] }, ports);
    expect(again).toEqual([{ clientOrgId: a.org.id, status: 'failed', errorCode: 'not_found' }]);
    const view = await executeQuery(clientAgencyOpsQuery, {}, a.ctx(), ports);
    expect(view.detachments[0]).toMatchObject({ grantId: grantA, initiatedBy: 'client' });
    // Detaching twice: the grant is gone.
    expect(
      (await errorOf(executeCommand(detachAgencyCommand, { grantId: grantA }, a.ctx(), ports))).code,
    ).toBe('not_found');
  });

  it('the agency hands a client over (step-up): the same detach, recorded on both sides', async () => {
    const before = await counts(b.org.id);
    const stale = await errorOf(handOverClient(staleCtx(agencyCtx()), { clientOrgId: b.org.id }, ports));
    expect(stale.code).toBe('step_up_required');
    const marketerRefused = await errorOf(
      handOverClient(agencyCtx(marketer), { clientOrgId: b.org.id }, ports),
    );
    expect(marketerRefused.code).toBe('forbidden');
    const r = await handOverClient(agencyCtx(), { clientOrgId: b.org.id }, ports);
    expect(r).toMatchObject({ grantId: grantB, initiatedBy: 'agency' });
    expect(await counts(b.org.id)).toEqual(before);
    expect(await agencyAccess(userCtx(marketer, b.org.id))).toBeNull();
    const clientLog = await executeQuery(auditLogQuery, { limit: 100 }, b.ctx(), ports);
    expect(clientLog.entries.some((e) => e.action === 'agency.handover' && e.targetId === grantB)).toBe(true);
    const agencyLog = await executeQuery(auditLogQuery, { limit: 100 }, userCtx(owner, agencyId), ports);
    expect(agencyLog.entries.some((e) => e.action === 'agency.handover' && e.targetId === b.org.id)).toBe(
      true,
    );
    // A system actor can't detach without naming the agency person, and a user can't name one.
    const bad = await errorOf(
      executeCommand(
        detachAgencyCommand,
        { grantId: grantC, handoverBy: staff },
        userCtx(c.owner, c.id),
        ports,
      ),
    );
    expect(bad.code).toBe('forbidden');
    const sys = await errorOf(
      executeCommand(
        detachAgencyCommand,
        { grantId: grantC },
        createCtx({ orgId: c.id, actor: { type: 'system', name: 'agency.handover' } }),
        ports,
      ),
    );
    expect(sys.code).toBe('forbidden');
  });
});
