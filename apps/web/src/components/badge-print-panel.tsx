import { randomUUID } from 'node:crypto';
import { badgePrintStateQuery, type PrintingSetupDto, printLogQuery } from '@yayatoh/badges';
import { REPRINT_REASONS } from '@yayatoh/badges/client';
import { type Ctx, executeQuery, isDomainError } from '@yayatoh/kernel';
import { Alert, buttonClass, StatusPill } from '@yayatoh/ui';
import { getFormatter, getLocale, getTranslations } from 'next-intl/server';
import { ProgramForm } from '@/components/program-form.tsx';
import { ports } from '@/server/ports.ts';
import { type PrintReturn, printBadgeAction } from '@/server/printing-actions.ts';

/**
 * One badge's print panel (M5.5b), on the desk page and the attendee's profile: how often it was
 * printed, the outcome of the job just made (with the PDF for the print dialog), and the print
 * form. A first print asks only for the printer; a reprint also asks why (and a note for "Other").
 */
export async function BadgePrintPanel({
  org,
  event,
  eventId,
  ticketId,
  timeZone,
  ctx,
  printing,
  back,
  printedJobId,
  headingId,
  headingLevel = 2,
  overrideToken,
}: {
  org: string;
  event: string;
  eventId: string;
  ticketId: string;
  timeZone: string;
  ctx: Ctx;
  printing: PrintingSetupDto;
  back: PrintReturn;
  printedJobId?: string | undefined;
  headingId: string;
  headingLevel?: 1 | 2;
  /** M5.1d: the desk's audited balance-due override for this ticket (from the badges page). */
  overrideToken?: string | undefined;
}) {
  const t = await getTranslations('badgePrinting');
  const tb = await getTranslations('badges');
  const format = await getFormatter();
  const locale = await getLocale();
  const state = await executeQuery(badgePrintStateQuery, { eventId, ticketId }, ctx, ports).catch((err) => {
    if (isDomainError(err) && err.code === 'not_found') return null;
    throw err;
  });
  const Heading = headingLevel === 1 ? 'h1' : 'h2';
  if (!state)
    return (
      <section aria-labelledby={headingId} className="flex flex-col gap-2">
        <Heading id={headingId} className={headingLevel === 1 ? 'text-title' : 'text-caption text-ink-2'}>
          {t('badgeHeading')}
        </Heading>
        <p className="text-caption text-ink-2">{t('noBadge')}</p>
      </section>
    );
  const log = await executeQuery(printLogQuery, { eventId, ticketId, limit: 5 }, ctx, ports);
  const printed = printedJobId ? log.entries.find((e) => e.id === printedJobId) : undefined;
  const when = (d: Date) => format.dateTime(d, { dateStyle: 'medium', timeStyle: 'short', timeZone });
  // Route handlers (PDFs) are linked directly: the default locale has no prefix.
  const raw = `${locale === 'en' ? '' : `/${locale}`}/o/${org}/e/${event}/badges`;
  const live = printing.printers.filter((p) => !p.archived);
  const reprint = state.nextKind === 'reprint';
  const errors = {
    reason_required: t('errors.reason_required'),
    reason: t('errors.reason_required'),
    note_required: t('errors.note_required'),
    note: t('errors.note'),
    archived: t('errors.archived'),
    printnode_off: t('errors.printnode_off'),
    printerId: t('errors.printerId'),
    no_template: t('noTemplate'),
    balance_due: tb('balanceDue'),
  };
  // M5.1d: a balance is due: the badge prints only with the desk's override (badges page).
  const blocked = state.paymentDue && !overrideToken;
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <Heading id={headingId} className={headingLevel === 1 ? 'text-title' : 'text-caption text-ink-2'}>
        {headingLevel === 1 ? t('printTitle', { name: state.holderName }) : t('badgeHeading')}
      </Heading>
      <p className="text-body">
        {state.prints === 0
          ? t('neverPrinted')
          : t('printedTimes', { count: state.prints, time: when(state.lastPrintedAt ?? new Date()) })}
      </p>
      {printed ? (
        printed.status === 'failed' ? (
          <Alert title={t('printFailed', { code: printed.errorCode ?? 'failed' })} />
        ) : printed.adapter === 'browser' ? (
          <div role="status" className="flex flex-col gap-2 rounded-card bg-success-soft px-4 py-3">
            <p className="text-body text-success">{t('printDialogReady')}</p>
            <a
              href={`${raw}/jobs/${printed.id}/pdf`}
              target="_blank"
              rel="noopener"
              className={`${buttonClass('primary')} self-start`}
            >
              {t('openPdf', { name: state.holderName })}
            </a>
          </div>
        ) : (
          <Alert tone="info" title={t('printSent', { printer: printed.printerName ?? '' })} />
        )
      ) : null}
      {blocked ? (
        <Alert tone="warning" title={tb('balanceDue')}>
          <a href={`${raw}`} className="underline">
            {tb('printAnywayNamed', { name: state.holderName })}
          </a>
        </Alert>
      ) : state.hasTemplate ? (
        <ProgramForm
          action={printBadgeAction.bind(null, org, event, ticketId, back, randomUUID(), overrideToken)}
          idPrefix={`print-${ticketId}`}
          fields={[
            {
              kind: 'select',
              name: 'printerId',
              label: t('printer'),
              hint: live.length ? undefined : t('noPrintersHint'),
              options: [
                { value: '', label: t('deviceDialog') },
                ...live.map((p) => ({
                  value: p.id,
                  label: `${p.name} · ${t(`status.${p.status}`)}`,
                })),
              ],
            },
            ...(reprint
              ? [
                  {
                    kind: 'select' as const,
                    name: 'reason',
                    label: t('reason'),
                    required: true,
                    options: [
                      { value: '', label: t('reasonPlaceholder') },
                      ...REPRINT_REASONS.map((r) => ({ value: r, label: t(`reasons.${r}`) })),
                    ],
                  },
                  {
                    kind: 'text' as const,
                    name: 'note',
                    label: t('note'),
                    hint: t('noteHint'),
                    maxLength: 200,
                  },
                ]
              : []),
          ]}
          submitLabel={
            reprint ? t('reprint', { name: state.holderName }) : t('print', { name: state.holderName })
          }
          successLabel={t('printDialogReady')}
          errors={errors}
        />
      ) : (
        <p className="text-caption text-ink-2">{t('noTemplate')}</p>
      )}
      {log.entries.length ? (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-caption text-ink-2">{t('history')}</h3>
          <ol className="flex list-none flex-col gap-1.5 p-0 text-caption">
            {log.entries.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-2">
                <StatusPill
                  tone={e.status === 'failed' ? 'danger' : e.kind === 'reprint' ? 'waiting' : 'success'}
                  label={e.status === 'failed' ? t('jobStatus.failed') : t(`kinds.${e.kind}`)}
                />
                <span>
                  {e.kind === 'reprint' ? `${t(`reasons.${e.reason}`)} · ` : ''}
                  {e.printerName ?? t('deviceDialog')} · {when(e.createdAt)}
                </span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </section>
  );
}
