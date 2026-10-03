'use server';

import {
  archivePrinterCommand,
  createPrinterCommand,
  printerHeartbeatCommand,
  startPrintJobCommand,
} from '@yayatoh/badges';
import { executeCommand, isDomainError } from '@yayatoh/kernel';
import { revalidatePath } from 'next/cache';
import { getLocale } from 'next-intl/server';
import type { ProgramFormState } from '@/components/program-form.tsx';
import { redirect } from '@/i18n/navigation.ts';
import { loadEvent } from '@/server/console.ts';
import { failure, numberOrNull, success, textOrNull } from '@/server/form.ts';
import { ports } from '@/server/ports.ts';
import { sendPrintJobNow } from '@/server/printing.ts';

const printingPage = (org: string, event: string) => `/o/${org}/e/${event}/badges/printing`;

export async function createPrinterAction(
  org: string,
  event: string,
  _prev: ProgramFormState,
  form: FormData,
): Promise<ProgramFormState> {
  const { data, event: ev } = await loadEvent(org, event, 'badges');
  const adapter = String(form.get('adapter') ?? 'browser');
  try {
    await executeCommand(
      createPrinterCommand,
      {
        eventId: ev.id,
        name: String(form.get('name') ?? ''),
        adapter: adapter as never,
        printnodePrinterId: adapter === 'printnode' ? numberOrNull(form, 'printnodePrinterId') : null,
      },
      data.ctx,
      ports,
    );
  } catch (err) {
    return failure(err);
  }
  revalidatePath(printingPage(org, event), 'page');
  return success();
}

/** Archive a printer, then back to the printers with a confirmation (the printer leaves the list). */
export async function archivePrinterAction(org: string, event: string, printerId: string): Promise<void> {
  const locale = await getLocale();
  const { data, event: ev } = await loadEvent(org, event, 'badges');
  let done = 'archived=1';
  try {
    await executeCommand(archivePrinterCommand, { eventId: ev.id, printerId }, data.ctx, ports);
  } catch (err) {
    if (!isDomainError(err)) throw err;
    done = `printerError=${err.code}`;
  }
  revalidatePath(printingPage(org, event), 'page');
  redirect({ href: `${printingPage(org, event)}?${done}#printers-heading`, locale });
}

/** A print station's heartbeat (every 30 s while the station page is open). */
export async function stationHeartbeatAction(
  org: string,
  event: string,
  printerId: string,
): Promise<{ ok: boolean; code?: string }> {
  const { data, event: ev } = await loadEvent(org, event, 'badges');
  try {
    await executeCommand(printerHeartbeatCommand, { eventId: ev.id, printerId }, data.ctx, ports);
    return { ok: true };
  } catch (err) {
    if (!isDomainError(err)) throw err;
    return { ok: false, code: err.code };
  }
}

/** Where a print form returns to: the desk page of the badge, or the attendee's profile. */
export type PrintReturn = { to: 'desk' } | { to: 'attendee'; attendeeId: string };

/**
 * Print (or reprint) one badge. The job is logged with its reason before anything is printed; a
 * PrintNode job is handed over at once. Then back to the desk or the attendee, with the job, so
 * the page confirms it (and, for the browser's print dialog, opens the badge PDF).
 */
export async function printBadgeAction(
  org: string,
  event: string,
  ticketId: string,
  back: PrintReturn,
  requestKey: string,
  overrideToken: string | undefined,
  _prev: ProgramFormState,
  form: FormData,
): Promise<ProgramFormState> {
  const locale = await getLocale();
  const { data, event: ev } = await loadEvent(org, event, 'badges');
  let jobId: string;
  try {
    const job = await executeCommand(
      startPrintJobCommand,
      {
        eventId: ev.id,
        ticketId,
        printerId: textOrNull(form, 'printerId'),
        reason: (textOrNull(form, 'reason') as never) ?? null,
        note: textOrNull(form, 'note'),
        source: back.to === 'attendee' ? 'attendee_page' : 'desk',
        locale,
        requestKey,
        ...(overrideToken ? { overrideToken } : {}),
      },
      data.ctx,
      ports,
    );
    jobId = job.id;
    if (job.status === 'queued') await sendPrintJobNow(data.ctx, job.id);
  } catch (err) {
    return failure(err);
  }
  revalidatePath(printingPage(org, event), 'page');
  const href =
    back.to === 'attendee'
      ? `/o/${org}/e/${event}/attendees?a=${back.attendeeId}&printed=${jobId}#badge-heading`
      : `/o/${org}/e/${event}/badges/print/${ticketId}?printed=${jobId}`;
  return redirect({ href, locale });
}
