import { parseVideoUrl, type SectionBody, videoEmbedUrl } from '@yayatoh/events/ui';
import { Markdown } from './markdown.tsx';

/** Schedule rows grouped under their day heading (consecutive rows with the same `day`). */
export function groupScheduleByDay<T extends { day: string | null }>(
  items: readonly T[],
): { day: string | null; items: T[] }[] {
  const groups: { day: string | null; items: T[] }[] = [];
  for (const item of items) {
    const last = groups.at(-1);
    if (last && last.day === item.day) last.items.push(item);
    else groups.push({ day: item.day, items: [item] });
  }
  return groups;
}

/**
 * The body of one page section as the public event page shows it. Pure (no server APIs), so the
 * console's live preview renders exactly what visitors will see.
 */
export function SectionBodyView({
  section,
  openMap,
  title = '',
}: {
  section: SectionBody;
  openMap: string;
  /** The section's title: the video player's accessible name when there is no caption. */
  title?: string;
}) {
  if (section.kind === 'text') return <Markdown source={section.content.markdown} />;
  if (section.kind === 'faq')
    return (
      <div className="flex flex-col divide-y divide-line rounded-card border border-line">
        {section.content.items.map((item, i) => (
          <details key={`${i}-${item.question}`} className="group px-5 py-3">
            <summary className="min-h-6 cursor-pointer font-medium text-ink">{item.question}</summary>
            <Markdown source={item.answer} className="flex flex-col gap-2 pt-2 text-body text-ink-2" />
          </details>
        ))}
      </div>
    );
  if (section.kind === 'schedule')
    return (
      <div className="flex flex-col gap-4">
        {groupScheduleByDay(section.content.items).map((group, g) => (
          <div key={`${g}-${group.day ?? ''}`} className="flex flex-col gap-2">
            {group.day ? <h3 className="m-0 text-card font-extrabold">{group.day}</h3> : null}
            <ol className="list-none divide-y divide-line rounded-card border border-line p-0">
              {group.items.map((item, i) => (
                <li key={`${i}-${item.title}`} className="flex flex-wrap gap-x-6 gap-y-1 px-5 py-4">
                  {item.time ? (
                    <time className="w-16 text-body font-extrabold text-ink tabular-nums">{item.time}</time>
                  ) : null}
                  <span className="flex-1">{item.title}</span>
                  {item.detail ? <span className="text-caption text-ink-2">{item.detail}</span> : null}
                </li>
              ))}
            </ol>
          </div>
        ))}
      </div>
    );
  if (section.kind === 'location')
    return (
      <div className="flex flex-col gap-3">
        {section.content.address ? (
          <address className="whitespace-pre-line not-italic text-body text-ink-2">
            {section.content.address}
          </address>
        ) : null}
        {section.content.directions ? <Markdown source={section.content.directions} /> : null}
        {section.content.mapUrl ? (
          <a
            href={section.content.mapUrl}
            rel="noopener noreferrer nofollow"
            className="self-start text-body underline underline-offset-2"
          >
            {openMap}
          </a>
        ) : null}
      </div>
    );
  if (section.kind === 'video') {
    const ref = parseVideoUrl(section.content.url);
    if (!ref) return null;
    return (
      <figure className="m-0 flex flex-col gap-2">
        <div className="relative aspect-video w-full overflow-hidden rounded-card border border-line bg-surface-3">
          <iframe
            src={videoEmbedUrl(ref)}
            title={section.content.caption ?? title}
            loading="lazy"
            referrerPolicy="strict-origin-when-cross-origin"
            sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
            allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen"
            allowFullScreen
            className="absolute inset-0 size-full border-0"
          />
        </div>
        {section.content.caption ? (
          <figcaption className="text-caption text-ink-2">{section.content.caption}</figcaption>
        ) : null}
      </figure>
    );
  }
  return (
    <ul className="flex list-none flex-col gap-2 p-0">
      {section.content.items.map((item, i) => (
        <li key={`${i}-${item.url}`}>
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
  );
}
