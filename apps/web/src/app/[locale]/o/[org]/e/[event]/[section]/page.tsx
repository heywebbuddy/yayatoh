import { composeNav, isProfileKey, navLabelKey } from '@yayatoh/platform';
import { EmptyState, PageHeader } from '@yayatoh/ui';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { loadEvent } from '@/server/console.ts';

/**
 * Sections of the event console that later milestones fill in. Only sections the profile's
 * navigation shows (and the org is entitled to) resolve; anything else is a 404.
 */
export default async function SectionPage({
  params,
}: {
  params: Promise<{ locale: string; org: string; event: string; section: string }>;
}) {
  const { locale, org, event, section } = await params;
  setRequestLocale(locale);
  const { data, event: ev } = await loadEvent(org, event);
  const profile = isProfileKey(ev.profile) ? ev.profile : 'other';
  const item = composeNav(profile, data.modules).find((i) => i.path === section);
  if (!item) notFound();
  const t = await getTranslations();
  return (
    <>
      <PageHeader title={t(navLabelKey(profile, item))} />
      <EmptyState title={t('section.comingTitle')} description={t('section.comingDescription')} />
    </>
  );
}
