'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { SetOpenSignupInput, setOpenSignup } from '@/server/open-signup.ts';
import { requireStaff } from '@/server/staff.ts';

/**
 * Flip the open-signup switch (M3.11a; admins only). A reason is required both ways; opening also
 * needs the confirmation box. The outcome comes back in the address (`done` or `error`).
 */
export async function setOpenSignupAction(form: FormData) {
  const staff = await requireStaff('openSignup');
  const parsed = SetOpenSignupInput.safeParse({
    enabled: form.get('enabled') === 'on',
    reason: String(form.get('reason') ?? ''),
    confirm: form.get('confirm') === 'yes',
  });
  if (!parsed.success) {
    const field = parsed.error.issues.some((i) => i.path[0] === 'reason') ? 'reason' : 'confirm';
    redirect(`/open-signup?error=${field}&target=${form.get('enabled') === 'on' ? 'on' : 'off'}`);
  }
  const changed = await setOpenSignup(staff, parsed.data.enabled, parsed.data.reason);
  revalidatePath('/open-signup');
  redirect(`/open-signup?done=${changed ? (parsed.data.enabled ? 'opened' : 'closed') : 'unchanged'}`);
}
