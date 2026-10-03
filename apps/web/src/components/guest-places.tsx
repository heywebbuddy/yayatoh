import { type FloorplanDoc, itemCenter, mapArea, nearestObject } from '@yayatoh/floorplan';
import { Card } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

export interface GuestPlace {
  readonly itemId: string;
  readonly itemKind: 'table' | 'row';
  readonly itemLabel: string;
  readonly sponsor: string | null;
  readonly sponsorLogoUrl: string | null;
}

/**
 * The guest seat finder's tables (M4.4a): "Table 3" large, the hosted table's sponsor (M4.2b),
 * where it is on the map and the nearest entrance, plus whatever the caller adds (who of the
 * party sits there; tablemates on the party's own page only). Server or client.
 */
export function GuestPlaces({
  doc,
  places,
  detail,
  labelledBy,
}: {
  doc: FloorplanDoc;
  places: readonly GuestPlace[];
  detail?: (place: GuestPlace) => ReactNode;
  labelledBy?: string;
}) {
  const t = useTranslations('guestSeats');
  const tm = useTranslations('venueMap');
  const tf = useTranslations('seatFinder');
  const items = new Map(doc.items.map((i) => [i.id, i]));
  return (
    <ul aria-labelledby={labelledBy} className="m-0 flex list-none flex-col gap-2 p-0">
      {places.map((p) => {
        const item = items.get(p.itemId);
        const at = item ? itemCenter(item) : null;
        const door = at ? nearestObject(doc, at, ['entrance']) : null;
        return (
          <li key={p.itemId} data-guest-place={p.itemId}>
            <Card className="flex flex-col gap-1">
              <span className="text-[22px] font-extrabold tracking-[-0.03em]">
                {t(`placeAt.${p.itemKind}`, { item: p.itemLabel })}
              </span>
              {p.sponsor ? (
                <span className="flex items-center gap-2 text-body" data-sponsor>
                  {p.sponsorLogoUrl ? <img src={p.sponsorLogoUrl} alt="" className="h-8 w-auto" /> : null}
                  {tf('hostedBy', { sponsor: p.sponsor })}
                </span>
              ) : null}
              {at ? <span className="text-caption text-ink-2">{tm(`area.${mapArea(doc, at)}`)}</span> : null}
              {door ? (
                <span className="text-caption text-ink-2">
                  {tf('nearest', { name: door.label || tm('object.entrance') })}
                </span>
              ) : null}
              {detail?.(p)}
            </Card>
          </li>
        );
      })}
    </ul>
  );
}
