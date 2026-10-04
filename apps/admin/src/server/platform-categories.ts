import { withPlatformReader } from '@yayatoh/db/platform';
import { EVENT_CATEGORIES } from '@yayatoh/events/ui';
import { sql } from 'drizzle-orm';

/**
 * U8 (UX-2): the platform's default event category list. Every new organization's category list
 * starts from it (orgs that already changed theirs keep it). Read and written through
 * platform_reader; the write is the SECURITY DEFINER `events.set_platform_default_categories`.
 * Every use lands in the access log with the staff actor.
 */
export interface PlatformCategoryRow {
  readonly key: (typeof EVENT_CATEGORIES)[number];
  readonly inDefaults: boolean;
  readonly position: number;
  readonly updatedBy: string;
  readonly updatedAt: Date;
}

export async function listPlatformCategories(actor: string): Promise<PlatformCategoryRow[]> {
  const rows = await withPlatformReader(
    { actor, reason: 'staff console: platform default categories' },
    (tx) =>
      tx.execute<{
        key: string;
        in_defaults: boolean;
        position: number;
        updated_by: string;
        updated_at: string;
      }>(
        sql`select key, in_defaults, position, updated_by, updated_at from events.platform_categories
          order by in_defaults desc, position, key`,
      ),
  );
  return rows
    .filter((r) => (EVENT_CATEGORIES as readonly string[]).includes(r.key))
    .map((r) => ({
      key: r.key as PlatformCategoryRow['key'],
      inDefaults: r.in_defaults,
      position: Number(r.position),
      updatedBy: r.updated_by,
      updatedAt: new Date(r.updated_at),
    }));
}

/** The default list in order (validated: known keys, each once, at least one). */
export function parseDefaultKeys(keys: readonly string[]): (typeof EVENT_CATEGORIES)[number][] | null {
  const known = keys.filter((k): k is (typeof EVENT_CATEGORIES)[number] =>
    (EVENT_CATEGORIES as readonly string[]).includes(k),
  );
  const unique = [...new Set(known)];
  return unique.length && unique.length === keys.length ? unique : null;
}

/** Move one key a step up or down within the list (unknown keys or the ends: unchanged). */
export function moveKey<T extends string>(keys: readonly T[], key: string, direction: 'up' | 'down'): T[] {
  const next = [...keys];
  const at = next.indexOf(key as T);
  const to = direction === 'up' ? at - 1 : at + 1;
  if (at < 0 || to < 0 || to >= next.length) return next;
  [next[at], next[to]] = [next[to] as T, next[at] as T];
  return next;
}

/** Save the default list (keys in order); returns how many are in it. */
export async function savePlatformDefaults(actor: string, keys: readonly string[]): Promise<number> {
  const [row] = await withPlatformReader(
    { actor, reason: `staff console: set platform default categories (${keys.join(', ')})` },
    (tx) =>
      tx.execute<{ n: number }>(
        sql`select events.set_platform_default_categories(
              array(select jsonb_array_elements_text(${JSON.stringify(keys)}::jsonb)), ${actor}) as n`,
      ),
    { callsWritingFunctions: true },
  );
  return Number(row?.n ?? 0);
}
