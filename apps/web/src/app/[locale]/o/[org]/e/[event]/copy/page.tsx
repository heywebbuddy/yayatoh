import { utcToZonedInput } from '@yayatoh/kernel';
import { buttonClass, Card, EmptyState, PageHeader } from '@yayatoh/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { CopyEventForm, SaveTemplateForm } from '@/components/copy-forms.tsx';
import { Link } from '@/i18n/navigation.ts';
import { profileT } from '@/lib/profile-copy.ts';
import { loadEvent } from '@/server/console.ts';
import { duplicateAction, saveTemplateAction } from './actions.ts';

/**
 * M1.4b: duplicate this event, or save it as an org template. A copy takes the settings, ticket
 * types, questions and floor plan — never orders, attendees, tickets, check-ins or payouts.
 */
export default async function CopyPage({
  params,
}: {
  params: Promise<{ locale: string; org: string; event: string }>;
}) {
  const { locale, org, event } = await params;
  setRequestLocale(locale);
  const { event: ev, can, profile } = await loadEvent(org, event, 'copy');
  const t = await getTranslations();
  // M4.2a: a wedding copies guests' settings, never "tickets".
  const tp = profileT(t, profile);
  if (!can('events:write'))
    return (
      <>
        <PageHeader title={t('copy.title')} />
        <EmptyState
          title={t('copy.noAccessTitle')}
          description={t('copy.noAccessDescription')}
          action={
            <Link href={`/o/${org}/e/${event}`} className={buttonClass('primary', 'md')}>
              {t('copy.backToEvent')}
            </Link>
          }
        />
      </>
    );
  return (
    <>
      <PageHeader title={t('copy.title')} description={tp('copy.description')} />
      <section aria-labelledby="duplicate-heading" className="flex flex-col gap-3">
        <h2 id="duplicate-heading" className="text-section">
          {t('copy.duplicate')}
        </h2>
        <p className="text-body text-ink-2">{t('copy.duplicateHint')}</p>
        <Card>
          <CopyEventForm
            idPrefix="duplicate"
            action={duplicateAction.bind(null, org, event)}
            defaults={{
              name: t('copy.copyName', { name: ev.name }),
              startsAt: utcToZonedInput(ev.startsAt, ev.timezone),
            }}
            submitLabel={t('copy.duplicateSubmit')}
          />
        </Card>
      </section>
      <section aria-labelledby="template-heading" className="flex flex-col gap-3">
        <h2 id="template-heading" className="text-section">
          {t('copy.template')}
        </h2>
        <p className="text-body text-ink-2">{t('copy.templateHint')}</p>
        <Card>
          <SaveTemplateForm
            action={saveTemplateAction.bind(null, org, event)}
            defaultName={ev.name}
            org={org}
          />
        </Card>
      </section>
    </>
  );
}
