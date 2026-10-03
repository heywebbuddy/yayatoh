'use server';

import { isDomainError } from '@yayatoh/kernel';
import { deleteSandboxOrg } from '@yayatoh/tenancy';
import { revalidatePath } from 'next/cache';
import { loadConsole } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import { createSeededSandbox } from '@/server/sandbox.ts';

export type SandboxState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'created'; readonly name: string; readonly slug: string }
  | {
      readonly kind: 'error';
      readonly code: string;
      readonly fields: readonly 'name'[];
      /** `sandbox_limit`, `sandbox_of_sandbox`. */
      readonly reason?: string;
    };

/** Create a seeded sandbox org linked to this org (M6.3a). */
export async function createSandboxAction(
  org: string,
  _prev: SandboxState,
  form: FormData,
): Promise<SandboxState> {
  const data = await loadConsole(org);
  const name = String(form.get('name') ?? '').trim();
  try {
    const s = await createSeededSandbox(data.ctx, name);
    revalidatePath(`/o/${org}/sandboxes`);
    return { kind: 'created', name: s.name, slug: s.slug };
  } catch (err) {
    if (!isDomainError(err)) return { kind: 'error', code: 'internal', fields: [] };
    const issues = (err.details?.issues as { path: string }[] | undefined) ?? [];
    const fields = issues.some((i) => i.path.startsWith('name')) ? (['name'] as const) : [];
    const reason = typeof err.details?.reason === 'string' ? err.details.reason : undefined;
    return { kind: 'error', code: err.code, fields, ...(reason ? { reason } : {}) };
  }
}

/** Delete a sandbox (M6.3a, step-up): it closes, its members and keys lose access. */
export async function deleteSandboxAction(
  org: string,
  sandboxId: string,
  _form?: FormData,
): Promise<{ code: string } | undefined> {
  const data = await loadConsole(org);
  try {
    await deleteSandboxOrg(data.ctx, { sandboxId }, ports);
  } catch (err) {
    return { code: isDomainError(err) ? err.code : 'internal' };
  }
  revalidatePath(`/o/${org}/sandboxes`);
}
