'use server';

import { transitionEventCommand } from '@yayatoh/events';
import { executeCommand, isDomainError } from '@yayatoh/kernel';
import { pauseMassRefundCommand, resumeMassRefundCommand, startMassRefundCommand } from '@yayatoh/orders';
import { revalidatePath } from 'next/cache';
import { getLocale } from 'next-intl/server';
import type { StepUpActionResult } from '@/components/step-up.tsx';
import { redirect } from '@/i18n/navigation.ts';
import { loadEvent } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';

const codeOf = (err: unknown) => {
  if (!isDomainError(err)) throw err;
  return { code: err.code };
};

/**
 * Cancel the event and refund every buyer (M3.10b). The step-up is checked first, so the event is
 * not cancelled by a submission that cannot start the refunds; an event already cancelled (a
 * resubmission, or one cancelled earlier) only starts them. The batch then runs in the worker.
 */
export async function cancelAndRefundAction(
  org: string,
  event: string,
  form: FormData,
): Promise<StepUpActionResult> {
  const { data, event: ev } = await loadEvent(org, event);
  if (form.get('confirm') !== 'yes') return { code: 'validation_failed' };
  // Staff acting as a member never move money (M1.2e); everyone else confirms it's them first.
  if (data.ctx.impersonatedBy) return { code: 'impersonation_blocked' };
  if (!(await ports.stepUp.satisfied(data.ctx))) return { code: 'step_up_required' };
  let runId: string;
  try {
    if (ev.status !== 'cancelled')
      await executeCommand(transitionEventCommand, { eventId: ev.id, transition: 'cancel' }, data.ctx, ports);
    runId = (await executeCommand(startMassRefundCommand, { eventId: ev.id }, data.ctx, ports)).runId;
  } catch (err) {
    return codeOf(err);
  }
  revalidatePath(`/o/${org}/e/${event}`, 'layout');
  redirect({ href: `/o/${org}/e/${event}/cancel?run=${runId}`, locale: await getLocale() });
}

/** Postpone the event (M3.10b): tickets stay valid; every buyer holding one is emailed. */
export async function postponeAction(
  org: string,
  event: string,
  _form: FormData,
): Promise<StepUpActionResult> {
  const { data, event: ev } = await loadEvent(org, event);
  try {
    await executeCommand(transitionEventCommand, { eventId: ev.id, transition: 'postpone' }, data.ctx, ports);
  } catch (err) {
    return codeOf(err);
  }
  revalidatePath(`/o/${org}/e/${event}`, 'layout');
  redirect({ href: `/o/${org}/e/${event}/cancel`, locale: await getLocale() });
}

/** Pause or resume a mass refund (M3.10b). */
export async function steerRunAction(
  org: string,
  event: string,
  runId: string,
  to: 'pause' | 'resume',
  _form: FormData,
): Promise<StepUpActionResult> {
  const { data } = await loadEvent(org, event);
  try {
    await executeCommand(
      to === 'pause' ? pauseMassRefundCommand : resumeMassRefundCommand,
      { runId },
      data.ctx,
      ports,
    );
  } catch (err) {
    return codeOf(err);
  }
  revalidatePath(`/o/${org}/e/${event}/cancel`);
}
