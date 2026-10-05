/**
 * The contact collector's pure rules (M4.1f): what a guest may send, how a submission becomes a
 * new party, and the field-by-field merge into an existing party. No I/O.
 */

export const MAX_COLLECTOR_MEMBERS = 12;

/** One person of the household, as the guest typed them. */
export interface CollectorMember {
  readonly firstName: string;
  readonly lastName: string | null;
}

/** What a guest sends (sealed as one JSON object until the host decides). */
export interface CollectorPayload {
  /** How the household calls itself ("The Garcias"). */
  readonly household: string;
  readonly members: readonly CollectorMember[];
  readonly address: string | null;
  readonly email: string | null;
  readonly phone: string | null;
  /** Free text for the host ("We'll need a high chair"), never shown to anyone else. */
  readonly note: string | null;
}

/** The fields a merge can take from a submission, one decision each. */
export const MERGE_FIELDS = ['address', 'email', 'phone'] as const;
export type MergeField = (typeof MERGE_FIELDS)[number];

/** `keep`: the party's value stays; `use`: the submitted value replaces it. */
export type MergeChoice = 'keep' | 'use';

export interface ContactValues {
  readonly address: string | null;
  readonly email: string | null;
  readonly phone: string | null;
}

/** A plain-ASCII-safe email check: one @, a dot in the domain, no spaces. */
export function normalizeEmail(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  return /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/u.test(v) && v.length <= 254 ? v : null;
}

/**
 * A phone as typed, kept in E.164 when it can be: digits with an optional leading `+`, spaces,
 * dots, dashes and brackets dropped. 7–15 digits. Without a `+` the number is kept as digits (the
 * host can fix it); a text is only sent to an E.164 number.
 */
export function normalizePhone(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  if (!/^\+?[\d\s().-]+$/.test(v)) return null;
  const digits = v.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) return null;
  return v.startsWith('+') ? `+${digits}` : digits;
}

export const isE164 = (phone: string | null): phone is string => !!phone && /^\+[1-9]\d{6,14}$/.test(phone);

/**
 * The values a merge leaves on the party's primary guest: per field, `use` takes the submitted
 * value (when it has one), `keep` (or a missing choice) leaves the party's own.
 */
export function mergeContact(
  current: ContactValues,
  submitted: ContactValues,
  choices: Readonly<Partial<Record<MergeField, MergeChoice>>>,
): { values: ContactValues; changed: MergeField[] } {
  const values = { ...current } as { -readonly [K in keyof ContactValues]: ContactValues[K] };
  const changed: MergeField[] = [];
  for (const f of MERGE_FIELDS) {
    if (choices[f] !== 'use' || !submitted[f] || submitted[f] === current[f]) continue;
    values[f] = submitted[f];
    changed.push(f);
  }
  return { values, changed };
}

const fold = (s: string) => s.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('und');

/**
 * Members of a submission the party doesn't have yet (same first and last name, case and spacing
 * aside), so a merge offers only the new people.
 */
export function newMembers(
  existing: readonly { firstName: string | null; lastName: string | null }[],
  members: readonly CollectorMember[],
): number[] {
  const have = new Set(existing.map((g) => `${fold(g.firstName ?? '')}|${fold(g.lastName ?? '')}`));
  const out: number[] = [];
  members.forEach((m, i) => {
    if (!have.has(`${fold(m.firstName)}|${fold(m.lastName ?? '')}`)) out.push(i);
  });
  return out;
}
