import 'server-only';
import { isDomainError } from '@yayatoh/kernel';
import type { FormState } from '@/lib/form-state.ts';

/** Map a thrown DomainError to the form's state; anything else is rethrown (a real bug). */
export function failure(err: unknown): FormState {
  if (!isDomainError(err)) throw err;
  const details = (err.details ?? {}) as { issues?: { path: string }[]; field?: unknown; reason?: unknown };
  const fields = new Set<string>();
  for (const i of details.issues ?? []) {
    const first = i.path.split('.')[0];
    if (first) fields.add(first);
  }
  if (typeof details.field === 'string') fields.add(details.field);
  return {
    ok: false,
    code: err.code,
    ...(fields.size ? { fields: [...fields] } : {}),
    ...(typeof details.reason === 'string' ? { reason: details.reason } : {}),
  };
}

export const success = (): FormState => ({ ok: true, code: null, stamp: Date.now() });

/** Trimmed text field, or null when empty. */
export const textOrNull = (form: FormData, key: string): string | null => {
  const v = String(form.get(key) ?? '').trim();
  return v ? v : null;
};

/** A number field: null when empty, NaN (rejected by the command) when not a number. */
export const numberOrNull = (form: FormData, key: string): number | null => {
  const v = String(form.get(key) ?? '')
    .trim()
    .replace(',', '.');
  return v ? Number(v) : null;
};
