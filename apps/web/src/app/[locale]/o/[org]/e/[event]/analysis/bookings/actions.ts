'use server';

import { executeCommand, isDomainError } from '@yayatoh/kernel';
import { BOOKING_FILTERS, type BookingFilter, ORDER_STATUSES } from '@yayatoh/orders';
import { BOOKING_EXPORT_COLUMNS, bookingsExportBulk } from '@yayatoh/reports';
import { getLocale, getTranslations } from 'next-intl/server';
import { redirect } from '@/i18n/navigation.ts';
import { runBulkInline } from '@/server/bulk.ts';
import { loadEvent } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';

/**
 * Export the bookings the current search matches as CSV (M1.12c), through the bulk framework:
 * small exports finish in this request, bigger ones continue in the worker while the page polls.
 * Bulk exports need a recent step-up (M1.2c).
 */
export async function exportBookingsAction(
  org: string,
  event: string,
  form: FormData,
): Promise<{ code: string } | undefined> {
  const locale = await getLocale();
  const { data, event: ev } = await loadEvent(org, event, 'analysis');
  const q = String(form.get('q') ?? '')
    .trim()
    .slice(0, 200);
  const raw = String(form.get('filter') ?? 'all');
  const filter: BookingFilter = (BOOKING_FILTERS as readonly string[]).includes(raw)
    ? (raw as BookingFilter)
    : 'all';
  const back = `/o/${org}/e/${event}/analysis/bookings?${new URLSearchParams({ q, filter })}`;
  const t = await getTranslations();
  let operationId: string;
  try {
    ({ operationId } = await executeCommand(
      bookingsExportBulk.start,
      {
        eventId: ev.id,
        selection: { filter: { q, filter } },
        params: {
          headers: Object.fromEntries(
            BOOKING_EXPORT_COLUMNS.map((c) => [c, t(`reports.bookings.columns.${c}`)]),
          ),
          statuses: Object.fromEntries(ORDER_STATUSES.map((s) => [s, t(`order.status.${s}`)])),
          channels: { platform: t('reports.channels.online'), organizer: t('reports.channels.organizer') },
        },
      },
      data.ctx,
      ports,
    ));
  } catch (err) {
    const code = isDomainError(err) ? err.code : 'internal';
    // A step-up command: the form asks the person to confirm and sends it again.
    if (code === 'step_up_required') return { code };
    return redirect({ href: `${back}&exportError=${code}`, locale });
  }
  await runBulkInline(data.org.id, operationId);
  redirect({ href: `${back}&op=${operationId}`, locale });
}
