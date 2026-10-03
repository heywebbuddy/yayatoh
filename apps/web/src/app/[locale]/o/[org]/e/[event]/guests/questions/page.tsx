import { rsvpQuestionsQuery, subEventsQuery } from '@yayatoh/guests';
import { executeQuery } from '@yayatoh/kernel';
import { isProfileKey, navIncludes, PROFILES } from '@yayatoh/platform';
import { Card, PageHeader } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation.ts';
import { loadEvent } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
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
  const canWrite = can('guests:write');
  const [q, subs] = await Promise.all([
    executeQuery(rsvpQuestionsQuery, { eventId: ev.id }, data.ctx, ports),
    executeQuery(subEventsQuery, { eventId: ev.id }, data.ctx, ports),
  ]);
  const base = `/o/${org}/e/${event}/guests`;

  return (
    <>
      <PageHeader title={t('title')} description={t('subtitle')} />
      <nav aria-label={t('linksLabel')} className="flex flex-wrap gap-x-4">
        <Link href={`${base}/rsvp`} className="min-h-6 py-1 text-caption underline">
          {t('back')}
        </Link>
        <Link href={`${base}/answers`} className="min-h-6 py-1 text-caption underline">
          {t('answersLink')}
        </Link>
      </nav>
      {canWrite ? null : <p className="text-body text-ink-2">{t('viewerNotice')}</p>}

      <section aria-labelledby="rq-menu" className="flex flex-col gap-3">
        <h2 id="rq-menu" className="text-section">
          {t('menu.title')}
        </h2>
        <p className="text-body text-ink-2">{t('menu.subtitle')}</p>
        <Card>
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
