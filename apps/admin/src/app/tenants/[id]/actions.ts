'use server';

import {
  endImpersonation,
  getUsersByIds,
  IMPERSONATION_MAX_MS,
  impersonationReason,
  normalizeHandoffHost,
  startImpersonation,
} from '@yayatoh/auth';
import { setEntitlementOverrideCommand, setFeeOverrideCommand } from '@yayatoh/billing';
import { withPlatformReader } from '@yayatoh/db/platform';
import { type Ctx, executeCommand, executeQuery, isDomainError, uuidv7 } from '@yayatoh/kernel';
import { markEvidenceSubmittedCommand, setPayoutHoldCommand } from '@yayatoh/payments';
import {
  endImpersonationCommand,
  getOrganizationQuery,
  SUSPENSION_KINDS,
  type SuspensionKind,
  setSuspensionCommand,
  startImpersonationCommand,
} from '@yayatoh/tenancy';
import { sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { getPaymentProvider } from '@/server/payments.ts';
import { ports } from '@/server/ports.ts';
import { requireStaff, type StaffAction } from '@/server/staff.ts';

const Id = z.uuid();

/** Run one staff command for an org, then come back to the tenant page with the outcome. */
async function run(orgId: string, action: StaffAction, done: string, fn: (ctx: Ctx) => Promise<unknown>) {
  if (!Id.safeParse(orgId).success) redirect('/');
  const staff = await requireStaff(action);
  let outcome: string;
  try {
    await fn(staff.ctx(orgId));
    outcome = `done=${done}`;
  } catch (err) {
    outcome = `error=${isDomainError(err) ? err.code : 'internal'}`;
  }
  revalidatePath(`/tenants/${orgId}`);
  redirect(`/tenants/${orgId}?${outcome}`);
}

const reasonOf = (form: FormData) => String(form.get('reason') ?? '');

export async function suspensionAction(orgId: string, kind: SuspensionKind, paused: boolean, form: FormData) {
  if (!SUSPENSION_KINDS.includes(kind)) redirect('/');
  await run(orgId, 'suspend', paused ? 'paused' : 'resumed', (ctx) =>
    executeCommand(setSuspensionCommand, { kind, paused, reason: reasonOf(form) }, ctx, ports),
  );
}

export async function payoutHoldAction(orgId: string, held: boolean, form: FormData) {
  await run(orgId, 'payouts', held ? 'held' : 'released', (ctx) =>
    executeCommand(setPayoutHoldCommand, { held, reason: reasonOf(form) }, ctx, ports),
  );
}

export async function feeOverrideAction(orgId: string, form: FormData) {
  await run(orgId, 'fees', 'fee', (ctx) =>
    executeCommand(
      setFeeOverrideCommand,
      {
        currency: String(form.get('currency') ?? '').toUpperCase(),
        percentBps: Number(form.get('percentBps') ?? Number.NaN),
        fixedMinor: Number(form.get('fixedMinor') ?? Number.NaN),
        reason: reasonOf(form),
      },
      ctx,
      ports,
    ),
  );
}

export async function entitlementAction(orgId: string, form: FormData) {
  await run(orgId, 'entitlements', 'entitlement', (ctx) =>
    executeCommand(
      setEntitlementOverrideCommand,
      {
        moduleKey: String(form.get('moduleKey') ?? ''),
        effect: form.get('effect') === 'revoke' ? 'revoke' : 'grant',
        reason: reasonOf(form),
      },
      ctx,
      ports,
    ),
  );
}

/**
 * Submit a dispute's evidence after a person reviewed the packet (platform_mor: Yayatoh is the
 * merchant). The reviewer confirms they read it; the summary goes to the provider with the packet.
 */
export async function submitEvidenceAction(
  orgId: string,
  disputeId: string,
  providerDisputeId: string,
  form: FormData,
) {
  if (form.get('reviewed') !== 'yes') redirect(`/tenants/${orgId}?error=not_reviewed`);
  const summary = String(form.get('summary') ?? '').trim();
  await run(orgId, 'payouts', 'evidence', async (ctx) => {
    const r = await getPaymentProvider().submitDisputeEvidence({
      providerDisputeId,
      summary,
      idempotencyKey: `evidence:${disputeId}`,
    });
    if (r.status !== 'submitted') throw new Error('The provider did not accept the evidence');
    return executeCommand(markEvidenceSubmittedCommand, { disputeId }, ctx, ports);
  });
}

/** The app host staff are sent to (app.yayatoh.com in production; the web's origin elsewhere). */
const appOrigin = () =>
  process.env.NEXT_PUBLIC_APP_ORIGIN ?? process.env.BETTER_AUTH_URL ?? 'http://localhost:3000';
const adminOrigin = () => process.env.ADMIN_AUTH_URL ?? 'http://localhost:3001';

/**
 * Act as an org member (M1.2e): admins only, a reason required, at most one hour. The org's audit
 * log records the start (and its owners are told), the global record keeps who, whom, why and
 * when, and a one-time code takes the browser to the app host signed in as the member, with the
 * banner on every page. Platform staff can't be impersonated, nor can anyone act as themselves.
 */
export async function startImpersonationAction(orgId: string, form: FormData) {
  if (!Id.safeParse(orgId).success) redirect('/');
  const staff = await requireStaff('impersonate');
  const back = `/tenants/${orgId}`;
  const userId = String(form.get('userId') ?? '');
  const reason = impersonationReason(String(form.get('reason') ?? ''));
  if (!Id.safeParse(userId).success) redirect(`${back}?error=member_required#impersonate`);
  if (!reason) redirect(`${back}?error=reason_required#impersonate`);
  if (userId === staff.userId) redirect(`${back}?error=self#impersonate`);
  const [isStaff] = await withPlatformReader(
    { actor: staff.actor, reason: `staff console: impersonation target check ${orgId}` },
    (tx) =>
      tx.execute<{ n: number }>(
        sql`select count(*)::int as n from platform.staff where user_id = ${userId} and revoked_at is null`,
      ),
  );
  if ((isStaff?.n ?? 0) > 0) redirect(`${back}?error=staff_target#impersonate`);
  const ctx = staff.ctx(orgId);
  const member = (await getUsersByIds([userId])).get(userId);
  const id = uuidv7();
  const now = new Date();
  let code: string;
  let slug: string;
  try {
    const org = await executeQuery(getOrganizationQuery, {}, ctx, ports);
    slug = org.slug;
    await executeCommand(
      startImpersonationCommand,
      {
        impersonationId: id,
        userId,
        reason,
        expiresAt: new Date(now.getTime() + IMPERSONATION_MAX_MS),
        memberName: member?.name ?? '',
      },
      ctx,
      ports,
    );
    const app = new URL(appOrigin());
    const h = await headers();
    ({ code } = await startImpersonation({
      id,
      staffUserId: staff.userId,
      userId,
      orgId,
      reason,
      returnUrl: `${adminOrigin()}${back}?done=impersonation_ended`,
      ipAddress: h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
      appHost: normalizeHandoffHost(app.host) ?? app.host,
      returnPath: `/o/${slug}`,
      now,
    }));
  } catch (err) {
    redirect(`${back}?error=${isDomainError(err) ? err.code : 'internal'}#impersonate`);
  }
  redirect(`${appOrigin()}/auth/handoff?code=${encodeURIComponent(code)}`);
}

/** End an open impersonation from the staff console (its session on the app host ends too). */
export async function endImpersonationAction(orgId: string, impersonationId: string) {
  if (!Id.safeParse(orgId).success || !Id.safeParse(impersonationId).success) redirect('/');
  await run(orgId, 'impersonate', 'impersonation_ended', async (ctx) => {
    const ended = await endImpersonation(impersonationId, 'ended');
    if (!ended) return;
    if (ended.orgId !== orgId) throw new Error('Impersonation belongs to another org');
    await executeCommand(
      endImpersonationCommand,
      { impersonationId, userId: ended.userId, how: 'ended' },
      ctx,
      ports,
    );
  });
}
