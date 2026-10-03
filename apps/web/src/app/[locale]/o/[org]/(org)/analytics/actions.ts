'use server';

import { startBackfillCommand } from '@yayatoh/analytics';
import { executeCommand } from '@yayatoh/kernel';
import { revalidatePath } from 'next/cache';
import type { FormState } from '@/lib/form-state.ts';
import { loadConsole } from '@/server/console.ts';
import { failure, success } from '@/server/form.ts';
import { ports } from '@/server/ports.ts';

/** Rebuild the org's analytics from its orders and check-ins (owners and admins; audited by the command). */
export async function startBackfillAction(
  org: string,
  _prev: FormState,
  _form: FormData,
): Promise<FormState> {
  const data = await loadConsole(org);
  try {
    await executeCommand(startBackfillCommand, {}, data.ctx, ports);
  } catch (err) {
    return failure(err);
  }
  revalidatePath(`/o/${org}/analytics`, 'page');
  return success();
}
