import { randomBytes } from 'node:crypto';
import { generateTotpSecret, secretKey, setupKey, totp } from '@yayatoh/auth/totp';
import { createCtx, executeCommand } from '@yayatoh/kernel';
import { addMemberCommand, createOrganization, resolveOrgSlug } from '@yayatoh/tenancy';
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
  if (form.get('org') === 'new') {
    const org = await createOrganization(
      createCtx({ actor: { type: 'user', userId: user.id } }),
      { slug: `e2e-${stamp}`, name: `Test Org ${stamp}` },
      ports,
    );
    orgSlug = org.slug;
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
  const res = NextResponse.json({
    email,
    orgSlug,
    setupKey: secret ? setupKey(secret) : null,
    backupCodes,
  });
  for (const c of cookies) res.headers.append('set-cookie', c);
  return res;
}
