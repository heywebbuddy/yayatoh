import type { GuestOrderDto } from '@yayatoh/orders';

export const ATTENDEE_SECTIONS = [
  'overview',
  'events',
  'tickets',
  'schedule',
  'profile',
  'notifications',
  'settings',
] as const;
export type AttendeeSection = (typeof ATTENDEE_SECTIONS)[number];

/** Order history stays visible; cancelled/refunded bookings do not count as upcoming. */
export function upcomingOrders(orders: readonly GuestOrderDto[], now: Date) {
  return orders
    .filter((order) => order.endsAt > now && order.status !== 'cancelled' && order.status !== 'refunded')
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}

export function attendeeEvents(orders: readonly GuestOrderDto[]) {
  const events = new Map<string, GuestOrderDto>();
  for (const order of orders) if (!events.has(order.eventId)) events.set(order.eventId, order);
  return [...events.values()].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}
