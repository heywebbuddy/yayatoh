import type { SponsorDto } from '@yayatoh/program';
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
import {
  createSponsorAction,
  createTierAction,
  deleteSponsorAction,
  deleteTierAction,
  updateSponsorAction,
} from './actions.ts';

/** Sponsors (M1.4f): tiers (package name and order) and the sponsors in each. */
export default async function SponsorsPage({
  params,
}: {
  params: Promise<{ locale: string; org: string; event: string }>;
}) {
  const { locale, org, event } = await params;
  setRequestLocale(locale);
  const { data, program, canWrite } = await loadProgramPage(org, event, 'sponsors');
  const tm = await getTranslations('media');
  const logos = await programMediaPanels(
    data,
    'sponsor',
    program.sponsors.map((s) => s.id),
  );
  const t = await getTranslations();
  const tp = await getTranslations('program');
  const ts = await getTranslations('sponsorship');
  const errors = {
    name: tp('errors.name'),
    'conflict.name': tp('errors.nameTaken'),
    position: tp('errors.position'),
    tierId: tp('errors.tier'),
    websiteUrl: tp('errors.website'),
    tier_in_use: tp('errors.tierInUse'),
    too_many: tp('errors.too_many'),
  };
  const tierOptions = program.sponsorTiers.map((x) => ({ value: x.id, label: x.name }));
  const fields = (s?: SponsorDto): FieldSpec[] => [
    { kind: 'select', name: 'tierId', label: tp('tier'), options: tierOptions, defaultValue: s?.tierId },
    {
      kind: 'text',
      name: 'name',
      label: tp('sponsorName'),
      required: true,
      maxLength: 120,
      defaultValue: s?.name,
    },
    { kind: 'url', name: 'websiteUrl', label: tp('website'), defaultValue: s?.websiteUrl ?? undefined },
    {
      kind: 'textarea',
      name: 'description',
      label: tp('description'),
      hint: tp('markdownHint'),
      defaultValue: s?.description,
    },
  ];
  return (
    <>
      <PageHeader
        title={t('nav.sponsors')}
        description={tp('sponsorsSubtitle')}
        actions={
          // M5.4b: package terms and sponsors' packages, and the deliverables checklist.
          <nav aria-label={ts('subnav')} className="flex flex-wrap gap-2.5">
            <Link href={`/o/${org}/e/${event}/sponsors/packages`} className={buttonClass('secondary')}>
              {ts('packagesLink')}
            </Link>
            <Link href={`/o/${org}/e/${event}/sponsors/deliverables`} className={buttonClass('secondary')}>
              {ts('deliverablesLink')}
            </Link>
          </nav>
        }
      />
      {canWrite ? null : <p className="text-body text-ink-2">{tp('viewerNotice')}</p>}
      <section aria-labelledby="tiers-heading" className="flex flex-col gap-3">
        <h2 id="tiers-heading" className="text-section">
          {tp('tiers')}
        </h2>
        {program.sponsorTiers.length === 0 ? (
          <EmptyState title={tp('emptyTiersTitle')} description={tp('emptyTiersDescription')} />
        ) : (
          <ol className="flex list-none flex-col gap-3 p-0">
            {program.sponsorTiers.map((tier) => {
              const inTier = program.sponsors.filter((s) => s.tierId === tier.id);
              return (
                <li key={tier.id}>
                  <Card className="flex flex-col gap-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="text-body font-medium">
                        {tier.name}{' '}
                        <span className="text-caption text-ink-2">
                          · {tp('order', { position: tier.position })}
                        </span>
                      </h3>
                      {canWrite ? (
                        <ProgramForm
                          action={deleteTierAction.bind(null, org, event, tier.id)}
                          fields={[]}
                          idPrefix={`tier-${tier.id}`}
                          submitLabel={tp('deleteNamed', { name: tier.name })}
                          successLabel={tp('deleted')}
                          errors={errors}
                        />
                      ) : null}
                    </div>
                    {inTier.length === 0 ? (
                      <p className="text-caption text-ink-2">{tp('noSponsorsInTier')}</p>
                    ) : (
                      <ul className="flex list-none flex-col gap-2 p-0">
                        {inTier.map((s) => (
                          <li key={s.id} className="flex flex-col gap-1 border-t border-line pt-2">
                            <span className="flex items-center gap-3">
                              <ProgramThumb item={logos.get(s.id)?.items[0]} />
                              <span className="text-body">{s.name}</span>
                            </span>
                            {s.websiteUrl ? (
                              <span className="text-caption text-ink-2">{s.websiteUrl}</span>
                            ) : null}
                            {s.description ? <Markdown source={s.description} /> : null}
                            {canWrite ? (
                              <details>
                                <summary className="min-h-6 cursor-pointer text-caption text-ink-2">
                                  {tp('editNamed', { name: s.name })}
                                </summary>
                                <div className="flex flex-col gap-3 pt-3">
                                  <ProgramForm
                                    action={updateSponsorAction.bind(null, org, event, s.id)}
                                    fields={fields(s)}
                                    idPrefix={`sponsor-${s.id}`}
                                    submitLabel={tp('save')}
                                    successLabel={tp('saved')}
                                    errors={errors}
                                  />
                                  <MediaUploader
                                    org={org}
                                    slot="logo"
                                    kind="sponsor"
                                    headingLevel={4}
                                    title={tm('titleNamed.sponsor', { name: s.name })}
                                    defaultAlt={defaultProgramAlt('sponsor', s.name, (name) => name)}
                                    ticket={logos.get(s.id)?.ticket ?? null}
                                    items={logos.get(s.id)?.items ?? []}
                                  />
                                  <form action={deleteSponsorAction.bind(null, org, event, s.id)}>
                                    <Button type="submit" variant="ghost" size="sm">
                                      {tp('deleteNamed', { name: s.name })}
                                    </Button>
                                  </form>
                                </div>
                              </details>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    )}
                  </Card>
                </li>
              );
            })}
          </ol>
        )}
        {canWrite ? (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <section aria-labelledby="add-tier-heading">
              <Card size="panel" className="flex flex-col gap-3">
                <h3 id="add-tier-heading" className="text-section">
                  {tp('addTier')}
                </h3>
                <ProgramForm
                  action={createTierAction.bind(null, org, event)}
                  fields={[
                    {
                      kind: 'text',
                      name: 'name',
                      label: tp('tierName'),
                      hint: tp('tierNameHint'),
                      required: true,
                      maxLength: 60,
                    },
                    {
                      kind: 'number',
                      name: 'position',
                      label: tp('tierOrder'),
                      hint: tp('tierOrderHint'),
                      required: true,
                    },
                  ]}
                  idPrefix="new-tier"
                  submitLabel={tp('addTier')}
                  successLabel={tp('tierAdded')}
                  errors={errors}
                  reset
                />
              </Card>
            </section>
            {program.sponsorTiers.length > 0 ? (
              <section aria-labelledby="add-sponsor-heading">
                <Card size="panel" className="flex flex-col gap-3">
                  <h3 id="add-sponsor-heading" className="text-section">
                    {tp('addSponsor')}
                  </h3>
                  <ProgramForm
                    action={createSponsorAction.bind(null, org, event)}
                    fields={fields()}
                    idPrefix="new-sponsor"
                    submitLabel={tp('addSponsor')}
                    successLabel={tp('sponsorAdded')}
                    errors={errors}
                    reset
                  />
                  <p className="text-caption text-ink-2">{tp('logoAfterSave')}</p>
                </Card>
              </section>
            ) : null}
          </div>
        ) : null}
      </section>
    </>
  );
}
