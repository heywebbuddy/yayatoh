import { publicEventBySlug } from '@yayatoh/events';
import { EmptyState, Label, PageHeader } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { GuestHelpForm } from '@/components/assistance-guest.tsx';
import { Link } from '@/i18n/navigation.ts';
import { checkHelpTicket } from '@/server/assistance.ts';
import { askForHelpAction } from './actions.ts';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'assistance.guest' });
  return { title: t('title') };
}

/**
 * "Need help" from the seat finder (M3.3b), `/events/{slug}/seat-finder/help?ticket=…`: a guest
 * whose ticket's help link is valid for this event picks a reason (medical shows the emergency
 * guidance first), adds a note and where they are, and asks the event's staff. Anything else
 * (no link, a forged one, another event's ticket, a void ticket) is refused with a way back.
 */
export default async function GuestHelpPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; slug: string }>;
  searchParams: Promise<{ ticket?: string }>;
}) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const ev = await publicEventBySlug(slug);
  if (!ev) notFound();
  const token = (await searchParams).ticket ?? '';
  const t = await getTranslations('assistance.guest');
  const check = await checkHelpTicket(slug, token.slice(0, 200));
  const back = (
    <Link href={`/events/${slug}/seat-finder`} className="self-start text-caption text-ink-2 underline">
      {t('back')}
    </Link>
  );
  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-xl flex-col gap-6 px-4 py-10 sm:px-6">
      <PageHeader eyebrow={<Label>{ev.name}</Label>} title={t('title')} description={t('description')} />
      {!check ? (
        <EmptyState title={t('closedTitle')} description={t('closedDescription')} />
      ) : !check.valid ? (
        <EmptyState title={t('invalidTitle')} description={t('invalidDescription')} />
      ) : (
        <GuestHelpForm action={askForHelpAction.bind(null, slug, token)} />
      )}
      {back}
    </main>
  );
}
