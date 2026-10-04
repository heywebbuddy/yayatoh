import { type FloorplanDoc, itemCenter, mapArea } from '@yayatoh/floorplan';
import { useTranslations } from 'next-intl';

/**
 * The venue map in words (its accessible alternative, M1.7e): everything on the plan — stage,
 * entrances, bars, tables, rows — and where it is on the map, with the guest's own seats marked
 * (and, M4.4a, the guest's own tables or rows).
 */
export function VenueGuide({
  doc,
  highlight = [],
  highlightItems = [],
  headingLevel = 3,
  headingId = 'venue-guide-heading',
}: {
  doc: FloorplanDoc;
  highlight?: readonly string[];
  highlightItems?: readonly string[];
  headingLevel?: 2 | 3;
  /** Unique per page when the page shows several plans (M4.4a: one per sub-event). */
  headingId?: string;
}) {
  const t = useTranslations('venueMap');
  const mine = new Set(highlight);
  const places = new Set(highlightItems);
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  // Landmarks first (stage, doors, bars…), then tables and rows in plan order.
  const items = [
    ...doc.items.filter((i) => i.kind === 'object'),
    ...doc.items.filter((i) => i.kind !== 'object'),
  ];
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <Heading id={headingId} className="text-section">
        {t('guide')}
      </Heading>
      <p className="text-caption text-ink-2">{t('guideHint')}</p>
      <ul aria-labelledby={headingId} className="grid list-none gap-x-6 gap-y-1.5 p-0 sm:grid-cols-2">
        {items.map((item) => {
          const area = t(`area.${mapArea(doc, itemCenter(item))}`);
          if (item.kind === 'object')
            return (
              <li key={item.id} className="flex flex-col border-b border-line py-1.5">
                <span className="text-body text-ink">
                  {item.label && item.label !== t(`object.${item.objectType}`)
                    ? t('named', { type: t(`object.${item.objectType}`), label: item.label })
                    : t(`object.${item.objectType}`)}
                </span>
                <span className="text-caption text-ink-2">{area}</span>
              </li>
            );
          const yours = item.seats.filter((s) => mine.has(s.id));
          const yourPlace = places.has(item.id);
          return (
            <li
              key={item.id}
              data-your-place={yourPlace ? item.id : undefined}
              className={`flex flex-col border-b border-line py-1.5 ${yours.length || yourPlace ? 'font-medium' : ''}`}
            >
              <span className="text-body text-ink">
                {t(item.kind, { label: item.label })}
                <span className="text-caption font-normal text-ink-2">
                  {' · '}
                  {t('seats', { count: item.seats.length })}
                </span>
              </span>
              <span className="text-caption text-ink-2">{area}</span>
              {yourPlace ? (
                <span className="text-caption text-primary-ink">{t(`yourPlace.${item.kind}`)}</span>
              ) : yours.length ? (
                <span className="text-caption text-primary-ink">
                  {t('yours', { count: yours.length, seats: yours.map((s) => s.label).join(', ') })}
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
