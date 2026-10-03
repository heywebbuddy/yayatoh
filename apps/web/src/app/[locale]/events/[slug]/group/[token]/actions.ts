'use server';

import { checkoutTarget } from '@yayatoh/events';
import { createCtx, executeCommand } from '@yayatoh/kernel';
import { substituteByPayerCommand } from '@yayatoh/registration';
import { revalidatePath } from 'next/cache';
import { getLocale } from 'next-intl/server';
import type { FormState } from '@/lib/form-state.ts';
import { failure, success } from '@/server/form.ts';
import { ports } from '@/server/ports.ts';
import { limitAction } from '@/server/rate-limit.ts';

/**
 * Replace one of the people the payer registered (M5.1c), until the type's cut-off: their ticket
 * is reissued to the new person (the old code stops working).
 */
export async function substituteAction(
  slug: string,
  token: string,
  registrantId: string,
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const locale = await getLocale();
  const target = await checkoutTarget(slug);
  if (!target) return { ok: false, code: 'not_found' };
  const name = String(form.get('name') ?? '').trim();
  const email = String(form.get('email') ?? '').trim();
  const fields = [...(name ? [] : ['name']), ...(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? [] : ['email'])];
  if (fields.length) return { ok: false, code: 'validation_failed', fields };
  const limit = await limitAction('checkoutStart');
  if (!limit.allowed) return { ok: false, code: 'rate_limited' };
  try {
    await executeCommand(
      substituteByPayerCommand,
      { token, registrantId, name, email },
      createCtx({ orgId: target.orgId, actor: { type: 'anonymous' }, locale }),
      ports,
    );
  } catch (err) {
    return failure(err);
  }
  revalidatePath(`/events/${slug}/group/${token}`);
  return success();
}
