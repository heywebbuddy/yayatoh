import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { CodeBlock } from '@/components/developers/code-block.tsx';
import { Markdown } from '@/components/markdown.tsx';
import { Link } from '@/i18n/navigation.ts';
import { GUIDES, guide } from '@/lib/developer-guides.ts';

export function generateStaticParams() {
  return GUIDES.map((g) => ({ guide: g.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ guide: string }>;
}): Promise<Metadata> {
  const g = guide((await params).guide);
  return g ? { title: g.title, description: g.summary.replaceAll('`', '') } : {};
}

/** One guide: English content (code verbatim), in the translated shell. */
export default async function GuidePage({ params }: { params: Promise<{ locale: string; guide: string }> }) {
  const { locale, guide: slug } = await params;
  setRequestLocale(locale);
  const g = guide(slug);
  if (!g) notFound();
  const t = await getTranslations('developers');
  return (
    <>
      <Link href="/developers/guides" className="text-caption underline underline-offset-2">
        {t('backToGuides')}
      </Link>
      <article lang="en" dir="ltr" className="flex max-w-3xl flex-col gap-5">
        <h1 className="text-[32px] leading-[1.1] font-light tracking-[-0.04em]">{g.title}</h1>
        {g.blocks.map((b) =>
          b.kind === 'md' ? (
            <Markdown key={b.text.slice(0, 40)} source={b.text} />
          ) : (
            <CodeBlock key={b.title} title={b.title} code={b.code} />
          ),
        )}
      </article>
    </>
  );
}
