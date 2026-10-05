import type { TenantTx } from '@yayatoh/db';
import type { OccupantParty } from './guest-seating.ts';
import { viewTx } from './guest-seating.ts';

/**
 * Where every guest of an event sits, for the day of (M4.4b): the check-in screens, the kiosk,
 * the A–Z board and the host's day-of view. One read of the event plan and of each sub-event's
 * chart (`viewTx`, the seating editor's own view), so a guest's tables are exactly what the
 * seating editor shows. Labels only; the caller decides what leaves the server.
 */
export interface GuestPlace {
  /** The sub-event whose chart it is (null: the event plan). */
  readonly subEventId: string | null;
  readonly subEventName: string | null;
  readonly kind: 'table' | 'row';
  readonly label: string;
}

export interface GuestPlaces {
  /** Every party with every guest of the event (whole-event RSVP status). */
  readonly parties: readonly OccupantParty[];
  /** The charts guests can be seated on (those with a floor plan). */
  readonly charts: readonly { readonly subEventId: string | null; readonly name: string | null }[];
  /** A guest's places on those charts, event plan first, then sub-events in their order. */
  readonly placesOf: ReadonlyMap<string, readonly GuestPlace[]>;
}

export async function guestPlacesTx(tx: TenantTx, eventId: string): Promise<GuestPlaces> {
  const plan = await viewTx(tx, eventId, null);
  const views = [
    { sub: null as { id: string; name: string } | null, view: plan },
    ...(await Promise.all(
      plan.subEvents.map(async (s) => ({
        sub: { id: s.id, name: s.name },
        view: await viewTx(tx, eventId, s.id),
      })),
    )),
  ];
  const placesOf = new Map<string, GuestPlace[]>();
  const charts: { subEventId: string | null; name: string | null }[] = [];
  for (const { sub, view } of views) {
    if (view.chart.source === 'none') continue;
    charts.push({ subEventId: sub?.id ?? null, name: sub?.name ?? null });
    for (const p of view.placed) {
      const place = view.places.get(p.itemId);
      if (!place) continue;
      const list = placesOf.get(p.guestId) ?? [];
      list.push({
        subEventId: sub?.id ?? null,
        subEventName: sub?.name ?? null,
        kind: place.kind,
        label: place.label,
      });
      placesOf.set(p.guestId, list);
    }
  }
  return { parties: plan.parties, charts, placesOf };
}
