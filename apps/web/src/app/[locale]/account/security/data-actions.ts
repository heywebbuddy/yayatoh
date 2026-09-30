'use server';

import { isDomainError, isStepUpFresh } from '@yayatoh/kernel';
import { deleteAccount } from '@yayatoh/privacy';
import { getLocale } from 'next-intl/server';
import { redirect } from '@/i18n/navigation.ts';
import { notifyAccountDeleted } from '@/server/account.ts';
import { ports } from '@/server/ports.ts';
import { ownSession } from '@/server/session.ts';

/**
 * The person's own data (M1.14e, Yayatoh as controller): download it and delete the account.
 * Both need a recent step-up ("Confirm it's you"); deleting also needs the email typed again and
 * is refused while they are the only owner of an organization.
 */
export interface DataExportState {
  readonly ok: boolean;
  readonly code: string | null;
}

/** Step 1 of a download: confirm it's them; the file then comes from /api/account/export. */
export async function prepareExportAction(_prev: DataExportState, _form: FormData): Promise<DataExportState> {
  // The person's own session only (M1.2d/e): never an impersonation.
  const session = await ownSession();
  if (!session) return { ok: false, code: 'unauthenticated' };
  if (!isStepUpFresh(session.stepUpAt, new Date())) return { ok: false, code: 'step_up_required' };
  return { ok: true, code: null };
}

export interface DeleteAccountState {
  readonly code: string | null;
  /** `last_owner`: the organizations they are the only owner of. */
  readonly orgs?: readonly string[];
}

const norm = (s: string) => s.normalize('NFC').trim().toLowerCase();

export async function deleteAccountAction(
  _prev: DeleteAccountState,
  form: FormData,
): Promise<DeleteAccountState> {
  // The person's own session only (M1.2d/e): never an impersonation.
  const session = await ownSession();
  if (!session) return { code: 'unauthenticated' };
  const confirm = String(form.get('confirm') ?? '');
  if (!confirm.trim()) return { code: 'confirm_required' };
  if (norm(confirm) !== norm(session.email)) return { code: 'confirm_mismatch' };
  try {
    await deleteAccount({
      userId: session.userId,
      email: session.email,
      by: { type: 'self' },
      ports,
      notify: notifyAccountDeleted,
      stepUpAt: session.stepUpAt,
    });
  } catch (err) {
    if (!isDomainError(err)) throw err;
    const d = err.details as { reason?: unknown; orgs?: unknown } | undefined;
    if (d?.reason === 'last_owner' && Array.isArray(d.orgs))
      return { code: 'last_owner', orgs: d.orgs.map(String) };
    return { code: err.code };
  }
  // Every session is gone (this one too); the cookie no longer signs anyone in.
  redirect({ href: '/account/deleted', locale: await getLocale() });
  return { code: null };
}
