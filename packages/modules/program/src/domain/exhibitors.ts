/**
 * Pure rules of the exhibitor portal (M5.4a): staff allowance counting, membership expiry and
 * booth assignment. Unit-tested; the commands apply them under row locks.
 */

/** Staff badges an exhibitor gets when neither the event nor the exhibitor says (M5.4b packages will). */
export const DEFAULT_STAFF_ALLOWANCE = 5;
/** Portal access lasts until the event ends plus this long (lead export, decision P5-7). */
export const PORTAL_GRACE_MS = 90 * 24 * 3_600_000;

export type MemberRole = 'exhibitor_admin' | 'exhibitor_staff';
export type MemberStatus = 'pending' | 'active' | 'revoked';

/** The exhibitor's own allowance when the organizer set one, else the event's default. */
export function staffAllowance(
  eventDefault: number | null | undefined,
  own: number | null | undefined,
): number {
  return own ?? eventDefault ?? DEFAULT_STAFF_ALLOWANCE;
}

/** Staff who hold a place: invited (pending) or signed in (active). Revoked people free theirs. */
export function holdsPlace(m: { readonly role: string; readonly status: string }): boolean {
  return m.role === 'exhibitor_staff' && (m.status === 'pending' || m.status === 'active');
}

/** Places taken and left under an allowance (never negative, even after the allowance shrinks). */
export function allowanceUse(allowance: number, members: readonly { role: string; status: string }[]) {
  const used = members.filter(holdsPlace).length;
  return { allowance, used, left: Math.max(0, allowance - used) };
}

/** When a member's access (and every link and session) ends: the event's end plus 90 days. */
export function memberExpiry(eventEndsAt: Date): Date {
  return new Date(eventEndsAt.getTime() + PORTAL_GRACE_MS);
}

/* ---------------------------------------------------------------------- booth assignment ---- */

export interface Seat {
  readonly exhibitorId: string;
  readonly isPrimary: boolean;
}

export type AssignOutcome =
  | { readonly kind: 'already'; readonly exhibitorId: string }
  | {
      readonly kind: 'assign';
      /** Whether the new (or existing) exhibitor ends up primary. */
      readonly primary: boolean;
      /** The exhibitor who stops being primary (it stays at the booth as a co-exhibitor). */
      readonly demote: string | null;
      /** Whether the exhibitor is already at the booth (only its primary flag changes). */
      readonly existing: boolean;
    };

/**
 * Assign an exhibitor to a booth. The first exhibitor at a booth is always its primary; later ones
 * are co-exhibitors unless `primary` is asked, which moves the primary role to them (the old
 * primary stays as a co-exhibitor). Asking again for what is already so changes nothing.
 */
export function planAssignment(
  current: readonly Seat[],
  exhibitorId: string,
  primary: boolean,
): AssignOutcome {
  const mine = current.find((s) => s.exhibitorId === exhibitorId);
  const head = current.find((s) => s.isPrimary) ?? null;
  if (mine && (mine.isPrimary || !primary)) return { kind: 'already', exhibitorId };
  const becomesPrimary = primary || head === null;
  return {
    kind: 'assign',
    primary: becomesPrimary,
    demote: becomesPrimary && head && head.exhibitorId !== exhibitorId ? head.exhibitorId : null,
    existing: Boolean(mine),
  };
}

/**
 * After removing an exhibitor from a booth: the co-exhibitor that becomes primary when the
 * primary left (the earliest assigned), or null.
 */
export function nextPrimary(
  remaining: readonly (Seat & { readonly createdAt: Date })[],
  removedWasPrimary: boolean,
): string | null {
  if (!removedWasPrimary || remaining.length === 0) return null;
  return [...remaining].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0]?.exhibitorId ?? null;
}

export const BOOTH_WARNING_KINDS = [
  'booths_overlap',
  'shared_booth',
  'several_booths',
  'category_mismatch',
] as const;
export type BoothWarningKind = (typeof BOOTH_WARNING_KINDS)[number];

export interface BoothWarning {
  readonly kind: BoothWarningKind;
  readonly boothId: string | null;
  readonly otherBoothId: string | null;
  readonly exhibitorId: string | null;
}

interface WarnBooth {
  readonly id: string;
  readonly number: string;
  readonly category: string | null;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

const overlap = (a: WarnBooth, b: WarnBooth) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/**
 * Conflicts on the booth plan, as warnings (the writes still happen, like M1.4f's schedule
 * warnings): booths drawn on top of each other, a booth shared by co-exhibitors, an exhibitor at
 * several booths, and a booth whose category is not one of its exhibitor's categories.
 */
export function boothWarnings(
  booths: readonly WarnBooth[],
  assignments: readonly { boothId: string; exhibitorId: string }[],
  categoriesOf: ReadonlyMap<string, readonly string[]>,
): BoothWarning[] {
  const out: BoothWarning[] = [];
  const sorted = [...booths].sort((a, b) => a.number.localeCompare(b.number, 'en', { numeric: true }));
  for (let i = 0; i < sorted.length; i++)
    for (let j = i + 1; j < sorted.length; j++) {
      const a = sorted[i] as WarnBooth;
      const b = sorted[j] as WarnBooth;
      if (overlap(a, b))
        out.push({ kind: 'booths_overlap', boothId: a.id, otherBoothId: b.id, exhibitorId: null });
    }
  for (const b of sorted) {
    const here = assignments.filter((a) => a.boothId === b.id);
    if (here.length > 1)
      out.push({ kind: 'shared_booth', boothId: b.id, otherBoothId: null, exhibitorId: null });
    if (!b.category) continue;
    const want = b.category.toLowerCase();
    for (const a of here) {
      const cats = categoriesOf.get(a.exhibitorId) ?? [];
      if (cats.length > 0 && !cats.some((c) => c.toLowerCase() === want))
        out.push({
          kind: 'category_mismatch',
          boothId: b.id,
          otherBoothId: null,
          exhibitorId: a.exhibitorId,
        });
    }
  }
  const byExhibitor = new Map<string, number>();
  for (const a of assignments) byExhibitor.set(a.exhibitorId, (byExhibitor.get(a.exhibitorId) ?? 0) + 1);
  for (const [exhibitorId, n] of [...byExhibitor].sort(([a], [b]) => a.localeCompare(b)))
    if (n > 1) out.push({ kind: 'several_booths', boothId: null, otherBoothId: null, exhibitorId });
  return out;
}
