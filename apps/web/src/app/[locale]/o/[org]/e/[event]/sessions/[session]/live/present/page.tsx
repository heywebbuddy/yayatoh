import { moderationQuery } from '@yayatoh/engagement';
import { executeQuery } from '@yayatoh/kernel';
import { buttonClass, PageHeader } from '@yayatoh/ui';
import { ArrowLeft } from 'lucide-react';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Crumbs } from '@/components/crumbs.tsx';
import { StageView } from '@/components/engagement/stage-view.tsx';
import { Link } from '@/i18n/navigation.ts';
import { moderationChannelUrl } from '@/server/engagement.ts';
import { ports } from '@/server/ports.ts';
import { loadProgramPage } from '@/server/program.ts';

type Params = { params: Promise<{ locale: string; org: string; event: string; session: string }> };

export async function generateMetadata() {
  const t = await getTranslations('engagement.presenter');
  return { title: t('metaTitle') };
}

/**
 * The presenter view (M5.7a): for the speaker's laptop or phone, the current question and the poll
 * on stage with live results (even while hidden from the audience), and what is next. Members only.
 */
export default async function PresenterPage({ params }: Params) {
  const { locale, org, event, session } = await params;
  setRequestLocale(locale);
  const { data, ev, program } = await loadProgramPage(org, event, 'sessions');
  const s = program.sessions.find((x) => x.id === session);
  if (!s) notFound();
  const page = await executeQuery(moderationQuery, { eventId: ev.id, sessionId: s.id }, data.ctx, ports);
  if (!page.enabled || !page.state) notFound();
  const t = await getTranslations('engagement');
  const tr = await getTranslations();
  const live = `/o/${org}/e/${event}/sessions/${s.id}/live`;
  return (
    <>
      <PageHeader
        breadcrumb={
          <Crumbs
            items={[
              { label: data.org.name, href: `/o/${org}` },
              { label: ev.name, href: `/o/${org}/e/${event}` },
              { label: tr('nav.sessions'), href: `/o/${org}/e/${event}/sessions` },
              { label: t('moderator.title'), href: live },
              { label: t('presenter.metaTitle') },
            ]}
          />
        }
        title={s.title}
        actions={
          <Link href={live} className={buttonClass('secondary')}>
            <ArrowLeft aria-hidden="true" className="rtl:-scale-x-100" />
            {t('presenter.back')}
          </Link>
        }
      />
      <StageView
        variant="presenter"
        eventName={ev.name}
        sessionTitle={s.title}
        initial={page.state}
        streamUrl={moderationChannelUrl(data.ctx.orgId ?? '', ev.id, s.id)}
        join={null}
      />
    </>
  );
}
