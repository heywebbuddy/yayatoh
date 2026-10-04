/**
 * Gallery limits (M4.5b, P4-6). The owner has not set numbers yet, so these are **placeholders**
 * (owner inbox): the per-event storage cap, the per-guest quota (bytes and items) and the largest
 * single upload. A host may lower the cap and the quota for their event, never raise them.
 */
export const GALLERY_LIMITS = {
  /** Stored bytes per event (every photo's variants, plus open upload slots). */
  eventCapBytes: 5 * 1024 ** 3,
  /** Per guest uploader. */
  guestQuotaBytes: 250 * 1024 ** 2,
  guestQuotaItems: 50,
  /** One upload, as the browser sends it (phone HEIC and camera JPEGs fit; Vercel's 4 MB does not apply). */
  maxUploadBytes: 25 * 1024 ** 2,
  /** Items per event, whatever their size. */
  maxItemsPerEvent: 5_000,
  /** How long a presigned upload slot is valid (and counts against the cap if never completed). */
  uploadSlotSeconds: 60 * 60,
} as const;

export const CAPTION_MAX = 280;
export const NAME_MAX = 60;

export type QuotaRefusal = 'event_cap' | 'event_items' | 'guest_bytes' | 'guest_items' | 'too_large';

export interface QuotaFacts {
  /** Bytes the event holds now (processed photos plus open slots), without the item in question. */
  readonly eventBytes: number;
  readonly eventItems: number;
  readonly capBytes: number;
  /** The uploader's own usage; null for a host (hosts have no personal quota). */
  readonly guest: {
    readonly bytes: number;
    readonly items: number;
    readonly quotaBytes: number;
    readonly quotaItems: number;
  } | null;
}

/**
 * May `bytes` more be stored (and, with `newItem`, one more item)? Pure: the commands read the
 * facts under the event's lock and refuse on the first reason, in this order. Exactly at the
 * cap is allowed; one byte over is not.
 */
export function quotaRefusal(f: QuotaFacts, bytes: number, newItem: boolean): QuotaRefusal | null {
  if (bytes > GALLERY_LIMITS.maxUploadBytes && newItem) return 'too_large';
  if (newItem && f.eventItems + 1 > GALLERY_LIMITS.maxItemsPerEvent) return 'event_items';
  if (f.eventBytes + bytes > f.capBytes) return 'event_cap';
  if (f.guest) {
    if (newItem && f.guest.items + 1 > f.guest.quotaItems) return 'guest_items';
    if (f.guest.bytes + bytes > f.guest.quotaBytes) return 'guest_bytes';
  }
  return null;
}

/** A host's setting, clamped to the placeholder maximum (never above, never below 1). */
export function clampLimit(value: number | null | undefined, max: number): number {
  if (value == null || !Number.isFinite(value)) return max;
  return Math.min(max, Math.max(1, Math.floor(value)));
}
