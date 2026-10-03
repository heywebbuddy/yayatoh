/**
 * Apply-to-attend, groups, +1 and substitution (M5.1c), pure: the rules the commands apply and the
 * console shows. No database.
 */
import { domainAllowed, emailDomain, normalizeDomain } from './eligibility.ts';

export type RegistrantStatus = 'pending' | 'approved' | 'reserved' | 'confirmed' | 'denied' | 'cancelled';
export type DecisionSource = 'open' | 'auto_domain' | 'auto_member' | 'manual';
export type Decision = 'approve' | 'deny';

/** The most addresses one member list holds. */
export const MAX_MEMBERS = 5_000;
/** The most registrants one group checkout names (one payer). */
export const MAX_GROUP = 20;

export interface ApprovalRule {
  readonly approval: 'none' | 'manual';
  readonly autoApproveDomains: readonly string[];
}

/**
 * Why an applicant is approved on applying, or null when a person must decide: an address at an
 * auto-approve domain (subdomains match), else one on the type's member list.
 */
export function autoApproval(
  rule: ApprovalRule,
  email: string,
  onMemberList: boolean,
): DecisionSource | null {
  if (rule.approval === 'none') return 'open';
  const d = emailDomain(email);
  if (d && domainAllowed(d, rule.autoApproveDomains)) return 'auto_domain';
  return onMemberList ? 'auto_member' : null;
}

/** What a decision may change: approve a pending (or earlier denied) one; deny before payment. */
export function decisionRefusal(
  status: RegistrantStatus,
  decision: Decision,
  paymentStarted: boolean,
): 'already' | 'not_pending' | 'payment_started' | null {
  if (decision === 'approve') {
    if (status === 'approved' || status === 'confirmed' || status === 'reserved') return 'already';
    return status === 'pending' || status === 'denied' ? null : 'not_pending';
  }
  if (status === 'denied') return 'already';
  if (status === 'approved' && paymentStarted) return 'payment_started';
  return status === 'pending' || status === 'approved' ? null : 'not_pending';
}

const EMAIL = /^[^\s@,;"'<>]+@[^\s@,;"'<>]+\.[^\s@,;"'<>]+$/;

/**
 * A member list from CSV or pasted text: every cell that is an address (any column, any order,
 * a header row is skipped as it holds no address), lower case, each once. Lines with no address
 * count as skipped.
 */
export function parseMemberList(text: string): { emails: string[]; skipped: number } {
  const seen = new Set<string>();
  let skipped = 0;
  const lines = text.split(/\r?\n/);
  for (const [i, line] of lines.entries()) {
    if (!line.trim()) continue;
    const cells = line
      .split(/[,;\t]/)
      .map((c) => c.trim().replace(/^"|"$/g, '').replace(/^<|>$/g, '').trim().toLowerCase());
    const found = cells.filter((c) => c.length <= 254 && EMAIL.test(c));
    if (found.length === 0) {
      if (i > 0 || !/[a-z]/i.test(line)) skipped += 1;
      continue;
    }
    for (const e of found) seen.add(e);
  }
  return { emails: [...seen], skipped };
}

/** Auto-approve domains as stored (normalized, each once); null when one is not a domain. */
export function normalizeDomains(raw: readonly string[]): string[] | null {
  const out = new Set<string>();
  for (const r of raw) {
    if (!r.trim()) continue;
    const d = normalizeDomain(r);
    if (!d) return null;
    out.add(d);
  }
  return [...out];
}

/** Substitution closes `cutoffHours` before the event starts. */
export function substitutionClosesAt(startsAt: Date, cutoffHours: number): Date {
  return new Date(startsAt.getTime() - cutoffHours * 3_600_000);
}

export function substitutionOpen(startsAt: Date, cutoffHours: number, now: Date): boolean {
  return now < substitutionClosesAt(startsAt, cutoffHours);
}

export interface GroupMember {
  readonly name: string;
  readonly email: string;
  readonly registrationTypeId: string;
}

/** What is wrong with a group's names, or null: 1–20 people, each address once. */
export function groupProblem(
  members: readonly GroupMember[],
): 'empty' | 'too_many' | 'duplicate_email' | null {
  if (members.length === 0) return 'empty';
  if (members.length > MAX_GROUP) return 'too_many';
  const emails = members.map((m) => m.email.trim().toLowerCase());
  return new Set(emails).size === emails.length ? null : 'duplicate_email';
}

/** Places a type's registrants need, counted per type (the order's claims). */
export function placesPerType(members: readonly { registrationTypeId: string }[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const m of members) out.set(m.registrationTypeId, (out.get(m.registrationTypeId) ?? 0) + 1);
  return out;
}

/** Pair a confirmed order's admission tickets with its registrants, type by type, in order. */
export function pairTickets<
  R extends { id: string; ticketTypeId: string },
  T extends { id: string; ticketTypeId: string },
>(registrants: readonly R[], tickets: readonly T[]): { registrantId: string; ticketId: string }[] {
  const free = new Map<string, string[]>();
  for (const t of tickets) free.set(t.ticketTypeId, [...(free.get(t.ticketTypeId) ?? []), t.id]);
  const out: { registrantId: string; ticketId: string }[] = [];
  for (const r of registrants) {
    const t = free.get(r.ticketTypeId)?.shift();
    if (t) out.push({ registrantId: r.id, ticketId: t });
  }
  return out;
}
