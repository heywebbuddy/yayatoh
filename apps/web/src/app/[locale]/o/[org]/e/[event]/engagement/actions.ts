'use server';

import { ENGAGEMENT_KINDS, resetScoreWeightsCommand, setScoreWeightsCommand } from '@yayatoh/engagement';
import { executeCommand } from '@yayatoh/kernel';
import { revalidatePath } from 'next/cache';
import type { FormState } from '@/lib/form-state.ts';
import { loadEvent } from '@/server/console.ts';
import { failure, success } from '@/server/form.ts';
import { ports } from '@/server/ports.ts';

const path = (org: string, event: string) => `/o/${org}/e/${event}/engagement`;

/**
 * Save the org's engagement weights (M5.7b): whole points from 0 to 100 per kind. Every score of
 * the org is recomputed with them. Owners and admins only (the command checks `org:update`).
 */
export async function saveWeightsAction(
  org: string,
  event: string,
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const { data } = await loadEvent(org, event, 'sessions');
  const weights: Record<string, number> = {};
  const bad: string[] = [];
  for (const k of ENGAGEMENT_KINDS) {
    const raw = String(form.get(k) ?? '').trim();
    const n = Number(raw);
    if (!/^\d{1,3}$/.test(raw) || n > 100) bad.push(k);
    weights[k] = n;
  }
  if (bad.length) return { ok: false, code: 'validation_failed', fields: bad };
  try {
    await executeCommand(setScoreWeightsCommand, weights as never, data.ctx, ports);
  } catch (err) {
    return failure(err);
  }
  revalidatePath(path(org, event), 'page');
  return success();
}

export async function resetWeightsAction(org: string, event: string, _prev: FormState): Promise<FormState> {
  const { data } = await loadEvent(org, event, 'sessions');
  try {
    await executeCommand(resetScoreWeightsCommand, {}, data.ctx, ports);
  } catch (err) {
    return failure(err);
  }
  revalidatePath(path(org, event), 'page');
  return success();
}
