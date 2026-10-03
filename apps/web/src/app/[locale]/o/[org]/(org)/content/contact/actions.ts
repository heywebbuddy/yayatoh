'use server';

import { markContactHandledCommand, setContactPageCommand } from '@yayatoh/cms';
import { executeCommand } from '@yayatoh/kernel';
import { revalidatePath, updateTag } from 'next/cache';
import { orgChangeTags } from '@/lib/cache-keys.ts';
import type { FormState } from '@/lib/form-state.ts';
import { loadConsole } from '@/server/console.ts';
import { failure, success } from '@/server/form.ts';
import { ports } from '@/server/ports.ts';

/** U10: turn the contact page on or off and set its line of text. Its public pages follow at once. */
export async function saveContactPageAction(
  org: string,
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const data = await loadConsole(org);
  try {
    await executeCommand(
      setContactPageCommand,
      { enabled: form.get('enabled') === 'on', intro: String(form.get('intro') ?? '').trim() || null },
      data.ctx,
      ports,
    );
  } catch (err) {
    return failure(err);
  }
  for (const tag of orgChangeTags(data.org.id)) updateTag(tag);
  revalidatePath(`/o/${org}/content/contact`);
  return success();
}

/** Mark a contact page message as handled (it leaves the "new" count). */
export async function markContactMessageHandledAction(
  org: string,
  requestId: string,
  _prev: FormState,
  _form: FormData,
): Promise<FormState> {
  const data = await loadConsole(org);
  try {
    await executeCommand(markContactHandledCommand, { requestId }, data.ctx, ports);
  } catch (err) {
    return failure(err);
  }
  revalidatePath(`/o/${org}/content/contact`);
  return success();
}
