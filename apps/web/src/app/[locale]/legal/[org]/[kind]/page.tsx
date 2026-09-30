import { LEGAL_PAGE_KINDS, type LegalPageKind, publicLegalPage } from '@yayatoh/tenancy';
import { Label, PageHeader } from '@yayatoh/ui';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { PLATFORM_LEGAL } from '@/content/platform-legal.ts';

/**
 * Public legal pages: the platform's own agreements (`/legal/platform/platform_tos|dpa`), and each
 * organizer's terms, privacy notice and refund policy (`/legal/<org>/terms|privacy|refund`).
 * Plain text with paragraphs; no HTML from the database is rendered.
 */
export default async function LegalPage({
  params,
}: {
  params: Promise<{ locale: string; org: string; kind: string }>;
}) {
  const { locale, org, kind } = await params;
  setRequestLocale(locale);
  const t = await getTranslations();
  let title: string;
  let eyebrow: string;
  let body: string;
  let updated: Date | null = null;
  if (org === 'platform') {
    const doc = PLATFORM_LEGAL[kind as keyof typeof PLATFORM_LEGAL];
    if (!doc) notFound();
    ({ title, body } = doc);
    eyebrow = t('legal.platform');
  } else {
    if (!LEGAL_PAGE_KINDS.includes(kind as LegalPageKind)) notFound();
    const page = await publicLegalPage(org, kind as LegalPageKind);
    if (!page) notFound();
    title = t(`settings.legal.kind.${kind}`);
    eyebrow = page.orgName;
    body = page.body;
    updated = page.updatedAt;
  }
  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-6 px-6 py-16">
      <PageHeader
        eyebrow={<Label>{eyebrow}</Label>}
        title={title}
        description={
          updated
            ? t('legal.updated', {
                date: new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(updated),
              })
            : undefined
        }
      />
      <div className="flex flex-col gap-4 text-body">
        {body.split(/\n{2,}/).map((para, i) => (
          <p key={i} className="whitespace-pre-line">
            {para}
          </p>
        ))}
      </div>
    </main>
  );
}
