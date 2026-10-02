import { formatLinksText } from '@yayatoh/events';
import { executeQuery } from '@yayatoh/kernel';
import { type SpeakerDto, speakerAccessQuery, speakerChangesQuery } from '@yayatoh/program';
import { Button, buttonClass, Card, EmptyState, PageHeader } from '@yayatoh/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Markdown } from '@/components/markdown.tsx';
import { MediaUploader } from '@/components/media-uploader.tsx';
import { type FieldSpec, ProgramForm } from '@/components/program-form.tsx';
import { ProgramThumb } from '@/components/program-thumb.tsx';
import { SpeakerAccessPanel } from '@/components/speaker-access-panel.tsx';
import { Link } from '@/i18n/navigation.ts';
import { defaultProgramAlt } from '@/lib/program-media.ts';
import { programMediaPanels } from '@/server/media.ts';
import { ports } from '@/server/ports.ts';
import { loadProgramPage } from '@/server/program.ts';
import { createSpeakerAction, deleteSpeakerAction, updateSpeakerAction } from './actions.ts';

/**
 * Speakers (M1.4f): profile, bio (Markdown subset) and links; public on the event page.
 * M1.4h: a photo per speaker (thumbnail in the list, uploader in the edit disclosure).
 */
export default async function SpeakersPage({
  params,
}: {
  params: Promise<{ locale: string; org: string; event: string }>;
}) {
  const { locale, org, event } = await params;
  setRequestLocale(locale);
  const { data, ev, program, canWrite } = await loadProgramPage(org, event, 'speakers');
  const t = await getTranslations();
  const tp = await getTranslations('program');
  const tm = await getTranslations('media');
  const photos = await programMediaPanels(
    data,
    'speaker',
    program.speakers.map((p) => p.id),
  );
  // M5.3a speaker portal: access per speaker, and links to proposed changes and the task board.
  const ts = await getTranslations('speakerAccess');
  const access = await executeQuery(speakerAccessQuery, { eventId: ev.id }, data.ctx, ports);
  const changes = await executeQuery(speakerChangesQuery, { eventId: ev.id }, data.ctx, ports);
  const errors = {
    name: tp('errors.name'),
    links: tp('errors.links'),
    links_line: tp('errors.links'),
    links_url: tp('errors.links'),
    too_many: tp('errors.too_many'),
  };
  const fields = (p?: SpeakerDto): FieldSpec[] => [
    {
      kind: 'text',
      name: 'name',
      label: tp('speakerName'),
      required: true,
      maxLength: 120,
      defaultValue: p?.name,
    },
    {
      kind: 'text',
      name: 'title',
      label: tp('jobTitle'),
      maxLength: 120,
      defaultValue: p?.title ?? undefined,
    },
    {
      kind: 'text',
      name: 'company',
      label: tp('company'),
      maxLength: 120,
      defaultValue: p?.company ?? undefined,
    },
    {
      kind: 'textarea',
      name: 'bio',
      label: tp('bio'),
      hint: tp('markdownHint'),
      rows: 5,
      defaultValue: p?.bio,
    },
    {
      kind: 'textarea',
      name: 'links',
      label: tp('links'),
      hint: tp('linksHint'),
      rows: 3,
      defaultValue: p?.links.length ? formatLinksText({ items: p.links }) : undefined,
    },
  ];
  const sessionsOf = (id: string) => program.sessions.filter((s) => s.speakerIds.includes(id)).length;
  return (
    <>
      <PageHeader
        title={t('nav.speakers')}
        description={tp('speakersSubtitle')}
        actions={
          <nav aria-label={ts('portalNav')} className="flex flex-wrap gap-2.5">
            <Link href={`/o/${org}/e/${event}/speakers/changes`} className={buttonClass('secondary')}>
              {ts('changesLink', { count: changes.pending.length })}
            </Link>
            <Link href={`/o/${org}/e/${event}/speakers/tasks`} className={buttonClass('secondary')}>
              {ts('tasksLink')}
            </Link>
          </nav>
        }
      />
      {canWrite ? null : <p className="text-body text-ink-2">{tp('viewerNotice')}</p>}
      <section aria-labelledby="speakers-heading" className="flex flex-col gap-3">
        <h2 id="speakers-heading" className="text-section">
          {tp('speakerList', { count: program.speakers.length })}
        </h2>
        {program.speakers.length === 0 ? (
          <EmptyState title={tp('emptySpeakersTitle')} description={tp('emptySpeakersDescription')} />
        ) : (
          <ul className="flex list-none flex-col gap-3 p-0">
            {program.speakers.map((p) => (
              <li key={p.id}>
                <Card className="flex flex-col gap-2">
                  <div className="flex items-center gap-3">
                    <ProgramThumb item={photos.get(p.id)?.items[0]} round />
                    <h3 className="text-body font-medium">{p.name}</h3>
                  </div>
                  <p className="text-caption text-ink-2">
                    {[p.title, p.company].filter(Boolean).join(' · ')}
                    {[p.title, p.company].some(Boolean) ? ' · ' : ''}
                    {tp('sessionCount', { count: sessionsOf(p.id) })}
                  </p>
                  {p.bio ? <Markdown source={p.bio} /> : null}
                  <SpeakerAccessPanel
                    org={org}
                    event={event}
                    speakerId={p.id}
                    speakerName={p.name}
                    accounts={access.find((x) => x.speakerId === p.id)?.accounts ?? []}
                    canWrite={canWrite}
                  />
                  {canWrite ? (
                    <details className="border-t border-line pt-2">
                      <summary className="min-h-6 cursor-pointer text-caption text-ink-2">
                        {tp('editNamed', { name: p.name })}
                      </summary>
                      <div className="flex flex-col gap-3 pt-3">
                        <ProgramForm
                          action={updateSpeakerAction.bind(null, org, event, p.id)}
                          fields={fields(p)}
                          idPrefix={`speaker-${p.id}`}
                          submitLabel={tp('save')}
                          successLabel={tp('saved')}
                          errors={errors}
                        />
                        <MediaUploader
                          org={org}
                          slot="photo"
                          kind="speaker"
                          headingLevel={4}
                          title={tm('titleNamed.speaker', { name: p.name })}
                          defaultAlt={defaultProgramAlt('speaker', p.name, (name) =>
                            tm('defaultAlt.speaker', { name }),
                          )}
                          ticket={photos.get(p.id)?.ticket ?? null}
                          items={photos.get(p.id)?.items ?? []}
                        />
                        <form action={deleteSpeakerAction.bind(null, org, event, p.id)}>
                          <Button type="submit" variant="ghost" size="sm">
                            {tp('deleteNamed', { name: p.name })}
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
          <section aria-labelledby="add-speaker-heading">
            <Card size="panel" className="flex flex-col gap-3">
              <h3 id="add-speaker-heading" className="text-section">
                {tp('addSpeaker')}
              </h3>
              <ProgramForm
                action={createSpeakerAction.bind(null, org, event)}
                fields={fields()}
                idPrefix="new-speaker"
                submitLabel={tp('addSpeaker')}
                successLabel={tp('speakerAdded')}
                errors={errors}
                reset
              />
              <p className="text-caption text-ink-2">{tp('photoAfterSave')}</p>
            </Card>
          </section>
        ) : null}
      </section>
    </>
  );
}
