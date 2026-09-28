import { buttonClass, Card, Label, PageHeader } from '@yayatoh/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { SignInForm } from '@/components/sign-in-form.tsx';
import { Link } from '@/i18n/navigation.ts';
import { devAuthEnabled } from '@/server/session.ts';

export default async function SignInPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ next?: string; challenge?: string }>;
}) {
  const { locale } = await params;
  const { next, challenge } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations('signIn');
  // Only same-site relative paths are accepted as a post-sign-in destination (no open redirect).
  const safeNext = next?.startsWith('/') && !next.startsWith('//') ? next : '/o';
  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-6 py-16">
      <PageHeader eyebrow={<Label>{t('eyebrow')}</Label>} title={t('title')} />
      <Card size="panel">
        {/* `challenge=1`: a magic link signed in the first factor; the code is still due. */}
        <SignInForm next={safeNext} challenge={challenge === '1'} />
      </Card>
      {devAuthEnabled() ? (
        <Link href="/dev/login" className={buttonClass('ghost', 'sm', 'self-center')}>
          {t('devPersonas')}
        </Link>
      ) : null}
    </main>
  );
}
