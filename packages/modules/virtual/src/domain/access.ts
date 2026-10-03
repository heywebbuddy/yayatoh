/**
 * Delivery and access modes (M6.9a).
 *
 * An event's **delivery mode** is the events module's `attendance_mode` (in person, online or
 * hybrid; M1.4d): one source of truth for the public page and for streaming. A ticket type's
 * **access mode** says what its holders get: the room, the stream, or both. Without an explicit
 * choice an online event's tickets are virtual and every other event's are in person, so nobody
 * receives a (metered) stream the organizer did not decide to give.
 */
export const DELIVERY_MODES = ['in_person', 'online', 'hybrid'] as const;
export type DeliveryMode = (typeof DELIVERY_MODES)[number];

export const ACCESS_MODES = ['in_person', 'virtual', 'both'] as const;
export type AccessMode = (typeof ACCESS_MODES)[number];

export function defaultAccess(delivery: DeliveryMode): AccessMode {
  return delivery === 'online' ? 'virtual' : 'in_person';
}

/** What a ticket type gives at an event, all things considered. In-person events never stream. */
export function effectiveAccess(delivery: DeliveryMode, explicit: AccessMode | null): AccessMode {
  if (delivery === 'in_person') return 'in_person';
  return explicit ?? defaultAccess(delivery);
}

/** Whether holders of a ticket type may watch the event's streams. */
export const mayWatch = (access: AccessMode): boolean => access !== 'in_person';

export const isDeliveryMode = (v: string): v is DeliveryMode => (DELIVERY_MODES as readonly string[]).includes(v);
