/**
 * Pure rules of duplicate detection and merging (M6.1a). Browser-safe: no database, no `node:*`.
 */
import type { CONSENT_STATUSES, DUPLICATE_REASONS, MERGE_FIELDS } from '../schema.ts';

export type DuplicateReason = (typeof DUPLICATE_REASONS)[number];
export type MergeField = (typeof MERGE_FIELDS)[number];
export type MergeSide = 'source' | 'target';
export type MergeChoices = Readonly<Record<MergeField, MergeSide>>;
type ConsentStatus = (typeof CONSENT_STATUSES)[number];

/** Mail providers that ignore dots in the local part (and their alias domains). */
const DOTLESS_DOMAINS: Readonly<Record<string, string>> = {
  'gmail.com': 'gmail.com',
  'googlemail.com': 'gmail.com',
};

/**
 * The address as a mailbox receives it: lower-case, without a `+tag`, and for Gmail without dots
 * (`j.doe+vip@googlemail.com` → `jdoe@gmail.com`). Two contacts with the same canonical email are
 * almost certainly one person (`email_norm` is already unique per org).
 */
export function canonicalEmail(email: string): string {
  const e = email.trim().toLowerCase();
  const at = e.lastIndexOf('@');
  if (at <= 0) return e;
  let local = e.slice(0, at);
  let domain = e.slice(at + 1);
  const plus = local.indexOf('+');
  if (plus > 0) local = local.slice(0, plus);
  const dotless = DOTLESS_DOMAINS[domain];
  if (dotless) {
    domain = dotless;
    local = local.replaceAll('.', '');
  }
  return `${local}@${domain}`;
}

/** Name and company similarities (pg_trgm, 0–1) at or above this raise the name + company reason. */
export const NAME_THRESHOLD = 0.6;
export const COMPANY_THRESHOLD = 0.6;

export interface DuplicateSignals {
  readonly sameEmail: boolean;
  readonly samePhone: boolean;
  /** Trigram similarity of the names (0–1), null when either has none. */
  readonly nameSimilarity: number | null;
  /** Trigram similarity of the companies (0–1), null when either has none. */
  readonly companySimilarity: number | null;
}

export interface DuplicateScore {
  /** Confidence 0–99 (never 100: a person decides). */
  readonly score: number;
  readonly reasons: readonly DuplicateReason[];
}

/**
 * The documented score: each reason is an independent piece of evidence with a probability that
 * the pair is one person — same canonical email 0.90, same phone 0.80, similar name and company
 * 0.35 + 0.5 × their mean similarity (0.65–0.85) — combined as 1 − Π(1 − p), in percent, capped
 * at 99. No reason, no candidate (null).
 */
export function scoreDuplicate(s: DuplicateSignals): DuplicateScore | null {
  const parts: [DuplicateReason, number][] = [];
  if (s.sameEmail) parts.push(['email', 0.9]);
  if (s.samePhone) parts.push(['phone', 0.8]);
  if (
    s.nameSimilarity !== null &&
    s.companySimilarity !== null &&
    s.nameSimilarity >= NAME_THRESHOLD &&
    s.companySimilarity >= COMPANY_THRESHOLD
  )
    parts.push(['name_company', 0.35 + 0.5 * ((s.nameSimilarity + s.companySimilarity) / 2)]);
  if (parts.length === 0) return null;
  const miss = parts.reduce((acc, [, p]) => acc * (1 - p), 1);
  return { score: Math.min(99, Math.round(100 * (1 - miss))), reasons: parts.map(([r]) => r) };
}

export interface MergeRecord {
  readonly email: string;
  readonly name: string | null;
  readonly phoneE164: string | null;
  readonly company: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

const fieldValue = (r: MergeRecord, f: MergeField): string | null =>
  f === 'name' ? r.name : f === 'email' ? r.email : f === 'phone' ? r.phoneE164 : r.company;

/**
 * Which record survives by default: the older one (its id is the one more places already know).
 * Ties go to `a`.
 */
export function defaultSurvivor<T extends Pick<MergeRecord, 'createdAt'>>(a: T, b: T): { keep: T; merge: T } {
  return b.createdAt < a.createdAt ? { keep: b, merge: a } : { keep: a, merge: b };
}

/**
 * The default field choices: the most recently updated record's value, unless it is empty, then
 * the other one's. Both empty: the target's.
 */
export function defaultChoices(source: MergeRecord, target: MergeRecord): MergeChoices {
  const recent: MergeSide = source.updatedAt > target.updatedAt ? 'source' : 'target';
  const other: MergeSide = recent === 'source' ? 'target' : 'source';
  const pick = (f: MergeField): MergeSide => {
    const side = { source, target };
    const v = fieldValue(side[recent], f);
    if (v !== null && v.trim() !== '') return recent;
    const w = fieldValue(side[other], f);
    return w !== null && w.trim() !== '' ? other : 'target';
  };
  return { name: pick('name'), email: pick('email'), phone: pick('phone'), company: pick('company') };
}

/** The values the surviving record gets from the choices. */
export function mergedFields(
  source: MergeRecord,
  target: MergeRecord,
  choices: MergeChoices,
): { email: string; name: string | null; phoneE164: string | null; company: string | null } {
  const from = (f: MergeField) => fieldValue(choices[f] === 'source' ? source : target, f);
  return {
    email: from('email') as string,
    name: from('name'),
    phoneE164: from('phone'),
    company: from('company'),
  };
}

/** Strictness order: an opt-out beats everything, a grant beats a legacy unknown, which beats none. */
const RANK: Readonly<Record<ConsentStatus, number>> = { withdrawn: 3, granted: 2, unknown_legacy: 1 };

/**
 * The merged consent for one (channel, purpose): the strictest of the two records' current
 * statuses, an opt-out winning over any grant. Returns which side it came from (null: neither has
 * any row, which means no consent).
 */
export function strictestConsent(
  target: ConsentStatus | null,
  source: ConsentStatus | null,
): { status: ConsentStatus | null; from: MergeSide | null } {
  if (target === null && source === null) return { status: null, from: null };
  if (source === null) return { status: target, from: 'target' };
  if (target === null) return { status: source, from: 'source' };
  return RANK[source] > RANK[target] ? { status: source, from: 'source' } : { status: target, from: 'target' };
}

/** Merges can be undone for this long (M6.1a: 30 days). */
export const UNDO_WINDOW_MS = 30 * 86_400_000;

/** Bulk merges (several pairs in one step) need step-up and take at most this many pairs. */
export const BULK_MERGE_MAX = 50;
