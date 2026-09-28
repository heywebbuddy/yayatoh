'use server';

import { setEntitlementOverrideCommand, setFeeOverrideCommand } from '@yayatoh/billing';
import { type Ctx, executeCommand, isDomainError } from '@yayatoh/kernel';
import {
  markEvidenceSubmittedCommand,
  resolveReconciliationItemCommand,
  setPayoutHoldCommand,
} from '@yayatoh/payments';
import { SUSPENSION_KINDS, type SuspensionKind, setSuspensionCommand } from '@yayatoh/tenancy';
import { revalidatePath } from 'next/cache';
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

/** Close a reconciliation difference with a note (staff with payout powers; audited). */
export async function resolveReconciliationAction(orgId: string, itemId: string, form: FormData) {
  if (!Id.safeParse(itemId).success) redirect('/');
  await run(orgId, 'payouts', 'reconciled', (ctx) =>
    executeCommand(
      resolveReconciliationItemCommand,
      { itemId, note: String(form.get('note') ?? '') },
      ctx,
      ports,
    ),
  );
}
