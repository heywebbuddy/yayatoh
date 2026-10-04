import { normalizeCode } from '@yayatoh/ce';
import { Button, Card, Input, Label, PageHeader } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { z } from 'zod';
import { redirect } from '@/i18n/navigation.ts';
import { pageLocale } from '@/server/locale.ts';

type Params = {
  params: Promise<{ locale: string; org: string }>;
  searchParams: Promise<{ code?: string | string[] }>;
};

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('ce.verify');
  return { title: t('metaTitle'), robots: { index: false }, referrer: 'no-referrer' };
}

/** Enter a certificate's code (M6.9b): a plain form (no script), then the code's page. */
export default async function VerifyFormPage({ params, searchParams }: Params) {
  const { locale, org } = await params;
  pageLocale(locale);
  if (!z.uuid().safeParse(org).success) notFound();
  const sp = await searchParams;
  const typed = typeof sp.code === 'string' ? sp.code.slice(0, 40) : null;
  const code = typed ? normalizeCode(typed) : null;
  if (code) redirect({ href: `/certificates/${org}/verify/${code}`, locale });
  const t = await getTranslations('ce.verify');
  return (
    <main id="main" className="mx-auto flex min-h-dvh w-full max-w-xl flex-col gap-6 px-4 py-10 sm:px-6">
      <PageHeader eyebrow={<Label>{t('eyebrow')}</Label>} title={t('title')} description={t('description')} />
      <Card>
        <form method="get" className="flex flex-col gap-4" noValidate>
          <Input
            id="code"
            name="code"
            label={t('codeLabel')}
            hint={t('codeHint')}
            defaultValue={typed ?? ''}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            required
            error={typed !== null ? t('codeInvalid') : undefined}
          />
          <div>
            <Button type="submit">{t('check')}</Button>
          </div>
        </form>
      </Card>
    </main>
  );
}
