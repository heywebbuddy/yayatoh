import { Card, Label, PageHeader } from '@yayatoh/ui';
import { getTranslations } from 'next-intl/server';
import { SignInForm } from '@/components/sign-in-form.tsx';

export default async function SignInPage() {
  const t = await getTranslations('signIn');
  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-6 py-16">
      <PageHeader eyebrow={<Label>{t('eyebrow')}</Label>} title={t('title')} />
      <Card size="panel">
        <SignInForm />
      </Card>
    </main>
  );
}
