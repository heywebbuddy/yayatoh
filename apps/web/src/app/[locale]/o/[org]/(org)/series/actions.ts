'use server';

import { createSeriesCommand, deleteSeriesCommand } from '@yayatoh/events';
import { executeCommand, isDomainError } from '@yayatoh/kernel';
import { revalidatePath } from 'next/cache';
import { loadConsole } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';

export interface SeriesFormState {
  readonly ok: boolean;
  readonly code: string | null;
  readonly field?: string;
}

export async function createSeriesAction(
  org: string,
  _prev: SeriesFormState,
  form: FormData,
): Promise<SeriesFormState> {
  const data = await loadConsole(org);
  try {
    await executeCommand(
      createSeriesCommand,
      {
        name: String(form.get('name') ?? '').trim(),
        description: String(form.get('description') ?? '').trim() || null,
      },
      data.ctx,
      ports,
    );
  } catch (err) {
    if (!isDomainError(err)) throw err;
    const issue = Array.isArray(err.details?.issues)
      ? (err.details.issues[0] as { path?: string } | undefined)
      : undefined;
    const field = typeof err.details?.field === 'string' ? err.details.field : issue?.path;
    return field ? { ok: false, code: err.code, field } : { ok: false, code: err.code };
  }
  revalidatePath(`/o/${org}`, 'layout');
  return { ok: true, code: null };
}

export async function deleteSeriesAction(org: string, seriesId: string): Promise<void> {
  const data = await loadConsole(org);
  await executeCommand(deleteSeriesCommand, { seriesId }, data.ctx, ports);
  revalidatePath(`/o/${org}`, 'layout');
}
