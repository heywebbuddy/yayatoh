'use server';

import { NewSignupCodeInput } from '@yayatoh/tenancy';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createSignupCode, revokeSignupCode } from '@/server/signup-codes.ts';
import { requireStaff } from '@/server/staff.ts';

export interface NewCodeState {
  /** Shown once, right after creation; never stored or put in a URL. */
  readonly code: string | null;
  readonly expiresAt: string | null;
  readonly errors: Partial<Record<'maxUses' | 'days' | 'note', string>>;
  /** What was typed, kept after a refusal. */
  readonly values: { maxUses: string; days: string; note: string };
}

/** Create a signup code (admins and support). The code is returned to this response only. */
export async function createSignupCodeAction(_prev: NewCodeState, form: FormData): Promise<NewCodeState> {
  const staff = await requireStaff('signupCodes');
  const values = {
    maxUses: String(form.get('maxUses') ?? '').trim(),
    days: String(form.get('days') ?? '').trim(),
    note: String(form.get('note') ?? ''),
  };
  const parsed = NewSignupCodeInput.safeParse({
    maxUses: values.maxUses === '' ? Number.NaN : values.maxUses,
    days: values.days === '' ? Number.NaN : values.days,
    note: values.note,
  });
  if (!parsed.success) {
    const errors: NewCodeState['errors'] = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0] as keyof NewCodeState['errors'];
      errors[key] = key;
    }
    return { code: null, expiresAt: null, errors, values };
  }
  const r = await createSignupCode(staff, parsed.data);
  revalidatePath('/signup-codes');
  return {
    code: r.code,
    expiresAt: r.expiresAt.toISOString(),
    errors: {},
    values: { maxUses: '1', days: '14', note: '' },
  };
}

/** Revoke a code at once (it stops working for new signups; orgs made with it stay). */
export async function revokeSignupCodeAction(id: string) {
  if (!z.uuid().safeParse(id).success) redirect('/signup-codes');
  const staff = await requireStaff('signupCodes');
  const revoked = await revokeSignupCode(staff, id);
  revalidatePath('/signup-codes');
  redirect(`/signup-codes?done=${revoked ? 'revoked' : 'already_revoked'}`);
}
