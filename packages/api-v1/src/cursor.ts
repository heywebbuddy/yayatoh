import type { KeysetAfter } from '@yayatoh/contracts';
import { DomainError } from '@yayatoh/kernel';

/**
 * Opaque cursors for /v1 lists: base64url of the last row's keyset position. Clients pass
 * `nextCursor` back as `cursor`; they must not build or parse them.
 */
export function encodeCursor(after: KeysetAfter): string {
  return Buffer.from(JSON.stringify([after.at.toISOString(), after.id])).toString('base64url');
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function decodeCursor(cursor: string | undefined): KeysetAfter | undefined {
  if (cursor === undefined || cursor === '') return undefined;
  try {
    const v = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown;
    if (Array.isArray(v) && v.length === 2 && typeof v[0] === 'string' && typeof v[1] === 'string') {
      const at = new Date(v[0]);
      if (!Number.isNaN(at.getTime()) && UUID.test(v[1])) return { at, id: v[1] };
    }
  } catch {}
  throw new DomainError('validation_failed', 'Invalid cursor', { field: 'cursor' });
}

export const DEFAULT_LIMIT = 25;
export const MAX_LIMIT = 100;

/**
 * One page from `limit + 1` fetched rows: the extra row only says whether there is more. The
 * cursor points at the last row returned.
 */
export function pageOf<T>(
  rows: readonly T[],
  limit: number,
  keyOf: (row: T) => KeysetAfter,
): { data: T[]; nextCursor: string | null } {
  const data = rows.slice(0, limit);
  const last = data[data.length - 1];
  return { data, nextCursor: rows.length > limit && last ? encodeCursor(keyOf(last)) : null };
}

/** A sort key for `pageByKey`: compared as plain strings (code units), then by id (or slug). */
export type SortKey = readonly [key: string, id: string];

const compareKeys = (a: SortKey, b: SortKey) =>
  a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0;

/**
 * One keyset page over a short list read whole (per-event content is capped at a few hundred
 * rows): the rows are ordered by `keyOf`, and the cursor carries the last row's key and id, so a
 * row added or removed between pages never shifts the next one. The cursor has the same opaque
 * shape as `encodeCursor` (a time key is its ISO string).
 */
export function pageByKey<T>(
  rows: readonly T[],
  limit: number,
  cursor: string | undefined,
  keyOf: (row: T) => SortKey,
): { data: T[]; nextCursor: string | null } {
  const after = decodeKeyCursor(cursor);
  const sorted = rows
    .map((row) => ({ row, key: keyOf(row) }))
    .sort((a, b) => compareKeys(a.key, b.key))
    .filter((x) => !after || compareKeys(x.key, after) > 0);
  const page = sorted.slice(0, limit);
  const last = page[page.length - 1];
  return {
    data: page.map((x) => x.row),
    nextCursor:
      sorted.length > limit && last
        ? Buffer.from(JSON.stringify([last.key[0], last.key[1]])).toString('base64url')
        : null,
  };
}

function decodeKeyCursor(cursor: string | undefined): SortKey | undefined {
  if (cursor === undefined || cursor === '') return undefined;
  try {
    const v = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown;
    if (
      Array.isArray(v) &&
      v.length === 2 &&
      typeof v[0] === 'string' &&
      v[0].length <= 200 &&
      typeof v[1] === 'string' &&
      /^[a-z0-9-]{1,100}$/i.test(v[1])
    )
      return [v[0], v[1]];
  } catch {}
  throw new DomainError('validation_failed', 'Invalid cursor', { field: 'cursor' });
}

/** A case-insensitive name key, cut so a cursor stays short (ties fall back to the id). */
export const nameKey = (name: string) => name.toLocaleLowerCase('en').slice(0, 60);

/** Newest first as an ascending key (for `pageByKey`). */
export const newestFirst = (at: Date) => String(9_999_999_999_999 - at.getTime()).padStart(13, '0');
