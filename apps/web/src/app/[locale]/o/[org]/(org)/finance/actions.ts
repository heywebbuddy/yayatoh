'use server';

import { executeCommand } from '@yayatoh/kernel';
import { resolveReconciliationItemCommand } from '@yayatoh/payments';
import { revalidatePath } from 'next/cache';
import type { FormState } from '@/lib/form-state.ts';
import { loadConsole } from '@/server/console.ts';
import { failure, success } from '@/server/form.ts';
import { ports } from '@/server/ports.ts';

/** Close a reconciliation difference with a note (finance, owners, admins; audited by the command). */
export async function resolveReconciliationAction(
  org: string,
  itemId: string,
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const data = await loadConsole(org);
  try {
    await executeCommand(
      resolveReconciliationItemCommand,
      { itemId, note: String(form.get('note') ?? '') },
      data.ctx,
      ports,
    );
  } catch (err) {
    return failure(err);
  }
  revalidatePath(`/o/${org}/finance`, 'page');
  return success();
}
