/**
 * M5.3a speaker portal: the pure rules (no I/O). Change diffs, who a "missing X" reminder reaches,
 * pre-due reminder timing and overdue detection.
 */

export const PROFILE_FIELDS = ['name', 'title', 'company', 'bio', 'links'] as const;
export type ProfileField = (typeof PROFILE_FIELDS)[number];
export const SESSION_FIELDS = ['title', 'description'] as const;
export type SessionField = (typeof SESSION_FIELDS)[number];

export interface FieldChange {
  readonly field: string;
  readonly before: unknown;
  readonly after: unknown;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * The fields a proposal changes, in field order: only keys of `fields` present in `proposed`
 * and different from `base` (links compare as whole lists, in order).
 */
export function changeDiff(
  fields: readonly string[],
  base: Readonly<Record<string, unknown>>,
  proposed: Readonly<Record<string, unknown>>,
): FieldChange[] {
  return fields.flatMap((field) =>
    Object.hasOwn(proposed, field) && !same(base[field], proposed[field])
      ? [{ field, before: base[field] ?? null, after: proposed[field] ?? null }]
      : [],
  );
}

/** Only the changed fields of a proposal (what approval writes). */
export function changedValues(
  fields: readonly string[],
  base: Readonly<Record<string, unknown>>,
  proposed: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  return Object.fromEntries(changeDiff(fields, base, proposed).map((c) => [c.field, c.after]));
}

/**
 * Whether approving is still safe: every changed field still has the value the speaker saw
 * (`base`). If the organizer edited it since, approval would silently overwrite their edit.
 */
export function staleFields(
  fields: readonly string[],
  base: Readonly<Record<string, unknown>>,
  proposed: Readonly<Record<string, unknown>>,
  current: Readonly<Record<string, unknown>>,
): string[] {
  return changeDiff(fields, base, proposed)
    .filter((c) => !same(base[c.field], current[c.field]))
    .map((c) => c.field);
}

export interface AssigneeState {
  readonly id: string;
  readonly subjectId: string;
  readonly status: 'open' | 'done';
}

export interface PortalContact {
  readonly id: string;
  readonly subjectId: string;
  readonly email: string;
}

export interface ReminderPlan {
  /** One message per (assignee, account): who gets the reminder. */
  readonly recipients: readonly { assigneeId: string; subjectId: string; accountId: string; email: string }[];
  /** Assignees missing the task with nobody to email (no live portal access). */
  readonly unreachable: readonly string[];
}

/**
 * "Remind whoever is missing X": exactly the assignees who have not completed the task, reached
 * through each live portal account of their subject. Done assignees never get one; an address
 * shared by two accounts of the same subject gets one message.
 */
export function missingRecipients(
  assignees: readonly AssigneeState[],
  contacts: readonly PortalContact[],
): ReminderPlan {
  const recipients: { assigneeId: string; subjectId: string; accountId: string; email: string }[] = [];
  const unreachable: string[] = [];
  for (const a of assignees) {
    if (a.status !== 'open') continue;
    const seen = new Set<string>();
    const mine = contacts.filter((c) => {
      if (c.subjectId !== a.subjectId || seen.has(c.email)) return false;
      seen.add(c.email);
      return true;
    });
    if (mine.length === 0) unreachable.push(a.subjectId);
    for (const c of mine)
      recipients.push({ assigneeId: a.id, subjectId: a.subjectId, accountId: c.id, email: c.email });
  }
  return { recipients, unreachable };
}

/** The scheduled reminder goes this long before the due date. */
export const PRE_DUE_MS = 48 * 3_600_000;

/**
 * When to send the scheduled pre-due reminder: 48 hours before the due date; at once when that
 * moment has passed but the task is not yet due; never once it is due (the overdue event takes over).
 */
export function preDueReminderAt(dueAt: Date, now: Date): Date | null {
  if (dueAt.getTime() <= now.getTime()) return null;
  const at = dueAt.getTime() - PRE_DUE_MS;
  return new Date(Math.max(at, now.getTime()));
}

/** Overdue: still open after the due date, and not yet reported. */
export const isOverdue = (a: { status: string; overdueAt: Date | null }, dueAt: Date, now: Date): boolean =>
  a.status === 'open' && a.overdueAt === null && dueAt.getTime() <= now.getTime();

/** Dedupe key of a scheduled pre-due reminder: a new due date plans a new one. */
export const preDueKey = (assigneeId: string, accountId: string, dueAt: Date) =>
  `task-due:${assigneeId}:${accountId}:${dueAt.getTime()}`;
