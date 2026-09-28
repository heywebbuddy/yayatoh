'use server';

import { type Ctx, executeCommand, isDomainError } from '@yayatoh/kernel';
import {
  liftAutoPauseCommand,
  QUOTA_CHANNELS,
  type QuotaChannel,
  setQuotaLimitCommand,
} from '@yayatoh/notifications';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { ports } from '@/server/ports.ts';
import { requireStaff } from '@/server/staff.ts';

const Id = z.uuid();

/** Run one staff command for an org, then come back to its messaging page with the outcome. */
async function run(
  orgId: string,
  action: 'messaging' | 'quotas',
  done: string,
  fn: (ctx: Ctx) => Promise<unknown>,
) {
  if (!Id.safeParse(orgId).success) redirect('/');
  const staff = await requireStaff(action);
  let outcome: string;
  try {
    await fn(staff.ctx(orgId));
    outcome = `done=${done}`;
  } catch (err) {
    outcome = `error=${isDomainError(err) ? String(err.details?.reason ?? err.code) : 'internal'}`;
  }
  revalidatePath(`/tenants/${orgId}/messaging`);
  redirect(`/tenants/${orgId}/messaging?${outcome}`);
}

/** Lift a complaint-rate auto-pause after review (admin and support; note required; audited). */
export async function liftAutoPauseAction(orgId: string, form: FormData) {
  await run(orgId, 'messaging', 'lifted', (ctx) =>
    executeCommand(liftAutoPauseCommand, { note: String(form.get('note') ?? '') }, ctx, ports),
  );
}

/** Set (or reset) one channel's monthly quota (admin and finance; reason required; audited). */
export async function quotaAction(orgId: string, channel: QuotaChannel, form: FormData) {
  if (!QUOTA_CHANNELS.includes(channel)) redirect('/');
  const raw = String(form.get('limit') ?? '').trim();
  const reset = form.get('intent') === 'reset';
  await run(orgId, 'quotas', reset ? 'quota_reset' : 'quota', (ctx) =>
    executeCommand(
      setQuotaLimitCommand,
      {
        channel,
        monthlyLimit: reset ? null : /^\d+$/.test(raw) ? Number(raw) : Number.NaN,
        reason: String(form.get('reason') ?? ''),
      },
      ctx,
      ports,
    ),
  );
}
