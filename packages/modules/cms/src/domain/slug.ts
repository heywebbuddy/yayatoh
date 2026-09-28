/** CMS slug rules (M1.4g): lowercase ASCII letters, digits and single hyphens, 1–80 characters. */
export const SLUG_MAX = 80;

const FORMAT = /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){0,79}$/;

export type SlugProblem = 'empty' | 'too_long' | 'format';

/** Why a slug the organizer typed can't be used, or null when it can. */
export function slugProblem(slug: string): SlugProblem | null {
  if (slug.length === 0) return 'empty';
  if (slug.length > SLUG_MAX) return 'too_long';
  return FORMAT.test(slug) ? null : 'format';
}

/** A slug from a title: accents folded, anything else becomes a hyphen; never empty. */
export function cmsSlug(title: string): string {
  const s = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX - 4)
    .replace(/-+$/g, '');
  return s || 'untitled';
}

/** The first free slug: `base`, then `base-2`, `base-3`, … (slugs are unique per org and kind). */
export function nextFreeSlug(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}
