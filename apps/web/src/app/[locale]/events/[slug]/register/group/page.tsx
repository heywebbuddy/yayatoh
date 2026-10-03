import { checkoutTarget, publicEventBySlug } from '@yayatoh/events';
import { formatMoney, money } from '@yayatoh/kernel';
import { MAX_GROUP, publicGroupOptions } from '@yayatoh/registration';
import { Card, EmptyState, Label, PageHeader } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation.ts';
import { pageLocale } from '@/server/locale.ts';
import { groupAction } from './actions.ts';
import { GroupForm } from './group-form.tsx';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('registration.group');
  return { title: t('metaTitle'), robots: { index: false } };
}

type Params = {
  params: Promise<{ locale: string; slug: string }>;
  searchParams: Promise<{ people?: string }>;
};

/** Register a group (M5.1c): one payer, up to 20 named people, each with their own pass. */
export default async function GroupRegisterPage({ params, searchParams }: Params) {
  const { locale, slug } = await params;
  pageLocale(locale);
  const target = await checkoutTarget(slug);
  const ev = target ? await publicEventBySlug(slug) : null;
  if (!target || !ev) notFound();
  const t = await getTranslations('registration.group');
  const count = Math.min(MAX_GROUP, Math.max(1, Number((await searchParams).people ?? 3) || 3));
  const options = await publicGroupOptions(target.orgId, target.eventId);
  const passes = options.map((o) => ({
    value: `${o.registrationTypeId}:${o.admissionItemId}`,
    label: `${o.typeName} · ${o.itemName} · ${formatMoney(money(o.allInMinor, o.currency), locale).replace(/\.00$/, '')}`,
  }));
  return (
    <main
      id="main"
      className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-6 px-4 py-10 sm:px-6 sm:py-16"
    >
      <PageHeader eyebrow={<Label>{ev.name}</Label>} title={t('title')} description={t('description')} />
      {passes.length === 0 ? (
        <Card>
          <EmptyState title={t('emptyTitle')} description={t('emptyDescription')} />
        </Card>
      ) : (
        <>
          <nav aria-label={t('countLabel')} className="flex flex-wrap items-center gap-2">
            <span className="text-body text-ink-2">{t('howMany')}</span>
            {[2, 3, 4, 5, 6, 8, 10].map((k) => (
              <Link
                key={k}
                href={`/events/${slug}/register/group?people=${k}`}
                aria-current={k === count ? 'page' : undefined}
                className={`inline-flex min-h-11 min-w-11 items-center justify-center rounded-pill border px-3 text-body ${k === count ? 'border-ink bg-tag text-white' : 'border-line bg-surface'}`}
              >
                {t('peopleCount', { count: k })}
              </Link>
            ))}
          </nav>
          <GroupForm key={count} action={groupAction.bind(null, slug)} count={count} passes={passes} />
        </>
      )}
      <Link href={`/events/${slug}/register`} className="self-start text-body underline underline-offset-2">
        {t('backToRegister')}
      </Link>
    </main>
  );
}
