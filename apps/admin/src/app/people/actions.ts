'use server';

import type { AccountUser } from '@yayatoh/auth';
import { withPlatformReader } from '@yayatoh/db/platform';
import { isDomainError, isProductionEnv } from '@yayatoh/kernel';
import { consoleTransport, devMailboxTransports, sendAccountNotice } from '@yayatoh/notifications';
import { deleteAccount, exportAccount, StaffReason } from '@yayatoh/privacy';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { getTwoFactor } from '@/server/auth.ts';
import { confirmStaff } from '@/server/confirm.ts';
import { liveEmail } from '@/server/mail.ts';
import { hasAnything, lookupPerson, type PersonLookup } from '@/server/people.ts';
import { ports } from '@/server/ports.ts';
import { requireStaff } from '@/server/staff.ts';

const Email = z.string().trim().toLowerCase().max(320).pipe(z.email());

export type FindState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'error'; readonly code: string }
  | {
      readonly kind: 'found';
      readonly person: PersonLookup;
      readonly found: boolean;
      readonly nonce: string;
    };

/** Find a person by email (posted, never in a URL). Admin and support only. */
export async function findPersonAction(_prev: FindState, form: FormData): Promise<FindState> {
  const staff = await requireStaff('privacy');
  const email = Email.safeParse(form.get('email'));
  if (!email.success) return { kind: 'error', code: 'invalid_email' };
  const person = await lookupPerson(staff, email.data);
  return { kind: 'found', person, found: hasAnything(person), nonce: crypto.randomUUID() };
}

export type ExportState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'error'; readonly code: string }
  | { readonly kind: 'ready'; readonly fileName: string; readonly json: string };

/**
 * Access request handled by staff: the person's account data as JSON (the same allowlisted
 * `yayatoh.account/1` document they can download themselves). A written reason is required and
 * recorded with the request.
 */
export async function exportPersonAction(_prev: ExportState, form: FormData): Promise<ExportState> {
  const staff = await requireStaff('privacy');
  const email = Email.safeParse(form.get('email'));
  if (!email.success) return { kind: 'error', code: 'invalid_email' };
  const reason = StaffReason.safeParse(form.get('reason'));
  if (!reason.success) return { kind: 'error', code: 'reason_required' };
  const { doc, fileName } = await exportAccount({
    email: email.data,
    by: { type: 'staff', staffUserId: staff.userId, reason: reason.data },
  });
  return { kind: 'ready', fileName, json: `${JSON.stringify(doc, null, 2)}\n` };
}

export type EraseState =
  | { readonly kind: 'idle' }
  | {
      readonly kind: 'error';
      readonly code: string;
      readonly field?: string;
      readonly orgs?: readonly string[];
    }
  | { readonly kind: 'erased'; readonly requestId: string; readonly summary: Record<string, number> };

/** The deletion confirmation to the old address: SES when configured, else the dev mailbox or a log. */
async function notify(to: string, user: AccountUser) {
  const dev = process.env.YAYATOH_DEV_AUTH === '1' && !isProductionEnv();
  await sendAccountNotice(liveEmail() ?? (dev ? devMailboxTransports().email : consoleTransport()), {
    to,
    name: user.name,
    locale: user.locale,
  });
}

/**
 * Erase a person at their request: the same rules as self-service deletion (refused while they are
 * the only owner of an org), plus a written reason and the email typed again. Active staff must
 * have their staff role revoked first (owner CLI). Recorded in privacy.account_requests with the
 * staff member and reason; each org's audit chain records its part.
 */
export async function erasePersonAction(_prev: EraseState, form: FormData): Promise<EraseState> {
  const staff = await requireStaff('privacy');
  const email = Email.safeParse(form.get('email'));
  if (!email.success) return { kind: 'error', code: 'invalid_email' };
  const confirm = String(form.get('confirm') ?? '')
    .trim()
    .toLowerCase();
  if (confirm !== email.data) return { kind: 'error', code: 'confirm_mismatch', field: 'confirm' };
  const reason = StaffReason.safeParse(form.get('reason'));
  if (!reason.success) return { kind: 'error', code: 'reason_required', field: 'reason' };
  const person = await lookupPerson(staff, email.data);
  if (person.staffRole) return { kind: 'error', code: 'is_staff' };
  try {
    const r = await deleteAccount({
      email: email.data,
      by: { type: 'staff', staffUserId: staff.userId, reason: reason.data },
      ports,
      notify,
    });
    return { kind: 'erased', requestId: r.requestId, summary: r.summary };
  } catch (err) {
    if (!isDomainError(err)) throw err;
    const d = err.details as { reason?: unknown; orgs?: unknown } | undefined;
    if (d?.reason === 'last_owner' && Array.isArray(d.orgs))
      return { kind: 'error', code: 'last_owner', orgs: d.orgs.map(String) };
    return { kind: 'error', code: err.code };
  }
}

export type ResetTwoFactorState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'error'; readonly code: string; readonly field?: string }
  | { readonly kind: 'reset'; readonly wasOn: boolean };

/**
 * Turn a person's two-step verification off (a lost phone, a shared test account): their
 * authenticator and backup codes are removed, and they sign in with their password or an email
 * code until they set one up again. Admin and support, with a reason and their own confirmation.
 * Staff accounts are refused: staff manage their own on the Security page.
 */
export async function resetTwoFactorAction(
  _prev: ResetTwoFactorState,
  form: FormData,
): Promise<ResetTwoFactorState> {
  const staff = await requireStaff('twoFactor');
  const email = Email.safeParse(form.get('email'));
  if (!email.success) return { kind: 'error', code: 'invalid_email' };
  const reason = StaffReason.safeParse(form.get('reason'));
  if (!reason.success) return { kind: 'error', code: 'reason_required', field: 'reason' };
  const person = await lookupPerson(staff, email.data);
  if (!person.account) return { kind: 'error', code: 'not_found' };
  if (person.staffRole) return { kind: 'error', code: 'is_staff_two_factor' };
  const confirmed = await confirmStaff(staff, form);
  if (!confirmed.ok) return { kind: 'error', code: `two_factor_${confirmed.code}`, field: 'proof' };
  const [user] = await withPlatformReader(
    { actor: staff.actor, reason: `staff console: two-step verification off for a person: ${reason.data}` },
    (tx) =>
      tx.execute<{ id: string }>(
        sql`select id from auth.users where lower(email) = ${email.data} and deleted_at is null`,
      ),
  );
  if (!user) return { kind: 'error', code: 'not_found' };
  const r = await getTwoFactor().staffDisable(user.id, { staffUserId: staff.userId, reason: reason.data });
  return { kind: 'reset', wasOn: r.wasOn };
}
