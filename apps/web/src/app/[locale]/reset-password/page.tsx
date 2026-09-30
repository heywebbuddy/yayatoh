import { Card, Label, PageHeader } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ResetPasswordForm } from '@/components/password-reset-forms.tsx';
import { Link } from '@/i18n/navigation.ts';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'passwordReset' });
  return { title: t('resetMetaTitle'), referrer: 'no-referrer' };
}

/** The emailed link lands here with its token (Better Auth checked it first; `error` if not). */
export default async function ResetPasswordPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ token?: string; error?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { token, error } = await searchParams;
  const t = await getTranslations('passwordReset');
  const usable = token && !error;
  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-6 py-16">
      <PageHeader eyebrow={<Label>{t('eyebrow')}</Label>} title={t('resetTitle')} />
      <Card size="panel">
        {usable ? (
          <ResetPasswordForm token={token} />
        ) : (
          <div className="flex flex-col gap-4">
            <p className="text-body text-zinc-600">{t('errors.invalid_token')}</p>
            <Link href="/forgot-password" className="self-start text-body underline underline-offset-4">
              {t('askAgain')}
            </Link>
          </div>
        )}
      </Card>
    </main>
  );
}
