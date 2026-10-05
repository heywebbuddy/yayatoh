'use server';

import { executeCommand } from '@yayatoh/kernel';
import { archiveSupportMacroCommand, MACRO_ACTIONS, saveSupportMacroCommand } from '@yayatoh/orders';
import { revalidatePath } from 'next/cache';
import type { SupportState } from '@/components/support-tools.tsx';
import { loadConsole } from '@/server/console.ts';
import { failure, success } from '@/server/form.ts';
import { ports } from '@/server/ports.ts';

type MacroAction = (typeof MACRO_ACTIONS)[number];

/** Create a support macro, or change one (M3.10c). */
export async function saveMacroAction(
  org: string,
  macroId: string | null,
  _prev: SupportState,
  form: FormData,
): Promise<SupportState> {
  const data = await loadConsole(org);
  const actions = form
    .getAll('actions')
    .map(String)
    .filter((a): a is MacroAction => (MACRO_ACTIONS as readonly string[]).includes(a));
  try {
    await executeCommand(
      saveSupportMacroCommand,
      {
        ...(macroId ? { macroId } : {}),
        name: String(form.get('name') ?? ''),
        subject: String(form.get('subject') ?? ''),
        body: String(form.get('body') ?? ''),
        actions,
      },
      data.ctx,
      ports,
    );
  } catch (err) {
    return failure(err);
  }
  revalidatePath(`/o/${org}/macros`);
  return success();
}

/** Retire a macro (kept in the run history of the orders it ran on). */
export async function archiveMacroAction(
  org: string,
  macroId: string,
  _prev: SupportState,
  _form: FormData,
): Promise<SupportState> {
  const data = await loadConsole(org);
  try {
    await executeCommand(archiveSupportMacroCommand, { macroId }, data.ctx, ports);
  } catch (err) {
    return failure(err);
  }
  revalidatePath(`/o/${org}/macros`);
  return success();
}
