import { unsubscribeInfo } from '@yayatoh/notifications';
import { Card, Label, PageHeader } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { UnsubscribeForm } from '@/components/unsubscribe-form.tsx';
import { unsubscribeAction } from './actions.ts';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('unsubscribe');
  return { title: t('metaTitle'), robots: { index: false } };
}

/** The unsubscribe page behind the footer link of every optional email (no account needed). */
export default async function UnsubscribePage({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}) {
  const { locale, token: raw } = await params;
  setRequestLocale(locale);
  const token = decodeURIComponent(raw);
  const info = await unsubscribeInfo(token);
  if (!info) notFound();
  const t = await getTranslations('unsubscribe');
  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-xl flex-col gap-6 px-6 py-16">
      <PageHeader
        eyebrow={<Label>{t('eyebrow')}</Label>}
        title={t('title', { org: info.orgName })}
        description={t(`category.${info.category}`)}
      />
      <Card size="panel" className="flex flex-col gap-4">
        {info.email ? <p className="text-body text-zinc-600">{t('address', { email: info.email })}</p> : null}
        <UnsubscribeForm
          action={unsubscribeAction.bind(null, token)}
          initial={info.unsubscribed}
          org={info.orgName}
          category={info.category}
        />
        <p className="text-caption text-zinc-500">{t('transactionalNote')}</p>
      </Card>
    </main>
  );
}
