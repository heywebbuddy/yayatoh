import { creditBalanceQuery } from '@yayatoh/ai';
import {
  announcementsQuery,
  type EventSectionDto,
  eventSectionsQuery,
  formatFaqText,
  formatLinksText,
  formatScheduleText,
} from '@yayatoh/events';
import { executeQuery } from '@yayatoh/kernel';
import { roleCan } from '@yayatoh/tenancy';
import { Button, Card, EmptyState, Label, PageHeader } from '@yayatoh/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AiDraftPanel } from '@/components/ai-draft-panel.tsx';
import { AnnouncementForm } from '@/components/announcement-form.tsx';
import { Markdown } from '@/components/markdown.tsx';
import { SectionForm, type SectionValues } from '@/components/section-form.tsx';
import { SectionList } from '@/components/section-list.tsx';
import { Link } from '@/i18n/navigation.ts';
import { profileT } from '@/lib/profile-copy.ts';
import { aiDrafter } from '@/server/ai.ts';
import { loadEvent } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import {
  acceptDraftAction,
  addSectionAction,
  createAnnouncementAction,
  deleteAnnouncementAction,
  deleteSectionAction,
  draftWithAiAction,
  moveSectionAction,
  reorderSectionsAction,
  updateAnnouncementAction,
  updateSectionAction,
} from './actions.ts';

function valuesOf(s: EventSectionDto): SectionValues {
  const fields: Record<string, string> =
    s.kind === 'text'
      ? { markdown: s.content.markdown }
      : s.kind === 'faq'
        ? { faq: formatFaqText(s.content) }
        : s.kind === 'schedule'
          ? { schedule: formatScheduleText(s.content) }
          : s.kind === 'links'
            ? { links: formatLinksText(s.content) }
            : {
                address: s.content.address,
                directions: s.content.directions,
                mapUrl: s.content.mapUrl ?? '',
              };
  return { title: s.title, visible: s.visible, fields };
}

export default async function ContentPage({
  params,
}: {
  params: Promise<{ locale: string; org: string; event: string }>;
}) {
  const { locale, org, event } = await params;
  setRequestLocale(locale);
  const { data, event: ev, can, profile } = await loadEvent(org, event, 'content');
  const t = await getTranslations();
  // M4.2a: a wedding's announcements go to guests, not ticket holders.
  const tp = profileT(t, profile);
  const canWrite = can('events:write');
  const [sections, announcements] = await Promise.all([
    executeQuery(eventSectionsQuery, { eventId: ev.id }, data.ctx, ports),
    executeQuery(announcementsQuery, { eventId: ev.id }, data.ctx, ports),
  ]);
  // M1.4f: AI drafting for writers of orgs with the `ai` module. The credits are the org's: people
  // with only an event role (M4.2a co-hosts) write without AI drafts.
  const ai =
    canWrite && data.modules.has('ai') && roleCan(data.role, 'events:read')
      ? await executeQuery(creditBalanceQuery, {}, data.ctx, ports)
      : null;
  const when = new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: ev.timezone,
  });
  const isPublic =
    ['published', 'postponed', 'cancelled', 'completed'].includes(ev.status) && ev.visibility !== 'private';
  const editors = Object.fromEntries(
    sections.map((s) => [
      s.id,
      canWrite ? (
        <details key={s.id} className="border-t border-line pt-2">
          <summary className="min-h-6 cursor-pointer text-caption text-ink-2">
            {t('content.edit', { title: s.title })}
          </summary>
          <div className="flex flex-col gap-3 pt-3">
            <SectionForm
              action={updateSectionAction.bind(null, org, event, s.id, s.kind)}
              kind={s.kind}
              values={valuesOf(s)}
              idPrefix={`section-${s.id}`}
            />
            <form action={deleteSectionAction.bind(null, org, event, s.id)}>
              <Button type="submit" variant="ghost" size="sm">
                {t('content.delete', { title: s.title })}
              </Button>
            </form>
          </div>
        </details>
      ) : null,
    ]),
  );
  return (
    <>
      <PageHeader
        title={t('content.title')}
        description={t('content.subtitle')}
        actions={
          isPublic ? (
            <Link
              href={`/events/${ev.slug}`}
              className="inline-flex min-h-10 items-center underline underline-offset-2"
            >
              {t('dashboard.previewPage')}
            </Link>
          ) : undefined
        }
      />
      {canWrite ? null : <p className="text-body text-ink-2">{t('content.viewerNotice')}</p>}
      <section aria-labelledby="tagline-heading" className="flex flex-col gap-2">
        <h2 id="tagline-heading" className="text-section">
          {t('aiDraft.taglineHeading')}
        </h2>
        <p className="text-body text-ink-2" data-testid="event-tagline">
          {ev.tagline ?? t('aiDraft.noTagline')}
        </p>
      </section>
      {ai ? (
        <section aria-labelledby="ai-heading" className="flex flex-col gap-3">
          <h2 id="ai-heading" className="text-section">
            {t('aiDraft.title')}
          </h2>
          <Card size="panel">
            <AiDraftPanel
              draft={draftWithAiAction.bind(null, org, event)}
              accept={acceptDraftAction.bind(null, org, event)}
              balance={ai.balance}
              allowance={ai.allowance}
              enabled={aiDrafter() !== null}
            />
          </Card>
        </section>
      ) : null}
      <section aria-labelledby="sections-heading" className="flex flex-col gap-3">
        <h2 id="sections-heading" className="text-section">
          {t('content.sections')}
        </h2>
        {sections.length === 0 ? (
          <EmptyState title={t('content.emptyTitle')} description={t('content.emptyDescription')} />
        ) : (
          <SectionList
            sections={sections.map((s) => ({ id: s.id, title: s.title, kind: s.kind, visible: s.visible }))}
            editors={editors}
            canWrite={canWrite}
            move={moveSectionAction.bind(null, org, event)}
            reorder={reorderSectionsAction.bind(null, org, event)}
          />
        )}
        {canWrite ? (
          <section aria-labelledby="add-section-heading">
            <Card size="panel" className="flex flex-col gap-3">
              <h3 id="add-section-heading" className="text-section">
                {t('content.addTitle')}
              </h3>
              <SectionForm action={addSectionAction.bind(null, org, event)} idPrefix="new-section" />
            </Card>
          </section>
        ) : null}
      </section>
      <section aria-labelledby="announcements-heading" className="flex flex-col gap-3">
        <h2 id="announcements-heading" className="text-section">
          {t('eventAnnouncements.heading')}
        </h2>
        <p className="text-body text-ink-2">{tp('eventAnnouncements.explainer')}</p>
        {announcements.length === 0 ? (
          <EmptyState
            title={t('eventAnnouncements.emptyTitle')}
            description={tp('eventAnnouncements.emptyDescription')}
          />
        ) : (
          <ul className="flex list-none flex-col gap-3 p-0">
            {announcements.map((a) => (
              <li key={a.id}>
                <Card className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Label>
                      {a.publishedAt ? t('eventAnnouncements.published') : t('eventAnnouncements.draft')}
                    </Label>
                    <Label>
                      {a.audience === 'holders'
                        ? tp('eventAnnouncements.holdersOnly')
                        : t('eventAnnouncements.public')}
                    </Label>
                    {a.pinned ? <Label>{t('eventAnnouncements.pinned')}</Label> : null}
                    {a.publishedAt ? (
                      <span className="text-caption text-ink-2">{when.format(a.publishedAt)}</span>
                    ) : null}
                  </div>
                  <h3 className="text-section">{a.title}</h3>
                  <Markdown source={a.body} />
                  {canWrite ? (
                    <div className="flex flex-wrap gap-2">
                      <form
                        action={updateAnnouncementAction.bind(null, org, event, a.id, {
                          published: !a.publishedAt,
                        })}
                      >
                        <Button type="submit" variant="secondary" size="sm">
                          {a.publishedAt
                            ? t('eventAnnouncements.unpublish', { title: a.title })
                            : t('eventAnnouncements.publish', { title: a.title })}
                        </Button>
                      </form>
                      <form
                        action={updateAnnouncementAction.bind(null, org, event, a.id, { pinned: !a.pinned })}
                      >
                        <Button type="submit" variant="ghost" size="sm">
                          {a.pinned
                            ? t('eventAnnouncements.unpinOne', { title: a.title })
                            : t('eventAnnouncements.pinOne', { title: a.title })}
                        </Button>
                      </form>
                      <form action={deleteAnnouncementAction.bind(null, org, event, a.id)}>
                        <Button type="submit" variant="ghost" size="sm">
                          {t('eventAnnouncements.delete', { title: a.title })}
                        </Button>
                      </form>
                    </div>
                  ) : null}
                </Card>
              </li>
            ))}
          </ul>
        )}
        {canWrite ? (
          <section aria-labelledby="new-announcement-heading">
            <Card size="panel" className="flex flex-col gap-3">
              <h3 id="new-announcement-heading" className="text-section">
                {t('eventAnnouncements.new')}
              </h3>
              <AnnouncementForm action={createAnnouncementAction.bind(null, org, event)} />
            </Card>
          </section>
        ) : null}
      </section>
    </>
  );
}
