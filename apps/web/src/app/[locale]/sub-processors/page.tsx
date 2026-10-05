import { Label, PageHeader, Table } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { PRIVACY_UPDATED, SUB_PROCESSORS } from '@/content/sub-processors.ts';
import { Link } from '@/i18n/navigation.ts';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'subprocessors' });
  return { title: t('title') };
}

/** The sub-processor list (M1.14c; roadmap §10: 30 days' notice of changes). DRAFT. */
export default async function SubProcessorsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('subprocessors');
  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-4xl flex-col gap-6 px-6 py-16">
      <PageHeader
        eyebrow={<Label>{t('eyebrow')}</Label>}
        title={t('title')}
        description={t('updated', {
          date: new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'UTC' }).format(
            new Date(`${PRIVACY_UPDATED}T00:00:00Z`),
          ),
        })}
      />
      <p
        role="note"
        className="rounded-card border border-primary bg-primary-soft px-4 py-3 text-body text-primary-ink"
      >
        {t('draft')}
      </p>
      <p className="text-body">{t('intro')}</p>
      <Table
        caption={t('caption')}
        rowKey={(s) => s.key}
        rows={SUB_PROCESSORS}
        columns={[
          { key: 'name', header: t('columns.name'), cell: (s) => s.name },
          { key: 'purpose', header: t('columns.purpose'), cell: (s) => t(`purposes.${s.key}`) },
          { key: 'data', header: t('columns.data'), cell: (s) => t(`data.${s.data}`) },
          { key: 'location', header: t('columns.location'), cell: (s) => s.location },
        ]}
      />
      <p className="text-body">{t('notice')}</p>
      <p className="text-body">
        <Link href="/privacy" className="underline underline-offset-2">
          {t('privacyLink')}
        </Link>
      </p>
    </main>
  );
}
