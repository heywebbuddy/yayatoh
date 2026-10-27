import type { PublicSectionDto } from '@yayatoh/events';
import { getTranslations } from 'next-intl/server';
import { SectionBodyView } from './section-body.tsx';

/** The public page's content sections (M1.4d), in the organizer's order. */
export async function EventSections({ sections }: { sections: readonly PublicSectionDto[] }) {
  const t = await getTranslations('content');
  return (
    <>
      {sections.map((s) => (
        <section
          key={s.id}
          aria-labelledby={`section-${s.id}`}
          className="flex scroll-mt-4 flex-col gap-4 rounded-panel border border-line bg-surface p-5 elevation-card glass md:p-6"
        >
          <h2 id={`section-${s.id}`} className="text-section">
            {s.title}
          </h2>
          <SectionBodyView section={s} openMap={t('openMap')} title={s.title} />
        </section>
      ))}
    </>
  );
}
