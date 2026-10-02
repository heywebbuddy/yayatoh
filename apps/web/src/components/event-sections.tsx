import type { PublicSectionDto } from '@yayatoh/events';
import { getTranslations } from 'next-intl/server';
import { Markdown } from './markdown.tsx';

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
          {s.kind === 'text' ? <Markdown source={s.content.markdown} /> : null}
          {s.kind === 'faq' ? (
            <div className="flex flex-col divide-y divide-line rounded-card border border-line">
              {s.content.items.map((item) => (
                <details key={item.question} className="group px-5 py-3">
                  <summary className="min-h-6 cursor-pointer font-medium text-ink">{item.question}</summary>
                  <Markdown source={item.answer} className="flex flex-col gap-2 pt-2 text-body text-ink-2" />
                </details>
              ))}
            </div>
          ) : null}
          {s.kind === 'schedule' ? (
            <ol className="list-none divide-y divide-line rounded-card border border-line p-0">
              {s.content.items.map((item) => (
                <li key={`${item.time}-${item.title}`} className="flex flex-wrap gap-x-6 gap-y-1 px-5 py-4">
                  <time className="w-16 text-body font-extrabold text-ink tabular-nums">{item.time}</time>
                  <span className="flex-1">{item.title}</span>
                  {item.detail ? <span className="text-caption text-ink-2">{item.detail}</span> : null}
                </li>
              ))}
            </ol>
          ) : null}
          {s.kind === 'location' ? (
            <div className="flex flex-col gap-3">
              {s.content.address ? (
                <address className="whitespace-pre-line not-italic text-body text-ink-2">
                  {s.content.address}
                </address>
              ) : null}
              {s.content.directions ? <Markdown source={s.content.directions} /> : null}
              {s.content.mapUrl ? (
                <a
                  href={s.content.mapUrl}
                  rel="noopener noreferrer nofollow"
                  className="self-start text-body underline underline-offset-2"
                >
                  {t('openMap')}
                </a>
              ) : null}
            </div>
          ) : null}
          {s.kind === 'links' ? (
            <ul className="flex list-none flex-col gap-2 p-0">
              {s.content.items.map((item) => (
                <li key={item.url}>
                  <a
                    href={item.url}
                    rel="noopener noreferrer nofollow"
                    className="inline-flex min-h-6 items-center text-body underline underline-offset-2"
                  >
                    {item.label}
                  </a>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ))}
    </>
  );
}
