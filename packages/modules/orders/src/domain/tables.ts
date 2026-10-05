/**
 * M4.2b gala tables: the pure rules of naming a purchased table's guest slots (the same on the
 * server and in tests).
 */

/** Order states in which a table's slots may still be named (it was paid, maybe partly refunded). */
export const NAMING_ORDER_STATES = ['paid', 'partially_refunded'] as const;

/** A buyer may email themselves the link again at most once a minute. */
export const RESEND_GAP_MS = 60_000;
/** A host reminds one table at most once an hour. */
export const REMINDER_GAP_MS = 60 * 60_000;

export type NamingRefusal = 'not_paid' | 'event_over';

/** Why a table can't be named now, or null. Naming closes when the event ends. */
export function namingRefusal(orderStatus: string, eventEndsAt: Date, now: Date): NamingRefusal | null {
  if (!(NAMING_ORDER_STATES as readonly string[]).includes(orderStatus)) return 'not_paid';
  if (eventEndsAt.getTime() <= now.getTime()) return 'event_over';
  return null;
}

/**
 * The slot to name: the one asked for, when it is a slot of this table and still unnamed; with
 * none asked for, the first unnamed slot in order. Null when nothing fits.
 */
export function pickSlot(
  slots: readonly { readonly id: string }[],
  named: ReadonlySet<string>,
  wanted: string | null,
): string | null {
  if (wanted) return slots.some((s) => s.id === wanted) && !named.has(wanted) ? wanted : null;
  return slots.find((s) => !named.has(s.id))?.id ?? null;
}

/** Seats named and missing on a table (slots are its live tickets). */
export function tableProgress(slots: number, named: number): { named: number; missing: number } {
  const n = Math.min(named, slots);
  return { named: n, missing: Math.max(0, slots - n) };
}

/** Whether another email may go out for a table, given when the last one went. */
export function mayResend(last: Date | null, now: Date, gapMs: number): boolean {
  return !last || now.getTime() - last.getTime() >= gapMs;
}

/** "Ada Lovelace", or just the first name. */
export function guestFullName(firstName: string, lastName: string | null): string {
  return [firstName.trim(), lastName?.trim() ?? ''].filter(Boolean).join(' ');
}

/**
 * What a refund by tickets pays back, in sold units: an ordinary ticket on its own, a table once
 * (its price covers every seat). A table is refunded whole: every one of its live seats must be
 * chosen, else null (`table_partial`). Returns one representative ticket per unit.
 */
export function refundUnits<T extends { readonly id: string; readonly tableUnitId: string | null }>(
  chosen: readonly T[],
  live: readonly { readonly id: string; readonly tableUnitId: string | null }[],
): T[] | null {
  const picked = new Set(chosen.map((t) => t.id));
  const out: T[] = [];
  const seen = new Set<string>();
  for (const t of chosen) {
    if (!t.tableUnitId) {
      out.push(t);
      continue;
    }
    if (seen.has(t.tableUnitId)) continue;
    seen.add(t.tableUnitId);
    const seats = live.filter((l) => l.tableUnitId === t.tableUnitId);
    if (seats.some((s) => !picked.has(s.id))) return null;
    out.push(t);
  }
  return out;
}
