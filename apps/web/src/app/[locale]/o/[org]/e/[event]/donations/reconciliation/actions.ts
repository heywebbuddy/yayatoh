'use server';

import { reconcileEventDonations, resolveDonationReconItemCommand } from '@yayatoh/donations';
import { executeCommand } from '@yayatoh/kernel';
import { revalidatePath } from 'next/cache';
import type { ProgramFormState } from '@/components/program-form.tsx';
import { loadEvent } from '@/server/console.ts';
import { failure, success } from '@/server/form.ts';
import { getPaymentProvider } from '@/server/payments.ts';
import { ports } from '@/server/ports.ts';

const path = (org: string, event: string) => `/o/${org}/e/${event}/donations/reconciliation`;
const done = (org: string, event: string) => {
  revalidatePath(path(org, event));
  revalidatePath(`/o/${org}/e/${event}/donations/report`);
};

/** Compare the event's gifts with the charity's connected account now (M4.8g, finance roles). */
export async function reconcileDonationsAction(
  org: string,
  event: string,
  _prev: ProgramFormState,
  _form: FormData,
): Promise<ProgramFormState> {
  const { data, event: ev } = await loadEvent(org, event, 'donations');
  try {
    const run = await reconcileEventDonations(getPaymentProvider(), ev.id, data.ctx, ports);
    if (!run) return { ok: false, code: 'invalid_state', reason: 'provider_unavailable' };
  } catch (err) {
    return failure(err);
  }
  done(org, event);
  return success();
}

/** Close an open difference with a note (finance roles). */
export async function resolveReconItemAction(
  org: string,
  event: string,
  itemId: string,
  _prev: ProgramFormState,
  form: FormData,
): Promise<ProgramFormState> {
  const { data, event: ev } = await loadEvent(org, event, 'donations');
  try {
    await executeCommand(
      resolveDonationReconItemCommand,
      { eventId: ev.id, itemId, note: String(form.get('note') ?? '') },
      data.ctx,
      ports,
    );
  } catch (err) {
    return failure(err);
  }
  done(org, event);
  return success();
}
