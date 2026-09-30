import { preferenceCenterInfo } from '@yayatoh/notifications';
import { Card, Label, PageHeader } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { PreferenceCenterForm } from '@/components/preference-center-form.tsx';
import { savePreferencesAction } from './actions.ts';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('preferenceCenter');
  return { title: t('metaTitle'), robots: { index: false } };
}

/**
 * The recipient's preference center (M3.5a): categories by email, and consent to text messages
 * and WhatsApp with the disclosure next to the boxes. No account: the signed link is the
 * credential and names the org (`/preferences/{org}/{token}`).
 */
export default async function PreferenceCenterPage({
  params,
}: {
  params: Promise<{ locale: string; org: string; token: string }>;
}) {
  const { locale, org, token: raw } = await params;
  setRequestLocale(locale);
  const token = decodeURIComponent(raw);
  const info = await preferenceCenterInfo(org, token);
  if (!info) notFound();
  const t = await getTranslations('preferenceCenter');
  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-6 px-6 py-16">
      <PageHeader
        eyebrow={<Label>{t('eyebrow')}</Label>}
        title={t('title', { org: info.orgName })}
        description={t('description', { org: info.orgName })}
      />
      <Card size="panel">
        <PreferenceCenterForm
          action={savePreferencesAction.bind(null, org, token)}
          org={info.orgName}
          email={info.email}
          phone={info.phone}
          initial={{ emailCategories: info.emailCategories, sms: info.sms, whatsapp: info.whatsapp }}
        />
      </Card>
    </main>
  );
}
