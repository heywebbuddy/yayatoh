import { type PrinterDto, type PrintLogEntryDto, printLogQuery } from '@yayatoh/badges';
import { PRINT_KINDS } from '@yayatoh/badges/client';
import { executeQuery } from '@yayatoh/kernel';
import {
  Alert,
  Button,
  buttonClass,
  Card,
  EmptyState,
  filterChipClass,
  PageHeader,
  StatusPill,
  type StatusTone,
  Table,
} from '@yayatoh/ui';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { AutoRefresh } from '@/components/auto-refresh.tsx';
import { Crumbs } from '@/components/crumbs.tsx';
import { ProgramForm } from '@/components/program-form.tsx';
import { Link } from '@/i18n/navigation.ts';
import { errorMessageKey } from '@/lib/errors.ts';
import { ports } from '@/server/ports.ts';
import { loadPrintingPage } from '@/server/printing.ts';
import { archivePrinterAction, createPrinterAction } from '@/server/printing-actions.ts';

const PRINTER_TONE: Record<PrinterDto['status'], StatusTone> = {
  unknown: 'neutral',
  online: 'success',
  offline: 'danger',
};

/**
 * Printers and the print log (M5.5b): the event's badge printers with their live state (a
 * printer silent for 90 s is offline), and every badge printed or reprinted, with why.
 */
export default async function PrintingPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; org: string; event: string }>;
  searchParams: Promise<{ kind?: string; archived?: string; printerError?: string }>;
}) {
  const { locale, org, event } = await params;
  const sp = await searchParams;
  setRequestLocale(locale);
  const { data, ev, printing, canWrite, canPrint, platformPrintNode } = await loadPrintingPage(org, event);
  const kind = PRINT_KINDS.find((k) => k === sp.kind);
  const log = await executeQuery(
    printLogQuery,
    { eventId: ev.id, limit: 100, ...(kind ? { kind } : {}) },
    data.ctx,
    ports,
  );
  const t = await getTranslations();
  const tp = await getTranslations('badgePrinting');
  const format = await getFormatter();
  const when = (d: Date) =>
    format.dateTime(d, { dateStyle: 'medium', timeStyle: 'medium', timeZone: ev.timezone });
  const base = `/o/${org}/e/${event}/badges`;
  const printnode = printing.printnodeEnabled && platformPrintNode;
  const errors = {
    name: tp('errors.name'),
    name_taken: tp('errors.nameTaken'),
    printnode_off: tp('errors.printnode_off'),
    printnode_id_required: tp('errors.printnode_id_required'),
    printnodePrinterId: tp('errors.printnodePrinterId'),
    too_many_printers: tp('errors.too_many_printers'),
  };
  const filterHref = (k?: string) => `${base}/printing${k ? `?kind=${k}` : ''}#log-heading`;

  const columns = [
    { key: 'when', header: tp('columns.when'), cell: (e: PrintLogEntryDto) => when(e.createdAt) },
    { key: 'who', header: tp('columns.who'), cell: (e: PrintLogEntryDto) => e.holderName || tp('voided') },
    {
      key: 'what',
      header: tp('columns.what'),
      cell: (e: PrintLogEntryDto) => (
        <StatusPill tone={e.kind === 'reprint' ? 'waiting' : 'success'} label={tp(`kinds.${e.kind}`)} />
      ),
    },
    {
      key: 'reason',
      header: tp('columns.reason'),
      cell: (e: PrintLogEntryDto) =>
        e.kind === 'reprint'
          ? e.note
            ? `${tp(`reasons.${e.reason}`)}: ${e.note}`
            : tp(`reasons.${e.reason}`)
          : '—',
    },
    {
      key: 'printer',
      header: tp('columns.printer'),
      cell: (e: PrintLogEntryDto) => e.printerName ?? tp('deviceDialog'),
    },
    {
      key: 'status',
      header: tp('columns.status'),
      cell: (e: PrintLogEntryDto) => (
        <StatusPill
          tone={e.status === 'failed' ? 'danger' : e.status === 'queued' ? 'info' : 'success'}
          label={tp(`jobStatus.${e.status}`)}
        />
      ),
    },
  ];

  return (
    <>
      <PageHeader
        breadcrumb={
          <Crumbs
            items={[
              { label: data.org.name, href: `/o/${org}` },
              { label: ev.name, href: `/o/${org}/e/${event}` },
              { label: t('nav.badges'), href: base },
              { label: tp('title') },
            ]}
          />
        }
        title={tp('title')}
        description={tp('subtitle')}
      />
      {printing.printers.length ? <AutoRefresh seconds={30} /> : null}

      <section aria-labelledby="printers-heading" className="flex flex-col gap-3">
        <h2 id="printers-heading" className="text-section">
          {tp('printers')}
        </h2>
        <p className="max-w-prose text-caption text-ink-2">{tp('stationHint')}</p>
        <div aria-live="polite">
          {sp.archived === '1' ? <Alert tone="info" title={tp('archived')} /> : null}
          {sp.printerError ? <Alert title={t(errorMessageKey(sp.printerError))} /> : null}
        </div>
        {printing.printers.length === 0 ? (
          <EmptyState title={tp('noPrintersTitle')} description={tp('noPrintersDescription')} />
        ) : (
          <ul className="flex list-none flex-col gap-3 p-0">
            {printing.printers.map((p) => (
              <li key={p.id}>
                <Card className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-body font-medium">{p.name}</h3>
                    <StatusPill tone={PRINTER_TONE[p.status]} label={tp(`status.${p.status}`)} />
                  </div>
                  <p className="text-caption text-ink-2">
                    {tp(`adapterShort.${p.adapter}`)}
                    {p.printnodePrinterId ? ` · ${tp('printnodeNumber', { id: p.printnodePrinterId })}` : ''}
                    {' · '}
                    {p.status === 'offline' && p.offlineAt
                      ? tp('offlineSince', { time: when(p.offlineAt) })
                      : p.lastSeenAt
                        ? tp('lastSeen', { time: when(p.lastSeenAt) })
                        : tp('neverSeen')}
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    {canPrint && p.adapter === 'browser' ? (
                      <Link href={`${base}/printing/${p.id}`} className={buttonClass('secondary', 'sm')}>
                        {tp('openStation', { name: p.name })}
                      </Link>
                    ) : null}
                    {canWrite ? (
                      <form action={archivePrinterAction.bind(null, org, event, p.id)}>
                        <Button type="submit" variant="ghost" size="sm">
                          {tp('archive', { name: p.name })}
                        </Button>
                      </form>
                    ) : null}
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}
        {canWrite ? (
          <section aria-labelledby="new-printer-heading">
            <Card size="panel" className="flex flex-col gap-3">
              <h3 id="new-printer-heading" className="text-section">
                {tp('addPrinter')}
              </h3>
              {printnode ? null : <p className="text-caption text-ink-2">{tp('printnodeOffHint')}</p>}
              <ProgramForm
                action={createPrinterAction.bind(null, org, event)}
                fields={[
                  { kind: 'text', name: 'name', label: tp('printerName'), required: true, maxLength: 60 },
                  ...(printnode
                    ? [
                        {
                          kind: 'select' as const,
                          name: 'adapter',
                          label: tp('connection'),
                          defaultValue: 'browser',
                          options: (['browser', 'printnode'] as const).map((a) => ({
                            value: a,
                            label: tp(`adapters.${a}`),
                          })),
                        },
                        {
                          kind: 'number' as const,
                          name: 'printnodePrinterId',
                          label: tp('printnodeId'),
                          hint: tp('printnodeIdHint'),
                        },
                      ]
                    : []),
                ]}
                idPrefix="new-printer"
                submitLabel={tp('addPrinter')}
                successLabel={tp('printerAdded')}
                errors={errors}
                reset
              />
            </Card>
          </section>
        ) : null}
      </section>

      <section aria-labelledby="log-heading" className="flex flex-col gap-3">
        <h2 id="log-heading" className="text-section">
          {tp('log')}
        </h2>
        <p className="text-caption text-ink-2">
          {tp('counts', { prints: log.prints, reprints: log.reprints })}
        </p>
        <nav aria-label={tp('filterLabel')} className="flex flex-wrap gap-2">
          {([undefined, ...PRINT_KINDS] as const).map((k) => (
            <Link
              key={k ?? 'all'}
              href={filterHref(k)}
              aria-current={kind === k ? 'page' : undefined}
              className={filterChipClass(kind === k)}
            >
              {k ? tp(`filters.${k}`) : tp('filters.all')}
            </Link>
          ))}
        </nav>
        {log.entries.length === 0 ? (
          <EmptyState title={tp('logEmptyTitle')} description={tp('logEmptyDescription')} />
        ) : (
          <Table
            caption={tp('logCaption')}
            captionHidden
            columns={columns}
            rows={log.entries}
            rowKey={(e) => e.id}
            density="compact"
            stackOnPhone
          />
        )}
        {log.entries.some((e) => e.status === 'failed') ? (
          <Alert tone="info" title={tp('failedHint')} />
        ) : null}
      </section>
    </>
  );
}
