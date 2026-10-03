/** What the gallery's upload Server Actions return to the uploader (host console and guest page). */
export type SlotResult =
  | {
      readonly ok: true;
      readonly itemId: string;
      readonly url: string;
      readonly headers: Record<string, string>;
    }
  | { readonly ok: false; readonly code: string; readonly reason?: string };

export type DoneResult =
  | {
      readonly ok: true;
      readonly status: 'published' | 'pending' | 'refused';
      readonly reason: string | null;
    }
  | { readonly ok: false; readonly code: string; readonly reason?: string };

/** A photo as the slideshow and grids draw it (a subset of the gallery's allowlisted item). */
export interface PhotoView {
  readonly id: string;
  readonly caption: string | null;
  readonly by: string | null;
  readonly byHost: boolean;
  readonly width: number | null;
  readonly height: number | null;
  readonly files: readonly {
    readonly format: 'avif' | 'webp' | 'jpeg' | 'png';
    readonly width: number;
    readonly url: string;
    readonly fallback: boolean;
  }[];
}

/** Reasons the uploader has a message for (anything else falls back to the code's message). */
export const UPLOAD_REASONS = [
  'event_cap',
  'event_items',
  'guest_bytes',
  'guest_items',
  'too_large',
  'size_mismatch',
  'unsupported_type',
  'undecodable',
  'too_many_pixels',
  'heic_unsupported',
  'expired',
  'upload_missing',
  'locked',
  'gallery_closed',
  'rate_limited',
  'network',
] as const;
