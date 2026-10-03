'use server';

import { deleteBrandKitCommand, saveBrandKitCommand } from '@yayatoh/ai';
import { executeCommand } from '@yayatoh/kernel';
import { revalidatePath } from 'next/cache';
import type { FormState } from '@/lib/form-state.ts';
import { loadConsole } from '@/server/console.ts';
import { failure, success } from '@/server/form.ts';
import { ports } from '@/server/ports.ts';

const text = (form: FormData, key: string) => String(form.get(key) ?? '');

/** M6.12b: create or update a brand kit (`kitId` null creates). */
export async function saveBrandKitAction(
  org: string,
  kitId: string | null,
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const data = await loadConsole(org);
  try {
    await executeCommand(
      saveBrandKitCommand,
      {
        kitId,
        name: text(form, 'name'),
        voice: text(form, 'voice'),
        tone: text(form, 'tone') as never,
        keywords: text(form, 'keywords'),
        avoid: text(form, 'avoid'),
        isDefault: form.get('isDefault') === 'on',
      },
      data.ctx,
      ports,
    );
  } catch (err) {
    return failure(err);
  }
  revalidatePath(`/o/${org}/brand-kits`);
  return success();
}

export async function deleteBrandKitAction(org: string, kitId: string, _prev: FormState): Promise<FormState> {
  const data = await loadConsole(org);
  try {
    await executeCommand(deleteBrandKitCommand, { kitId }, data.ctx, ports);
  } catch (err) {
    return failure(err);
  }
  revalidatePath(`/o/${org}/brand-kits`);
  return success();
}
