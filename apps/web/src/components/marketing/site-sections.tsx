import type { PublicSiteSectionDto } from '@yayatoh/cms';
import { buttonClass, CardLabel } from '@yayatoh/ui';
import { Markdown } from '@/components/markdown.tsx';
import { Link } from '@/i18n/navigation.ts';

function Cta({ label, href }: { label: string; href: string }) {
  // Site paths go through the locale-aware Link; https addresses leave the site.
  return href.startsWith('/') ? (
    <Link href={href} className={buttonClass('secondary')}>
      {label}
    </Link>
  ) : (
    <a href={href} className={buttonClass('secondary')} rel="noopener">
      {label}
    </a>
  );
}

/**
 * Marketing sections from the platform CMS (M3.11b). Only the layout is code: eyebrow, heading,
 * Markdown text and an optional call to action all come from the content org's console. `grid`
 * lays them out as cards (the home page's "Why Yayatoh"); `stack` one under another (features,
 * contact).
 */
export function SiteSections({
  sections,
  layout,
  locale,
  headingLevel = 2,
}: {
  sections: readonly PublicSiteSectionDto[];
  layout: 'grid' | 'stack';
  locale: string;
  headingLevel?: 2 | 3;
}) {
  if (sections.length === 0) return null;
  const H = headingLevel === 2 ? 'h2' : 'h3';
  return (
    <div
      className={
        layout === 'grid' ? 'grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3' : 'flex flex-col gap-10'
      }
    >
      {sections.map((s) => (
        <section
          key={s.slug}
          aria-labelledby={`section-${s.slug}`}
          lang={s.locale === locale ? undefined : s.locale}
          data-section={s.slug}
          className={`flex min-w-0 flex-col gap-3 ${layout === 'grid' ? 'rounded-card border border-zinc-200 p-5' : ''}`}
        >
          {s.eyebrow ? <CardLabel>{s.eyebrow}</CardLabel> : null}
          <H
            id={`section-${s.slug}`}
            className={`${layout === 'grid' ? 'text-[21px]' : 'text-[28px]'} leading-tight font-normal tracking-[-0.02em] break-words`}
          >
            {s.heading}
          </H>
          {s.body ? <Markdown source={s.body} /> : null}
          {s.ctaLabel && s.ctaHref ? (
            <div>
              <Cta label={s.ctaLabel} href={s.ctaHref} />
            </div>
          ) : null}
        </section>
      ))}
    </div>
  );
}
