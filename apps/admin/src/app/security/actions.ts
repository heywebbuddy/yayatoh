'use server';

import { isTwoFactorError } from '@yayatoh/auth';
import { qrPath } from '@yayatoh/pdf';
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { getAuth, getTwoFactor } from '@/server/auth.ts';
import { confirmStaff } from '@/server/confirm.ts';
import { requireStaff } from '@/server/staff.ts';

/** Remove one of the signed-in staff member's own passkeys (Better Auth checks ownership). */
export async function deletePasskeyAction(
  _prev: { code: string | null },
  form: FormData,
): Promise<{ code: string | null }> {
  await requireStaff();
  try {
    await getAuth().api.deletePasskey({
      body: { id: String(form.get('id') ?? '').slice(0, 64) },
      headers: await headers(),
    });
  } catch {
    return { code: 'failed' };
  }
  revalidatePath('/security');
  return { code: 'deleted' };
}

export type StaffTwoFactorState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'error'; readonly code: string }
  | {
      readonly kind: 'key';
      readonly purpose: 'setup' | 'device';
      readonly setupKey: string;
      readonly qr: { readonly size: number; readonly d: string };
    }
  | { readonly kind: 'codes'; readonly backupCodes: readonly string[] }
  | { readonly kind: 'off' };

const codeOf = (err: unknown): string => {
  if (isTwoFactorError(err)) return err.code;
  throw err;
};

/**
 * The staff member's own two-step verification (the same account as the organizer app):
 * - `setup` (confirm with the password) shows a new authenticator key, `verify` turns it on with
 *   a code and returns the backup codes;
 * - `device` (confirm with a code) shows the key in use again, for another phone;
 * - `codes` (confirm with a code) replaces the backup codes;
 * - `off` turns it off with a current code or a backup code.
 * Every change is audited (auth.security_events) by packages/auth.
 */
export async function staffTwoFactorAction(
  _prev: StaffTwoFactorState,
  form: FormData,
): Promise<StaffTwoFactorState> {
  const staff = await requireStaff();
  const twoFactor = getTwoFactor();
  const intent = String(form.get('intent') ?? '');
  try {
    if (intent === 'verify') {
      const { backupCodes } = await twoFactor.confirm(staff.userId, String(form.get('code') ?? ''));
      revalidatePath('/security');
      return { kind: 'codes', backupCodes };
    }
    if (intent === 'off') {
      await twoFactor.disable(staff.userId, String(form.get('code') ?? ''));
      revalidatePath('/security');
      return { kind: 'off' };
    }
    if (intent !== 'setup' && intent !== 'device' && intent !== 'codes')
      return { kind: 'error', code: 'internal' };
    const confirmed = await confirmStaff(staff, form);
    if (!confirmed.ok) return { kind: 'error', code: `two_factor_${confirmed.code}` };
    if (intent === 'codes')
      return { kind: 'codes', backupCodes: await twoFactor.regenerateBackupCodes(staff.userId) };
    const { setupKey, uri } =
      intent === 'setup'
        ? await twoFactor.begin(staff.userId, staff.email)
        : await twoFactor.currentSetup(staff.userId, staff.email);
    return { kind: 'key', purpose: intent, setupKey, qr: qrPath(uri) };
  } catch (err) {
    return { kind: 'error', code: codeOf(err) };
  }
}
