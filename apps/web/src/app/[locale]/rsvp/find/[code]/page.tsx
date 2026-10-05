import { rsvpLookupTarget } from '@yayatoh/guests';
import { Label, PageHeader } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { humanCheckWidget } from '@/server/human-check.ts';
import { findRsvpAction } from './actions.ts';
import { RsvpLookupForm } from './lookup-form.tsx';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('rsvpFind');
  return { title: t('metaTitle'), robots: { index: false, follow: false } };
}

/**
 * The paper fallback's address (M4.1d, P4-2), printed on invitations: `/rsvp/find/{code}`. It
 * names no event, no host and no guest: the code finds the event server-side (only while the
 * hosts keep name lookup on), and the page never lists anyone.
 */
export default async function RsvpFindPage({
  params,
}: {
  params: Promise<{ locale: string; code: string }>;
}) {
  const { locale, code: raw } = await params;
  setRequestLocale(locale);
  const code = decodeURIComponent(raw).toUpperCase();
  if (!(await rsvpLookupTarget(code))) notFound();
  const t = await getTranslations('rsvpFind');
  return (
    <main
      id="main"
      className="mx-auto flex min-h-dvh w-full max-w-xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-14"
    >
      <PageHeader eyebrow={<Label>{t('eyebrow')}</Label>} title={t('title')} description={t('intro')} />
      <RsvpLookupForm action={findRsvpAction.bind(null, code)} challenge={humanCheckWidget()} />
    </main>
  );
}
