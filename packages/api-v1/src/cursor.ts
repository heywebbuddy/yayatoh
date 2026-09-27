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
