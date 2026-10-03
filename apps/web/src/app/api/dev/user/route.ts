import { randomBytes } from 'node:crypto';
import { generateTotpSecret, secretKey, setupKey, totp } from '@yayatoh/auth/totp';
import { setEntitlementOverrideCommand } from '@yayatoh/billing';
import { createEventCommand, transitionEventCommand } from '@yayatoh/events';
import { createCtx, executeCommand } from '@yayatoh/kernel';
import { catchUpListings, updateSiteSettingsCommand } from '@yayatoh/marketplace';
import { applyAccountEventCommand, recordPayoutAccountCommand } from '@yayatoh/payments';
import { saveTemplateCommand } from '@yayatoh/templates';
import {
  AGREEMENT_DOCUMENTS,
  acceptAgreementCommand,
  addMemberCommand,
  createOrganization,
  PLATFORM_AGREEMENTS,
  resolveOrgSlug,
  setLegalPageCommand,
} from '@yayatoh/tenancy';
import { createTicketTypeCommand } from '@yayatoh/ticketing';
import { type NextRequest, NextResponse } from 'next/server';
import { devLastCode, getAuth, getTwoFactor } from '@/server/auth.ts';
import { devPasswordSignIn } from '@/server/dev-sign-in.ts';
import { ports } from '@/server/ports.ts';
import { devAuthEnabled } from '@/server/session.ts';

/**
 * Development only: a throwaway account for journeys the seeded personas can't share (setting up
 * two-step verification, a fresh owner, a code-only invitee). 404 unless enabled; never in
 * production. Form fields:
 * - `password=0`: no password (signs in with an emailed code, like invitees);
 * - `org=new`: create an organization the account owns;
 * - `join=<slug>:<role>` (repeatable): add it to existing organizations;
 * - `twoFactor=1`: two-step verification already on (the setup key and backup codes come back);
 * - `signIn=0`: don't sign in.
 * - `event=published` (with `org=new`): the org accepts the terms, gets a refund policy, lists on
 *   the marketplace with its tenant site on, and publishes one event with a free and a paid pass
 *   (its slug comes back as `eventSlug`), already projected into the listings.
 * - `profile=<key>` (with `event=published`): the event's profile (M4.8a: `gala` shows Donations).
 * - `payouts=active` (with `org=new`): a fake connected account, fully enabled (gifts and direct
 *   charges, M4.8a), as if onboarding had finished.
 * - `org=agency` (M6.7a): create an agency organization the account owns, with the `agency`
 *   entitlement (staff switch it on per org, P6-13); `orgName` names it.
 * - `template=1` (with `org=agency`, M6.8b): the agency also has an event with a ticket type, saved
 *   as a template (its name comes back as `templateName`), to publish to clients.
 */
export async function POST(req: NextRequest) {
  const devPassword = process.env.DEV_PERSONA_PASSWORD;
  if (!devAuthEnabled() || !devPassword) return new NextResponse(null, { status: 404 });
  const form = await req.formData();
  const withPassword = form.get('password') !== '0';
  const stamp = `${Date.now().toString(36)}${randomBytes(3).toString('hex')}`;
  const email = `e2e-${stamp}@example.test`;
  const auth = getAuth();
  const ctx = await auth.$context;
  const user = await ctx.internalAdapter.createUser(
    { email, name: String(form.get('name') ?? '') || `Test ${stamp}`, emailVerified: true },
    { method: 'admin' },
  );
  if (withPassword)
    await ctx.internalAdapter.linkAccount({
      userId: user.id,
      providerId: 'credential',
      accountId: user.id,
      password: await ctx.password.hash(devPassword),
    });

  let orgSlug: string | null = null;
  let eventSlug: string | null = null;
  let templateName: string | null = null;
  if (form.get('org') === 'agency') {
    const org = await createOrganization(
      createCtx({ actor: { type: 'user', userId: user.id } }),
      { slug: `e2e-${stamp}`, name: String(form.get('orgName') ?? '') || `Agency ${stamp}`, kind: 'agency' },
      ports,
    );
    orgSlug = org.slug;
    await executeCommand(
      setEntitlementOverrideCommand,
      { moduleKey: 'agency', effect: 'grant', reason: 'dev test agency' },
      createCtx({ orgId: org.id, actor: { type: 'system', name: 'dev.test-user' } }),
      ports,
    );
    if (form.get('template') === '1') templateName = await agencyTemplate(org.id, user.id, stamp);
  }
  if (form.get('org') === 'new') {
    const org = await createOrganization(
      createCtx({ actor: { type: 'user', userId: user.id } }),
      { slug: `e2e-${stamp}`, name: `Test Org ${stamp}` },
      ports,
    );
    orgSlug = org.slug;
    if (form.get('event') === 'published')
      eventSlug = await publishedEvent(
        org.id,
        user.id,
        stamp,
        String(form.get('profile') ?? '') || undefined,
      );
    if (form.get('payouts') === 'active') await activePayouts(org.id, user.id);
  }
  for (const j of form.getAll('join')) {
    const [slug = '', role = ''] = String(j).split(':');
    const target = await resolveOrgSlug(slug);
    if (!target) return NextResponse.json({ error: `unknown org ${slug}` }, { status: 400 });
    await executeCommand(
      addMemberCommand,
      { userId: user.id, role },
      createCtx({ orgId: target.orgId, actor: { type: 'system', name: 'dev.test-user' } }),
      ports,
    );
  }

  let secret: string | null = null;
  let backupCodes: string[] = [];
  if (form.get('twoFactor') === '1') {
    secret = generateTotpSecret();
    const tf = getTwoFactor();
    await tf.begin(user.id, email, { secret });
    ({ backupCodes } = await tf.confirm(user.id, totp(secretKey(secret), Date.now())));
    // Enrolling used the current code; the tools' own sign-in below uses it again.
    await tf.forgetUsedCodes(user.id);
  }

  let cookies: string[] = [];
  if (form.get('signIn') !== '0') {
    if (withPassword) {
      cookies = (await devPasswordSignIn(email, devPassword, secret, req.headers)) ?? [];
    } else {
      await auth.api.sendVerificationOTP({ body: { email, type: 'sign-in' } });
      const res = await auth.api.signInEmailOTP({
        body: { email, otp: (await devLastCode(email)) ?? '' },
        asResponse: true,
      });
      cookies = res.headers.getSetCookie();
    }
  }
  // The tools used the current authenticator code; the test types that same code next.
  if (secret) await getTwoFactor().forgetUsedCodes(user.id);
  const res = NextResponse.json({
    email,
    orgSlug,
    eventSlug,
    templateName,
    setupKey: secret ? setupKey(secret) : null,
    backupCodes,
  });
  for (const c of cookies) res.headers.append('set-cookie', c);
  return res;
}

/** M6.8b: an agency's draft event with a pass, saved as a template; returns the template's name. */
async function agencyTemplate(orgId: string, userId: string, stamp: string): Promise<string> {
  const ctx = createCtx({ orgId, actor: { type: 'user', userId }, stepUpAt: new Date() });
  const starts = new Date(Date.now() + 45 * 86_400_000);
  const event = await executeCommand(
    createEventCommand,
    {
      name: `Agency Gala ${stamp}`,
      slug: `agency-gala-${stamp}`,
      timezone: 'America/New_York',
      startsAt: starts.toISOString(),
      endsAt: new Date(starts.getTime() + 4 * 3_600_000).toISOString(),
    },
    ctx,
    ports,
  );
  await executeCommand(
    createTicketTypeCommand,
    { eventId: event.id, name: 'Gala seat', priceMinor: 12_500, quantityTotal: 200 },
    ctx,
    ports,
  );
  const name = `Gala kit ${stamp}`;
  await executeCommand(saveTemplateCommand, { eventId: event.id, name }, ctx, ports);
  return name;
}

/** A public, published event with a free and a paid pass in a fresh org (see `event=published`). */
async function publishedEvent(
  orgId: string,
  userId: string,
  stamp: string,
  profile?: string,
): Promise<string> {
  const ctx = createCtx({ orgId, actor: { type: 'user', userId }, stepUpAt: new Date() });
  for (const document of AGREEMENT_DOCUMENTS)
    await executeCommand(
      acceptAgreementCommand,
      { document, version: PLATFORM_AGREEMENTS[document].version },
      ctx,
      ports,
    );
  await executeCommand(
    setLegalPageCommand,
    { kind: 'refund', body: 'Refunds up to a week before.' },
    ctx,
    ports,
  );
  await executeCommand(updateSiteSettingsCommand, { listOnMarketplace: true, tenantSite: true }, ctx, ports);
  const starts = new Date(Date.now() + 30 * 86_400_000);
  const event = await executeCommand(
    createEventCommand,
    {
      name: `Test Show ${stamp}`,
      slug: `test-show-${stamp}`,
      timezone: 'America/New_York',
      startsAt: starts.toISOString(),
      endsAt: new Date(starts.getTime() + 3 * 3_600_000).toISOString(),
      city: 'Boston',
      country: 'US',
      ...(profile ? { profile } : {}),
    },
    ctx,
    ports,
  );
  await executeCommand(
    createTicketTypeCommand,
    { eventId: event.id, name: 'Free entry', priceMinor: 0, quantityTotal: 50 },
    ctx,
    ports,
  );
  await executeCommand(
    createTicketTypeCommand,
    { eventId: event.id, name: 'Supporter', priceMinor: 1500, quantityTotal: 50 },
    ctx,
    ports,
  );
  await executeCommand(transitionEventCommand, { eventId: event.id, transition: 'publish' }, ctx, ports);
  await catchUpListings(orgId);
  return event.slug;
}

/** A fake connected account that finished onboarding (see `payouts=active`). */
async function activePayouts(orgId: string, userId: string) {
  const ctx = createCtx({ orgId, actor: { type: 'user', userId }, stepUpAt: new Date() });
  const { accountId } = await executeCommand(
    recordPayoutAccountCommand,
    { provider: 'fake', accountId: `fakeacct_${orgId.replace(/-/g, '').slice(-16)}`, country: 'US' },
    ctx,
    ports,
  );
  await executeCommand(
    applyAccountEventCommand,
    {
      provider: 'fake',
      id: `fakeevt_dev_${orgId}`,
      type: 'account.updated',
      orgId,
      account: {
        accountId,
        chargesEnabled: true,
        payoutsEnabled: true,
        detailsSubmitted: true,
        requirementsDue: [],
        country: 'US',
        defaultCurrency: 'usd',
      },
    },
    createCtx({ orgId, actor: { type: 'system', name: 'dev.test-user' } }),
    ports,
  );
}
