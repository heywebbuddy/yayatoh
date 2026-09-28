'use server';

import { PostIncidentInput, UpdateIncidentInput } from '@yayatoh/platform';
import { revalidatePath } from 'next/cache';
import { incidentProvider, postIncident, updateIncident } from '@/server/incidents.ts';
import { requireStaff } from '@/server/staff.ts';

export interface IncidentFormState {
  readonly ok: boolean;
  /** Fields the server rejected. */
  readonly errors: readonly string[];
  /** Changes on every success so the form resets. */
  readonly stamp: number;
  readonly closed?: boolean;
}

const fieldsOf = (issues: readonly { path: PropertyKey[] }[]) => [...new Set(issues.map((i) => String(i.path[0])))];

/** Open an incident on the (fake) status page: title, impact, components, first update. */
export async function postIncidentAction(_prev: IncidentFormState, form: FormData): Promise<IncidentFormState> {
  const staff = await requireStaff('incidents');
  if (incidentProvider() !== 'fake') return { ok: false, errors: ['provider'], stamp: Date.now() };
  const parsed = PostIncidentInput.safeParse({
    title: String(form.get('title') ?? ''),
    impact: String(form.get('impact') ?? ''),
    components: form.getAll('components').map(String),
    body: String(form.get('body') ?? ''),
  });
  if (!parsed.success) return { ok: false, errors: fieldsOf(parsed.error.issues), stamp: Date.now() };
  await postIncident(staff, parsed.data);
  revalidatePath('/incidents');
  return { ok: true, errors: [], stamp: Date.now() };
}

/** Add an update to an open incident; "resolved" / "completed" close it. */
export async function updateIncidentAction(
  id: string,
  _prev: IncidentFormState,
  form: FormData,
): Promise<IncidentFormState> {
  const staff = await requireStaff('incidents');
  if (incidentProvider() !== 'fake') return { ok: false, errors: ['provider'], stamp: Date.now() };
  const parsed = UpdateIncidentInput.safeParse({
    id,
    status: String(form.get('status') ?? ''),
    body: String(form.get('body') ?? ''),
  });
  if (!parsed.success) return { ok: false, errors: fieldsOf(parsed.error.issues), stamp: Date.now() };
  const updated = await updateIncident(staff, parsed.data);
  revalidatePath('/incidents');
  return { ok: updated, errors: updated ? [] : ['closed'], stamp: Date.now(), closed: !updated };
}
