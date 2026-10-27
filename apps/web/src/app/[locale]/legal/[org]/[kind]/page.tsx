import { LEGAL_PAGE_KINDS, type LegalPageKind, publicLegalPage } from '@yayatoh/tenancy';
import { Scale } from 'lucide-react';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { PageHero, Toc, type TocItem } from '@/components/showcase/page-hero.tsx';
import { PLATFORM_LEGAL } from '@/content/platform-legal.ts';
import { Link } from '@/i18n/navigation.ts';

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
  const paras = body
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  // A short line without closing punctuation is a section heading: those feed the contents list.
  const isHeading = (p: string) => p.length <= 80 && !p.includes('\n') && !/[.:;,]$/.test(p);
  const toc: TocItem[] = [];
  const blocks = paras.map((p, i) => {
    const heading = isHeading(p);
    if (heading) toc.push({ id: `section-${i}`, title: p.replace(/^\d+[.)]\s*/, '') });
    return { p, id: `section-${i}`, heading };
  });
  return (
    <main id="main" className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col gap-8 px-4 py-6 md:px-6">
      <PageHero
        eyebrow={eyebrow}
        title={title}
        icon={Scale}
        lede={
          updated
            ? t('legal.updated', {
                date: new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(updated),
              })
            : undefined
        }
      />
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[240px_minmax(0,1fr)]">
        <Toc items={toc} />
        <div
          className={`flex max-w-[68ch] flex-col gap-4 text-[17px] leading-8 ${toc.length < 3 ? 'lg:col-span-2' : ''}`}
        >
          {blocks.map((b) =>
            b.heading && toc.length >= 3 ? (
              <h2 key={b.id} id={b.id} className="mt-4 scroll-mt-24 text-[22px] leading-snug font-extrabold">
                {b.p}
              </h2>
            ) : (
              <p key={b.id} className="whitespace-pre-line">
                {b.p}
              </p>
            ),
          )}
        </div>
      </div>
      {org !== 'platform' && kind === 'privacy' ? (
        // M6.1c: the person's own data-subject request (a copy, or erasure).
        <p className="text-body">
          <Link
            href={`/privacy-request/${org}`}
            className="inline-flex min-h-11 items-center font-semibold underline underline-offset-2"
          >
            {t('legal.privacyRequest')}
          </Link>
        </p>
      ) : null}
    </main>
  );
}
