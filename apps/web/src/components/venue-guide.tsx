import { type FloorplanDoc, itemCenter, mapArea } from '@yayatoh/floorplan';
import { useTranslations } from 'next-intl';

/**
 * The venue map in words (its accessible alternative, M1.7e): everything on the plan — stage,
 * entrances, bars, tables, rows — and where it is on the map, with the guest's own seats marked.
 */
export function VenueGuide({
  doc,
  highlight = [],
  headingLevel = 3,
}: {
  doc: FloorplanDoc;
  highlight?: readonly string[];
  headingLevel?: 2 | 3;
}) {
  const t = useTranslations('venueMap');
  const mine = new Set(highlight);
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  // Landmarks first (stage, doors, bars…), then tables and rows in plan order.
  const items = [
    ...doc.items.filter((i) => i.kind === 'object'),
    ...doc.items.filter((i) => i.kind !== 'object'),
  ];
  return (
    <section aria-labelledby="venue-guide-heading" className="flex flex-col gap-2">
      <Heading id="venue-guide-heading" className="text-section">
        {t('guide')}
      </Heading>
      <p className="text-caption text-zinc-600">{t('guideHint')}</p>
      <ul
        aria-labelledby="venue-guide-heading"
        className="grid list-none gap-x-6 gap-y-1.5 p-0 sm:grid-cols-2"
      >
        {items.map((item) => {
          const area = t(`area.${mapArea(doc, itemCenter(item))}`);
          if (item.kind === 'object')
            return (
              <li key={item.id} className="flex flex-col border-b border-zinc-100 py-1.5">
                <span className="text-body text-zinc-900">
                  {item.label && item.label !== t(`object.${item.objectType}`)
                    ? t('named', { type: t(`object.${item.objectType}`), label: item.label })
                    : t(`object.${item.objectType}`)}
                </span>
                <span className="text-caption text-zinc-600">{area}</span>
              </li>
            );
          const yours = item.seats.filter((s) => mine.has(s.id));
          return (
            <li
              key={item.id}
              className={`flex flex-col border-b border-zinc-100 py-1.5 ${yours.length ? 'font-medium' : ''}`}
            >
              <span className="text-body text-zinc-900">
                {t(item.kind, { label: item.label })}
                <span className="text-caption font-normal text-zinc-600">
                  {' · '}
                  {t('seats', { count: item.seats.length })}
                </span>
              </span>
              <span className="text-caption text-zinc-600">{area}</span>
              {yours.length ? (
                <span className="text-caption text-accent-text">
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
