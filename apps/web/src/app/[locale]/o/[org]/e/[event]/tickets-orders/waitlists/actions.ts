'use server';

import { executeCommand, isDomainError } from '@yayatoh/kernel';
import {
  offerWaitlistEntryCommand,
  removeWaitlistEntriesCommand,
  updateWaitlistCommand,
  WAITLIST_ENTRY_STATUSES,
  waitlistExportBulk,
} from '@yayatoh/orders';
import { revalidatePath } from 'next/cache';
import { getLocale, getTranslations } from 'next-intl/server';
import { redirect } from '@/i18n/navigation.ts';
import type { FormState } from '@/lib/form-state.ts';
import { runBulkInline } from '@/server/bulk.ts';
import { loadEvent } from '@/server/console.ts';
import { failure, success } from '@/server/form.ts';
import { ports } from '@/server/ports.ts';

const base = (org: string, event: string) => `/o/${org}/e/${event}/tickets-orders/waitlists`;

/** Pause or resume automatic offers and set the offer window (hours). */
export async function updateWaitlistAction(
  org: string,
  event: string,
  waitlistId: string,
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const { data } = await loadEvent(org, event);
  const hours = Number(String(form.get('offerHours') ?? '').replace(',', '.'));
  if (!Number.isFinite(hours) || hours <= 0)
    return { ok: false, code: 'validation_failed', fields: ['offerHours'] };
  try {
    await executeCommand(
      updateWaitlistCommand,
      { waitlistId, autoOffer: form.get('autoOffer') === '1', offerMinutes: Math.round(hours * 60) },
      data.ctx,
      ports,
    );
  } catch (err) {
    const f = failure(err);
    return f.code === 'validation_failed' ? { ...f, fields: ['offerHours'] } : f;
  }
  revalidatePath(base(org, event));
  return success();
}

/** Offer one person their places now (out of line order if the organizer chooses). */
export async function offerEntryAction(
  org: string,
  event: string,
  entryId: string,
  _prev: FormState,
  _form: FormData,
): Promise<FormState> {
  const { data } = await loadEvent(org, event);
  try {
    await executeCommand(offerWaitlistEntryCommand, { entryId }, data.ctx, ports);
  } catch (err) {
    return failure(err);
  }
  revalidatePath(base(org, event));
  return success();
}

/** Take one person off the list (an open offer's tickets go back). */
export async function removeEntryAction(
  org: string,
  event: string,
  entryId: string,
  _prev: FormState,
  _form: FormData,
): Promise<FormState> {
  const { data } = await loadEvent(org, event);
  try {
    await executeCommand(removeWaitlistEntriesCommand, { entryIds: [entryId] }, data.ctx, ports);
  } catch (err) {
    return failure(err);
  }
  revalidatePath(base(org, event));
  return success();
}

/**
 * Export a list as CSV through the bulk framework (a recent step-up, `attendees:export`, audited,
 * refused while staff act as a member): small lists finish in this request.
 */
export async function exportWaitlistAction(
  org: string,
  event: string,
  waitlistId: string,
  _form: FormData,
): Promise<{ code: string } | undefined> {
  const locale = await getLocale();
  const { data, event: ev } = await loadEvent(org, event);
  const t = await getTranslations('waitlist.console');
  const back = `${base(org, event)}?list=${waitlistId}`;
  let operationId: string;
  try {
    ({ operationId } = await executeCommand(
      waitlistExportBulk.start,
      {
        eventId: ev.id,
        selection: { filter: { waitlistId } },
        params: {
          headers: {
            position: t('columns.position'),
            name: t('columns.name'),
            email: t('columns.email'),
            quantity: t('columns.quantity'),
            status: t('columns.status'),
            joinedAt: t('columns.joined'),
          },
          statuses: Object.fromEntries(WAITLIST_ENTRY_STATUSES.map((s) => [s, t(`status.${s}`)])) as Record<
            (typeof WAITLIST_ENTRY_STATUSES)[number],
            string
          >,
        },
      },
      data.ctx,
      ports,
    ));
  } catch (err) {
    const code = isDomainError(err) ? err.code : 'internal';
    if (code === 'step_up_required') return { code };
    return redirect({ href: `${back}&exportError=${code}`, locale });
  }
  await runBulkInline(data.org.id, operationId);
  redirect({ href: `${back}&op=${operationId}`, locale });
}
