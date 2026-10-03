import { checkoutTarget, publicEventBySlug } from '@yayatoh/events';
import { hasRegistration } from '@yayatoh/registration';
import { Label, PageHeader } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { RegistrationForm } from '@/components/registration-form.tsx';
import { Link } from '@/i18n/navigation.ts';
import { pageLocale } from '@/server/locale.ts';
import { findOptionsAction, registerAction } from './actions.ts';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('registration.public');
  return { title: t('metaTitle'), robots: { index: false } };
}

type Params = { params: Promise<{ locale: string; slug: string }> };

/**
 * Register for a conference (M5.1a): registration types the visitor may pick, an admission item and
 * add-ons, then the normal payment. Only published, listed events that sell through registration.
 */
export default async function RegisterPage({ params }: Params) {
  const { locale, slug } = await params;
  pageLocale(locale);
  const target = await checkoutTarget(slug);
  const ev = target ? await publicEventBySlug(slug) : null;
  if (!target || !ev || !(await hasRegistration(target.orgId, target.eventId))) notFound();
  const t = await getTranslations('registration.public');
  return (
    <main
      id="main"
      className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-6 px-4 py-10 sm:px-6 sm:py-16"
    >
      <PageHeader eyebrow={<Label>{ev.name}</Label>} title={t('title')} description={t('description')} />
      <RegistrationForm
        find={findOptionsAction.bind(null, slug)}
        register={registerAction.bind(null, slug)}
      />
      {/* M5.1c: one payer for several people. */}
      <Link
        href={`/events/${slug}/register/group`}
        className="self-start text-body underline underline-offset-2"
      >
        {t('registerGroup')}
      </Link>
      <Link href={`/events/${slug}`} className="self-start text-body underline underline-offset-2">
        {t('backToEvent')}
      </Link>
    </main>
  );
}
