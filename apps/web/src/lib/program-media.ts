/**
 * M1.4h: program images in the console and on public pages (pure, client-safe).
 * Speakers have a photo, exhibitors and sponsors a logo; each has exactly one image.
 */
export type ProgramImageKind = 'speaker' | 'exhibitor' | 'sponsor';

/** The media slot each program row's image lives in (mirrors `PROGRAM_IMAGES` in the media module). */
export const PROGRAM_IMAGE_SLOT = { speaker: 'photo', exhibitor: 'logo', sponsor: 'logo' } as const;

/**
 * The alt text the uploader suggests: "Photo of {name}" for a speaker (localized by `photoOf`),
 * the company name for a logo. The organizer can edit it; it is never empty for a named row.
 */
export function defaultProgramAlt(
  kind: ProgramImageKind,
  name: string,
  photoOf: (name: string) => string,
): string {
  const n = name.trim().slice(0, 250);
  return kind === 'speaker' ? photoOf(n) : n;
}

/**
 * Sponsor logo height by tier rank (0 = the first tier shown): bigger packages, bigger logos.
 * Heights are token-scale Tailwind classes; widths follow the logo's aspect ratio.
 */
export function sponsorLogoClass(rank: number): string {
  return rank === 0 ? 'h-20' : rank === 1 ? 'h-14' : 'h-10';
}
