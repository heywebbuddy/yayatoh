/** Client-safe exports (no database code): slug rules and limits for the console forms. */

export { ENTRY_KINDS, ENTRY_STATUSES } from './domain/kinds.ts';
export { cmsSlug, SLUG_MAX, type SlugProblem, slugProblem } from './domain/slug.ts';
