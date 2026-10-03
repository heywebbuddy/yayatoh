import { EVENT_CATEGORIES, type EventCategory } from './categories.ts';

/**
 * U8 (UX-2): org-managed categories. Pure rules shared by the commands, the console and tests.
 *
 * A category is addressed by its **ref**: the platform key while it is an unchanged platform
 * default (`music`), else its id. So an org that never touched its list, and old links such as
 * `?category=music`, keep working, and a renamed or custom category has a stable id.
 */
export const MAX_CATEGORY_NAME = 60;
export const MAX_ORG_CATEGORIES = 100;

export function isPlatformKey(ref: string): ref is EventCategory {
  return (EVENT_CATEGORIES as readonly string[]).includes(ref);
}

/** The ref of a stored category: its platform key while unnamed, else its id. */
export function categoryRef(row: { id: string; name: string | null; platformKey: string }): string {
  return row.name === null ? row.platformKey : row.id;
}

/** Trimmed, inner whitespace collapsed; null when empty. Throws when too long. */
export function normalizeCategoryName(raw: string): string | null {
  const name = raw.trim().replace(/\s+/g, ' ');
  if (!name) return null;
  if (name.length > MAX_CATEGORY_NAME) throw new CategoryNameError('name_too_long');
  return name;
}

export class CategoryNameError extends Error {
  readonly reason: 'name_too_long';
  constructor(reason: 'name_too_long') {
    super(reason);
    this.reason = reason;
  }
}

/**
 * The order after moving one item a step up or down (an accessible alternative to dragging).
 * Unknown ids and moves past either end return the order unchanged.
 */
export function moveInOrder(order: readonly string[], id: string, direction: 'up' | 'down'): string[] {
  const next = [...order];
  const at = next.indexOf(id);
  const to = direction === 'up' ? at - 1 : at + 1;
  if (at < 0 || to < 0 || to >= next.length) return next;
  [next[at], next[to]] = [next[to] as string, next[at] as string];
  return next;
}
