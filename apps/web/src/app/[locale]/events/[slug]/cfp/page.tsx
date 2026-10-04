import { pageTarget, publicEventBySlug } from '@yayatoh/events';
import { publicCfp } from '@yayatoh/program';
import { EmptyState, Label, PageHeader } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation.ts';
import { formatMoment } from '@/lib/portal-format.ts';
import { pageLocale } from '@/server/locale.ts';
import { submitCfpAction } from './actions.ts';
import { CfpForm } from './cfp-form.tsx';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('cfpPublic');
  return { title: t('metaTitle'), robots: { index: false } };
}

/**
 * An event's call for papers (M5.3b, public): the organizer's introduction, the deadline in the
 * event's time zone and the proposal form. A call that is still a draft (or none) is a 404; a
 * closed one says so.
 */
export default async function CfpPublicPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  pageLocale(locale);
  const target = await pageTarget(slug);
  const ev = target ? await publicEventBySlug(slug) : null;
  const call = target ? await publicCfp(target) : null;
  if (!target || !ev || !call) notFound();
  const t = await getTranslations('cfpPublic');
  return (
    <main
      id="main"
      className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-6 px-4 py-10 sm:px-6 sm:py-16"
    >
      <PageHeader
        eyebrow={<Label>{ev.name}</Label>}
        title={t('title')}
        description={
          call.closesAt && call.state === 'open'
            ? t('deadline', {
                date: formatMoment(call.closesAt, locale, ev.timezone),
                zone: ev.timezone.replace(/_/g, ' '),
              })
            : undefined
        }
      />
      {call.intro ? <p className="m-0 whitespace-pre-line text-body text-ink-2">{call.intro}</p> : null}
      {call.state === 'open' ? (
        <CfpForm action={submitCfpAction.bind(null, slug)} call={call} />
      ) : (
        <EmptyState title={t('closedTitle')} description={t('closedDescription')} />
      )}
      <Link
        href={`/events/${slug}`}
        className="inline-flex min-h-11 items-center self-start text-body underline underline-offset-2"
      >
        {t('backToEvent')}
      </Link>
    </main>
  );
}
