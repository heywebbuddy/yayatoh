import 'server-only';
import {
  type ApplicationKind,
  type ApplicationStatus,
  defaultDecisionEmail,
  INVITATION_DAYS,
  invitationEmail,
  NoteInput,
  nextStatuses,
  type PlainEmail,
  renderPlainEmail,
} from '@yayatoh/applications';
import { getUsersByIds } from '@yayatoh/auth';
import { withPlatformReader } from '@yayatoh/db/platform';
import { DomainError } from '@yayatoh/kernel';
import { hashSignupCode, randomSignupCode } from '@yayatoh/tenancy';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { sendConsoleMail } from './mail.ts';
import type { Staff } from './staff.ts';

export interface ApplicationRow {
  readonly id: string;
  readonly kind: ApplicationKind;
  readonly status: ApplicationStatus;
  readonly orgName: string;
  readonly orgType: string;
  readonly country: string;
  readonly website: string | null;
  readonly contactName: string;
  readonly contactEmail: string;
  readonly contactPhone: string | null;
  readonly eventTypes: readonly string[];
  readonly eventsPerYear: string;
  readonly expectedTickets: string;
  readonly planInterest: string;
  readonly whiteLabel: boolean;
  readonly message: string | null;
  readonly preferredTime: Date | null;
  readonly timezone: string | null;
  readonly locale: string;
  readonly assignedTo: string | null;
  readonly approvedPlan: string | null;
  readonly decidedBy: string | null;
  readonly decidedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface ApplicationNote {
  readonly id: string;
  readonly body: string;
  readonly author: string;
  readonly createdAt: Date;
}

export interface ApplicationEvent {
  readonly id: string;
  readonly action: string;
  readonly actor: string;
  readonly data: Record<string, unknown>;
  readonly at: Date;
}

type Raw = Record<string, unknown>;
const str = (v: unknown) => (v === null || v === undefined ? null : String(v));
const date = (v: unknown) => (v === null || v === undefined ? null : new Date(String(v)));

function toRow(r: Raw): ApplicationRow {
  return {
    id: String(r.id),
    kind: r.kind as ApplicationKind,
    status: r.status as ApplicationStatus,
    orgName: String(r.org_name),
    orgType: String(r.org_type),
    country: String(r.country),
    website: str(r.website),
    contactName: String(r.contact_name),
    contactEmail: String(r.contact_email),
    contactPhone: str(r.contact_phone),
    eventTypes: (r.event_types as string[]) ?? [],
    eventsPerYear: String(r.events_per_year),
    expectedTickets: String(r.expected_tickets),
    planInterest: String(r.plan_interest),
    whiteLabel: r.white_label === true,
    message: str(r.message),
    preferredTime: date(r.preferred_time),
    timezone: str(r.timezone),
    locale: String(r.locale),
    assignedTo: str(r.assigned_to),
    approvedPlan: str(r.approved_plan),
    decidedBy: str(r.decided_by),
    decidedAt: date(r.decided_at),
    createdAt: new Date(String(r.created_at)),
    updatedAt: new Date(String(r.updated_at)),
  };
}

/** `staff:<id>` → the staff member's name (anything else as it is). */
async function names(actors: readonly (string | null)[]): Promise<Map<string, string>> {
  const id = (a: string) => /^staff:([0-9a-f-]{36})$/.exec(a)?.[1] ?? null;
  const all = [...new Set(actors.filter((a): a is string => Boolean(a)))];
  const users = await getUsersByIds(all.map(id).filter((x): x is string => x !== null));
  return new Map(all.map((a) => [a, users.get(id(a) ?? '')?.name ?? a]));
}

export const ApplicationFilter = z.object({
  status: z.enum(['new', 'in_review', 'approved', 'rejected', 'needs_info']).optional(),
  assignee: z.string().max(60).optional(),
  q: z.string().trim().max(100).optional(),
});
export type ApplicationFilter = z.infer<typeof ApplicationFilter>;

export interface ApplicationList {
  readonly rows: readonly (ApplicationRow & { assigneeName: string | null })[];
  readonly counts: Readonly<Record<ApplicationStatus | 'all', number>>;
}

/** The queue: newest first, filtered by status, assignee (a `staff:` actor or `none`) and a search. */
export async function listApplications(
  staff: Staff,
  filter: ApplicationFilter = {},
): Promise<ApplicationList> {
  if (!staff.can('applications')) throw new DomainError('forbidden');
  const f = ApplicationFilter.parse(filter);
  const like = f.q ? `%${f.q.replace(/[\\%_]/g, '\\$&')}%` : null;
  const { rows, counts } = await withPlatformReader(
    { actor: staff.actor, reason: 'staff console: list organizer applications' },
    async (tx) => ({
      rows: await tx.execute<Raw>(
        sql`select * from applications.applications
            where (${f.status ?? null}::text is null or status = ${f.status ?? null})
              and (${f.assignee ?? null}::text is null
                   or (${f.assignee ?? null} = 'none' and assigned_to is null)
                   or assigned_to = ${f.assignee ?? null})
              and (${like}::text is null or org_name ilike ${like} or contact_name ilike ${like}
                   or contact_email ilike ${like})
            order by created_at desc, id desc limit 300`,
      ),
      counts: await tx.execute<{ status: string; n: number }>(
        sql`select status, count(*)::int as n from applications.applications group by status`,
      ),
    }),
  );
  const who = await names(rows.map((r) => str(r.assigned_to)));
  const c: Record<string, number> = { all: 0, new: 0, in_review: 0, approved: 0, rejected: 0, needs_info: 0 };
  for (const r of counts) {
    c[r.status] = r.n;
    c.all = (c.all ?? 0) + r.n;
  }
  return {
    rows: rows.map((r) => {
      const row = toRow(r);
      return { ...row, assigneeName: row.assignedTo ? (who.get(row.assignedTo) ?? row.assignedTo) : null };
    }),
    counts: c as ApplicationList['counts'],
  };
}

export interface ApplicationDetail {
  readonly application: ApplicationRow;
  readonly assigneeName: string | null;
  readonly decidedByName: string | null;
  readonly notes: readonly (ApplicationNote & { authorName: string })[];
  readonly events: readonly (ApplicationEvent & { actorName: string })[];
  readonly next: readonly ApplicationStatus[];
}

export async function getApplication(staff: Staff, id: string): Promise<ApplicationDetail | null> {
  if (!staff.can('applications')) throw new DomainError('forbidden');
  if (!z.uuid().safeParse(id).success) return null;
  const { app, notes, events } = await withPlatformReader(
    { actor: staff.actor, reason: `staff console: view organizer application ${id}` },
    async (tx) => ({
      app: await tx.execute<Raw>(sql`select * from applications.applications where id = ${id}::uuid`),
      notes: await tx.execute<Raw>(
        sql`select * from applications.notes where application_id = ${id}::uuid order by created_at desc, id desc`,
      ),
      events: await tx.execute<Raw>(
        sql`select * from applications.events where application_id = ${id}::uuid order by at desc, id desc`,
      ),
    }),
  );
  if (!app[0]) return null;
  const application = toRow(app[0]);
  const who = await names([
    application.assignedTo,
    application.decidedBy,
    ...notes.map((n) => str(n.author)),
    ...events.map((e) => str(e.actor)),
  ]);
  const nm = (a: string) => who.get(a) ?? a;
  return {
    application,
    assigneeName: application.assignedTo ? nm(application.assignedTo) : null,
    decidedByName: application.decidedBy ? nm(application.decidedBy) : null,
    notes: notes.map((n) => ({
      id: String(n.id),
      body: String(n.body),
      author: String(n.author),
      authorName: nm(String(n.author)),
      createdAt: new Date(String(n.created_at)),
    })),
    events: events.map((e) => ({
      id: String(e.id),
      action: String(e.action),
      actor: String(e.actor),
      actorName: nm(String(e.actor)),
      data: (e.data as Record<string, unknown>) ?? {},
      at: new Date(String(e.at)),
    })),
    next: nextStatuses(application.status),
  };
}

/** Active staff who can review applications (the assignee list). */
export async function reviewers(staff: Staff): Promise<{ actor: string; name: string }[]> {
  const rows = await withPlatformReader(
    { actor: staff.actor, reason: 'staff console: list application reviewers' },
    (tx) =>
      tx.execute<{ user_id: string; role: string }>(
        sql`select user_id, role from platform.staff where revoked_at is null and role in ('admin', 'support')`,
      ),
  );
  const users = await getUsersByIds(rows.map((r) => r.user_id));
  return rows
    .map((r) => ({ actor: `staff:${r.user_id}`, name: users.get(r.user_id)?.name ?? r.user_id }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The plans an application can be approved onto: every plan that exists, active ones first. */
export async function approvablePlans(
  staff: Staff,
): Promise<{ key: string; name: string; active: boolean }[]> {
  const rows = await withPlatformReader(
    { actor: staff.actor, reason: 'staff console: list plans for application approval' },
    (tx) =>
      tx.execute<{ key: string; name: string; active: boolean }>(
        sql`select p.key, p.name, coalesce(c.active, false) as active
            from billing.plans p left join billing.plan_catalog c on c.plan_key = p.key
            order by coalesce(c.active, false) desc, coalesce(c.sort_order, 9999), p.key`,
      ),
  );
  return rows.map((r) => ({ key: r.key, name: r.name, active: r.active }));
}

async function write<T>(
  staff: Staff,
  reason: string,
  run: (tx: Parameters<Parameters<typeof withPlatformReader<T>>[1]>[0]) => Promise<T>,
) {
  return withPlatformReader({ actor: staff.actor, reason }, run, { callsWritingFunctions: true });
}

export async function assignApplication(staff: Staff, id: string, assignee: string | null): Promise<void> {
  if (!staff.can('applications')) throw new DomainError('forbidden');
  if (assignee !== null && !/^staff:[0-9a-f-]{36}$/.test(assignee))
    throw new DomainError('validation_failed');
  await write(staff, `staff console: assign organizer application ${id}`, (tx) =>
    tx.execute(sql`select applications.assign(${id}::uuid, ${assignee}, ${staff.actor})`),
  );
}

export async function addApplicationNote(staff: Staff, id: string, body: string): Promise<void> {
  if (!staff.can('applications')) throw new DomainError('forbidden');
  const note = NoteInput.parse({ body });
  await write(staff, `staff console: note on organizer application ${id}`, (tx) =>
    tx.execute(sql`select applications.add_note(${id}::uuid, ${note.body}, ${staff.actor})`),
  );
}

/** Move to "in review" (take it, reopen it). Approvals and the two emailed decisions have their own paths. */
export async function markInReview(staff: Staff, id: string): Promise<void> {
  if (!staff.can('applications')) throw new DomainError('forbidden');
  await write(staff, `staff console: organizer application ${id} → in_review`, (tx) =>
    tx.execute(sql`select applications.set_status(${id}::uuid, 'in_review', ${staff.actor}, '')`),
  );
}

const webOrigin = () =>
  (process.env.NEXT_PUBLIC_APP_ORIGIN ?? process.env.BETTER_AUTH_URL ?? 'http://localhost:3000').replace(
    /\/$/,
    '',
  );

export const DecisionMail = z.object({
  subject: z.string().trim().min(3).max(200),
  body: z.string().trim().min(10).max(5000),
});

/** The text staff start from for a decision email, filled in for this applicant. */
export function decisionDefaults(kind: 'needs_info' | 'rejected', a: ApplicationRow): PlainEmail {
  return defaultDecisionEmail(kind, { contactName: a.contactName, orgName: a.orgName });
}

async function rowOf(staff: Staff, id: string): Promise<ApplicationRow> {
  const d = await getApplication(staff, id);
  if (!d) throw new DomainError('not_found');
  return d.application;
}

/**
 * "Needs info" and "Reject": staff edit the email, it is sent first, then the status changes and
 * both are written to the audit log. If the email cannot be sent nothing changes.
 */
export async function sendDecision(
  staff: Staff,
  id: string,
  kind: 'needs_info' | 'rejected',
  mail: z.input<typeof DecisionMail>,
): Promise<void> {
  if (!staff.can('applications')) throw new DomainError('forbidden');
  const m = DecisionMail.parse(mail);
  const app = await rowOf(staff, id);
  if (!nextStatuses(app.status).includes(kind)) throw new DomainError('invalid_state');
  const rendered = renderPlainEmail({ subject: m.subject, body: m.body });
  await sendConsoleMail({
    to: app.contactEmail,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    key: `application-${kind}-${id}-${Date.now()}`,
  });
  await write(staff, `staff console: organizer application ${id} → ${kind}`, async (tx) => {
    await tx.execute(sql`select applications.set_status(${id}::uuid, ${kind}, ${staff.actor}, ${m.subject})`);
    await tx.execute(sql`select applications.log_email(${id}::uuid, ${kind}, ${m.subject}, ${staff.actor})`);
  });
}

export const ApproveInput = z.object({
  plan: z.string().regex(/^[a-z][a-z0-9_]{1,40}$/),
  note: z.string().trim().max(1000).default(''),
});

export interface ApproveResult {
  readonly emailSent: boolean;
}

function planNameOf(plans: { key: string; name: string }[], key: string) {
  return plans.find((p) => p.key === key)?.name ?? key;
}

/**
 * Approve: one single-use signup code tied to the applicant's email and the chosen plan (the
 * existing signup-code table, created in the same transaction as the status change), then the
 * invitation email. The code only ever exists in that email. If the email fails the application
 * stays approved and "Resend invitation" issues a fresh code.
 */
export async function approveApplication(
  staff: Staff,
  id: string,
  value: z.input<typeof ApproveInput>,
): Promise<ApproveResult> {
  if (!staff.can('applications')) throw new DomainError('forbidden');
  const input = ApproveInput.parse(value);
  const app = await rowOf(staff, id);
  if (!nextStatuses(app.status).includes('approved')) throw new DomainError('invalid_state');
  const code = randomSignupCode();
  const expires = new Date(Date.now() + INVITATION_DAYS * 86_400_000);
  await write(staff, `staff console: approve organizer application ${id} on ${input.plan}`, (tx) =>
    tx.execute(
      sql`select applications.approve(${id}::uuid, ${hashSignupCode(code)}, ${input.plan}, ${expires.toISOString()}::timestamptz, ${staff.actor})`,
    ),
  );
  return { emailSent: await mailInvitation(staff, app, input.plan, code, input.note) };
}

/** A fresh code for an approved application whose invitation was lost (the old one stops working). */
export async function resendInvitation(staff: Staff, id: string): Promise<ApproveResult> {
  if (!staff.can('applications')) throw new DomainError('forbidden');
  const app = await rowOf(staff, id);
  if (app.status !== 'approved' || !app.approvedPlan) throw new DomainError('invalid_state');
  const code = randomSignupCode();
  const expires = new Date(Date.now() + INVITATION_DAYS * 86_400_000);
  await write(staff, `staff console: reissue invitation for organizer application ${id}`, (tx) =>
    tx.execute(
      sql`select applications.reissue(${id}::uuid, ${hashSignupCode(code)}, ${expires.toISOString()}::timestamptz, ${staff.actor})`,
    ),
  );
  return { emailSent: await mailInvitation(staff, app, app.approvedPlan, code, '') };
}

async function mailInvitation(
  staff: Staff,
  app: ApplicationRow,
  plan: string,
  code: string,
  note: string,
): Promise<boolean> {
  const plans = await approvablePlans(staff);
  const url = `${webOrigin()}/signup?code=${encodeURIComponent(code)}`;
  const mail = renderPlainEmail(
    invitationEmail(
      {
        contactName: app.contactName,
        orgName: app.orgName,
        plan,
        planName: planNameOf(plans, plan),
        days: INVITATION_DAYS,
      },
      url,
      note,
    ),
  );
  try {
    await sendConsoleMail({
      to: app.contactEmail,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
      key: `application-invite-${app.id}-${Date.now()}`,
    });
  } catch {
    return false;
  }
  await write(staff, `staff console: invitation emailed for organizer application ${app.id}`, (tx) =>
    tx.execute(
      sql`select applications.log_email(${app.id}::uuid, 'invitation', ${mail.subject}, ${staff.actor})`,
    ),
  );
  return true;
}
