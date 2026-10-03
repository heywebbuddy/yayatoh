import { Card, Label, PageHeader } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AuthBar } from '@/components/auth-bar.tsx';
import { ForgotPasswordForm } from '@/components/password-reset-forms.tsx';
import { humanCheckWidget } from '@/server/human-check.ts';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'passwordReset' });
  return { title: t('forgotMetaTitle') };
}

/** Ask for a link to choose a new password (M1.2f). */
export default async function ForgotPasswordPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('passwordReset');
  return (
    <>
      <AuthBar />
      <main
        id="main"
        className="mx-auto flex min-h-[calc(100dvh-5rem)] max-w-md flex-col justify-center gap-6 px-6 py-16"
      >
        <PageHeader
          eyebrow={<Label>{t('eyebrow')}</Label>}
          title={t('forgotTitle')}
          description={t('forgotDescription')}
        />
        <Card size="panel">
          <ForgotPasswordForm humanCheck={humanCheckWidget()} locale={locale} />
        </Card>
      </main>
    </>
  );
}
