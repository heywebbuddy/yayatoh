import { recordTermConsentTx } from '@yayatoh/crm';
import { withTenant } from '@yayatoh/db';
import {
  createEventCommand,
  createPortalSession,
  portalInviteToken,
  portalInviteUrl,
  transitionEventCommand,
} from '@yayatoh/events';
import { type Ctx, createCtx, executeCommand, executeQuery } from '@yayatoh/kernel';
import { acceptLeadTermsCommand, LEAD_TERMS_VERSION, syncLeadScansCommand } from '@yayatoh/leads';
import { orderByManageToken } from '@yayatoh/orders';
import {
  createExhibitorCommand,
  inviteExhibitorMemberCommand,
  portalAssignLeadLicenseCommand,
  saveLeadLicenseSettingsCommand,
} from '@yayatoh/program';
import {
  registrationSetupQuery,
  seedRegistrationDefaultsCommand,
  setCellCommand,
  startRegistrationCommand,
} from '@yayatoh/registration';
import { resolveOrgSlug } from '@yayatoh/tenancy';
import { issueHolderLinkTx } from '@yayatoh/ticketing';
import { type NextRequest, NextResponse } from 'next/server';
import { ports } from '@/server/ports.ts';
import { requestHost } from '@/server/request-origin.ts';
import { devAuthEnabled } from '@/server/session.ts';

const MIN = 60_000;
const HOUR = 60 * MIN;

/**
 * Dev/CI only (M5.6b e2e): a published conference with free registration and an exhibitor
 * ("Booth {name}") whose admin and staff member are invited (their invitation links are
 * returned), 2 lead licenses included and the admin holding one. Registrants: Ana (agreed to
 * share her email with exhibitors), Ben and Cleo (did not); Ana's ticket holder link. `phase`:
 * `open` (under way) or `closed` (ended 49 h ago: capture closed). With `ready=1` the admin has
 * accepted the lead terms and captured Ana and Ben, and an admin session signed in 11 minutes
 * ago is returned (for the export's step-up). 404 unless dev auth is on; never in production.
 */
export async function POST(req: NextRequest) {
  if (!devAuthEnabled()) return new NextResponse(null, { status: 404 });
  const form = await req.formData();
  const slug = String(form.get('org') ?? '');
  const org = /^[a-z0-9-]{1,63}$/.test(slug) ? await resolveOrgSlug(slug) : null;
  if (!org) return NextResponse.json({ error: 'unknown_org' }, { status: 404 });
  const name = String(form.get('name') ?? 'Lead Expo').slice(0, 60);
  const closed = form.get('phase') === 'closed';
  const ready = form.get('ready') === '1';
  const now = Date.now();
  const ctx = createCtx({ orgId: org.orgId, actor: { type: 'system', name: 'dev.leads' } });
  const startsAt = new Date(now - (closed ? 60 * HOUR : HOUR));
  const endsAt = new Date(now + (closed ? -49 * HOUR : 8 * HOUR));
  const ev = await executeCommand(
    createEventCommand,
    { name, profile: 'conference', timezone: 'America/Chicago', startsAt, endsAt },
    ctx,
    ports,
  );
  await executeCommand(seedRegistrationDefaultsCommand, { eventId: ev.id, names: {} }, ctx, ports);
  const setup = await executeQuery(registrationSetupQuery, { eventId: ev.id }, ctx, ports);
  const member = setup.types.find((t) => t.key === 'member')?.id as string;
  const full = setup.items.find((i) => i.key === 'full_pass')?.id as string;
  await executeCommand(
    setCellCommand,
    { eventId: ev.id, registrationTypeId: member, admissionItemId: full, priceMinor: 0 },
    ctx,
    ports,
  );
  await executeCommand(transitionEventCommand, { eventId: ev.id, transition: 'publish' }, ctx, ports);
  await executeCommand(
    saveLeadLicenseSettingsCommand,
    { eventId: ev.id, includedLeadLicenses: 2, leadLicensePriceMinor: null },
    ctx,
    ports,
  );
  const exhibitorName = `Booth ${name}`;
  const x = await executeCommand(createExhibitorCommand, { eventId: ev.id, name: exhibitorName }, ctx, ports);
  const tag = `${now.toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const { origin, host } = await requestHost();
  const invite = async (role: 'exhibitor_admin' | 'exhibitor_staff', who: string) => {
    const email = `${who}.${tag}@exhibitor.test`;
    const r = await executeCommand(
      inviteExhibitorMemberCommand,
      { eventId: ev.id, exhibitorId: x.id, email, role },
      ctx,
      ports,
    );
    return {
      id: r.member.id,
      email,
      invite: new URL(portalInviteUrl(origin, portalInviteToken(org.orgId, r.member.id, 1))).pathname,
    };
  };
  const admin = await invite('exhibitor_admin', 'admin');
  const staff = await invite('exhibitor_staff', 'staff');
  const adminCtx = (at = now): Ctx =>
    createCtx({
      orgId: org.orgId,
      actor: { type: 'portal', accountId: admin.id, role: 'exhibitor_admin' },
      now: new Date(at),
    });
  await executeCommand(portalAssignLeadLicenseCommand, { accountId: admin.id }, adminCtx(), ports);

  const people: { name: string; email: string; code: string }[] = [];
  for (const who of ['Ana', 'Ben', 'Cleo']) {
    const email = `${who.toLowerCase()}.${tag}@example.test`;
    const r = await executeCommand(
      startRegistrationCommand,
      {
        eventId: ev.id,
        registrationTypeId: member,
        itemIds: [full],
        buyer: { email, name: `${who} ${tag}` },
      },
      createCtx({ orgId: org.orgId, now: new Date(startsAt.getTime() - 48 * HOUR) }),
      ports,
    );
    const order = await orderByManageToken(r.manageToken);
    people.push({ name: who, email, code: order?.tickets[0]?.shortCode ?? '' });
  }
  const ana = people[0] as (typeof people)[number];
  const link = await withTenant(ctx, async (tx) => {
    // Ana agreed at registration (P5-8 consent question, version 1).
    await recordTermConsentTx(tx, ctx, {
      email: ana.email,
      name: null,
      term: 'exhibitor_email_sharing',
      version: 1,
      evidence: 'dev:leads',
    });
    return issueHolderLinkTx(tx, ctx, ev.id, ana.email);
  });

  let staleSession: string | null = null;
  if (ready) {
    const during = closed ? endsAt.getTime() - HOUR : now;
    await executeCommand(acceptLeadTermsCommand, { version: LEAD_TERMS_VERSION }, adminCtx(during), ports);
    await executeCommand(
      syncLeadScansCommand,
      {
        scans: people.slice(0, 2).map((p, i) => ({
          scanId: `dev-${tag}-${i}`,
          code: p.code,
          capturedAt: new Date(during - (2 - i) * MIN),
          offline: false,
        })),
      },
      adminCtx(during),
      ports,
    );
    staleSession = (
      await createPortalSession({ orgId: org.orgId, accountId: admin.id, host }, new Date(now - 11 * MIN))
    ).token;
  }
  return NextResponse.json({
    path: `/o/${slug}/e/${ev.id}`,
    exhibitor: exhibitorName,
    admin: { email: admin.email, invite: admin.invite },
    staff: { email: staff.email, invite: staff.invite },
    people,
    myTickets: `/my-tickets/${encodeURIComponent(link.token)}`,
    staleSession,
  });
}
