'use server';

import { isTwoFactorError } from '@yayatoh/auth';
import { isStepUpFresh } from '@yayatoh/kernel';
import { qrPath } from '@yayatoh/pdf';
import { twoFactorRequiredBy } from '@yayatoh/tenancy';
import { revalidatePath } from 'next/cache';
import { getTwoFactor } from '@/server/auth.ts';
import { getSession } from '@/server/session.ts';

/**
 * Two-step verification for the signed-in person (M1.2c). Starting set-up and replacing backup
 * codes need a recent step-up; turning it off needs a current code and is refused while a role
 * requires it. Every change is audited (auth.security_events) by packages/auth.
 */
export interface SecurityState {
  readonly ok: boolean;
  readonly code: string | null;
}

export interface SetupStart extends SecurityState {
  readonly setupKey?: string;
  readonly qr?: { readonly size: number; readonly d: string };
}

export interface CodesState extends SecurityState {
  readonly backupCodes?: readonly string[];
}

const codeOf = (err: unknown): string => {
  if (isTwoFactorError(err)) return err.code;
  throw err;
};

export async function beginSetupAction(): Promise<SetupStart> {
  const session = await getSession();
  if (!session) return { ok: false, code: 'unauthenticated' };
  if (!isStepUpFresh(session.stepUpAt, new Date())) return { ok: false, code: 'step_up_required' };
  try {
    const { setupKey, uri } = await getTwoFactor().begin(session.userId, session.email);
    return { ok: true, code: null, setupKey, qr: qrPath(uri) };
  } catch (err) {
    return { ok: false, code: codeOf(err) };
  }
}

export async function confirmSetupAction(_prev: CodesState, form: FormData): Promise<CodesState> {
  const session = await getSession();
  if (!session) return { ok: false, code: 'unauthenticated' };
  try {
    const { backupCodes } = await getTwoFactor().confirm(session.userId, String(form.get('code') ?? ''));
    return { ok: true, code: null, backupCodes };
  } catch (err) {
    return { ok: false, code: codeOf(err) };
  }
}

export async function disableAction(_prev: SecurityState, form: FormData): Promise<SecurityState> {
  const session = await getSession();
  if (!session) return { ok: false, code: 'unauthenticated' };
  if ((await twoFactorRequiredBy(session.userId)).length > 0) return { ok: false, code: 'required' };
  try {
    await getTwoFactor().disable(session.userId, String(form.get('code') ?? ''));
  } catch (err) {
    return { ok: false, code: codeOf(err) };
  }
  revalidatePath('/account/security');
  return { ok: true, code: null };
}

export async function regenerateCodesAction(_prev: CodesState, _form: FormData): Promise<CodesState> {
  const session = await getSession();
  if (!session) return { ok: false, code: 'unauthenticated' };
  if (!isStepUpFresh(session.stepUpAt, new Date())) return { ok: false, code: 'step_up_required' };
  try {
    return { ok: true, code: null, backupCodes: await getTwoFactor().regenerateBackupCodes(session.userId) };
  } catch (err) {
    return { ok: false, code: codeOf(err) };
  }
}
