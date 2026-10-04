import { buttonClass, EmptyState, PageHeader } from '@yayatoh/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AgendaImport } from '@/components/agenda-import.tsx';
import { Link } from '@/i18n/navigation.ts';
import { loadProgramPage } from '@/server/program.ts';
import { applyAgendaImportAction, checkAgendaImportAction } from './actions.ts';

/**
 * Bulk agenda import (M5.2a): upload a CSV → dry run with a result for every row → import. Times
 * are wall-clock times in the event's timezone. Editors only; the sessions module gates the page.
 */
export default async function AgendaImportPage({
  params,
}: {
  params: Promise<{ locale: string; org: string; event: string }>;
}) {
  const { locale, org, event } = await params;
  setRequestLocale(locale);
  const { ev, canWrite } = await loadProgramPage(org, event, 'sessions');
  const t = await getTranslations('agenda.import');
  const back = `/o/${org}/e/${event}/sessions`;
  const header = (
    <PageHeader
      title={t('title')}
      description={t('description')}
      actions={
        <Link href={back} className={buttonClass('secondary')}>
          {t('back')}
        </Link>
      }
    />
  );
  if (!canWrite)
    return (
      <>
        {header}
        <EmptyState
          title={t('noAccessTitle')}
          description={t('noAccessDescription')}
          action={
            <Link href={`/o/${org}/e/${event}`} className={buttonClass('primary', 'md')}>
              {t('backToEvent')}
            </Link>
          }
        />
      </>
    );
  return (
    <>
      {header}
      <section aria-labelledby="agenda-columns-heading" className="flex flex-col gap-2">
        <h2 id="agenda-columns-heading" className="text-section">
          {t('columnsHeading')}
        </h2>
        <ul className="flex list-disc flex-col gap-1 ps-5 text-body text-ink-2">
          <li>{t('columnsRequired')}</li>
          <li>{t('columnsTimes', { timezone: ev.timezone.replace(/_/g, ' ') })}</li>
          <li>{t('columnsSpeakers')}</li>
          <li>{t('columnsMatch')}</li>
        </ul>
        <pre
          // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable example must be reachable by keyboard
          tabIndex={0}
          className="overflow-x-auto rounded-card border border-line bg-surface-2 p-3 font-mono text-caption"
          dir="ltr"
        >
          {
            'key,title,starts,ends,type,admission,capacity,room,track,group,speakers\nK-1,Opening keynote,2030-05-01 09:00,2030-05-01 10:00,Keynote,included,,Main hall,,,Ada Lovelace <ada@example.org>'
          }
        </pre>
      </section>
      <AgendaImport
        check={checkAgendaImportAction.bind(null, org, event)}
        apply={applyAgendaImportAction.bind(null, org, event)}
      />
    </>
  );
}
