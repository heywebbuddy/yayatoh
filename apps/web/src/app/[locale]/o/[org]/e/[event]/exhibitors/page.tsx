import type { ExhibitorDto } from '@yayatoh/program';
import { Button, buttonClass, Card, EmptyState, PageHeader } from '@yayatoh/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Markdown } from '@/components/markdown.tsx';
import { MediaUploader } from '@/components/media-uploader.tsx';
import { type FieldSpec, ProgramForm } from '@/components/program-form.tsx';
import { ProgramThumb } from '@/components/program-thumb.tsx';
import { Link } from '@/i18n/navigation.ts';
import { defaultProgramAlt } from '@/lib/program-media.ts';
import { programMediaPanels } from '@/server/media.ts';
import { loadProgramPage } from '@/server/program.ts';
import { createExhibitorAction, deleteExhibitorAction, updateExhibitorAction } from './actions.ts';

/** Exhibitors (M1.4f): name, booth label, website and description; public on the event page. */
export default async function ExhibitorsPage({
  params,
}: {
  params: Promise<{ locale: string; org: string; event: string }>;
}) {
  const { locale, org, event } = await params;
  setRequestLocale(locale);
  const { data, program, canWrite } = await loadProgramPage(org, event, 'exhibitors');
  const tm = await getTranslations('media');
  const logos = await programMediaPanels(
    data,
    'exhibitor',
    program.exhibitors.map((x) => x.id),
  );
  const t = await getTranslations();
  const tp = await getTranslations('program');
  const tx = await getTranslations('exhibitorAdmin');
  const errors = {
    name: tp('errors.name'),
    websiteUrl: tp('errors.website'),
    too_many: tp('errors.too_many'),
  };
  const fields = (x?: ExhibitorDto): FieldSpec[] => [
    {
      kind: 'text',
      name: 'name',
      label: tp('exhibitorName'),
      required: true,
      maxLength: 120,
      defaultValue: x?.name,
    },
    {
      kind: 'text',
      name: 'boothLabel',
      label: tp('booth'),
      hint: tp('boothHint'),
      maxLength: 40,
      defaultValue: x?.boothLabel ?? undefined,
    },
    { kind: 'url', name: 'websiteUrl', label: tp('website'), defaultValue: x?.websiteUrl ?? undefined },
    {
      kind: 'textarea',
      name: 'description',
      label: tp('description'),
      hint: tp('markdownHint'),
      defaultValue: x?.description,
    },
  ];
  return (
    <>
      <PageHeader
        title={t('nav.exhibitors')}
        description={tp('exhibitorsSubtitle')}
        actions={
          // M5.4a: the exhibitor portal (people, approvals) and booths on the floor plan.
          <nav aria-label={tx('subnav')} className="flex flex-wrap gap-2.5">
            <Link href={`/o/${org}/e/${event}/exhibitors/portal`} className={buttonClass('secondary')}>
              {tx('portalLink')}
            </Link>
            <Link href={`/o/${org}/e/${event}/exhibitors/booths`} className={buttonClass('secondary')}>
              {tx('boothsLink')}
            </Link>
          </nav>
        }
      />
      {canWrite ? null : <p className="text-body text-ink-2">{tp('viewerNotice')}</p>}
      <section aria-labelledby="exhibitors-heading" className="flex flex-col gap-3">
        <h2 id="exhibitors-heading" className="text-section">
          {tp('exhibitorList', { count: program.exhibitors.length })}
        </h2>
        {program.exhibitors.length === 0 ? (
          <EmptyState title={tp('emptyExhibitorsTitle')} description={tp('emptyExhibitorsDescription')} />
        ) : (
          <ul className="flex list-none flex-col gap-3 p-0">
            {program.exhibitors.map((x) => (
              <li key={x.id}>
                <Card className="flex flex-col gap-2">
                  <div className="flex items-center gap-3">
                    <ProgramThumb item={logos.get(x.id)?.items[0]} />
                    <h3 className="text-body font-medium">{x.name}</h3>
                  </div>
                  <p className="text-caption text-ink-2">
                    {[x.boothLabel ? tp('boothNamed', { booth: x.boothLabel }) : null, x.websiteUrl]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                  {x.description ? <Markdown source={x.description} /> : null}
                  {canWrite ? (
                    <details className="border-t border-line pt-2">
                      <summary className="min-h-6 cursor-pointer text-caption text-ink-2">
                        {tp('editNamed', { name: x.name })}
                      </summary>
                      <div className="flex flex-col gap-3 pt-3">
                        <ProgramForm
                          action={updateExhibitorAction.bind(null, org, event, x.id)}
                          fields={fields(x)}
                          idPrefix={`exhibitor-${x.id}`}
                          submitLabel={tp('save')}
                          successLabel={tp('saved')}
                          errors={errors}
                        />
                        <MediaUploader
                          org={org}
                          slot="logo"
                          kind="exhibitor"
                          headingLevel={4}
                          title={tm('titleNamed.exhibitor', { name: x.name })}
                          defaultAlt={defaultProgramAlt('exhibitor', x.name, (name) => name)}
                          ticket={logos.get(x.id)?.ticket ?? null}
                          items={logos.get(x.id)?.items ?? []}
                        />
                        <form action={deleteExhibitorAction.bind(null, org, event, x.id)}>
                          <Button type="submit" variant="ghost" size="sm">
                            {tp('deleteNamed', { name: x.name })}
                          </Button>
                        </form>
                      </div>
                    </details>
                  ) : null}
                </Card>
              </li>
            ))}
          </ul>
        )}
        {canWrite ? (
          <section aria-labelledby="add-exhibitor-heading">
            <Card size="panel" className="flex flex-col gap-3">
              <h3 id="add-exhibitor-heading" className="text-section">
                {tp('addExhibitor')}
              </h3>
              <ProgramForm
                action={createExhibitorAction.bind(null, org, event)}
                fields={fields()}
                idPrefix="new-exhibitor"
                submitLabel={tp('addExhibitor')}
                successLabel={tp('exhibitorAdded')}
                errors={errors}
                reset
              />
              <p className="text-caption text-ink-2">{tp('logoAfterSave')}</p>
            </Card>
          </section>
        ) : null}
      </section>
    </>
  );
}
