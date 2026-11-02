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
          data-ev-section
          className="ev-card flex flex-col gap-5 rounded-card p-6 md:p-10"
        >
          <h2
            id={`section-${s.id}`}
            className="m-0 font-display text-[length:calc(clamp(24px,3vw,30px)*var(--ev-scale,1))] leading-none font-black tracking-[-0.02em] uppercase [overflow-wrap:anywhere]"
          >
            {s.title}
          </h2>
          <SectionBodyView section={s} openMap={t('openMap')} title={s.title} />
        </section>
      ))}
    </>
  );
}
