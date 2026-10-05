'use server';

import { rsvpAnswersExportBulk, rsvpAnswersPrivateExportBulk } from '@yayatoh/guests';
import { executeCommand, isDomainError } from '@yayatoh/kernel';
import { getLocale, getTranslations } from 'next-intl/server';
import { redirect } from '@/i18n/navigation.ts';
import { runBulkInline } from '@/server/bulk.ts';
import { loadEvent } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';

/**
 * Export the guests' RSVP answers as CSV through the bulk framework (M4.1e): a recent step-up,
 * `attendees:export`; members who may see private answers (`attendees:export_private`) get the
 * private columns too. Small exports finish in this request; the page then offers the download.
 */
export async function exportAnswersAction(
  org: string,
  event: string,
  _form: FormData,
): Promise<{ code: string } | undefined> {
  const locale = await getLocale();
  const { data, event: ev, can } = await loadEvent(org, event, 'guests');
  const t = await getTranslations('rsvpAnswers.exportColumns');
  const back = `/o/${org}/e/${event}/guests/answers`;
  const bulk = can('attendees:export_private') ? rsvpAnswersPrivateExportBulk : rsvpAnswersExportBulk;
  let operationId: string;
  try {
    ({ operationId } = await executeCommand(
      bulk.start,
      {
        eventId: ev.id,
        selection: { filter: {} },
        params: {
          headers: {
            party: t('party'),
            guest: t('guest'),
            age: t('age'),
            meal: t('meal'),
            dietary: t('dietary'),
            accessibility: t('accessibility'),
          },
          statuses: {
            attending: t('attending'),
            declined: t('declined'),
            awaiting: t('awaiting'),
            notInvited: t('notInvited'),
          },
          ages: { adult: t('adult'), child: t('child'), infant: t('infant') },
          yes: t('yes'),
          no: t('no'),
        },
      },
      data.ctx,
      ports,
    ));
  } catch (err) {
    const code = isDomainError(err) ? err.code : 'internal';
    if (code === 'step_up_required') return { code };
    return redirect({ href: `${back}?exportError=${code}`, locale });
  }
  await runBulkInline(data.org.id, operationId);
  redirect({ href: `${back}?op=${operationId}`, locale });
}
