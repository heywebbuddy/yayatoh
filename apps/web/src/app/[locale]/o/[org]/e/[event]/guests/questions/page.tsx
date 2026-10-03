import { rsvpQuestionsQuery, subEventsQuery } from '@yayatoh/guests';
import { executeQuery } from '@yayatoh/kernel';
import { isProfileKey, navIncludes, navLabelKey, PROFILES } from '@yayatoh/platform';
import { Alert, Card, CardHeader, PageHeader } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { loadEvent } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import { GuestsCrumbs, RsvpTabs } from '../rsvp/nav.tsx';
import { publishQuestionsAction, removeMenuOptionAction, saveMenuOptionAction } from './actions.ts';
import { MenuEditor } from './menu-editor.tsx';
import { QuestionsBuilder } from './questions-builder.tsx';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('rsvpQuestions');
  return { title: t('title') };
}

/**
 * RSVP questions (M4.1e): the event's menu (what a meal question offers, with dietary notes) and
 * the question builder with its live preview. `guests:write` edits; viewers read.
 */
export default async function RsvpQuestionsPage({
  params,
}: {
  params: Promise<{ locale: string; org: string; event: string }>;
}) {
  const { locale, org, event } = await params;
  setRequestLocale(locale);
  const { data, event: ev, can } = await loadEvent(org, event, 'guests');
  const profile = isProfileKey(ev.profile) ? ev.profile : 'other';
  const nav = PROFILES[profile].nav.find((i) => i.key === 'guests');
  if (!nav || !navIncludes(profile, data.modules, 'guests') || !can('guests:read')) notFound();
  const t = await getTranslations('rsvpQuestions');
  const tr = await getTranslations();
  const canWrite = can('guests:write');
  const [q, subs] = await Promise.all([
    executeQuery(rsvpQuestionsQuery, { eventId: ev.id }, data.ctx, ports),
    executeQuery(subEventsQuery, { eventId: ev.id }, data.ctx, ports),
  ]);

  return (
    <>
      <PageHeader
        breadcrumb={
          <GuestsCrumbs
            org={org}
            event={event}
            orgName={data.org.name}
            eventName={ev.name}
            guestsLabel={tr(navLabelKey(profile, nav))}
            trail={[{ label: t('title') }]}
          />
        }
        title={t('title')}
        description={t('subtitle')}
      />
      <RsvpTabs org={org} event={event} current="questions" />
      {canWrite ? null : <Alert tone="info" title={t('viewerNotice')} />}

      <section aria-labelledby="rq-menu" className="flex flex-col gap-3">
        <Card size="panel" className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <CardHeader id="rq-menu" title={t('menu.title')} />
            <p className="m-0 text-body text-ink-2">{t('menu.subtitle')}</p>
          </div>
          <MenuEditor
            options={q.menu}
            canWrite={canWrite}
            add={saveMenuOptionAction.bind(null, org, event, null)}
            save={Object.fromEntries(
              q.menu.map((m) => [m.id, saveMenuOptionAction.bind(null, org, event, m.id)]),
            )}
            remove={Object.fromEntries(
              q.menu.map((m) => [m.id, removeMenuOptionAction.bind(null, org, event, m.id)]),
            )}
          />
        </Card>
      </section>

      <QuestionsBuilder
        initial={q.definition.questions}
        version={q.version}
        subEvents={subs.map((s) => ({ id: s.id, name: s.name }))}
        menu={q.menu}
        canWrite={canWrite}
        publish={publishQuestionsAction.bind(null, org, event)}
      />
    </>
  );
}
