'use server';

import {
  dismissDuplicateCommand,
  type MERGE_FIELDS,
  mergeContactsCommand,
  mergeDuplicatesBulkCommand,
  scanDuplicatesCommand,
  undoMergeCommand,
} from '@yayatoh/crm';
import { executeCommand, isDomainError } from '@yayatoh/kernel';
import { revalidatePath } from 'next/cache';
import { getLocale } from 'next-intl/server';
import { redirect } from '@/i18n/navigation.ts';
import { loadConsole } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';

/** What a people/duplicates form answers when it can't go on: a code (`invalid_state:reason`). */
export interface PeopleActionState {
  readonly code: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const FIELDS = [
  'name',
  'email',
  'phone',
  'company',
] as const satisfies readonly (typeof MERGE_FIELDS)[number][];

const codeOf = (err: unknown): PeopleActionState => {
  if (!isDomainError(err)) throw err;
  const reason = err.details?.reason;
  return { code: typeof reason === 'string' ? `${err.code}:${reason}` : err.code };
};

/** "Look for duplicates": a full scan now (the background job scans new contacts on its own). */
export async function scanDuplicatesAction(org: string): Promise<PeopleActionState> {
  const data = await loadConsole(org);
  let found: number;
  try {
    ({ found } = await executeCommand(scanDuplicatesCommand, { full: true }, data.ctx, ports));
  } catch (err) {
    return codeOf(err);
  }
  revalidatePath(`/o/${org}/audiences/duplicates`);
  redirect({ href: `/o/${org}/audiences/duplicates?scanned=${found}`, locale: await getLocale() });
  return { code: null };
}

/**
 * Merge one candidate pair: `keep` is the record that stays; each field names the record whose
 * value the merged record takes. Both are record ids of this pair, mapped to source/target here.
 */
export async function mergePairAction(
  org: string,
  pair: { a: string; b: string },
  _prev: PeopleActionState,
  form: FormData,
): Promise<PeopleActionState> {
  const data = await loadConsole(org);
  const keep = String(form.get('keep') ?? '');
  if (keep !== pair.a && keep !== pair.b) return { code: 'validation_failed:keep' };
  const other = keep === pair.a ? pair.b : pair.a;
  const choices = {} as Record<(typeof FIELDS)[number], 'source' | 'target'>;
  for (const f of FIELDS) {
    const v = String(form.get(f) ?? '');
    if (v !== pair.a && v !== pair.b) return { code: `validation_failed:${f}` };
    choices[f] = v === keep ? 'target' : 'source';
  }
  let mergeId: string;
  try {
    ({ mergeId } = await executeCommand(
      mergeContactsCommand,
      { sourceContactId: other, targetContactId: keep, choices },
      data.ctx,
      ports,
    ));
  } catch (err) {
    return codeOf(err);
  }
  revalidatePath(`/o/${org}/audiences/duplicates`);
  redirect({ href: `/o/${org}/audiences/people/${keep}?merged=${mergeId}`, locale: await getLocale() });
  return { code: null };
}

/** "Not the same person": the pair leaves the queue for good. */
export async function dismissPairAction(org: string, candidateId: string): Promise<PeopleActionState> {
  const data = await loadConsole(org);
  try {
    await executeCommand(dismissDuplicateCommand, { candidateId }, data.ctx, ports);
  } catch (err) {
    return codeOf(err);
  }
  revalidatePath(`/o/${org}/audiences/duplicates`);
  redirect({ href: `/o/${org}/audiences/duplicates?dismissed=1`, locale: await getLocale() });
  return { code: null };
}

/** Merge the selected pairs with the defaults (step-up: the form confirms, then resends). */
export async function mergeSelectedAction(
  org: string,
  _prev: PeopleActionState,
  form: FormData,
): Promise<PeopleActionState> {
  const data = await loadConsole(org);
  const ids = [...new Set(form.getAll('candidate').map(String))].filter((v) => UUID.test(v));
  if (ids.length === 0) return { code: 'none_selected' };
  if (ids.length > 50) return { code: 'too_many_selected' };
  let merged: number;
  try {
    ({ merged } = await executeCommand(mergeDuplicatesBulkCommand, { candidateIds: ids }, data.ctx, ports));
  } catch (err) {
    return codeOf(err);
  }
  revalidatePath(`/o/${org}/audiences/duplicates`);
  redirect({ href: `/o/${org}/audiences/duplicates?bulk=${merged}`, locale: await getLocale() });
  return { code: null };
}

/** Undo a merge (30 days): both records come back exactly as they were. */
export async function undoMergeAction(org: string, mergeId: string): Promise<PeopleActionState> {
  const data = await loadConsole(org);
  let r: { sourceContactId: string; targetContactId: string };
  try {
    r = await executeCommand(undoMergeCommand, { mergeId }, data.ctx, ports);
  } catch (err) {
    return codeOf(err);
  }
  revalidatePath(`/o/${org}/audiences/people/${r.targetContactId}`);
  redirect({
    href: `/o/${org}/audiences/people/${r.targetContactId}?undone=${r.sourceContactId}`,
    locale: await getLocale(),
  });
  return { code: null };
}
