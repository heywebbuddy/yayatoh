import { checkoutTarget, publicEventBySlug } from '@yayatoh/events';
import { hasRegistrationForm } from '@yayatoh/forms';
import { EmptyState, Label, PageHeader } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { RegistrationStartForm } from '@/components/registration-form-runner.tsx';
import { Link } from '@/i18n/navigation.ts';
import { pageLocale } from '@/server/locale.ts';
import { publicRegistrationTypes } from '@/server/registration-types.ts';
import { startRegistrationFormAction } from './actions.ts';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('registrationForm');
  return { title: t('startMetaTitle'), robots: { index: false } };
}

/**
 * The start of an event's registration form (M5.1b): the person picks their registration type
 * and gives their name and email; the form's pages follow on their own signed link.
 */
export default async function RegistrationStartPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  pageLocale(locale);
  const target = await checkoutTarget(slug);
  const ev = target ? await publicEventBySlug(slug) : null;
  if (!target || !ev || !(await hasRegistrationForm(target.orgId, target.eventId))) notFound();
  const types = await publicRegistrationTypes(slug);
  const t = await getTranslations('registrationForm');
  return (
    <main
      id="main"
      className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-6 px-4 py-10 sm:px-6 sm:py-16"
    >
      <PageHeader
        eyebrow={<Label>{ev.name}</Label>}
        title={t('startTitle')}
        description={t('startDescription')}
      />
      {types.length === 0 ? (
        <EmptyState title={t('noTypesPublicTitle')} description={t('noTypesPublic')} />
      ) : (
        <RegistrationStartForm types={types} action={startRegistrationFormAction.bind(null, slug)} />
      )}
      <Link href={`/events/${slug}`} className="self-start text-body underline underline-offset-2">
        {t('backToEvent')}
      </Link>
    </main>
  );
}
